import type { QueueEventStatus, QueueStatus } from "@corpus/contract";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { ID_PREFIXES, newId } from "../core/ids.js";
import { formatInstant } from "../core/time.js";
import { notFound } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";
import {
  NOOP_INVALIDATE,
  NOOP_QUEUE_MIRROR,
  QUEUE_QUERY_KEYS,
  rebuildQueueMirrorSync,
  type QueueInvalidate,
  type QueueMirror,
  type QueueScanResult,
} from "./project.js";
import {
  QueueStore,
  salvageEvent,
  type HaltSentinel,
  type ReadEventResult,
  type StoredEvent,
} from "./store.js";
import { WaiterRegistry } from "./waiters.js";

/**
 * How long an event may sit in `in-progress/` before the reaper assumes the run
 * that claimed it died, and how many times it may be handed back before it is
 * declared unworkable. Server-side constants, deliberately not request
 * parameters: `POST /api/queue/reap-stale` declares no query (sprint-003
 * adjudication 1).
 */
export const DEFAULT_STALE_AFTER_MS = 900_000;
export const DEFAULT_MAX_ATTEMPTS = 3;

type MalformedRead = Extract<ReadEventResult, { ok: false }>;

export interface QueueServiceOptions {
  readonly corpusDir: string;
  readonly logger?: Logger | undefined;
  readonly mirror?: QueueMirror | undefined;
  readonly invalidate?: QueueInvalidate | undefined;
  /** Epoch milliseconds; injected so staleness and timestamps are testable. */
  readonly now?: (() => number) | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly staleAfterMs?: number | undefined;
  readonly maxAttempts?: number | undefined;
}

export interface EnqueueInput {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  /** Only for re-enqueueing a known event; a fresh `evt_*` id is minted otherwise. */
  readonly id?: string;
}

export interface IdleRequest {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export interface ReapResult {
  readonly reaped: string[];
  /** Events pushed past the attempt cap into `failed/`; not part of `reaped`. */
  readonly failed: string[];
}

/**
 * The event queue: five directories, one sentinel, and the transitions between
 * them (SPEC.md §7). The server is the sole writer; the CLI and the UI reach
 * this only over HTTP.
 */
export class QueueService {
  readonly store: QueueStore;
  private readonly logger: Logger;
  /** Late-bound: see {@link attachMirror}. */
  private mirror: QueueMirror;
  private readonly invalidate: QueueInvalidate;
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private readonly maxAttempts: number;
  private readonly waiters: WaiterRegistry;
  /** Serializes claim batches in this process; `ENOENT` covers the rest. */
  private claimChain: Promise<unknown> = Promise.resolve();

  constructor(options: QueueServiceOptions) {
    this.store = new QueueStore(options.corpusDir);
    this.logger = options.logger ?? silentLogger;
    this.mirror = options.mirror ?? NOOP_QUEUE_MIRROR;
    this.invalidate = options.invalidate ?? NOOP_INVALIDATE;
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.waiters = new WaiterRegistry({
      probe: async () => (await this.availablePending()).length > 0,
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      onProbeError: (error: unknown) => {
        this.logger.error("queue poll failed", { error: String(error) });
      },
    });

    this.store.ensureLayoutSync();
    this.rebuildMirror();
  }

  /**
   * Binds the projection's `events` table once it is open, and rebuilds it from
   * the directories on the spot.
   *
   * The queue is built by `createServer`, which is a pure function of its config
   * and opens no database; the projection attaches afterwards, from
   * `lifecycle.ts`, before the socket does. So the real mirror arrives *after*
   * the constructor's rebuild has already run against the no-op — which is why
   * binding re-runs it rather than merely storing the reference. Nothing can
   * have been enqueued in between (there is no socket yet), and the rebuild
   * would cover it if something had.
   */
  attachMirror(mirror: QueueMirror): QueueScanResult {
    this.mirror = mirror;
    return this.rebuildMirror();
  }

  /**
   * Replaces the mirror's contents with what the five directories currently
   * hold, so a restart — or a crash halfway through a transition, or a file
   * moved by hand while the server was down — can neither lose nor duplicate an
   * event (sprint-003 TEST-56).
   */
  private rebuildMirror(): QueueScanResult {
    const scan = rebuildQueueMirrorSync(this.store, this.mirror);
    if (scan.malformed.length > 0) {
      this.logger.error("queue boot rebuild skipped malformed events", {
        ids: scan.malformed.join(","),
      });
    }
    return scan;
  }

