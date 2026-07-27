import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "@hono/zod-openapi";
import {
  IsoDateTimeSchema,
  QUEUE_EVENT_STATUSES,
  QueueEventSchema,
  QueueEventStatusSchema,
  type QueueEvent,
  type QueueEventStatus,
} from "@corpus/contract";
import { normalizeInstant } from "../core/time.js";

/** `.corpus/queue/<status>/<id>.json` and the `.corpus/HALT` sentinel (SPEC.md §7). */
export const QUEUE_DIR_NAME = "queue";
export const HALT_FILE_NAME = "HALT";

/**
 * The only thing that counts as an event, anywhere: listing, claiming, counting,
 * reaping and the boot rebuild. Every `corpus init` workspace ships a `.gitkeep`
 * in each status directory, and an in-flight write leaves a `.tmp-*` file next
 * to its target — neither is an event (sprint-003 adjudication 3).
 */
const EVENT_FILE_NAME = /^(evt_[A-Za-z0-9]+)\.json$/;

/** How much of a corrupt file is carried into its `failed/` replacement. */
export const MAX_SALVAGED_BYTES = 8192;

/** The `type` given to an event file that could not be parsed as one. */
export const MALFORMED_EVENT_TYPE = "corpus.malformed";

/**
 * The on-disk event: the contract's wire shape plus the transition bookkeeping
 * only the server reads (sprint-003 adjudication 7). `status` duplicates the
 * directory for readability — the **directory is authoritative**, so a file that
 * disagrees (a crash between the rename and the rewrite, or a hand-moved file)
 * is read as its directory says, never as its field claims. Unknown top-level
 * keys are not preserved across a transition; `payload` is where extensibility
 * lives, and it is copied verbatim.
 */
export const StoredEventSchema = QueueEventSchema.extend({
  status: QueueEventStatusSchema.optional(),
  updated: IsoDateTimeSchema.optional(),
  attempts: z.number().int().min(0).optional(),
  error: z.string().min(1).optional(),
});

export type StoredEvent = z.infer<typeof StoredEventSchema> & {
  readonly status: QueueEventStatus;
};

/** The five contract fields, and nothing else: what every route responds with. */
export function toWireEvent(event: StoredEvent): QueueEvent {
  return {
    id: event.id,
    type: event.type,
    created: event.created,
    source: event.source,
    payload: event.payload,
  };
}

export type ReadEventResult =
  | { readonly ok: true; readonly event: StoredEvent }
  | { readonly ok: false; readonly reason: string; readonly text: string };

/** `.corpus/HALT`: why the agent stopped picking up work, and since when. */
export const HaltSentinelSchema = z.object({
  reason: z.string().min(1).optional(),
  at: IsoDateTimeSchema,
});

export type HaltSentinel = z.infer<typeof HaltSentinelSchema>;

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const eventIdFromFileName = (name: string): string | undefined => EVENT_FILE_NAME.exec(name)?.[1];

/**
 * Hand-written and out-of-band files are read leniently and normalized in memory
 * (core/time.ts); only what the server itself writes is canonical.
 */
function normalizeInstants(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw };
  for (const field of ["created", "updated"]) {
    const value = normalized[field];
    if (typeof value === "string") {
      const instant = normalizeInstant(value);
      if (instant !== null) normalized[field] = instant;
    }
  }
  return normalized;
}

/**
 * Parses one event file. `id` and `status` come from the path, which is the
 * addressing the API uses — a file whose JSON disagrees is corrected, not
 * rejected, so `complete <id>` can never be unreachable because of a bad field.
 */
export function parseEventFile(
  text: string,
  id: string,
  status: QueueEventStatus,
): ReadEventResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `not JSON: ${error instanceof Error ? error.message : String(error)}`,
      text,
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "not a JSON object", text };
  }

  const candidate = { ...normalizeInstants(raw as Record<string, unknown>), id, status };
  const parsed = StoredEventSchema.safeParse(candidate);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    return { ok: false, reason, text };
  }
  return { ok: true, event: { ...parsed.data, status } };
}

/**
 * The stand-in written to `failed/` for a file that could not be parsed, so a
 * corrupt event is quarantined with its evidence instead of poisoning a batch.
 */
export function salvageEvent(
  id: string,
  reason: string,
  text: string,
  at: string,
): StoredEvent & { readonly error: string } {
  return {
    id,
    type: MALFORMED_EVENT_TYPE,
    created: at,
    source: "corpus",
    payload: { raw: text.slice(0, MAX_SALVAGED_BYTES) },
    status: "failed",
    updated: at,
    error: `malformed event file: ${reason}`,
  };
}

/**
 * Notified about every file the queue writes or removes, with the bytes that
 * land (`null` for a removal). The watcher registers these as self-writes so a
 * transition it performed is not re-projected and re-announced a second time
 * (SPEC.md §9.1 — "server-originated writes re-project synchronously … without
 * double-broadcasting").
 */
export type QueueWriteObserver = (absPath: string, content: string | null) => void;

/**
 * The queue's filesystem. Every write is a temp file plus a rename inside the
 * same directory, so a concurrent reader sees either the old file or the whole
 * new one — never a truncated one.
 */
export class QueueStore {
  readonly queueDir: string;
  readonly haltPath: string;

