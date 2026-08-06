import { MAX_IN_PROGRESS_REPORTED, type InProgressSet } from "@corpus/contract";
import type { JobOrigin } from "../jobs/project.js";
import type { Logger } from "../logger.js";
import type { QueueStore, ReadEventResult, StoredEvent } from "./store.js";

/**
 * What the server still thinks the agent is doing: the events sitting in
 * `.corpus/queue/in-progress/`, ordered and bounded, ready to be reported beside
 * a claim (SPEC.md §7's reconciliation bullet, SHARED-015 / CONTRACT-033).
 *
 * The server-side twin of the contract's `InProgressSet`: same `total` and
 * `truncated`, but carrying whole {@link StoredEvent}s rather than wire rows,
 * because resolving an origin needs a projection and this module has none — see
 * {@link toInProgressSet}.
 *
 * **This is a read, and only a read.** §7 is explicit that reconciliation is the
 * agent's judgement and never an inference the server draws on its behalf:
 * nothing here completes, fails, requeues or even quarantines an event.
 * `reap-stale` remains the one recovery path, and it stays a requeue.
 */
export interface HeldSet {
  /** Most recently claimed first, at most {@link MAX_IN_PROGRESS_REPORTED} long. */
  readonly events: readonly StoredEvent[];
  /** Every held event, not just the reported ones. */
  readonly total: number;
  /** True exactly when the cap cut the list. */
  readonly truncated: boolean;
}

/** Nothing held — the value the field carries when the queue is idle, never an absent field. */
export const NOTHING_HELD: HeldSet = { events: [], total: 0, truncated: false };

/**
 * When the event was claimed.
 *
 * `updated` is written by `stamp()` as the event moves into `in-progress/`, and
 * nothing rewrites it while it stays there — every transition that touches it
 * moves it out. `created` is the fallback for a file dropped into the directory
 * by hand without one, which the store parses leniently and this must not drop:
 * an event with an approximate instant is still an event the agent has to be
 * able to see.
 *
 * An **instant**, deliberately, never an elapsed duration: a duration computed
 * here is stale the moment the response is read, and this response is read by an
 * agent that may sit on it for a whole turn. Rendering it as "held 3h" is the
 * CLI's job (CONTRACT-033).
 */
export function heldSince(event: StoredEvent): string {
  return event.updated ?? event.created;
}

