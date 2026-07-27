// Document edit locks (SPEC.md §7): one holder per document, file-backed, with a
// TTL, a reaper and a user-only force break.
//
// The server is the sole writer of lock files — the agent's CLI edit verbs and
// the user's editor session both acquire *through here*, which is what makes
// "one holder at a time" a property of the system rather than of everybody's
// good behaviour.

import type { Actor, Lock, QueryKey } from "@corpus/contract";
import { formatInstant } from "../core/time.js";
import { conflict, forbidden, notFound } from "../errors.js";
import { LOCKS_KEY, docKey, lockKey } from "../events/index.js";
import type { AutoCommitter } from "../git/index.js";
import { silentLogger, type Logger } from "../logger.js";
import { projectLock, removeLock, type ProjectionDb } from "../projection/index.js";
import type { QueueService } from "../queue/index.js";
import {
  LockStore,
  clampTtl,
  isExpired,
  toWireLock,
  type LockWriteObserver,
  type StoredLock,
} from "./store.js";

export type LockInvalidate = (keys: readonly QueryKey[]) => void;

export interface LockServiceOptions {
  readonly corpusDir: string;
  /**
   * The `locks` table and the document existence check both live here: a lock is
   * per-document, never free-form, so acquiring one for an id the projection does
   * not know is a 404.
   */
  readonly projection: ProjectionDb;
  readonly queue: QueueService;
  /**
   * The server's one git writer (`git/commit.ts`). Shared with the document
   * write path rather than a second spawner of its own, so a force break's audit
   * entry is serialized against in-flight document commits on the same index
   * lock — two processes writing `.git/index` at once cross-contaminate.
   */
  readonly git: AutoCommitter;
  readonly invalidate?: LockInvalidate | undefined;
  readonly observeWrite?: LockWriteObserver | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => number) | undefined;
}

export interface BreakResult {
  readonly holder: Actor;
  /** The event put back on the queue, when the broken lock carried one. */
  readonly requeuedEventId: string | undefined;
}

/** The subject line a force break records in the audit trail (SPEC.md §7). */
export function forceBreakSubject(docId: string, previousHolder: Actor): string {
  return `lock: force-break on ${docId} (was ${previousHolder}) by user`;
}

/**
 * The trailer naming whose lease was taken away — the machine-readable half of
 * the subject above. `Corpus-Actor` says who *broke* it, which is always `user`;
 * this says who *held* it. Lock-specific, hence declared here rather than beside
 * the universal trailers in `git/commit.ts`.
 */
export const TRAILER_LOCK_HOLDER = "Corpus-Lock-Holder";

export class LockService {
  readonly store: LockStore;
  private readonly projection: ProjectionDb;
  private readonly queue: QueueService;
  private readonly git: AutoCommitter;
  private readonly invalidate: LockInvalidate;
  private readonly logger: Logger;
  private readonly now: () => number;
  /** One lock transition at a time in this process; two acquires can then never both win. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: LockServiceOptions) {
    this.store = new LockStore(options.corpusDir, options.observeWrite);
    this.projection = options.projection;
    this.queue = options.queue;
    this.git = options.git;
    this.invalidate = options.invalidate ?? (() => undefined);
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
    this.store.ensureLayoutSync();
  }

  /**
   * Every live lock, expired leases excluded even though their files still
   * exist.
   *
   * Also brings the `locks` table back in line with what it just read. A lease
   * expires by the passage of time, not by anything writing a file, so no write
   * path and no watcher event ever fires for it — and a row left behind would
   * put a banner on a document nobody is editing. The listing is what the UI
   * calls to hydrate those banners, so it is exactly the moment to reconcile;
   * nothing is broadcast, because the expiry changed no state a client could not
   * already have computed from `acquired` and `ttl`.
   */
  async list(): Promise<Lock[]> {
    const at = this.now();
    const locks = await this.store.listAll();
    const live: Lock[] = [];
    for (const lock of locks) {
      if (isExpired(lock, at)) removeLock(this.projection, lock.docId);
      else {
        projectLock(this.projection, this.projection.config.corpusDir, lock.docId, at);
        live.push(toWireLock(lock));
      }
    }
    return live;
  }

  /**
   * Takes the lock, or renews it when the caller already holds it. An expired
   * lease is treated as absent, so a crashed editor never wedges a document; a
   * live lease held by the other party is a `409` carrying that lock.
   */
  async acquire(docId: string, holder: Actor, ttl?: number): Promise<Lock> {
    return this.serialize(async () => {
      if (!this.documentExists(docId)) {
        throw notFound(`no document ${docId}`);
      }
      const at = this.now();
      const existing = await this.store.read(docId);
      if (existing !== undefined && !isExpired(existing, at) && existing.holder !== holder) {
        throw conflict(
          `${docId} is locked by ${existing.holder} until its lease expires`,
          toWireLock(existing),
        );
      }

      const lock: StoredLock = {
        docId,
        holder,
        acquired: formatInstant(at),
        ttl: clampTtl(ttl),
        // A renewal keeps the deferred event the previous lease recorded; a
        // takeover of an expired lease does not inherit one.
        ...(existing !== undefined &&
        existing.holder === holder &&
        existing.deferredEventId !== undefined
          ? { deferredEventId: existing.deferredEventId }
          : {}),
      };
      await this.store.write(lock);
      this.project(docId);
      this.announce(docId);
      return toWireLock(lock);
    });
  }