  /** Parked long-polls right now. Exposed so tests can prove none leaked. */
  get parked(): number {
    return this.waiters.size;
  }

  /**
   * Makes an event pending. The one entry point for producers inside the server
   * (SERVER-006's `@agent` comments, form answers, subagent wake-backs): write,
   * mirror, invalidate, wake. Re-enqueueing a known id overwrites its pending
   * file rather than creating a second event.
   */
  async enqueue(input: EnqueueInput): Promise<StoredEvent> {
    const at = formatInstant(this.now());
    const event: StoredEvent = {
      id: input.id ?? newId(ID_PREFIXES.event),
      type: input.type,
      created: at,
      source: input.source,
      payload: input.payload,
      status: "pending",
      updated: at,
    };
    await this.store.writeEvent("pending", event);
    this.mirror.upsertEvent(event);
    this.invalidate(QUEUE_QUERY_KEYS);
    this.waiters.notify();
    return event;
  }

  /**
   * Long-poll: resolves with the pending events the instant there are any, or
   * `undefined` when the window expires (the contract's `204`). It **reports
   * availability and never claims** — the agent's loop is `idle → claim-all`.
   * While halted it parks for the full window: that is what "the agent stops
   * picking up work" means (SPEC.md §7).
   */
  async idle(request: IdleRequest): Promise<StoredEvent[] | undefined> {
    // Wall clock, not the injected `now`: the window is a duration measured
    // against the very timers the waiter parks on, while `now` exists to make
    // the *instants written into files* deterministic in tests.
    const deadline = Date.now() + request.timeoutMs;
    for (;;) {
      const available = await this.availablePending();
      if (available.length > 0) return available;

      const remaining = deadline - Date.now();
      if (remaining <= 0) return undefined;
      const woke = await this.waiters.wait(remaining, request.signal);
      if (!woke) return undefined;
    }
  }

  /**
   * Moves every current `pending/*` to `in-progress/` and returns them as one
   * batch. Serialized in-process and `ENOENT`-tolerant, so two concurrent calls
   * split the queue between them and never hand the same event to both. Events
   * enqueued during the claim simply stay pending for the next one.
   */
  async claimAll(): Promise<StoredEvent[]> {
    return this.serialize(async () => {
      // Halted: return empty *without touching the filesystem*.
      if (await this.store.isHalted()) return [];

      const claimed: StoredEvent[] = [];
      let touched = false;
      for (const id of await this.store.listIds("pending")) {
        if (!(await this.store.move("pending", "in-progress", id))) continue;
        touched = true;
        const read = await this.store.readEvent("in-progress", id);
        if (read === undefined) continue;
        if (!read.ok) {
          await this.quarantine(id, "in-progress", read);
          continue;
        }
        const event = this.stamp(read.event, "in-progress");
        await this.store.writeEvent("in-progress", event);
        this.mirror.upsertEvent(event);
        claimed.push(event);
      }
      if (touched) this.invalidate(QUEUE_QUERY_KEYS);
      return claimed;
    });
  }

  async complete(id: string): Promise<StoredEvent> {
    return this.transition(id, "processed");
  }

  async fail(id: string, reason?: string): Promise<StoredEvent> {
    // The request field is `reason`, the on-disk field is `error` — one concept,
    // named for its reader on each side (sprint-003 adjudication 7).
    return this.transition(id, "failed", reason === undefined ? {} : { error: reason });
  }

  /** Abandon is a move to `abandoned/`, never a delete: the file is evidence. */
  async abandon(id: string): Promise<StoredEvent> {
    return this.transition(id, "abandoned");
  }

  /**
   * Returns events stranded in `in-progress/` by a dead run to `pending/`, one
   * attempt poorer, and gives up on those past the cap. `reaped` lists only what
   * came back to `pending/` (sprint-003 adjudication 1).
   */
  async reapStale(): Promise<ReapResult> {
    return this.serialize(async () => {
      const reaped: string[] = [];
      const failed: string[] = [];
      for (const id of await this.store.listIds("in-progress")) {
        const read = await this.store.readEvent("in-progress", id);
        if (read === undefined) continue;
        if (!read.ok) {
          await this.quarantine(id, "in-progress", read);
          failed.push(id);
          continue;
        }
        const lastTouched = await this.store.lastTouched("in-progress", read.event);
        if (this.now() - lastTouched < this.staleAfterMs) continue;

        const attempts = (read.event.attempts ?? 0) + 1;
        const target: QueueEventStatus = attempts > this.maxAttempts ? "failed" : "pending";
        if (!(await this.store.move("in-progress", target, id))) continue;
        const event = this.stamp({ ...read.event, attempts }, target, {
          ...(target === "failed"
            ? { error: `stale: exceeded attempt cap of ${this.maxAttempts}` }
            : {}),
        });
        await this.store.writeEvent(target, event);
        this.mirror.upsertEvent(event);
        (target === "failed" ? failed : reaped).push(id);
      }
      if (reaped.length > 0 || failed.length > 0) this.invalidate(QUEUE_QUERY_KEYS);
      if (reaped.length > 0) this.waiters.notify();
      return { reaped, failed };
    });
  }

