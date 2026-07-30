// The lock files themselves: `.corpus/locks/<docId>.json` (SPEC.md §7).
//
// A lock is runtime state — gitignored, rebuildable, and *not* contract surface
// beyond the four fields `LockSchema` declares.
//
// The file used to carry a fifth, server-internal field — `deferredEventId`,
// the one queue event whose edit had been deferred because this lock was held —
// so a force-break could put that work back. Nothing in the API could ever set
// it (sprint-005 Open Conflict 8), and SERVER-030 replaced it with the real
// mechanism: the deferral is recorded on the **event** (`blockedOn`), which
// scales to the several events that can queue behind one lock, covers release
// and reap as well as break, and survives a restart in the file the queue
// already owns. Two places recording "the deferred edit" would leave no answer
// to which one is authoritative, so there is one.

import { randomBytes } from "node:crypto";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_LOCK_TTL_SECONDS, LockSchema, type Lock } from "@corpus/contract";

export const LOCKS_DIR_NAME = "locks";

/**
 * Upper bound on a lease, in seconds. A TTL is what stops a crashed editor from
 * wedging a document, so an unbounded one would defeat the mechanism; a request
 * asking for more is clamped rather than rejected, because the caller's intent
 * ("hold it for a long time") is honoured as far as the rule allows.
 *
 * There is deliberately **no** lower clamp: `AcquireLockRequestSchema`'s
 * `.min(1)` is the floor, and a deliberately short lease is a legitimate ask.
 */
export const MAX_LOCK_TTL_SECONDS = 1800;

export { DEFAULT_LOCK_TTL_SECONDS };

/** `.corpus/locks/` only ever holds `<documentId>.json`. */
const LOCK_FILE = /^((?:doc|th)_[A-Za-z0-9]+)\.json$/;

/**
 * The on-disk lock. Parsed non-strictly, so a file left behind by an older
 * build — one still carrying `deferredEventId` — is read rather than rejected;
 * the key is simply dropped, and the lock keeps working.
 */
export const StoredLockSchema = LockSchema;

export type StoredLock = z.infer<typeof StoredLockSchema>;

/** The four contract fields, and nothing else: what every response carries. */
export function toWireLock(lock: StoredLock): Lock {
  return { docId: lock.docId, holder: lock.holder, acquired: lock.acquired, ttl: lock.ttl };
}

/** Clamps a requested lease to {@link MAX_LOCK_TTL_SECONDS}. */
export function clampTtl(ttl: number | undefined): number {
  return Math.min(ttl ?? DEFAULT_LOCK_TTL_SECONDS, MAX_LOCK_TTL_SECONDS);
}

/** When the lease runs out, in epoch milliseconds; `NaN` when `acquired` is not a date. */
export function expiresAtMs(lock: StoredLock): number {
  return Date.parse(lock.acquired) + lock.ttl * 1000;
}

/**
 * Expiry is evaluated **on read**, everywhere — acquire, list, the guard and the
 * projection all ask this question rather than trusting the reaper to have run.
 * A stale lease therefore blocks nothing even before its file is deleted.
 *
 * Phrased as a negated "still live" rather than a comparison, because every
 * comparison with `NaN` is false: a lease nobody can date reads as expired,
 * which is the safe answer — an undateable file must not be able to wedge a
 * document.
 */
export function isExpired(lock: StoredLock, nowMs: number): boolean {
  return !(nowMs < expiresAtMs(lock));
}

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/**
 * Notified about every lock file written or removed, with the bytes that land
 * (`null` for a removal), so the watcher can tell the server's own writes from
 * an outside editor's (SPEC.md §9.1).
 */
export type LockWriteObserver = (absPath: string, content: string | null) => void;

/**
 * The lock directory. Every write is a temp file plus a rename inside the same
 * directory, so a concurrent reader sees either the old file or the whole new
 * one — never a truncated one.
 */
export class LockStore {
  readonly locksDir: string;

  constructor(
    readonly corpusDir: string,
    private readonly observeWrite?: LockWriteObserver | undefined,
  ) {
    this.locksDir = join(corpusDir, LOCKS_DIR_NAME);
  }

  /** Called at boot, before the first request: the directory must exist. */
  ensureLayoutSync(): void {
    mkdirSync(this.locksDir, { recursive: true });
  }

  pathFor(docId: string): string {
    return join(this.locksDir, `${docId}.json`);
  }

  /**
   * The lock file as it stands, expiry not considered. A malformed file reads as
   * absent: it cannot describe a holder, so it cannot refuse anybody, and the
   * next acquire simply overwrites it.
   */
  async read(docId: string): Promise<StoredLock | undefined> {
    let text: string;
    try {
      text = await readFile(this.pathFor(docId), "utf8");
    } catch (error) {
      if (isEnoent(error)) return undefined;
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return undefined;
    }
    const parsed = StoredLockSchema.safeParse(raw);
    // The path is the addressing the API uses, so a file whose `docId` field
    // disagrees is corrected rather than rejected.
    return parsed.success ? { ...parsed.data, docId } : undefined;
  }

  /** The lock only if it is still live; `undefined` for absent, malformed or expired. */
  async readLive(docId: string, nowMs: number): Promise<StoredLock | undefined> {
    const lock = await this.read(docId);
    if (lock === undefined || isExpired(lock, nowMs)) return undefined;
    return lock;
  }

  async write(lock: StoredLock): Promise<void> {
    this.ensureLayoutSync();
    const tmpPath = join(
      this.locksDir,
      `.tmp-${lock.docId}-${randomBytes(4).toString("hex")}.json`,
    );
    const body = `${JSON.stringify(lock, null, 2)}\n`;
    try {
      await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
      // Announced before the rename: the watcher can see the file the instant it
      // lands, and a registration made afterwards would lose that race.
      this.observeWrite?.(this.pathFor(lock.docId), body);
      await rename(tmpPath, this.pathFor(lock.docId));
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  /** `false` means there was nothing to remove, which is never an error. */
  async remove(docId: string): Promise<boolean> {
    this.observeWrite?.(this.pathFor(docId), null);
    try {
      await unlink(this.pathFor(docId));
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  /** Every lock file, expiry not considered, sorted by document id. */
  async listAll(): Promise<StoredLock[]> {
    let names: string[];
    try {
      names = await readdir(this.locksDir);
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    const locks: StoredLock[] = [];
    for (const name of names.sort()) {
      const docId = LOCK_FILE.exec(name)?.[1];
      if (docId === undefined) continue;
      const lock = await this.read(docId);
      if (lock !== undefined) locks.push(lock);
    }
    return locks;
  }
}
