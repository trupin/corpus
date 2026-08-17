/**
 * SPEC.md §7's presence: **the parked request, and nothing else.**
 *
 * A resident is live exactly while it holds a parked scoped `idle`. So this
 * module registers nothing, asks nothing of an agent, and reaps nothing: it
 * counts the `idle` requests the server is holding open, per lane, and remembers
 * when each lane last held one. An agent that stops parking stops being present,
 * whether it exited cleanly, crashed or was killed — there is no third state to
 * arrive at and nothing to time out but the request itself.
 *
 * **The verdict is computed, never stored.** {@link LaneTracker.isLive} is an
 * arithmetic answer over `parked` and `lastSeen` at the instant it is asked, and
 * the claim path asks it at claim time (`queue/lanes.ts`'s `visibleTo`). The
 * timer below decides *nothing*: it exists only so that the moment a lane goes
 * quiet is **announced** — a parked orchestrator woken, a roster refetched —
 * rather than waited for. Kill the timer and every answer this module gives is
 * unchanged; only the announcement is late, and the waiter registry's poll would
 * find the same work within its tick anyway.
 *
 * That is also why nothing here is persisted. A restart empties the map, every
 * lane reads lapsed, and the next park restores it — which is the same fallback
 * §7 already accepts, in the direction it already accepts it: the orchestrator
 * may do work a resident would have, never the reverse.
 */

import {
  AGENT_PRESENCE_WINDOW_SECONDS,
  type AgentPresence,
  type Lane,
  type QueryKey,
} from "@corpus/contract";
import { formatInstant } from "../core/time.js";
import { AGENTS_KEY, QUEUE_KEY } from "../events/index.js";
import type { LaneLiveness } from "./lanes.js";

/**
 * What a presence change makes stale — **both routes that carry it**.
 *
 * Presence is served at two grains from this one map: per lane on
 * `GET /api/agents` (`["agents"]`), and aggregated on `QueueStatus.agent` from
 * `GET /api/queue/status` (`["queue"]`, CONTRACT-045). §7 makes presence *"a
 * read, never a push"*, so the only thing that reaches a client is the name of a
 * key it should ask again on — which means a reader whose key is not named never
 * learns at all. It cannot fall back on a poll: the UI caches with `staleTime:
 * Infinity` and refetches on neither focus nor reconnect
 * (`packages/kit/src/client/queryClient.ts`), so an unnamed key is stale until
 * something unrelated invalidates it.
 *
 * That is exactly what SERVER-114 measured: naming only `["agents"]` left the
 * console's agent pill — which reads the queue status, not the roster — showing
 * `disconnected` while the server answered `live: true`, until a reload or an
 * unrelated queue transition. **The rule this constant encodes: the emit names
 * every key a route carrying the changed fact is cached under, not the key of
 * the route the fact is named after.**
 *
 * Deliberately not the same thing as `QUEUE_QUERY_KEYS`: a queue *transition*
 * moves counts and jobs, a presence change moves neither, and a park emitting
 * `["jobs"]` would send the console to re-read a list that cannot have changed.
 */
export const PRESENCE_QUERY_KEYS: readonly QueryKey[] = [AGENTS_KEY, QUEUE_KEY];

/**
 * §7's **grace window**: how long a lane stays live after its listener un-parks.
 *
 * **Derived from the contract, never chosen here.** §7 deliberately leaves the
 * length open but guarantees exactly one bound on it — *"the window is longer
 * than a rearm gap"* — and the rearm gap is bounded by the idle timeout, which
 * the contract fixes at `MAX_IDLE_TIMEOUT_SECONDS = 480`. A park cannot outlive
 * that and the skill re-invokes immediately, so a healthy listener is un-parked
 * for milliseconds and absent for at most one whole park cycle when a rearm is
 * missed. `AGENT_PRESENCE_WINDOW_SECONDS` is `480 × 2 = 960 s`: it tolerates one
 * wholly missed rearm and calls two a departure.
 *
 * The number is **the contract's** rather than a server constant beside
 * `DEFAULT_STALE_AFTER_MS`, because it is one number two processes have to agree
 * on: the server applies it to decide `AgentPresence.live`, and a client applies
 * the same window to the same instant to expire a verdict it has been holding
 * (`isAgentPresent`). A server window of its own — 900 s, say — would satisfy
 * §7's bound and still let a client call a lane absent that the server had just
 * called present, which is the flicker the window exists to stop.
 */
export const LANE_GRACE_MS = AGENT_PRESENCE_WINDOW_SECONDS * 1000;

/** One lane's presence: the roster's `live`/`since` pair, before it is a row. */
export interface LanePresence {
  readonly lane: Lane;
  readonly live: boolean;
  /**
   * When this lane was last observed **holding** a parked `idle`, or null when
   * it never has been.
   *
   * Set at the park and again at the release — a release is the last instant the
   * listener was observed parked — and frozen in between. So on a live lane it
   * is never older than one park (the contract's 480 s bound), which is what
   * keeps `now − since` an honest age of the evidence and keeps the server's
   * `live` from ever being one a client would expire.
   */
  readonly since: string | null;
}