  async halt(reason?: string): Promise<QueueStatus> {
    const sentinel: HaltSentinel = {
      at: formatInstant(this.now()),
      ...(reason === undefined ? {} : { reason }),
    };
    await this.store.writeHalt(sentinel);
    this.invalidate(QUEUE_QUERY_KEYS);
    // Parked waiters are deliberately *not* woken: halting means the agent stops
    // picking up work, so they park out their window.
    return this.status();
  }

  async resume(): Promise<QueueStatus> {
    await this.store.clearHalt();
    this.invalidate(QUEUE_QUERY_KEYS);
    this.waiters.notify();
    return this.status();
  }

  async status(): Promise<QueueStatus> {
    const [halted, counts] = await Promise.all([
      this.store.isHalted(),
      Promise.all(
        QUEUE_EVENT_STATUSES.map(async (status) => (await this.store.listIds(status)).length),
      ),
    ]);
    const [pending = 0, inProgress = 0, processed = 0, failed = 0, abandoned = 0] = counts;
    return { halted, pending, inProgress, processed, failed, abandoned };
  }

  /** Releases every parked request. Registered as a server disposer. */
  close(): void {
    this.waiters.close();
  }

  /** The pending events an agent could claim right now; empty while halted. */
  private async availablePending(): Promise<StoredEvent[]> {
    if (await this.store.isHalted()) return [];
    const events: StoredEvent[] = [];
    for (const id of await this.store.listIds("pending")) {
      const read = await this.store.readEvent("pending", id);
      if (read === undefined) continue;
      if (read.ok) events.push(read.event);
      // A corrupt file is quarantined by `claim-all`, which is a write path;
      // `idle` is a read and never mutates the queue.
      else this.logger.debug("skipping malformed pending event", { id, reason: read.reason });
    }
    return events;
  }

  private async transition(
    id: string,
    to: QueueEventStatus,
    extra: { error?: string } = {},
  ): Promise<StoredEvent> {
    return this.serialize(async () => {
      const from = await this.store.locate(id);
      if (from === undefined) throw notFound(`no queue event ${id}`);

      const current = await this.store.readEvent(from, id);
      if (current === undefined) throw notFound(`no queue event ${id}`);
      if (!current.ok) return this.quarantine(id, from, current);
      // Already there: idempotent, and the file is left exactly as it is — a
      // second `fail` does not overwrite the reason the first one recorded.
      if (from === to) return current.event;

      if (!(await this.store.move(from, to, id))) {
        throw notFound(`no queue event ${id}`);
      }
      const event = this.stamp(current.event, to, extra);
      await this.store.writeEvent(to, event);
      this.mirror.upsertEvent(event);
      this.invalidate(QUEUE_QUERY_KEYS);
      return event;
    });
  }

  /** Moves an unparseable file to `failed/` with its reason and its evidence. */
  private async quarantine(
    id: string,
    from: QueueEventStatus,
    read: MalformedRead,
  ): Promise<StoredEvent> {
    const event = salvageEvent(id, read.reason, read.text, formatInstant(this.now()));
    if (from !== "failed") await this.store.move(from, "failed", id);
    await this.store.writeEvent("failed", event);
    this.mirror.upsertEvent(event);
    this.invalidate(QUEUE_QUERY_KEYS);
    this.logger.error("quarantined malformed queue event", { id, reason: read.reason });
    return event;
  }

  private stamp(
    event: StoredEvent,
    status: QueueEventStatus,
    extra: { error?: string } = {},
  ): StoredEvent {
    return {
      ...event,
      ...extra,
      status,
      updated: formatInstant(this.now()),
    };
  }

  /**
   * One writer at a time inside this process. Rejections must not poison the
   * chain, so the tail is always a resolved promise.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.claimChain.then(work, work);
    this.claimChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createQueueService(options: QueueServiceOptions): QueueService {
  return new QueueService(options);
}
