import {
  ORCHESTRATOR_LANE,
  parseResidentReleasedPayload,
  type Lane,
  type QueueEventStatus,
  type QueueStatus,
} from "@corpus/contract";
import { ID_PREFIXES, newId } from "../core/ids.js";
import { formatInstant } from "../core/time.js";
import { conflict, notFound, type HttpError } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";
import { readHeldInProgress, type HeldSet } from "./held.js";
import { NO_SCOPE_LOOKUP, laneFor, laneOf, visibleTo, type ScopeRootLookup } from "./lanes.js";
import { NOTHING_PARKED, type LaneTracker } from "./liveness.js";
import {
  NOOP_INVALIDATE,
  NOOP_QUEUE_MIRROR,
  QUEUE_QUERY_KEYS,
  queueTransitionKeys,
  rebuildQueueMirrorSync,
  type QueueInvalidate,
  type QueueMirror,
  type QueueScanResult,
} from "./project.js";
import {
  QueueStore,
  byQueueOrder,
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

/**
 * Closes the open commit window (SPEC.md §4), which for this service means: an
 * event has **finished**, so the stewardship it caused stops gathering saves and
 * the commit holding it is final.
 *
 * A seam rather than the `AutoCommitter` itself, and late-bound through
 * {@link QueueService.attachWindowCloser}, for the reason
 * {@link QueueEnqueueObserver} is: the queue is built by `createServer` before
 * the git writer exists (the writer needs the projection; the queue does not),
 * and a queue built without one — a test, a server with no projection — simply
 * closes nothing.
 *
 * The queue writes only to `.corpus/queue/`, which is gitignored. It therefore
 * commits nothing and opens no window of its own: this call **only** closes
 * (SERVER-092).
 */
export type CommitWindowCloser = () => Promise<void>;

/**
 * Told about every event this service moves, with the event **as it now is** —
 * new status, new stamps — and told **before** the transition is announced
 * (SERVER-137).
 *
 * That ordering is the whole reason it is a seam and not a caller of the queue:
 * SPEC.md §7's reflection clock moves when a `workspace.reflect` job reaches
 * `processed`, the same transition that sends `["queue"]` and, with it,
 * `["reflect"]`. An observer that ran after the announcement would let a client
 * refetch the clock it was told had changed and read the old one.
 *
 * **Synchronous, and it may not fail a transition.** The event has already
 * moved on disk and been mirrored by the time this runs; an observer that
 * throws is this service's problem to survive, exactly like
 * {@link QueueEnqueueObserver}.
 */
export type QueueSettlementObserver = (event: StoredEvent) => void;

/**
 * The statuses an event *finishes* in — SPEC.md §4's "a queue event finished,
 * however it finished — completed, failed, deferred (§7) or abandoned".
 *
 * `deferred` is on the list although §7 calls it neither live nor terminal: §4
 * states the cost explicitly — "an event the agent defers while a person is
 * editing ends the agent's window like any other ending, so one act that
 * resumes later lands as two
 * commits — accepted, rather than hold a window open across a wait of unknown
 * length during which the other party may write".
 *
 * `pending` and `in-progress` are absent because neither is an ending: claiming
 * an event begins the work, and a retry puts it back at the start of it.
 */
const FINISHED_STATUSES: ReadonlySet<QueueEventStatus> = new Set([
  "processed",
  "failed",
  "deferred",
  "abandoned",
]);

export interface EnqueueInput {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  /** Only for re-enqueueing a known event; a fresh `evt_*` id is minted otherwise. */
  readonly id?: string;
  /**
   * The lane this one message named — a posting request's `recipient` (SPEC.md
   * §7), already refused at the route if it named no lane.
   *
   * `undefined` is the ordinary case and means "compute it from where the
   * message was posted". It routes **this message and nothing else**: nothing is
   * remembered, and the next message from the same place is computed afresh.
   */
  readonly recipient?: Lane | undefined;
}

/** What a claim or a park is scoped to. Absent means {@link ORCHESTRATOR_LANE}. */
export interface LaneScope {
  readonly scope?: Lane | undefined;
}

/**
 * Notified once for every event {@link QueueService.enqueue} makes pending,
 * after the file is on disk and mirrored and before anything is woken.
 *
 * The sibling of {@link QueueWriteObserver}, one level up: that one lets the
 * watcher recognize the queue's own bytes, this one lets a surface *outside* the
 * queue react to a new event without the queue importing it. Its one production
 * caller is `jobs/weight.ts`, which writes the weight the request stated onto the
 * new job's log (SPEC.md §7's console bullet) — the queue therefore stays
 * ignorant of what a weight is, which is the point: the level is opaque to this
 * server everywhere.
 *
 * Late-bound through {@link QueueService.observeEnqueued} because the job
 * service is built after the queue (it reads the queue to resolve an id), and
 * awaited rather than fired off because a line about a job must be in the file
 * before the agent that will append to it is woken.
 *
 * **It may not fail an enqueue.** An observer that throws is the queue's
 * problem to survive, never the producer's: the event is already durable.
 */
export type QueueEnqueueObserver = (event: StoredEvent) => Promise<void>;

export interface IdleRequest extends LaneScope {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * What the loop's two entry points answer with: the events on offer, and what
 * the server is already holding (SPEC.md §7's reconciliation bullet).
 *
 * One type for both because they are the same two facts — `claimAll` has just
 * taken the events it reports, `idle` has only spotted them — and the agent
 * reconciles `held` identically either way. Keeping them one shape is also what
 * makes it impossible for a route to report the held set on one entry point and
 * silently drop it on the other.
 */
export interface QueueBatch {
  readonly events: StoredEvent[];
  readonly held: HeldSet;
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
   *
   * Every verb declares one since SERVER-145, and none of them lists its own
   * target status — which is what makes a repeat a refusal rather than a `200`
   * that claims a transition nobody made. See {@link CLAIMED_ONLY}.
   */
  readonly onlyFrom?:
    { readonly statuses: readonly QueueEventStatus[]; readonly verb: string } | undefined;
}

/**
 * One file in `pending/`, with what could be read of it: see
 * {@link QueueService.orderedPending}. An absent `event` is a file that did not
 * parse, or one that was gone by the time it was read.
 */
interface PendingEntry {
  readonly id: string;
  readonly event?: StoredEvent | undefined;
}

/** English for a `409` that names the statuses a verb accepts. */
function joinStatuses(statuses: readonly QueueEventStatus[]): string {
  if (statuses.length <= 1) return statuses[0] ?? "";
  return `${statuses.slice(0, -1).join(", ")} or ${statuses[statuses.length - 1] ?? ""}`;
}

/**
 * The statuses a **settling** verb accepts: the one the agent holds the work in.
 *
 * SPEC.md §7, signed 2026-08-13: "a lane's owner settles its own lane … and
 * **nobody settles work they did not claim**". A settle is a *report on claimed
 * work*, not an assertion of a state anyone may make at any time — so the
 * question the guard asks is "do you hold this event?", and the answer is `no`
 * for every status but this one, whether the caller asked for the status the
 * event is already in or a different one. That is one rule rather than two, and
 * it is the rule §7 states.
 *
 * `defer` has declared it since SERVER-030; `complete` and `fail` never did,
 * which is the whole of SERVER-145: a `processed` event could be re-settled to
 * `failed` and back with exit 0 each time, and an event **nobody ever claimed**
 * went straight from `pending/` to `processed/` — the work never done and the
 * event gone from the queue.
 */
const CLAIMED_ONLY: readonly QueueEventStatus[] = ["in-progress"];

/**
 * The statuses `abandon` accepts — every one but `processed`, and `abandoned`
 * itself.
 *
 * Abandon is the **operator's** give-up rather than the agent's report, so it is
 * deliberately not {@link CLAIMED_ONLY}: SPEC.md §7's console offers it on a
 * failed job beside `retry`, `job abandon` calls straight into it, and giving up
 * on work still queued or still deferred is the same act. What it may not do is
 * give up on work that is **done**: there is nothing left to abandon, and
 * `processed/` → `abandoned/` is precisely the history rewrite SERVER-145 is
 * about. `abandoned` is absent so that a repeat is refused by name — see
 * {@link refuseTransition}.
 */
const ABANDONABLE: readonly QueueEventStatus[] = ["pending", "in-progress", "deferred", "failed"];

/**
 * The `409` a refused transition carries, in one line — the audit that found
 * SERVER-145 measured refusals being read in full, so neither branch grows a
 * second sentence.
 *
 * **A repeat says "already", and that is not a softer refusal.** It is still a
 * `409` and still writes nothing; it says `already` because a caller that
 * duplicated a settle needs to know the outcome it wanted is the one on record —
 * which sends it on — where the generic wording would send it looking for a
 * fault that is not there. A caller asking for a *different* state gets the
 * generic wording, which names both what the event is and what the verb accepts.
 */
function refuseTransition(
  id: string,
  from: QueueEventStatus,
  to: QueueEventStatus,
  onlyFrom: { readonly statuses: readonly QueueEventStatus[]; readonly verb: string },
): HttpError {
  return conflict(
    from === to
      ? `queue event ${id} is already ${from}`
      : `queue event ${id} is ${from}; only ${joinStatuses(onlyFrom.statuses)} work can be ${onlyFrom.verb}`,
  );
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
  /** Late-bound: see {@link observeEnqueued}. */
  private enqueueObserver: QueueEnqueueObserver | undefined;
  /** Late-bound: see {@link attachWindowCloser}. Closes nothing until bound. */
  private closeCommitWindow: CommitWindowCloser = () => Promise.resolve();
  /** Late-bound: see {@link observeSettled}. Tells nobody until bound. */
  private settlementObserver: QueueSettlementObserver | undefined;
  /** Late-bound: see {@link attachScopeLookup}. Routes everything to the orchestrator until bound. */
  private findScopeRoot: ScopeRootLookup = NO_SCOPE_LOOKUP;
  /** Late-bound: see {@link attachLaneTracker}. Observes no park until bound. */
  private laneTracker: LaneTracker = NOTHING_PARKED;
  private readonly invalidate: QueueInvalidate;
  private readonly now: () => number;
  private readonly staleAfterMs: number;
  private readonly maxAttempts: number;
  private readonly waiters: WaiterRegistry;
  /** Serializes claim batches in this process; `ENOENT` covers the rest. */
  private claimChain: Promise<unknown> = Promise.resolve();
  /** The last value {@link nextSeq} handed out; see {@link StoredEvent.seq}. */
  private lastSeq = 0;

  constructor(options: QueueServiceOptions) {
    this.store = new QueueStore(options.corpusDir, options.observeWrite);
    this.logger = options.logger ?? silentLogger;
    this.mirror = options.mirror ?? NOOP_QUEUE_MIRROR;
    this.invalidate = options.invalidate ?? NOOP_INVALIDATE;
    this.now = options.now ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.waiters = new WaiterRegistry({
      probe: async (scope) => (await this.settledPending(scope)).length > 0,
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
   * Binds the one {@link QueueEnqueueObserver}, which `createServer` does as
   * soon as the job service exists. A queue built without one — a test, or a
   * server with no projection and so no console — simply notifies nobody.
   */
  observeEnqueued(observer: QueueEnqueueObserver): void {
    this.enqueueObserver = observer;
  }

  /**
   * Binds the one {@link CommitWindowCloser}, which `createServer` does as soon
   * as the git writer exists. A queue built without one closes nothing, which is
   * the right behaviour for a server that commits nothing.
   */
  attachWindowCloser(close: CommitWindowCloser): void {
    this.closeCommitWindow = close;
  }

  /**
   * Binds the one {@link QueueSettlementObserver}, which `createServer` does as
   * soon as the reflection service exists.
   *
   * Late-bound for the reason every other seam here is: the observer reads the
   * projection and this service is built before there is one. A queue built
   * without an observer tells nobody, which is the right behaviour for a server
   * that has no clock to move.
   */
  observeSettled(observer: QueueSettlementObserver): void {
    this.settlementObserver = observer;
  }

  /**
   * Runs the settlement observer, swallowing what it throws.
   *
   * The event has already moved and been mirrored; the transition may not be
   * failed by whatever a downstream reader made of it.
   */
  private notifySettled(event: StoredEvent): void {
    if (this.settlementObserver === undefined) return;
    try {
      this.settlementObserver(event);
    } catch (error) {
      this.logger.error("queue settlement observer failed", {
        id: event.id,
        status: event.status,
        error: String(error),
      });
    }
  }

  /**
   * Binds the projection-backed scope walk (`queue/scope.ts`), which
   * `createServer` does as soon as it has a database.
   *
   * Late-bound for the reason every other seam here is: `createServer` builds
   * the queue before it opens the projection, and a queue built without one
   * cannot see a designation at all — so it routes everything to the
   * orchestrator, which is the honest answer rather than a degraded one.
   */
  attachScopeLookup(findScopeRoot: ScopeRootLookup): void {
    this.findScopeRoot = findScopeRoot;
  }

  /**
   * Binds SPEC.md §7's presence tracker (SERVER-112) — the one that observes
   * parked scoped `idle` requests, which is what presence *is*.
   *
   * **The claim path is no longer one of its consumers** (SERVER-152). SPEC.md
   * §7's rider signed 2026-08-25 removed the lapse fallback, so what a claim
   * sees is decided by the two lanes alone and never by whether one of them is
   * live. What the tracker still feeds is the park observation {@link idle}
   * gives it and the aggregate {@link status} publishes as `QueueStatus.agent` —
   * both of which are what a person reads on a roster.
   *
   * Late-bound like every other seam here: `createServer` builds the queue
   * before it builds the things a lapse has to notify.
   */
  attachLaneTracker(tracker: LaneTracker): void {
    this.laneTracker = tracker;
  }

  /**
   * Replaces the mirror's contents with what every status directory currently
   * hold, so a restart — or a crash halfway through a transition, or a file
   * moved by hand while the server was down — can neither lose nor duplicate an
   * event (sprint-003 TEST-56).
   *
   * A file the scan could not read is reported one line per file rather than
   * aggregated like the malformed ones: it names a file an operator has to go
   * repair, and the reason (EACCES, EISDIR, EIO) is the whole diagnostic
   * (SERVER-063). A status directory it could not *list* gets the same
   * treatment, and its own line says what an operator needs to know beyond the
   * fault: everything in that directory is missing from the projection, so a
   * console that looks short of events is describing the filesystem, not a lost
   * event. Both are logged at `error` for the same reason the other reader does
   * — that is the level a `silent` server still writes.
   */
  private rebuildMirror(): QueueScanResult {
    const scan = rebuildQueueMirrorSync(this.store, this.mirror);
    if (scan.malformed.length > 0) {
      this.logger.error("queue boot rebuild skipped malformed events", {
        ids: scan.malformed.join(","),
      });
    }
    for (const skipped of scan.unreadable) {
      this.logger.error("skipping unreadable queue event", {
        id: skipped.id,
        status: skipped.status,
        reason: skipped.reason,
      });
    }
    for (const skipped of scan.unlistable) {
      this.logger.error(
        "cannot list queue status directory; its events are missing from the projection",
        {
          status: skipped.status,
          reason: skipped.reason,
        },
      );
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
      // SPEC.md §7: stamped here, once, and never rewritten by anything below.
      // Resolved outside `serialize()` because it is a read of the projection —
      // one indexed lookup per link of a chain that is one to three links long —
      // and the chain exists to keep readers from observing a half-written
      // *batch* of files, which a lane resolution neither performs nor observes.
      lane: laneFor(input, this.findScopeRoot),
      // SPEC.md §7's order, stamped here for the same reason the lane is: once,
      // at the only moment the answer is known, and never rewritten below.
      seq: this.nextSeq(),
    };
    await this.store.writeEvent("pending", event);
    this.mirror.upsertEvent(event);
    // After the mirror, so an observer that writes a console row for this event
    // finds its `events` row already there; before the invalidate, so the frame
    // that follows already announces whatever the observer wrote (`JOBS_KEY` is
    // in `QUEUE_QUERY_KEYS`, and an append broadcasts nothing of its own); and
    // before the wake, so a line about the job precedes anything the woken agent
    // appends to the same log.
    await this.notifyEnqueued(event);
    // This *does* name `["agents"]` (SERVER-155), reversing SERVER-115. A row
    // now carries its lane's `pending` count, and that count is what the
    // orchestrator launches a listener from — so an enqueue nobody announced
    // would leave a conversation waiting with nothing to say it had changed.
    this.invalidate(queueTransitionKeys(undefined, "pending"));
    this.wake(laneOf(event));
    this.evictReleasedLane(event);
    return event;
  }

  /**
   * The next {@link StoredEvent.seq}: the clock, dragged forward whenever it
   * would repeat itself.
   *
   * The clock alone is not enough twice over. Two enqueues inside one
   * millisecond would tie, and a test's injected `now` is usually a constant, so
   * every event a fixture makes would tie — and a queue whose order is only
   * observable on a fast enough machine is not an order. `Math.max` keeps the
   * value an epoch-milliseconds reading whenever real time has moved, which is
   * what makes it comparable across a restart, and makes it *this* enqueue's
   * position whenever it has not.
   */
  private nextSeq(): number {
    this.lastSeq = Math.max(this.now(), this.lastSeq + 1);
    return this.lastSeq;
  }

  /**
   * A `resident.released` ends every park on the lane it names (SERVER-128).
   *
   * **Here, rather than at the three call sites that release**, because a
   * release that announced itself without ending the park — or ended it without
   * announcing — is a state nothing wants to be able to reach, and there are
   * already three producers (a person's `DELETE`, resolution, and a designation
   * that displaces an occupant) with more possible later. Riding on the event
   * makes the two halves one act by construction, and gives the eviction the
   * same lane the announcement was routed against.
   *
   * Read through the contract's own `parseResidentReleasedPayload`, so the type
   * and the payload shape are the published ones and not a second reading of
   * them. A payload this server did not write — an older release, a hand-dropped
   * file — simply fails the parse and evicts nobody, which is the same
   * conservative direction `readRequestedWeight` takes for the same reason.
   *
   * After the wake, deliberately: the wake concerns the **orchestrator's** lane
   * (that is where a release is stamped) and the eviction concerns the released
   * lane, so the two never touch the same waiter, and doing the announcement's
   * work first keeps the ordinary path first.
   */
  private evictReleasedLane(event: StoredEvent): void {
    const released = parseResidentReleasedPayload(event);
    if (released === undefined) return;
    this.evictLane(released.threadId);
  }

  /**
   * Ends every parked `idle` scoped to `lane`, and answers how many there were.
   *
   * The lane's designation is gone by the time this runs, so those requests have
   * nothing left to wait for: they return the contract's `204` at once instead of
   * holding until their window runs out. §7's bound on discovering a release
   * drops from the park rearm — up to ~8 minutes — to one HTTP round trip, which
   * is what makes *release* an act with an observable end rather than a request
   * that takes effect at some point in the next eight minutes.
   *
   * **Exact lane equality, not {@link visibleTo}.** The relation that decides who
   * *sees* an event is deliberately asymmetric (the orchestrator sees lapsed
   * lanes); the relation that decides whose park *ended* is not. Only the
   * requests parked on this very lane are concerned, and the orchestrator's own
   * park is left alone — it is woken by the release event itself, as by any other
   * event on its lane.
   *
   * **Nothing queued is touched.** Events stamped for this lane before the
   * release stay exactly where they are, in `pending/` or `in-progress/`, for the
   * departing listener to drain — the converse skill's account of retirement
   * depends on that, and a release that swept them would orphan work in flight.
   */
  evictLane(lane: Lane): number {
    return this.waiters.evict((scope) => scope === lane);
  }

  /**
   * Releases every parked request that would see an event on `lane` — its own
   * lane's, and the orchestrator's when that lane is not live.
   *
   * The same predicate the claim uses, so a park and the claim that follows it
   * can never disagree about whether there is work: waking an agent whose next
   * claim returns an empty batch is a spin, and *not* waking one whose claim
   * would have returned the event is the event sitting there until the poll tick
   * finds it.
   */
  private wake(lane: Lane): void {
    this.wakeLanes([lane]);
  }

  /** {@link wake} for a batch: woken once, for the union of what those lanes reach. */
  private wakeLanes(lanes: readonly Lane[]): void {
    if (lanes.length === 0) return;
    this.waiters.notify((scope) => lanes.some((lane) => visibleTo(scope, lane)));
  }

  /**
   * Wakes every parked lane, whatever it is scoped to.
   *
   * The one caller is `resume`: a halt suppressed every lane at once, so lifting
   * it concerns every lane, and there is no set of events to read a lane off —
   * the work that becomes claimable is whatever was already sitting there.
   */
  private wakeEveryLane(): void {
    this.waiters.notify(() => true);
  }

  /**
   * Runs the enqueue observer, if one is bound, and swallows its failure.
   *
   * The event is on disk and mirrored by the time this runs, so a throwing
   * observer must not un-make it: failing the producer's request here would
   * report "your comment was not posted" about a comment that was posted and an
   * agent that has been woken for it.
   */
  private async notifyEnqueued(event: StoredEvent): Promise<void> {
    if (this.enqueueObserver === undefined) return;
    try {
      await this.enqueueObserver(event);
    } catch (error) {
      this.logger.error("enqueue observer failed", { id: event.id, error: String(error) });
    }
  }

  /**
   * Long-poll: resolves with the pending events the instant there are any, or
   * `undefined` when the window expires (the contract's `204`). It **reports
   * availability and never claims** — the agent's loop is `idle → claim-all`.
   * While halted it parks for the full window: that is what "the agent stops
   * picking up work" means (SPEC.md §7).
   *
   * A window that ends with work also reports {@link QueueBatch.held}, read in
   * the same serialized turn as the pending events so the two are one
   * observation rather than two. The expiring window reports nothing, because
   * the contract's `204` has no body — and an agent with nothing to claim has
   * nothing to reconcile against; the list arrives on the next `200` regardless.
   *
   * **Parks on one lane** (SPEC.md §7, SERVER-111): the events it waits for and
   * the events it reports are the ones `claimAll` at the same scope would hand
   * over, which is what keeps the loop's two entry points from disagreeing.
   * `scope` absent is {@link ORCHESTRATOR_LANE} — the same lane, not a third
   * behaviour, so a caller written before lanes existed means what it meant.
   *
   * **Holding this request is what presence is** (SPEC.md §7, SERVER-112), which
   * is why the tracker is told here and not inside `WaiterRegistry.wait`: an
   * `idle` whose work is already waiting never parks at all, and a resident busy
   * enough that every one of its calls returns at once would read as absent for
   * exactly as long as it was busiest — the orchestrator stealing its lane
   * because the listener was working it. The observation therefore spans the
   * whole call, and the release is a `finally`: a window that expired, was
   * aborted by a dropped client, or threw has ended the same way as far as
   * presence is concerned.
   *
   * **A release ends the window at once** (SERVER-128). Where the lane's
   * designation is removed while this request is parked on it, the request
   * answers `204` on the release's own round trip rather than holding to the end
   * of its window — see {@link evictLane}. Nothing about the response changes:
   * it is the ordinary empty window, and the caller finds out *why* by reading
   * its designation, or by being refused at its next park.
   */
  async idle(request: IdleRequest): Promise<QueueBatch | undefined> {
    const scope = request.scope ?? ORCHESTRATOR_LANE;
    const release = this.laneTracker.observePark(scope);
    try {
      return await this.idleHolding(scope, request);
    } finally {
      release();
    }
  }

  /** {@link idle}'s window, with presence already being observed around it. */
  private async idleHolding(scope: Lane, request: IdleRequest): Promise<QueueBatch | undefined> {
    // Wall clock, not the injected `now`: the window is a duration measured
    // against the very timers the waiter parks on, while `now` exists to make
    // the *instants written into files* deterministic in tests.
    const deadline = Date.now() + request.timeoutMs;
    for (;;) {
      const available = await this.settledWork(scope);
      if (available !== undefined) return available;

      const remaining = deadline - Date.now();
      if (remaining <= 0) return undefined;
      // Parked **under its lane**: another lane's arrival must not end this
      // window, or a resident re-parks on every message the orchestrator gets
      // and a scoped park stops being the zero-token wait it is sold as.
      //
      // Only `"woke"` goes round again. `"expired"` is the window ending and
      // `"evicted"` is the lane ending (SERVER-128) — and the second one has to
      // *leave the loop*, not merely fail to find work: a re-park on a lane
      // nobody designates any more would hold this request open for the rest of
      // its window, which is the wait the eviction exists to end.
      const outcome = await this.waiters.wait(scope, remaining, request.signal);
      if (outcome !== "woke") return undefined;
    }
  }

  /**
   * Moves every `pending/*` **this scope can see** to `in-progress/` and returns
   * them as one batch. Serialized in-process and `ENOENT`-tolerant, so two
   * concurrent calls split the queue between them and never hand the same event
   * to both. Events enqueued during the claim simply stay pending for the next
   * one.
   *
   * **What "can see" means is SPEC.md §7's whole partition** (SERVER-111): a
   * scoped claim sees only its own lane, and the orchestrator's — which is the
   * unscoped one, since `scope` absent is {@link ORCHESTRATOR_LANE} — sees its
   * own lane plus every lane whose listener has lapsed. Two agents claiming at
   * once are therefore reading disjoint sets rather than racing, and "a claim
   * never hands one event to two callers" now holds per lane, which is where it
   * was always doing its work.
   *
   * **`held` is the state `in-progress/` was in *before* this claim's moves**,
   * and that is the whole point of the field (SPEC.md §7, CONTRACT-033). The
   * batch being handed over lands in `in-progress/` as part of this very call,
   * so reporting the directory afterwards would tell the agent it is
   * "apparently already working" on the events it is being given — useless on
   * the first claim and actively misleading on every one. Read here, at the top
   * of the same serialized turn, the two sets are disjoint by construction
   * rather than by the order two calls happened to be made in.
   *
   * It is read before the halt check as well: a halt stops work being handed
   * out, not the agent's ability to reconcile what it already holds.
   *
   * **The batch is in the order the conversation has it** — `created`, then
   * `seq`, then id ({@link byQueueOrder}), for every lane (SERVER-131). SPEC.md
   * §7 has a resident work its conversation inline, one event at a time, and
   * the skill that does so reads the order off this list. Before this it was
   * `readdir` order, which is the event id's: measured on a real server, three
   * replies posted inside one second came back Y, Z, X — the first message
   * last, answered third.
   */
  async claimAll(request: LaneScope = {}): Promise<QueueBatch> {
    const scope = request.scope ?? ORCHESTRATOR_LANE;
    return this.serialize(async () => {
      const held = await readHeldInProgress(this.store, this.logger, (event) =>
        this.visible(scope, event),
      );
      // Halted: claim nothing, and *move* nothing — the read above is the report
      // the halt does not suppress (see the docblock), never a claim.
      if (await this.store.isHalted()) return { events: [], held };

      const claimed: StoredEvent[] = [];
      let touched = false;
      // The whole directory is read **before** the first move, so the batch can
      // be ordered by what the files say rather than by the order they were
      // listed in (SERVER-131). It is the same one read per pending file the
      // interleaved version did, in the same serialized turn — the only thing
      // that moved is where the reading stops and the claiming starts.
      for (const { id, event: pending } of await this.orderedPending()) {
        // The lane is read **before** the move, off the file in `pending/`: a
        // claim that moved first and filtered afterwards would have to move
        // another lane's event back, and the window between the two renames is
        // exactly where a second claimant would see it in neither directory.
        //
        // A file that does not parse belongs to no lane — its stamp is part of
        // what could not be read — so it is claimed by whoever gets there and
        // quarantined below. Skipping it while scoped would leave a corrupt file
        // sitting in `pending/` for as long as no orchestrator claim ran, which
        // is the one outcome quarantine exists to prevent.
        if (pending !== undefined && !this.visible(scope, pending)) continue;
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
      if (touched) this.invalidate(queueTransitionKeys("pending", "in-progress"));
      return { events: claimed, held };
    });
  }

  /**
   * In-progress → `processed/`: the agent reporting that the work it claimed is
   * done. {@link CLAIMED_ONLY} carries why every other status is a `409`.
   */
  async complete(id: string): Promise<StoredEvent> {
    return this.transition(id, "processed", {
      onlyFrom: { statuses: CLAIMED_ONLY, verb: "completed" },
    });
  }

  /**
   * In-progress → `failed/`: the agent reporting that the work it claimed could
   * not be done. {@link CLAIMED_ONLY} again — and it is what stops a second
   * `fail` quietly discarding the reason it carried, since the file the first one
   * wrote was never going to be overwritten.
   */
  async fail(id: string, reason?: string): Promise<StoredEvent> {
    // The request field is `reason`, the on-disk field is `error` — one concept,
    // named for its reader on each side (sprint-003 adjudication 7).
    return this.transition(id, "failed", {
      onlyFrom: { statuses: CLAIMED_ONLY, verb: "failed" },
      ...(reason === undefined ? {} : { fields: { error: reason } }),
    });
  }

  /**
   * Abandon is a move to `abandoned/`, never a delete: the file is evidence.
   *
   * Admitted from more than a settle is, and refused from `processed`:
   * {@link ABANDONABLE} carries the reasoning.
   */
  async abandon(id: string): Promise<StoredEvent> {
    return this.transition(id, "abandoned", {
      onlyFrom: { statuses: ABANDONABLE, verb: "abandoned" },
    });
  }

  /**
   * In-progress → `deferred/`: the agent found a **person editing** the document
   * this work is about, so it parks rather than writing beside them (SPEC.md §7,
   * CONTRACT-021). A judgement, not a refusal — nothing stopped it.
   *
   * **Only a claimed event can be deferred.** Nothing else has tried the edit
   * yet and terminal events are done, so anything but `in-progress` is a `409` —
   * which is also what makes a second defer of the same event a refusal rather
   * than a silent no-op that would look like it worked. The check rides
   * `transition`'s `onlyFrom`, inside the writer chain, for the same reason
   * retry's does (see {@link RequeueOptions}).
   *
   * The document waited on is recorded **on the event**, which is what survives
   * a restart (SPEC.md §7 — "never silently dropped"); several events can park
   * on the same document. No open session on `blockedOn` is required. The
   * contract declares exactly two refusals for this route and this is not one of
   * them; a deferral whose session ended in the meantime is left visible,
   * countable and retryable by hand rather than rejected on a race the caller
   * cannot win.
   */
  async defer(id: string, deferral: DeferralFields): Promise<StoredEvent> {
    return this.transition(id, "deferred", {
      onlyFrom: { statuses: CLAIMED_ONLY, verb: "deferred" },
      fields: {
        blockedOn: deferral.blockedOn,
        ...(deferral.deferReason === undefined ? {} : { deferReason: deferral.deferReason }),
      },
    });
  }

  /**
   * Returns every event deferred on `docId` to `pending/`. The queue's half of
   * §7's promise that a deferred edit "re-enters the queue rather than being
   * lost": the **edit-session tracker** calls it whenever a session ends
   * (`app.ts` wires `onSessionEnded` to it, SERVER-099), so the work comes back
   * **on its own**, with no CLI call and no operator. That trigger replaced the
   * lock's release, break and reap, and it is now the only automatic one —
   * `corpus job retry` remains §7's manual override.
   *
   * Deliberately keyed on the document rather than on a single recorded event
   * id: several events can park on the same document, and each has to come back
   * exactly once. Already-pending events are unreachable here (only `deferred/`
   * is scanned), which is what makes a second trigger — two sessions ending on
   * one document — a no-op rather than a duplicate.
   *
   * A session ending with nothing deferred behind it touches no file,
   * invalidates nothing and logs nothing: it is the overwhelmingly common case.
   */
  async requeueDeferredFor(docId: string): Promise<string[]> {
    return this.serialize(async () => {
      const requeued: string[] = [];
      const requeuedLanes: Lane[] = [];
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
        // attempt count does **not** reset, because waiting for a person to stop
        // editing is not an attempt and a manual `job retry` is the verb that
        // asserts a clean slate (see `requeue`).
        // `stamp` spreads the event, so the lane rides across untouched — which
        // is what §7 requires of automatic re-entry: an event deferred on a
        // resident's lane comes back to that resident, not to whoever happens to
        // claim next.
        const event = this.stamp(withoutDeferral(read.event), "pending");
        await this.store.writeEvent("pending", event);
        this.mirror.upsertEvent(event);
        requeuedLanes.push(laneOf(event));
        requeued.push(id);
      }
      if (requeued.length > 0) {
        // `deferred/` → `pending/`: work re-entering the queue, still unheld.
        this.invalidate(queueTransitionKeys("deferred", "pending"));
        this.wakeLanes(requeuedLanes);
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
   * asserting the run can start over. It is the console's retry of a failed job,
   * and §7's manual override for a deferral the automatic trigger never reached.
   * Already-pending is a no-op, so repeating it is harmless.
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
      // The **lane is not one of them** and has to be carried across by name —
      // this is the one transition that reconstructs the event instead of
      // stamping it, so it is the one place a lane could be silently dropped and
      // a resident's retried work quietly become the orchestrator's (SPEC.md §7:
      // the stamp is made once and never rewritten).
      //
      // `seq` is carried across for the same reason and with the same force
      // (SERVER-131). A retry re-runs work the conversation already has a place
      // for; minting a fresh one would move a retried message to the end of the
      // conversation it belongs in the middle of. It rides beside `created`,
      // which this rebuild already keeps for exactly that reason.
      const event: StoredEvent = {
        id: current.event.id,
        type: current.event.type,
        created: current.event.created,
        source: current.event.source,
        payload: current.event.payload,
        status: "pending",
        updated: formatInstant(this.now()),
        attempts: 0,
        ...(current.event.lane === undefined ? {} : { lane: current.event.lane }),
        ...(current.event.seq === undefined ? {} : { seq: current.event.seq }),
      };
      await this.store.writeEvent("pending", event);
      this.mirror.upsertEvent(event);
      // A retry of work a lane was **holding** takes it out of that lane's hands
      // and out of its summary; a retry of a failed or deferred job does not.
      this.invalidate(queueTransitionKeys(from, "pending"));
      this.wake(laneOf(event));
      return event;
    });
  }

  /**
   * Returns events stranded in `in-progress/` by a dead run to `pending/`, one
   * attempt poorer, and gives up on those past the cap. `reaped` lists only what
   * came back to `pending/` (sprint-003 adjudication 1).
   *
   * **Lane-blind, and lane-preserving** (SPEC.md §7). Staleness is staleness: a
   * held event nobody can account for is stuck whichever agent claimed it, and
   * scoping the reaper would leave a dead resident's work unrecoverable by the
   * one agent still running. What it must not do is *re-route* what it recovers
   * — `stamp` spreads the event, so a reaped event returns to `pending/` on the
   * lane it was claimed from, and the fallback (not the reaper) is what decides
   * who may then see it.
   */
  async reapStale(): Promise<ReapResult> {
    return this.serialize(async () => {
      const reaped: string[] = [];
      const failed: string[] = [];
      const reapedLanes: Lane[] = [];
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
        if (target === "failed") failed.push(id);
        else {
          reaped.push(id);
          reapedLanes.push(laneOf(event));
        }
      }
      // Everything a reap moves comes out of `in-progress/`, so a lane that was
      // reported as working stops being.
      if (reaped.length > 0 || failed.length > 0) {
        this.invalidate(queueTransitionKeys("in-progress"));
      }
      this.wakeLanes(reapedLanes);
      return { reaped, failed };
    });
  }

  async halt(reason?: string): Promise<QueueStatus> {
    const sentinel: HaltSentinel = {
      at: formatInstant(this.now()),
      ...(reason === undefined ? {} : { reason }),
    };
    await this.store.writeHalt(sentinel);
    // **No `["agents"]`, and that is a decision** (SERVER-115): a halt writes a
    // sentinel, not an event. It moves no `events` row and no `jobs` row, and
    // §7's roster reads neither the sentinel nor anything derived from it — a
    // resident holding work is still holding it, and an idle lane is still
    // idle. What a halt changes is `QueueStatus.halted`, which is `["queue"]`.
    // Naming the roster here would send every open client to refetch a response
    // that cannot have moved, which is the "blanket addition" this issue was
    // careful to distinguish from the fix.
    this.invalidate(QUEUE_QUERY_KEYS);
    // Parked waiters are deliberately *not* woken: halting means the agent stops
    // picking up work, so they park out their window.
    return this.status();
  }

  async resume(): Promise<QueueStatus> {
    await this.store.clearHalt();
    // The converse of {@link halt}, and roster-neutral for the same reason:
    // lifting the switch lets claims happen, and it is the claim that will move
    // a lane's row — announced then, by the transition that makes it true.
    this.invalidate(QUEUE_QUERY_KEYS);
    // One halt switch across every lane (SPEC.md §7), so lifting it concerns
    // every parked agent — including ones whose lane has nothing pending, which
    // simply claim an empty batch and re-park.
    this.wakeEveryLane();
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
   *
   * **`agent` is not a count and is not derived from one** (CONTRACT-045): the
   * counts describe the work, `agent` describes the worker, and the console used
   * to guess the second from the first — "not halted and nothing in progress ⇒
   * idle" — which reported an agent with nothing to do on a machine with no
   * agent at all. It is the roster's own verdict aggregated over every lane,
   * read from the same tracker `GET /api/agents` reads per lane, so the strip
   * and the recipient picker cannot disagree about whether anybody is listening.
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
    return {
      agent: this.laneTracker.presence(),
      halted,
      pending,
      inProgress,
      deferred,
      processed,
      failed,
      abandoned,
    };
  }

  /** Releases every parked request. Registered as a server disposer. */
  close(): void {
    this.waiters.close();
  }

  /**
   * The pending events a claim scoped to `scope` could take right now; empty
   * while halted.
   *
   * Filtered by the same predicate the claim itself uses, so `idle` and the
   * `claim-all` that follows it can never disagree: reporting availability that
   * the next claim declines to hand over is how an agent ends up in a wake-claim-
   * empty-repark loop.
   */
  private async availablePending(scope: Lane): Promise<StoredEvent[]> {
    if (await this.store.isHalted()) return [];
    const events: StoredEvent[] = [];
    for (const id of await this.store.listIds("pending")) {
      const read = await this.store.readEvent("pending", id);
      if (read === undefined) continue;
      if (read.ok) {
        if (this.visible(scope, read.event)) events.push(read.event);
      }
      // A corrupt file is quarantined by `claim-all`, which is a write path;
      // `idle` is a read and never mutates the queue.
      else this.logger.debug("skipping malformed pending event", { id, reason: read.reason });
    }
    // The same order `claimAll` hands the same events over in (SERVER-131), for
    // the same reason the same predicate filters them: the loop's two entry
    // points describe one queue, and an agent that read `idle`'s list and then
    // worked `claim-all`'s must not find the conversation reshuffled between
    // them.
    events.sort(byQueueOrder);
    return events;
  }

  /**
   * Every file in `pending/` read once, in the order the conversation has them
   * (SPEC.md §7, SERVER-131).
   *
   * `event` is absent for a file that vanished between the listing and the read,
   * and for one that does not parse — `claimAll` treats both the same way it
   * always has: it claims them, because a corrupt file belongs to no lane and
   * has to reach quarantine whoever is claiming.
   *
   * **The unreadable ones go last, and never between two events.** They carry no
   * instant to be ordered by, so any position among the readable ones would be
   * invented; they are also the only entries the batch never reports, so their
   * position costs the agent nothing and putting them at the end keeps a
   * quarantine from splitting a conversation in half.
   */
  private async orderedPending(): Promise<readonly PendingEntry[]> {
    const readable: (PendingEntry & { readonly event: StoredEvent })[] = [];
    const opaque: PendingEntry[] = [];
    for (const id of await this.store.listIds("pending")) {
      const read = await this.store.readEvent("pending", id);
      if (read !== undefined && read.ok) readable.push({ id, event: read.event });
      else opaque.push({ id });
    }
    readable.sort((left, right) => byQueueOrder(left.event, right.event));
    // `opaque` is already in a stable order: `listIds` sorts by id.
    return [...readable, ...opaque];
  }

  /**
   * SPEC.md §7's visibility rule: `queue/lanes.ts` decides, from the two lanes
   * and nothing else.
   *
   * **It asks no question about liveness, and that is the change** (SERVER-152).
   * A claim used to widen for a lapsed lane; the rider signed 2026-08-25 ends
   * that, so a listener's absence strands nothing and surrenders nothing. A
   * resident that comes back finds its lane exactly as it left it — which was
   * true before too, and is now true for the simpler reason that nobody else
   * could ever have touched it.
   */
  private visible(scope: Lane, event: StoredEvent): boolean {
    return visibleTo(scope, laneOf(event));
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
        throw refuseTransition(id, from, to, options.onlyFrom);
      }

      const current = await this.store.readEvent(from, id);
      if (current === undefined) throw notFound(`no queue event ${id}`);
      if (!current.ok) return this.quarantine(id, from, current);
      // Already there: no move, and the file is left exactly as it is.
      //
      // **No verb this service exposes reaches it** since SERVER-145 — all four
      // declare `onlyFrom` and none admits its own target status, so a repeat is
      // refused above rather than answered with a `200`. It stays as the floor
      // under `transition` itself, which is a general mechanism: a future verb
      // that omits `onlyFrom` gets "nothing happened" rather than a rename of a
      // file onto itself. Whether a repeat is a refusal or a no-op is the verb's
      // decision to state, which is the whole of what SERVER-145 settled.
      if (from === to) return current.event;

      if (!(await this.store.move(from, to, id))) {
        throw notFound(`no queue event ${id}`);
      }
      const event = this.stamp(current.event, to, options.fields);
      await this.store.writeEvent(to, event);
      this.mirror.upsertEvent(event);
      // Before the announcement, never after: SPEC.md §7's reflection clock
      // moves on this very transition and rides out on the same frame
      // (SERVER-137). See {@link QueueSettlementObserver}.
      this.notifySettled(event);
      // The general shape of a settlement — complete, fail, defer, abandon — so
      // the roster is named whenever `in-progress` is one of the two ends, which
      // for every verb routed through here is the `from`.
      this.invalidate(queueTransitionKeys(from, to));
      // SPEC.md §4: "a queue event finished, however it finished" closes the
      // open commit window, so the agent's stewardship for one event is one
      // commit rather than one per document it touched (SERVER-092). Only here,
      // and only for an ending: `claim` begins the work and `retry` puts it back
      // at the start of it, and neither may end a window the agent is still
      // filling. Reached only past the `onlyFrom` refusal above, so a second
      // `fail` on an already-failed event closes nothing — nothing finished.
      //
      // Nothing is committed either way: `.corpus/queue/` is gitignored, and a
      // close that finds no window open is a silent no-op — which is what a
      // deferral of an event that changed nothing gets.
      if (FINISHED_STATUSES.has(to)) await this.closeCommitWindow();
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
    this.invalidate(queueTransitionKeys(from, "failed"));
    this.logger.error("quarantined malformed queue event", { id, reason: read.reason });
    return event;
  }

  /**
   * The moved event as it is rewritten in its new directory.
   *
   * The deferral bookkeeping is stripped first and re-supplied only by the
   * transition that owns it, so `blockedOn` is present exactly while the event
   * is in `deferred/` — the invariant `Job.blockedOn` publishes (CONTRACT-021).
   * Carrying it along would leave a processed job claiming to be waiting on a
   * document.
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
  private settledPending(scope: Lane): Promise<StoredEvent[]> {
    return this.serialize(() => this.availablePending(scope));
  }

  /**
   * {@link settledPending} plus the held set, for the long poll's answer:
   * `undefined` when there is no work, so the parked path pays nothing for a
   * field only a `200` carries.
   *
   * Both halves are read in one turn of the chain, so the pending events and the
   * held set are a single observation — the same reason `settledPending` takes
   * the chain at all. `idle` claims nothing, so unlike `claimAll` there is no
   * before-or-after question here: there are no moves to be before.
   */
  private settledWork(scope: Lane): Promise<QueueBatch | undefined> {
    return this.serialize(async () => {
      const events = await this.availablePending(scope);
      if (events.length === 0) return undefined;
      return {
        events,
        held: await readHeldInProgress(this.store, this.logger, (event) =>
          this.visible(scope, event),
        ),
      };
    });
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