/**
 * What the queue asks of the tracker, and the whole of it.
 *
 * Three questions with three different consumers, which is why they are one
 * object rather than three seams: the claim path's predicate (bound through
 * `QueueService.attachLaneLiveness`, unchanged since SERVER-111), the park
 * observation that is the tracker's only input, and the aggregate
 * `QueueStatus.agent` publishes. Binding half of a tracker is not a state
 * anything wants, so there is no way to.
 */
export interface LaneTracker {
  /** SPEC.md §7's fallback predicate. A property, so it can be bound as a value. */
  readonly isLive: LaneLiveness;
  /**
   * A scoped `idle` has arrived and is being held. Returns the release, which
   * the holder calls exactly once when the request is answered however it is
   * answered — with work, empty, aborted or thrown.
   *
   * Counted rather than flagged: a rearm can briefly overlap the park it
   * replaces, and two parks that decremented one flag would leave a live lane
   * reading lapsed for a whole grace window.
   */
  observePark(lane: Lane): () => void;
  /** One lane's row material. Answers for a lane nothing ever parked on. */
  presenceOf(lane: Lane): LanePresence;
  /**
   * The roster's own verdict **aggregated over every lane**, which is what
   * `QueueStatus.agent` publishes: live iff some lane is live, `since` the most
   * recent of the **live** lanes' instants (CONTRACT-045; SERVER-118 for which
   * lanes' instants, and for the one state that has none).
   *
   * One notion of presence at two grains, from one map — so the console strip
   * and the recipient picker cannot come to disagree about whether anybody is
   * listening.
   */
  presence(): AgentPresence;
  /** Shutdown: stops the announcement timer. Answers nothing differently. */
  close(): void;
}

export interface LaneTrackerOptions {
  /** Epoch milliseconds; injected so the window is testable against a fixture clock. */
  readonly now?: (() => number) | undefined;
  /** Defaults to {@link LANE_GRACE_MS}; a test shortens it, production never does. */
  readonly graceMs?: number | undefined;
  /**
   * A lane's row changed — it parked, it released, or it lapsed. `app.ts` turns
   * this into one invalidation naming {@link PRESENCE_QUERY_KEYS} (SPEC.md §7:
   * *"who is running is a read, never a push"*), so both routes that carry
   * presence are refetched over HTTP and nothing about presence travels over SSE
   * as data.
   */
  readonly onPresenceChanged?: ((lane: Lane) => void) | undefined;
  /**
   * A lane went past the grace window. Fired **after** the lane already reads
   * lapsed, so whatever this wakes sees the fallback the lapse creates.
   */
  readonly onLapsed?: ((lane: Lane) => void) | undefined;
}

interface LaneRecord {
  /** Parked `idle` requests being held on this lane right now. */
  parked: number;
  /** Epoch ms of the most recent park or release. */
  lastSeen: number;
  /** Has this lapse already been announced? Reset by the next park. */
  announced: boolean;
}

/**
 * The tracker of a server that observes no parks: **nothing has ever parked**.
 *
 * Not a stand-in for an unknown answer, and not the `{live: false, since: null}`
 * a route would have hard-coded before this module existed. It is reachable only
 * from a `QueueService` built without a tracker — a unit test's — and such a
 * queue is the one thing that *would* have observed a park, so "no park was
 * observed" is a measurement over the whole population rather than an assertion
 * about agents the server cannot see. `app.ts` binds a real tracker
 * unconditionally, projection or no projection: presence is in-memory and needs
 * no database.
 */
export const NOTHING_PARKED: LaneTracker = {
  isLive: () => false,
  observePark: () => () => undefined,
  presenceOf: (lane) => ({ lane, live: false, since: null }),
  presence: () => ({ live: false, since: null }),
  close: () => undefined,
};

