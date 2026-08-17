/**
 * `GET /api/agents` — SPEC.md §7's roster: every lane, who is resident on it,
 * and whether anybody is listening.
 *
 * **A read, never a push.** §7 is explicit — *"who is running is a read, never a
 * push: the roster and each lane's liveness are read behind the ordinary
 * invalidate keys, like any other projection"* — so this module answers over
 * HTTP and nothing about presence travels over SSE as data. What goes over SSE
 * is `["agents"]`, a key name, emitted by the designation routes and by the
 * liveness tracker's transitions.
 *
 * Assembly is three reads and no cache: the designated lanes from the
 * projection, liveness from the in-memory tracker, and a line about what each
 * lane is doing from the `events`/`jobs` join the console already keeps. Nothing
 * is stored, so a roster can never be stale in a way a refetch would not fix.
 */

import {
  LANE_SUMMARY_MAX_LENGTH,
  ORCHESTRATOR_LANE,
  type AgentLane,
  type AgentRoster,
  type Lane,
  type Resident,
} from "@corpus/contract";
import { residentOrNull } from "../core/resident.js";
import { resolveOrigin } from "../jobs/project.js";
import type { ProjectionDb } from "../projection/index.js";
import type { LaneTracker } from "../queue/liveness.js";
import { currentResident } from "../threads/read.js";

export interface RosterDeps {
  readonly projection: ProjectionDb;
  readonly tracker: LaneTracker;
  /** Epoch milliseconds, for the relative age a quiet lane's summary carries. */
  readonly now: () => number;
}

/**
 * The lanes a designation created, **by the same predicate the walk uses**.
 *
 * `queue/scope.ts`'s `isDesignatedRoot` asks `parent_id IS NULL AND resident_name
 * IS NOT NULL`, and this asks it of every row rather than of one. They have to
 * agree: a lane the enqueue path will stamp events with and the roster does not
 * list is work addressed to a conversation nobody can see is being addressed,
 * and a row here for a thread the walk would not route to is a recipient the
 * composer offers and the queue refuses.
 *
 * The title comes from `documents`, which every projected file has a row in — a
 * thread is a document (§6) — and is read at response time so a renamed
 * conversation names itself correctly on the next read.
 */
const DESIGNATED_LANES_SQL = `
  SELECT threads.id AS id,
         documents.title AS title,
         threads.resident_name AS residentName,
         threads.resident_doc_id AS residentDocId
  FROM threads
  JOIN documents ON documents.id = threads.id
  WHERE threads.parent_id IS NULL AND threads.resident_name IS NOT NULL
  ORDER BY documents.title, threads.id`;

interface DesignatedRow {
  readonly id: string;
  readonly title: string;
  readonly residentName: string;
  readonly residentDocId: string | null;
}

/**
 * The newest event this lane is currently holding, and whatever it has said
 * about it.
 *
 * `in-progress` only: a pending event is work nobody has picked up, and
 * describing the lane by it would report an agent as working on something it has
 * not claimed — §8's own refusal, read here. Newest first because a lane may
 * hold several and the freshest is the one a person watching wants named.
 */
const LANE_WORK_SQL = `
  SELECT events.payload_json AS payloadJson, jobs.last_line AS lastLine
  FROM events
  LEFT JOIN jobs ON jobs.event_id = events.id
  WHERE events.lane = ? AND events.status = 'in-progress'
  ORDER BY events.created DESC, events.id DESC
  LIMIT 1`;

interface LaneWorkRow {
  readonly payloadJson: string;
  readonly lastLine: string | null;
}

/**
 * How long ago, in words, for the one summary that has nothing better to say.
 *
 * Rendered here rather than left to the caller because `summary` is a *line*,
 * and the row already carries `since` as an instant for anything that wants to
 * compute. The contract promises the field's bound and nothing about its
 * content, so this wording is display material and never something to parse.
 */
export function relativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Cuts a summary to the contract's bound.
 *
 * `AgentLaneSchema` caps `summary` at {@link LANE_SUMMARY_MAX_LENGTH} — measured
 * in UTF-16 code units, as `z.string().max` is — so the cut is by code unit and
 * not by code point, or a line of astral characters would pass this and fail the
 * schema. A trailing lone surrogate is dropped so the cut never produces text no
 * reader can render.
 */
