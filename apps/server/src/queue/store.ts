import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "@hono/zod-openapi";
import {
  DocumentIdSchema,
  IsoDateTimeSchema,
  LaneSchema,
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
  blockedOn: DocumentIdSchema.optional(),
  deferReason: z.string().min(1).optional(),
  /**
   * SPEC.md §7's lane: which agent's work this event is (SERVER-111).
   *
   * **Server-only bookkeeping**, beside `status` and `attempts` and never on the
   * wire — the contract's queue event gained nothing for lanes, because an agent
   * claims a lane rather than reading one off an event it has already been
   * handed.
   *
   * **Optional, and an absent value means the orchestrator's lane.** Every event
   * written before lanes existed, and every file a hand drops into `pending/`,
   * is therefore claimable by exactly the caller that could always claim it —
   * which is the whole of the migration. `queue/lanes.ts`'s `laneOf` is the one
   * reader; nothing else may spell that default.
   *
   * **Written once, at enqueue, and never rewritten.** A value that is neither
   * absent nor a lane fails the parse, which quarantines the file: a stamp
   * nobody can read is not a routing decision to be silently reinterpreted as
   * the orchestrator's. (The projection's own file reader is deliberately
   * laxer — see `projection/project-runtime.ts` — because it decides what a
   * console row says, not who may claim.)
   */
  lane: LaneSchema.optional(),
  /**
   * When this event was enqueued, in epoch milliseconds, made strictly
   * increasing within a process (SERVER-131).
   *
   * **Server-only bookkeeping**, beside `status` and `lane` and never on the
   * wire: it exists so a batch can be handed over in the order the conversation
   * has it, and an agent reads that order off the list rather than off a field.
   *
   * **`created` alone cannot carry that order.** SPEC.md §5 writes instants at
   * second precision — turn timestamps double as turn identity (§6) — so three
   * replies posted inside one second share one `created` to the character, and
   * the tie-break left is the id, which is random. Measured on a real server on
   * 2026-08-19: three replies one conversation apart, all stamped
   * `2026-08-19T21:38:27Z`, came back Y, Z, X — the first message last, which is
   * exactly what AGENT-038's drill reported. Widening `created` was not an
   * option: it is the published wire value and §5 fixes its form.
   *
   * **Monotonic rather than a bare clock read**, so two events enqueued inside
   * one millisecond — and every event enqueued under a test's frozen clock —
   * still order by the order they were made. See `QueueService.nextSeq`.
   *
   * **Optional, and absence sorts first within its second.** Every event written
   * before this field existed, and every file dropped into `pending/` by hand,
   * has only its `created` to be ordered by, which is the order it always had.
   * Like `lane`, it is written once at enqueue and never rewritten: a retry, a
   * reap and a deferral all put the event back where the conversation had it,
   * not at the end of the queue.
   */
  seq: z.number().int().min(0).optional(),
});

export type StoredEvent = z.infer<typeof StoredEventSchema> & {
  readonly status: QueueEventStatus;
};

/**
 * The deferral bookkeeping, carried on the event because a deferral is a
 * property of the *work*, not of the document (CONTRACT-021, SPEC.md §7).
 *
 * `blockedOn` is what makes automatic re-entry implementable: the end of a
 * person's edit session on that document is what returns the event to
 * `pending` (SERVER-099). It is supplied by the caller that just tried the edit rather than
 * inferred from the payload, because the payload cannot always carry it —
 * `comment.created` has `parentId`, `form.respond` names no document at all,
 * and plugin event types own their own shapes.
 *
 * Named `deferReason` rather than `reason` so it can never be confused with
 * `error`, which is what a *failure* records: the two live side by side in the
 * same file shape and mean opposite things.
 */
export interface DeferralFields {
  readonly blockedOn: string;
  readonly deferReason?: string | undefined;
}

/**
 * The same event with its deferral bookkeeping removed.
 *
 * `Job.blockedOn` is non-null **exactly when** the job is `deferred`
 * (CONTRACT-021), so every transition out of `deferred/` — re-entry, a manual
 * retry, a complete, a fail — has to drop the fields rather than carry them
 * along into a state where they would be a lie.
 */
