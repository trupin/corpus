import type { QueueEventStatus, QueueStatus } from "@corpus/contract";
import { ID_PREFIXES, newId } from "../core/ids.js";
import { formatInstant } from "../core/time.js";
import { conflict, notFound } from "../errors.js";
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
  withoutDeferral,
  type DeferralFields,
  type HaltSentinel,
  type QueueWriteObserver,
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
  /** Lets the watcher recognize the queue's own writes; see {@link QueueWriteObserver}. */
  readonly observeWrite?: QueueWriteObserver | undefined;
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

export interface RequeueOptions {
  /**
   * Refuse with a `409` unless the event is in one of these statuses *at the
   * moment the move happens*, rather than at whatever earlier moment the caller
   * looked.
   *
   * The console's retry is defined for a failed job only, and it used to check
   * that in `jobs/service.ts` before calling in here — outside this method's
   * serialize chain. A `complete` landing in the interval moved the event to
   * `processed/` and the requeue, which moves from wherever the event *is*,
   * then re-ran a job that had finished (SERVER-022 finding 2). The check has
   * to be in the same serialized step as the move to mean anything.
   *
   * A *list* rather than a single status since SERVER-030: `job retry` is
   * defined for a failed **or** deferred job (§7 names it as the manual
   * override automatic re-entry supplements), and both have to be admitted by
   * the same in-chain check.
   */
  readonly onlyFrom?: readonly QueueEventStatus[] | undefined;
}

/** Bookkeeping a transition writes onto the event as it moves. */
interface TransitionFields {
  readonly error?: string | undefined;
  readonly blockedOn?: string | undefined;
  readonly deferReason?: string | undefined;
}

interface TransitionOptions {
  readonly fields?: TransitionFields | undefined;
  /**
   * Refuse with a `409` unless the event is in one of `statuses` at the moment
   * the move happens — the same in-chain rule, for the same reason, as
   * {@link RequeueOptions.onlyFrom}. `verb` completes the message: "only
   * in-progress work can be deferred".
   */
  readonly onlyFrom?:
    { readonly statuses: readonly QueueEventStatus[]; readonly verb: string } | undefined;
}

/** English for a `409` that names the statuses a verb accepts. */
function joinStatuses(statuses: readonly QueueEventStatus[]): string {
  if (statuses.length <= 1) return statuses[0] ?? "";
  return `${statuses.slice(0, -1).join(", ")} or ${statuses[statuses.length - 1] ?? ""}`;
}