export function capSummary(line: string): string {
  if (line.length <= LANE_SUMMARY_MAX_LENGTH) return line;
  const cut = line.slice(0, LANE_SUMMARY_MAX_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * §7's one-line "what is this lane doing", in the order the issue fixes:
 *
 * 1. **What the job itself last said** — the newest line of the newest event the
 *    lane is holding. It is the agent's own account, so it outranks anything
 *    this server could infer.
 * 2. **What the work is about** — `working <origin title>`, when the held event
 *    names a document the corpus still holds. Derived, but from the event, so it
 *    is still about the work.
 * 3. **When the lane was last heard from** — all that is left once there is
 *    nothing in flight, and the honest thing to say about a designated lane with
 *    no listener, which is UI-109's "waiting to be picked up".
 * 4. **Nothing**, for a lane nothing has ever parked on and nothing is running:
 *    the row's own fields already say `live: false, since: null`, and a sentence
 *    restating them would be invention.
 *
 * A held event with neither a line nor a resolvable origin falls to (3) rather
 * than to a bare "working": the row's fields do not carry the lane's silence,
 * and "working" without a subject says less than when it was last heard from.
 */
function summarize(deps: RosterDeps, lane: Lane, since: string | null): string | null {
  const work = deps.projection.prepare(LANE_WORK_SQL).get(lane) as LaneWorkRow | undefined;
  if (work !== undefined) {
    if (work.lastLine !== null && work.lastLine !== "") return capSummary(work.lastLine);
    const origin = resolveOrigin(deps.projection, work.payloadJson);
    if (origin !== null) return capSummary(`working ${origin.title}`);
  }
  if (since === null) return null;
  const seen = Date.parse(since);
  if (Number.isNaN(seen)) return null;
  return capSummary(`idle — last active ${relativeAge(Math.max(0, deps.now() - seen))}`);
}

/** The two halves of a row that are configuration rather than observation. */
type LaneIdentity = Pick<AgentLane, "resident" | "origin">;

function row(deps: RosterDeps, lane: Lane, identity: LaneIdentity): AgentLane {
  const presence = deps.tracker.presenceOf(lane);
  return {
    lane,
    resident: identity.resident,
    live: presence.live,
    since: presence.since,
    summary: summarize(deps, lane, presence.since),
    origin: identity.origin,
  };
}

/**
 * The stored designation with its `docId` refreshed, or `null` when the row
 * cannot make one.
 *
 * The refresh is `threads/read.ts`'s, not a second resolution: §7's `docId` is
 * *"resolved at designation time and re-read on every response"*, and an
 * agent-def's id is derived from its path, so a roster repeating the stored id
 * would send a reader to a document a rename has moved. The name is the durable
 * half and is never rewritten — a designation survives its persona going
 * missing, and the roster showing the name is how a person sees *who* was
 * designated rather than a blank.
 *
 * A row whose `resident_doc_id` is missing — only reachable from a hand-edited
 * frontmatter, since the write path always stores both — still names a lane,
 * because `resident_name` is what the walk keys on. It reads as a lane with no
 * resident rather than as no lane, which is the difference between "we cannot
 * say who owns this" and "this conversation is not owned".
 */
function residentOf(deps: RosterDeps, entry: DesignatedRow): Resident | null {
  const stored = residentOrNull({ name: entry.residentName, docId: entry.residentDocId });
  return currentResident(deps.projection, stored);
}

/**
 * Every lane, the orchestrator's first.
 *
 * **The orchestrator's row is unconditional** — it exists before anything is
 * designated and survives the last release — so an empty list would be a bug
 * rather than a workspace with no agents, which is what the contract publishes.
 * It carries no `origin` because it belongs to no conversation, and no
 * `resident` because nobody designates it: it is the lane that is there.
 */
export function buildRoster(deps: RosterDeps): AgentRoster {
  const orchestrator = row(deps, ORCHESTRATOR_LANE, { resident: null, origin: null });
  const designated = (deps.projection.prepare(DESIGNATED_LANES_SQL).all() as DesignatedRow[]).map(
    (entry) =>
      row(deps, entry.id, {
        resident: residentOf(deps, entry),
        origin: { id: entry.id, title: entry.title },
      }),
  );
  return { agents: [orchestrator, ...designated] };
}