export function withoutDeferral(event: StoredEvent): StoredEvent {
  const stripped = { ...event };
  delete stripped.blockedOn;
  delete stripped.deferReason;
  return stripped;
}

/**
 * `created` as epoch milliseconds; an instant that does not parse sorts oldest.
 *
 * `created` is validated as an ISO instant on the way in, so the guard is
 * unreachable from disk — but a comparator that can return `NaN` makes `sort`
 * behave arbitrarily, which is the whole class of defect this ordering exists to
 * remove, so it is not left to be reasoned about.
 */
function createdRank(event: StoredEvent): number {
  const parsed = Date.parse(event.created);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The order the queue hands work over in: **the order the conversation has it**
 * (SPEC.md §7, SERVER-131).
 *
 * A resident works its lane inline, one event at a time, and until this existed
 * a batch arrived in `readdir` order — which is the event id's, and an id is
 * random against the conversation. A resident obeying "work each claimed event
 * in order" answered the third message before the first.
 *
 * Three keys, in this order, and each earns its place:
 *
 * 1. **`created`** — the event's own instant, the one an operator can read off
 *    the file, and the only key a hand-dropped or pre-{@link StoredEvent.seq}
 *    file has at all.
 * 2. **`seq`** — the sub-second order, because §5 stamps `created` to the second
 *    and a conversation moves faster than that. Absent sorts first within its
 *    second, so a legacy file keeps the only position its evidence supports.
 * 3. **`id`** — so the order is *total*: two events with the same instant and no
 *    `seq` still come back the same way on every call, which is what stops a
 *    batch depending on how a filesystem happened to list a directory.
 *
 * Lexicographic across all three rather than "seq when both have one": a
 * comparator that switches keys per pair is not transitive, and an intransitive
 * comparator is a `readdir` order with extra steps.
 */
export function byQueueOrder(left: StoredEvent, right: StoredEvent): number {
  const created = createdRank(left) - createdRank(right);
  if (created !== 0) return created;
  const seq = (left.seq ?? 0) - (right.seq ?? 0);
  if (seq !== 0) return seq;
  return left.id.localeCompare(right.id);
}

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

/** The event ids among a directory listing, in a stable order; see {@link QueueStore.listIds}. */
function eventIdsIn(names: readonly string[]): string[] {
  return names
    .flatMap((name) => {
      const id = eventIdFromFileName(name);
      return id === undefined ? [] : [id];
    })
    .sort((left, right) => left.localeCompare(right));
}

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
 *
 * It carries no `lane`, and that costs nothing: the file it replaces did not
 * parse, so whatever lane it claimed is not readable, and `failed/` is terminal
 * — no claim of any scope will ever offer it. The raw bytes are preserved in
 * `payload.raw`, which is where an operator reads the original stamp if it
 * mattered.
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

  /**
   * Called at boot, before the first request: one directory per contract status
   * must exist. Derived from the contract's list rather than enumerated here, so
   * a workspace scaffolded before a status existed — `deferred/`, CONTRACT-021 —
   * grows the directory on its next boot instead of needing an upgrade step.
   */
  ensureLayoutSync(): void {
    for (const status of QUEUE_EVENT_STATUSES) {
      mkdirSync(this.dirFor(status), { recursive: true });
    }
  }

  /**
   * The event ids in a status directory, **sorted by id**.
   *
   * `readdir` order is the filesystem's, and it is neither stable across
   * platforms nor meaningful anywhere: it is what made a claim batch arrive in
   * no particular order (SERVER-131). Sorting here does not by itself produce
   * §7's conversation order — that needs each event's `created`, which only a
   * caller that reads the files can compare, so {@link byQueueOrder} is where a
   * batch is actually ordered. What this gives every caller, including the ones
   * that never read a file (`status`'s counts) or read them for their own reasons
   * (`reapStale`, `requeueDeferredFor`), is that the *same* directory always
   * yields the *same* list.
   */
  async listIds(status: QueueEventStatus): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dirFor(status));
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    return eventIdsIn(names);
  }

  /** {@link listIds}, synchronously: the boot rebuild's reader. */
  listIdsSync(status: QueueEventStatus): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dirFor(status));
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
    return eventIdsIn(names);
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