/** Sort key for {@link heldSince}; an instant the parser let through unnormalized sorts oldest. */
function instantRank(event: StoredEvent): number {
  const parsed = Date.parse(heldSince(event));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Most recently claimed first, ties broken by id descending.
 *
 * The ordering is load-bearing when the cap bites (CONTRACT-033): the rows an
 * agent can actually account for are the ones it claimed recently, while ancient
 * residue from a session that died is `reap-stale`'s problem. Oldest-first would
 * let permanently unaccountable events occupy the window forever and hide every
 * fresh discrepancy behind them.
 *
 * Instants are canonical to the second (SPEC.md §5), so a whole claimed batch
 * shares one timestamp; the id tie-break makes the order within it deterministic
 * rather than dependent on `readdir`. Which member of a batch comes first is
 * arbitrary — they were claimed at the same instant — but *stability* is not.
 */
function byMostRecentlyClaimed(left: StoredEvent, right: StoredEvent): number {
  const delta = instantRank(right) - instantRank(left);
  return delta !== 0 ? delta : right.id.localeCompare(left.id);
}

/** What to put in a log field for a thrown value. */
const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads `in-progress/` and bounds it.
 *
 * A malformed file is skipped and logged, never quarantined — the same rule the
 * other read path (`availablePending`) follows, and the reason this is safe to
 * call on every claim. It is excluded from `total` as well as from the list, so
 * the contract's stated invariant holds exactly: `total === events.length`
 * whenever `truncated` is false. An unparseable file has no id, type or origin
 * to reconcile against anyway; `reap-stale` is what quarantines it.
 *
 * **Nothing here throws.** This runs inside `claimAll` *before* it moves
 * anything, so a throw would cost the agent its entire batch in order to produce
 * a diagnostic. The CLI reasons its way to the same conclusion from the other
 * end of the wire (`commands/queue/in-progress.ts`: "a server that omits the
 * report costs a diagnostic instead of costing the work"), and the rule is the
 * same on this side: **the in-progress set is the report, the claim is the
 * work**. Degradation is therefore as narrow as the failure allows, in two
 * tiers, because the two failures have different granularity:
 *
 * - **One unreadable file** — EACCES, EIO, a truncated filesystem, a directory
 *   where a file should be — is skipped exactly as a malformed one is, excluded
 *   from `total` as well as from the list. Every other held event is still
 *   reported, and still reported honestly.
 * - **An unlistable directory** offers no per-file granularity to be narrow
 *   with: there is no list to skip an entry from. The whole report degrades to
 *   {@link NOTHING_HELD} — the agent is told nothing, which the CLI renders as
 *   silence, rather than told a number that is wrong.
 *
 * Both are logged at `error` rather than at the malformed path's `debug`, and
 * the difference is deliberate: a malformed file is expected residue that
 * `reap-stale` exists to clear, while an unreadable one is a fault in the
 * workspace that only an operator can fix — and `error` is the one level a
 * silenced server still writes.
 *
 * Every held file is read, which is the same scan `reap-stale` already performs
 * and is bounded by what one agent is working on — the cap bounds the *report*,
 * not the directory.
 */
export async function readHeldInProgress(store: QueueStore, logger: Logger): Promise<HeldSet> {
  let ids: readonly string[];
  try {
    ids = await store.listIds("in-progress");
  } catch (error) {
    logger.error("cannot list in-progress events; reporting nothing held", {
      reason: causeOf(error),
    });
    return NOTHING_HELD;
  }

  const held: StoredEvent[] = [];
  for (const id of ids) {
    let read: ReadEventResult | undefined;
    try {
      read = await store.readEvent("in-progress", id);
    } catch (error) {
      logger.error("skipping unreadable in-progress event", { id, reason: causeOf(error) });
      continue;
    }
    if (read === undefined) continue;
    if (read.ok) held.push(read.event);
    else logger.debug("skipping malformed in-progress event", { id, reason: read.reason });
  }
  if (held.length === 0) return NOTHING_HELD;

  held.sort(byMostRecentlyClaimed);
  return {
    events: held.slice(0, MAX_IN_PROGRESS_REPORTED),
    total: held.length,
    truncated: held.length > MAX_IN_PROGRESS_REPORTED,
  };
}

/**
 * Where a held event came from: `jobs/project.ts`'s `resolveOrigin`, bound to a
 * projection by the caller.
 *
 * The *rule* is injected rather than reached for here, so this module stays a
 * function of the queue's own files and the projection stays the route's
 * concern; the *shape* is the console's own {@link JobOrigin}, so the two
 * surfaces cannot drift apart even structurally. Two answers to "where did this
 * event come from" is precisely the drift SERVER-056 exists to prevent.
 */
export type HeldOriginResolver = (payload: Record<string, unknown>) => JobOrigin | null;

/** The origin resolver for a server with no projection: nothing is resolvable. */
export const NO_ORIGIN: HeldOriginResolver = () => null;

/** Maps a {@link HeldSet} onto the wire, resolving each row's origin at response time. */
export function toInProgressSet(held: HeldSet, resolveOrigin: HeldOriginResolver): InProgressSet {
  return {
    events: held.events.map((event) => {
      const origin = resolveOrigin(event.payload);
      return {
        id: event.id,
        type: event.type,
        heldSince: heldSince(event),
        originId: origin?.id ?? null,
        originTitle: origin?.title ?? null,
      };
    }),
    total: held.total,
    truncated: held.truncated,
  };
}