/**
 * The event queue: one directory per status, one sentinel, and the transitions between
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
    this.store = new QueueStore(options.corpusDir, options.observeWrite);
    this.logger = options.logger ?? silentLogger;
    this.mirror = options.mirror ?? NOOP_QUEUE_MIRROR;
    this.invalidate = options.invalidate ?? NOOP_INVALIDATE;
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.waiters = new WaiterRegistry({
      probe: async () => (await this.settledPending()).length > 0,
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
   * Replaces the mirror's contents with what every status directory currently
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
   * (`threads/events.ts`'s `comment.created`, from thread creation, turn append
   * and capture): write, mirror, invalidate, wake. Re-enqueueing a known id
   * overwrites its pending file rather than creating a second event.
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
      const available = await this.settledPending();
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
    return this.transition(id, "failed", reason === undefined ? {} : { fields: { error: reason } });
  }

  /** Abandon is a move to `abandoned/`, never a delete: the file is evidence. */
  async abandon(id: string): Promise<StoredEvent> {
    return this.transition(id, "abandoned");
  }

  /**
   * In-progress → `deferred/`: the claimed work needs a document whose edit
   * lock somebody else holds, so it waits instead of failing (SPEC.md §7,
   * CONTRACT-021).
   *
   * **Only a claimed event can be deferred.** Nothing else has tried the edit
   * yet and terminal events are done, so anything but `in-progress` is a `409` —
   * which is also what makes a second defer of the same event a refusal rather
   * than a silent no-op that would look like it worked. The check rides
   * `transition`'s `onlyFrom`, inside the writer chain, for the same reason
   * retry's does (see {@link RequeueOptions}).
   *
   * The blocking document is recorded on the event, not on the lock: a lock is
   * one file per document and several events can queue behind the same one, and
   * the event file is what survives a restart (SPEC.md §7 — "never silently
   * dropped"). No live lock on `blockedOn` is required. The contract declares
   * exactly two refusals for this route and this is not one of them; a deferral
   * whose lock was released in the meantime is left visible, countable and
   * retryable by hand rather than rejected on a race the caller cannot win.
   */
  async defer(id: string, deferral: DeferralFields): Promise<StoredEvent> {
    return this.transition(id, "deferred", {
      onlyFrom: { statuses: ["in-progress"], verb: "deferred" },
      fields: {
        blockedOn: deferral.blockedOn,
        ...(deferral.deferReason === undefined ? {} : { deferReason: deferral.deferReason }),
      },
    });
  }

  /**
   * Returns every event deferred on `docId` to `pending/`. The queue's half of
   * §7's promise that a deferred edit "re-enters the queue rather than being
   * lost": `locks/service.ts` calls it on release, force-break and reap, so the
   * work comes back **on its own**, with no CLI call and no operator.
   *
   * Deliberately keyed on the document rather than on a single recorded event
   * id: several events can be deferred on the same lock, and each has to come
   * back exactly once. Already-pending events are unreachable here (only
   * `deferred/` is scanned), which is what makes a second trigger — a break
   * following a release, a reap of a lock nobody re-took — a no-op rather than
   * a duplicate.
   *
   * A release with nothing deferred behind it touches no file, invalidates
   * nothing and logs nothing: it is the overwhelmingly common case.
   */
  async requeueDeferredFor(docId: string): Promise<string[]> {
    return this.serialize(async () => {
      const requeued: string[] = [];
      for (const id of await this.store.listIds("deferred")) {
        const read = await this.store.readEvent("deferred", id);
        if (read === undefined) continue;
        if (!read.ok) {
          await this.quarantine(id, "deferred", read);
          continue;
        }
        if (read.event.blockedOn !== docId) continue;
        if (!(await this.store.move("deferred", "pending", id))) continue;

        // The deferral bookkeeping goes with the state that owned it; the
        // attempt count does **not** reset, because waiting for a lock is not an
        // attempt and a manual `job retry` is the verb that asserts a clean
        // slate (see `requeue`).
        const event = this.stamp(withoutDeferral(read.event), "pending");
        await this.store.writeEvent("pending", event);
        this.mirror.upsertEvent(event);
        requeued.push(id);
      }
      if (requeued.length > 0) {
        this.invalidate(QUEUE_QUERY_KEYS);
        this.waiters.notify();
        this.logger.info("deferred events re-entered the queue", {
          docId,
          ids: requeued.join(","),
        });
      }
      return requeued;
    });
  }

  /**
   * Puts an event back in `pending/` from wherever it is, with a clean slate —
   * attempts reset and any recorded error dropped, because the caller is
   * asserting the run can start over. Two callers need it (SPEC.md §7): the
   * console's retry of a failed job, and a force-break re-enqueueing the edit
   * that was deferred because the lock was held. Already-pending is a no-op, so
   * repeating either is harmless.
   *
   * `onlyFrom` is how a caller whose verb is defined for one status only says
   * so **inside this chain**, which is the only place the answer stays true
   * (see {@link RequeueOptions}).
   */
  async requeue(id: string, options: RequeueOptions = {}): Promise<StoredEvent> {
    return this.serialize(async () => {
      const from = await this.store.locate(id);
      if (from === undefined) throw notFound(`no queue event ${id}`);
      if (options.onlyFrom !== undefined && !options.onlyFrom.includes(from)) {
        throw conflict(
          `queue event ${id} is ${from}; only a ${joinStatuses(options.onlyFrom)} job can be retried`,
        );
      }

      const current = await this.store.readEvent(from, id);
      if (current === undefined) throw notFound(`no queue event ${id}`);
      if (!current.ok) return this.quarantine(id, from, current);
      if (from === "pending") return current.event;

      if (!(await this.store.move(from, "pending", id))) {
        throw notFound(`no queue event ${id}`);
      }
      // Rebuilt field by field rather than spread: `error`, `attempts` and the
      // deferral bookkeeping are exactly what a requeue is supposed to forget.
      const event: StoredEvent = {
        id: current.event.id,
        type: current.event.type,
        created: current.event.created,
        source: current.event.source,
        payload: current.event.payload,
        status: "pending",
        updated: formatInstant(this.now()),
        attempts: 0,
      };
      await this.store.writeEvent("pending", event);
      this.mirror.upsertEvent(event);
      this.invalidate(QUEUE_QUERY_KEYS);
      this.waiters.notify();
      return event;
    });
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

  /**
   * Queue depth, one count per status directory.
   *
   * Each count names the status it counts, rather than being destructured
   * positionally out of a map over the contract's status list: that ordering
   * was load-bearing and silent, so inserting `deferred` into the middle of the
   * list (CONTRACT-021) would have reported deferrals as `processed`, processed
   * as `failed`, and so on down the line, with nothing failing to compile.
   * Spelled this way, a status the contract adds and this method forgets is a
   * missing property on `QueueStatus` — a type error.
   *
   * `deferred` counts what the store holds today, which is zero until
   * SERVER-030 ships the transition that puts an event there. It is read the
   * same way as every other status because the directory already exists:
   * `ensureLayoutSync` creates one per contract status at every boot.
   */
  async status(): Promise<QueueStatus> {
    const depth = async (status: QueueEventStatus): Promise<number> =>
      (await this.store.listIds(status)).length;
    const [halted, pending, inProgress, deferred, processed, failed, abandoned] = await Promise.all(
      [
        this.store.isHalted(),
        depth("pending"),
        depth("in-progress"),
        depth("deferred"),
        depth("processed"),
        depth("failed"),
        depth("abandoned"),
      ],
    );
    return { halted, pending, inProgress, deferred, processed, failed, abandoned };
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
    options: TransitionOptions = {},
  ): Promise<StoredEvent> {
    return this.serialize(async () => {
      const from = await this.store.locate(id);
      if (from === undefined) throw notFound(`no queue event ${id}`);
      if (options.onlyFrom !== undefined && !options.onlyFrom.statuses.includes(from)) {
        throw conflict(
          `queue event ${id} is ${from}; only ${joinStatuses(options.onlyFrom.statuses)} work can be ${options.onlyFrom.verb}`,
        );
      }

      const current = await this.store.readEvent(from, id);
      if (current === undefined) throw notFound(`no queue event ${id}`);
      if (!current.ok) return this.quarantine(id, from, current);
      // Already there: idempotent, and the file is left exactly as it is — a
      // second `fail` does not overwrite the reason the first one recorded.
      // Unreachable for a transition that declares `onlyFrom`, which refuses
      // above rather than answering a repeat with a 200.
      if (from === to) return current.event;

      if (!(await this.store.move(from, to, id))) {
        throw notFound(`no queue event ${id}`);
      }
      const event = this.stamp(current.event, to, options.fields);
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

  /**
   * The moved event as it is rewritten in its new directory.
   *
   * The deferral bookkeeping is stripped first and re-supplied only by the
   * transition that owns it, so `blockedOn` is present exactly while the event
   * is in `deferred/` — the invariant `Job.blockedOn` publishes (CONTRACT-021).
   * Carrying it along would leave a processed job claiming to be waiting for a
   * lock.
   */
  private stamp(
    event: StoredEvent,
    status: QueueEventStatus,
    fields: TransitionFields = {},
  ): StoredEvent {
    return {
      ...withoutDeferral(event),
      ...fields,
      status,
      updated: formatInstant(this.now()),
    };
  }

  /**
   * `availablePending`, but never mid-batch.
   *
   * The two readers that answer "is there work?" — the long poll and the parked
   * waiter's tick — both used to scan `pending/` off the chain, while
   * `requeueDeferredFor` writes its files **one at a time** on it. A reader
   * landing between two of those writes saw half the batch and reported it as
   * the whole of it: a release that returned two deferred events could wake an
   * agent with one (INFRA-020; four gate cycles were spent deciding whether this
   * was a flaky test — it was not).
   *
   * Nothing was ever lost — the unreported event stays `pending/` and the very
   * next poll returns it — but "the queue told you what is there" is the whole
   * of what these two entry points promise, and a torn read breaks it.
   *
   * Taking the writer's chain is the cheapest way to say *between* batches
   * rather than *during* one, and it cannot deadlock: `notify()` fires from
   * inside a write's turn, but the woken reader only *queues* behind it.
   */
  private settledPending(): Promise<StoredEvent[]> {
    return this.serialize(() => this.availablePending());
  }

  /**
   * One turn at a time inside this process: every writer, and the two readers
   * that must not observe a partial one (see {@link settledPending}).
   * Rejections must not poison the chain, so the tail is always a resolved
   * promise.
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