  /**
   * Only the holder may release. Someone else's lock is broken, not released —
   * so a mismatch is `403` (the caller may not make this call), distinct from
   * the `409` an acquire conflict earns.
   */
  async release(docId: string, actor: Actor): Promise<Actor> {
    return this.serialize(async () => {
      const existing = await this.requireLock(docId);
      if (existing.holder !== actor) {
        throw forbidden(
          `${docId} is locked by ${existing.holder}; only the holder may release it — break the lock instead`,
        );
      }
      await this.store.remove(docId);
      removeLock(this.projection, docId);
      this.announce(docId);
      return existing.holder;
    });
  }

  /**
   * The human escape hatch for a stuck agent lock (SPEC.md §7). **User-only**: an
   * agent breaking its own contention would defeat the mechanism.
   *
   * `.corpus/` is gitignored, so the audit-trail entry has no file to stage and
   * is an explicit empty commit through the server's one git writer. A break
   * whose deferred edit is known puts that event back on the queue rather than
   * losing it.
   */
  async forceBreak(docId: string, actor: Actor): Promise<BreakResult> {
    return this.serialize(async () => {
      if (actor !== "user") {
        throw forbidden("force-breaking a lock is user-only; the agent waits or defers");
      }
      const existing = await this.requireLock(docId);
      await this.store.remove(docId);
      removeLock(this.projection, docId);
      this.announce(docId);

      const requeuedEventId = await this.requeueDeferred(existing);
      await this.recordBreak(docId, existing.holder);
      return { holder: existing.holder, requeuedEventId };
    });
  }

  /** Deletes every expired lock file and reports which documents were freed. */
  async reap(): Promise<string[]> {
    return this.serialize(async () => {
      const at = this.now();
      const reaped: string[] = [];
      for (const lock of await this.store.listAll()) {
        if (!isExpired(lock, at)) continue;
        await this.store.remove(lock.docId);
        removeLock(this.projection, lock.docId);
        reaped.push(lock.docId);
      }
      if (reaped.length > 0) {
        this.invalidate([LOCKS_KEY, ...reaped.flatMap((docId) => [lockKey(docId), docKey(docId)])]);
      }
      return reaped;
    });
  }

  /**
   * The live lock on a document, or `undefined`. The write-path guard's one
   * question (see `guard.ts`); expiry is evaluated here, so a stale lease never
   * refuses a write.
   */
  async liveLock(docId: string): Promise<Lock | undefined> {
    const lock = await this.store.readLive(docId, this.now());
    return lock === undefined ? undefined : toWireLock(lock);
  }

  private async requireLock(docId: string): Promise<StoredLock> {
    // Expiry is not consulted: releasing or breaking a lease that has run out is
    // still an operation on a lock that exists, and the file is what goes away.
    const existing = await this.store.read(docId);
    if (existing === undefined) throw notFound(`no lock on ${docId}`);
    return existing;
  }

  private documentExists(docId: string): boolean {
    const row = this.projection
      .prepare("SELECT 1 AS present FROM documents WHERE id = ?")
      .get(docId);
    return row !== undefined;
  }

  private async requeueDeferred(lock: StoredLock): Promise<string | undefined> {
    const eventId = lock.deferredEventId;
    if (eventId === undefined) return undefined;
    try {
      await this.queue.requeue(eventId);
      return eventId;
    } catch (error) {
      // The deferred event may have been completed or reaped while the lock sat
      // there; a break must still clear the lock.
      this.logger.info("deferred event could not be re-enqueued", {
        docId: lock.docId,
        eventId,
        error: String(error),
      });
      return undefined;
    }
  }

  private async recordBreak(docId: string, previousHolder: Actor): Promise<void> {
    const outcome = await this.git.commit({
      docId,
      actor: "user",
      subject: forceBreakSubject(docId, previousHolder),
      // `.corpus/` is gitignored, so a break has no file to stage: the audit
      // entry is an explicit empty commit. And it is its own event, never part
      // of whatever editing session preceded it — hence `squash: false`, which
      // also keeps it from amending a document commit.
      paths: [],
      trailers: [`${TRAILER_LOCK_HOLDER}: ${previousHolder}`],
      allowEmpty: true,
      squash: false,
    });
    if (outcome.kind === "committed" || outcome.kind === "amended") return;
    // The lock is already gone; a missing audit entry is loud, never fatal
    // (SPEC.md §14 — the failure surfaces, the mutation stands).
    this.logger.error("force-break audit commit did not land", {
      docId,
      previousHolder,
      reason: outcome.reason,
      ...(outcome.kind === "failed" ? { output: outcome.output } : {}),
    });
  }

  /** Re-projects one lock, dropping the row when the file is gone or expired. */
  private project(docId: string): void {
    projectLock(this.projection, this.projection.config.corpusDir, docId, this.now());
  }

  private announce(docId: string): void {
    // The document's own key too, so the banner clears everywhere the document
    // is visible — a board row, a reader, a search result (SPEC.md §7).
    this.invalidate([LOCKS_KEY, lockKey(docId), docKey(docId)]);
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work, work);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createLockService(options: LockServiceOptions): LockService {
  return new LockService(options);
}