  constructor(
    readonly corpusDir: string,
    private readonly observeWrite?: QueueWriteObserver | undefined,
  ) {
    this.queueDir = join(corpusDir, QUEUE_DIR_NAME);
    this.haltPath = join(corpusDir, HALT_FILE_NAME);
  }

  dirFor(status: QueueEventStatus): string {
    return join(this.queueDir, status);
  }

  pathFor(status: QueueEventStatus, id: string): string {
    return join(this.dirFor(status), `${id}.json`);
  }

  /** Called at boot, before the first request: the five directories must exist. */
  ensureLayoutSync(): void {
    for (const status of QUEUE_EVENT_STATUSES) {
      mkdirSync(this.dirFor(status), { recursive: true });
    }
  }

  async listIds(status: QueueEventStatus): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dirFor(status));
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    return names.flatMap((name) => {
      const id = eventIdFromFileName(name);
      return id === undefined ? [] : [id];
    });
  }

  listIdsSync(status: QueueEventStatus): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dirFor(status));
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    return names.flatMap((name) => {
      const id = eventIdFromFileName(name);
      return id === undefined ? [] : [id];
    });
  }

  async countPending(): Promise<number> {
    return (await this.listIds("pending")).length;
  }

  async readEvent(status: QueueEventStatus, id: string): Promise<ReadEventResult | undefined> {
    let text: string;
    try {
      text = await readFile(this.pathFor(status, id), "utf8");
    } catch (error) {
      if (isEnoent(error)) return undefined;
      throw error;
    }
    return parseEventFile(text, id, status);
  }

  readEventSync(status: QueueEventStatus, id: string): ReadEventResult | undefined {
    let text: string;
    try {
      text = readFileSync(this.pathFor(status, id), "utf8");
    } catch (error) {
      if (isEnoent(error)) return undefined;
      throw error;
    }
    return parseEventFile(text, id, status);
  }

  /** Atomic within the directory: write `.tmp-*`, then rename onto the target. */
  async writeEvent(status: QueueEventStatus, event: StoredEvent): Promise<void> {
    const dir = this.dirFor(status);
    const tmpPath = join(dir, `.tmp-${event.id}-${randomBytes(4).toString("hex")}.json`);
    const body = `${JSON.stringify({ ...event, status }, null, 2)}\n`;
    try {
      await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
      // Announced before the rename: the watcher can see the file the instant it
      // lands, and a registration made afterwards would lose that race.
      this.observeWrite?.(this.pathFor(status, event.id), body);
      await rename(tmpPath, this.pathFor(status, event.id));
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Moves the file first and rewrites it in place afterwards: a crash in between
   * leaves the event in its new directory with a stale `status` field, which the
   * directory-is-authoritative rule already covers. Writing-then-unlinking would
   * instead leave the same id in two directories, which nothing can repair.
   * `false` means another actor got there first (`ENOENT`), never an error.
   */
  async move(from: QueueEventStatus, to: QueueEventStatus, id: string): Promise<boolean> {
    if (from === to) return true;
    const fromPath = this.pathFor(from, id);
    const toPath = this.pathFor(to, id);
    this.observeWrite?.(fromPath, null);
    try {
      await rename(fromPath, toPath);
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
    // The moved file keeps its old bytes until `writeEvent` re-stamps it, so the
    // intermediate state is registered too — otherwise a watcher that saw the
    // rename before the rewrite would report a server transition as an
    // out-of-band edit.
    try {
      this.observeWrite?.(toPath, await readFile(toPath, "utf8"));
    } catch {
      // Already re-stamped or gone; the rewrite registers the final bytes.
    }
    return true;
  }

  /** The status directory holding `id`, or `undefined` when no directory does. */
  async locate(id: string): Promise<QueueEventStatus | undefined> {
    for (const status of QUEUE_EVENT_STATUSES) {
      try {
        await stat(this.pathFor(status, id));
        return status;
      } catch (error) {
        if (!isEnoent(error)) throw error;
      }
    }
    return undefined;
  }

  /**
   * When the event was last touched, in epoch milliseconds. The earliest of the
   * file's mtime and its `updated` field: both are evidence of the last activity,
   * and taking the older one means neither an out-of-band `touch` nor a rewritten
   * `updated` can hide a stuck event from the reaper.
   */
  async lastTouched(status: QueueEventStatus, event: StoredEvent): Promise<number> {
    const candidates: number[] = [];
    try {
      candidates.push((await stat(this.pathFor(status, event.id))).mtimeMs);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    if (event.updated !== undefined) {
      const parsed = Date.parse(event.updated);
      if (!Number.isNaN(parsed)) candidates.push(parsed);
    }
    return candidates.length === 0 ? 0 : Math.min(...candidates);
  }

  async isHalted(): Promise<boolean> {
    try {
      await stat(this.haltPath);
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  isHaltedSync(): boolean {
    try {
      statSync(this.haltPath);
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  /** Idempotent: halting an already-halted queue rewrites the sentinel. */
  async writeHalt(sentinel: HaltSentinel): Promise<void> {
    const tmpPath = join(this.corpusDir, `.tmp-halt-${randomBytes(4).toString("hex")}`);
    const body = `${JSON.stringify(sentinel, null, 2)}\n`;
    try {
      await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
      await rename(tmpPath, this.haltPath);
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  /** Idempotent: resuming a running queue is not an error. */
  async clearHalt(): Promise<void> {
    try {
      await unlink(this.haltPath);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
}