export function createLaneTracker(options: LaneTrackerOptions = {}): LaneTracker {
  const now = options.now ?? Date.now;
  const graceMs = options.graceMs ?? LANE_GRACE_MS;
  const onPresenceChanged = options.onPresenceChanged ?? (() => undefined);
  const onLapsed = options.onLapsed ?? (() => undefined);

  /**
   * One record per lane something has parked on since boot, kept after it
   * lapses because `since` outlives `live`: a designated lane with no listener
   * has to be able to say *when* it was last heard from, which is the difference
   * between "waiting to be picked up" and "never started". Nothing is reaped —
   * §7 has nothing to reap — and the set is bounded by the scopes an
   * authenticated local caller has actually parked on, which a restart clears.
   */
  const lanes = new Map<Lane, LaneRecord>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  /**
   * Strictly inside the window, so a lane cannot sit exactly on the boundary:
   * the sweep below arms its timer at `lastSeen + graceMs`, and a boundary that
   * still read live there would leave the sweep re-arming for the same instant
   * on every tick. The client's own expiry (`isAgentPresent`) uses `<=`, so the
   * server is the stricter of the two and can never report a `live` the client
   * would immediately discard.
   */
  const liveAt = (record: LaneRecord, at: number): boolean =>
    record.parked > 0 || at - record.lastSeen < graceMs;

  const isLive: LaneLiveness = (lane) => {
    const record = lanes.get(lane);
    return record !== undefined && liveAt(record, now());
  };

  /**
   * One timer for every lane, armed at the earliest lapse still to be announced
   * — the discipline `edit/sessions.ts` uses, for the same reason: a workspace
   * has a handful of lanes, and being wrong about that costs a live timer each.
   *
   * A lane currently parked has no deadline (it will get one when it releases)
   * and a lane already announced has had its.
   */
  const rearm = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (closed) return;
    let earliest: number | null = null;
    for (const record of lanes.values()) {
      if (record.parked > 0 || record.announced) continue;
      const deadline = record.lastSeen + graceMs;
      if (earliest === null || deadline < earliest) earliest = deadline;
    }
    if (earliest === null) return;
    timer = setTimeout(sweep, Math.max(0, earliest - now()));
    // A pending announcement must never be the reason a process stays up: the
    // lapse it would announce is already true of every reader that asks.
    timer.unref();
  };

  const sweep = (): void => {
    timer = null;
    const at = now();
    const lapsed: Lane[] = [];
    for (const [lane, record] of lanes) {
      if (record.parked > 0 || record.announced || liveAt(record, at)) continue;
      record.announced = true;
      lapsed.push(lane);
    }
    rearm();
    // After the state, and after the re-arm: a hook that claims on the strength
    // of a lapse must find the lane already lapsed, or its claim computes the
    // fallback against the state it was called to report.
    for (const lane of lapsed) {
      onPresenceChanged(lane);
      onLapsed(lane);
    }
  };

  const observePark = (lane: Lane): (() => void) => {
    const record = lanes.get(lane) ?? { parked: 0, lastSeen: 0, announced: false };
    lanes.set(lane, record);
    record.parked += 1;
    record.lastSeen = now();
    record.announced = false;
    rearm();
    onPresenceChanged(lane);

    let released = false;
    return () => {
      // Idempotent because the caller is a `finally`: a request that both threw
      // and was aborted must not decrement twice and take a lane down under a
      // listener that is still parked on it.
      if (released) return;
      released = true;
      record.parked -= 1;
      record.lastSeen = now();
      rearm();
      onPresenceChanged(lane);
    };
  };

  const presenceOf = (lane: Lane): LanePresence => {
    const record = lanes.get(lane);
    if (record === undefined) return { lane, live: false, since: null };
    return { lane, live: liveAt(record, now()), since: formatInstant(record.lastSeen) };
  };

  /**
   * Over **every lane something has parked on**, which is the roster's set plus,
   * briefly, one more: a listener parked on a thread whose resident was released
   * out from under it holds a request the roster no longer has a row for. The
   * aggregate reports it live, because it is — somebody is holding an `idle`
   * open — and the alternative would answer "nobody is listening" about a
   * request the server is at that moment listening on. It resolves itself: the
   * lane leaves this map's live set one grace window after that listener stops.
   *
   * That is the **only** lane this can report that the roster does not carry, and
   * it is so because a park on a thread that was never a lane is refused at the
   * route (`queue/scope.ts`'s `assertScopeIsLane`, SERVER-118). Before that
   * refusal existed, any `th_…` at all could enter this map and make `live` true
   * against a roster listing nothing live — which is the published sentence
   * (*"`live` is true exactly when some lane of `GET /api/agents` is live"*)
   * simply being false.
   *
   * **`since` is the most recent instant among the lanes that are live**, and
   * that is the same sentence's second half (*"`since` is the most recent of
   * their instants"*). It used to be the maximum over *every* record regardless
   * of liveness, so a lapsed lane that had parked more recently than the live one
   * supplied the aggregate's `since` — an instant no `AgentLane.since` carried,
   * and one that made `now − since` something other than the age of the evidence
   * behind `live`.
   *
   * **With nothing live it falls back to the most recent instant overall**, and
   * that is deliberate rather than a leftover. `since` is defined by the contract
   * as *"when a listener was last observed parked — null when none ever has
   * been"*, so answering `null` for a workspace whose agent left ten minutes ago
   * would assert something stronger and falser than the thing being fixed: it is
   * the difference the CLI prints as `no agent — last parked 10m ago` versus `no
   * agent — none has parked since the server started`, and `corpus agents` tells
   * the two apart on exactly this field. There are no live lanes for "theirs" to
   * range over in that state, so the aggregate reports the honest maximum
   * instead — which, every record now belonging to a lane that was designated
   * when its park was admitted, is a roster row's own `since` in every case but
   * the released-mid-park one above.
   */
  const presence = (): AgentPresence => {
    const at = now();
    let liveSince: number | null = null;
    let anySince: number | null = null;
    for (const record of lanes.values()) {
      if (anySince === null || record.lastSeen > anySince) anySince = record.lastSeen;
      if (!liveAt(record, at)) continue;
      if (liveSince === null || record.lastSeen > liveSince) liveSince = record.lastSeen;
    }
    const since = liveSince ?? anySince;
    return { live: liveSince !== null, since: since === null ? null : formatInstant(since) };
  };

  return {
    isLive,
    observePark,
    presenceOf,
    presence,
    close: () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
