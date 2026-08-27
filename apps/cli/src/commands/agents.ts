import { AGENT_PRESENCE_WINDOW_SECONDS, ORCHESTRATOR_LANE, type AgentLane } from "@corpus/contract";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../registry/types.js";
import { formatAge } from "./age.js";
import { oneLine } from "./columns.js";
import {
  ARCHIVING_IS_NOT_A_CAUSE,
  MISSING_PROFILE_CAUSES_PHRASE,
  PROFILE_MISSING,
  residentLabel,
} from "./resident.js";

/**
 * `corpus agents` — who is running (SPEC.md §7).
 *
 * **A read, and only a read.** §7 makes presence *"the parked request, and
 * nothing else"*: a resident is live exactly while it holds a parked scoped
 * `corpus queue idle --thread <id>`. There is no heartbeat to send, no
 * registration to keep fresh and nothing to reap, so this CLI has no verb that
 * announces an agent, joins a lane or says "I am still here" — and adding one
 * would create a second source of truth about presence that no refetch could
 * correct. This command asks the server what it currently observes and renders
 * the answer. It is the same read the composer's recipient picker consumes.
 *
 * **Nothing here is computed that the server did not report.** No liveness
 * arithmetic (the grace window is applied server-side, before `live` is
 * answered), no summary derivation, no origin walking. The only thing this
 * module decides is how to say `since` in English, which the contract assigns to
 * the caller precisely because an instant is what survives two clocks.
 *
 * **A lane with nobody on it is not a failure**, and the wording is written
 * around that. §7: the cost of a lapse is *"that the work is done by the
 * orchestrator instead — slower, and without the conversation's warmth — and
 * never that it is silently not done."* So a lapsed row is a state, printed
 * beside the live ones in the same shape, and the one sentence that explains
 * what happens next is a note rather than an alarm on every row.
 */

/**
 * Three ways a lane can be, from two reported fields, and they are worth telling
 * apart at the one surface a person looks at to see whether anybody is home:
 *
 * - **live** — a listener is parked right now, or was moments ago and the grace
 *   window still covers it.
 * - **lapsed** — a listener was parked once (`since`) and has been gone longer
 *   than the window. Its pending work falls back to the orchestrator's claim.
 * - **waiting** — the server has observed no park on this lane at all (`since`
 *   is null). A designated conversation nobody has started a listener for, which
 *   reads very differently from one whose agent has stopped.
 *
 * "Observed" rather than "ever", and the difference is real: presence is held in
 * memory and nothing about it is persisted, so a server that has just restarted
 * reports every lane as waiting however long a listener sat on it beforehand.
 * That is the fallback §7 already accepts, in the direction it accepts it — the
 * orchestrator may do work a resident would have, never the reverse — and this
 * wording is what keeps the row from claiming more than the server knows.
 *
 * This is a rendering of `{live, since}` and not a re-derivation of it: the
 * verdict is the server's, and the split only asks whether there is any evidence
 * behind a `false`.
 */
type Presence = "live" | "lapsed" | "waiting";

export function presenceOf(lane: Pick<AgentLane, "live" | "since">): Presence {
  if (lane.live) return "live";
  return lane.since === null ? "waiting" : "lapsed";
}

/**
 * How long a lane keeps reading `live` after its listener stops — **read from
 * the contract, never restated**.
 *
 * §7 deliberately leaves the length open and guarantees exactly one bound on it,
 * and `AGENT_PRESENCE_WINDOW_SECONDS` is the one place that number is chosen.
 * The server applies it to decide `live`; a second copy here would be a number
 * that could drift from the verdict it purports to explain, which is precisely
 * what putting it in the contract avoided.
 */
export const GRACE_WINDOW = formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000);

/**
 * The one sentence about what a lane with no listener costs, printed once
 * beneath the rows rather than on each of them.
 *
 * It is a note (stderr) because it is a diagnostic about the answer and not part
 * of it: the rows are what `corpus agents` was asked for, and a reader counting
 * lanes should not have to skip prose.
 */
export const FALLBACK_NOTE =
  "a lane with no listener is not a failure, but its work waits: nobody else can claim it. The " +
  "orchestrator's job is to **launch** a listener for it — that is what the pending count on " +
  "each row is for. Start one by hand with `corpus queue idle --thread <id>`; parking is what " +
  "presence is.";

/**
 * What the contract says an empty roster means: a bug, not a quiet workspace.
 * The orchestrator's row exists before anything is designated and survives the
 * last release, so this is reported rather than printed as an empty answer a
 * reader would take for "nobody is here".
 */
export const EMPTY_ROSTER_NOTE =
  "the server reported no lanes at all. The orchestrator's lane always exists, so this is a " +
  "fault in the server rather than a workspace with no agents.";

export async function runAgents(context: WorkspaceCommandContext, now = Date.now()): Promise<void> {
  const roster = await context.client.request((api) => api.GET("/api/agents"));

  context.out.emit(roster);

  if (roster.agents.length === 0) {
    context.out.note(EMPTY_ROSTER_NOTE);
    return;
  }

  for (const lane of roster.agents) context.out.line(renderLane(lane, now));

  // Only a *thread* lane's absence has a fallback to explain. The orchestrator's
  // lane is the fallback — asking whether it is live in order to say where its
  // work goes would be asking the question of itself — so its own row saying
  // `waiting` prints no note.
  const unattended = roster.agents.filter((lane) => lane.lane !== ORCHESTRATOR_LANE && !lane.live);
  if (unattended.length > 0) context.out.note(FALLBACK_NOTE);
}

/**
 * One lane, one line: which lane, who owns it, whether anybody is on it and
 * since when, and the server's own sentence about what it is doing.
 *
 * The summary is quoted verbatim (collapsed to one line, since a row is one
 * line) and never parsed: the contract promises its length and nothing about its
 * content, and states that how it is derived may change without a contract
 * change.
 */
export function renderLane(lane: AgentLane, now: number): string {
  const cells = [
    laneLabel(lane),
    ...residentCell(lane),
    presenceCell(lane, now),
    ...workingCell(lane),
    ...waitingCell(lane),
  ];
  const row = cells.join(" · ");
  return lane.summary === null ? row : `${row} — ${oneLine(lane.summary)}`;
}

/**
 * **How much is waiting on this lane, printed only when something is**
 * (CLI-070, for AGENT-053).
 *
 * The orchestrate skill launches a listener for a lane that is **not live** and
 * **has something pending**, and reads both off this row. `live` was already
 * here; without this cell the instruction names a fact the surface does not
 * show, and the orchestrator would be left inferring it from absence — which
 * launches an agent for every idle conversation in the workspace.
 *
 * **Absent at zero rather than `0 waiting`.** A roster is read by a person as
 * often as by an agent, and a column of zeroes is a column nobody reads. The
 * pair that matters is loud precisely because it is rare: `waiting for a
 * listener · 3 waiting` is a row that says what to do about it.
 *
 * It is deliberately not folded into the presence cell. Presence answers *is
 * anybody there*, this answers *is anybody waiting*, and the launch decision
 * needs both — a row that merged them would be a third fact neither field
 * states.
 */
/**
 * **Whether this lane is holding work it claimed** (CLI-071, for AGENT-055).
 *
 * The third of the three the launch decision needs, and the one that reads
 * strangest until you know why it is here: it appears **beside a not-live row**,
 * which looks like a contradiction and is the whole point. A resident works its
 * conversation inline and holds no park while it does, so `not live · working`
 * is a busy agent — and launching a second listener onto it is what this cell
 * exists to prevent.
 *
 * It sits **before** the waiting count rather than after, so the row reads in
 * the order a reader decides in: is anybody there, is anything being done, is
 * anything waiting. `lapsed · working · 2 waiting` is patience; the same row
 * without `working` is a launch.
 *
 * Absent when the lane holds nothing, on CLI-070's principle — a column of
 * states nobody reads is a column nobody reads.
 */
function workingCell(lane: AgentLane): string[] {
  return lane.working ? ["working"] : [];
}

function waitingCell(lane: AgentLane): string[] {
  if (lane.pending === 0) return [];
  return [`${String(lane.pending)} waiting`];
}

/**
 * `orchestrator`, or a thread id with the conversation's current title beside it
 * — the title is why `origin` is on the row at all, so a reader never needs a
 * second read to know which conversation `th_4b8e2c` is.
 */
function laneLabel(lane: AgentLane): string {
  if (lane.origin === null) return lane.lane;
  return `${lane.lane} "${oneLine(lane.origin.title)}"`;
}

/**
 * The orchestrator's lane has no resident cell at all — nobody designates it,
 * and printing an em dash there would invite reading it as a vacancy.
 *
 * Every other lane exists because something was designated, so its cell says
 * **which of the three residents §7 admits** owns it — a general one, a profile,
 * or a profile that has gone — in `commands/resident.ts`'s words rather than in
 * words invented here, because the board renders the same three states from the
 * same two fields and a person reading both must be told the same fact twice.
 *
 * A designated lane whose `resident` came back null is a lane the server can see
 * but cannot name, and since SHARED-048 that is no longer how a resident with no
 * profile is reported — a general resident is an object whose `name` is null.
 * `resident unknown` is therefore what is left: the conversation *is* owned, we
 * cannot say by whom, and that is a different fact from either a general
 * resident or nobody at all.
 *
 * **The weight rides inside this cell rather than beside it** (CLI-053): a row
 * is cells joined by ` · `, so a weight given a cell of its own would make one
 * row four dot-separated fields and the next row three — which is exactly what
 * a reader parsing a row positionally cannot survive. `commands/resident.ts`
 * spells the join, once, for every surface that names a resident.
 */
function residentCell(lane: AgentLane): readonly string[] {
  if (lane.lane === ORCHESTRATOR_LANE) return [];
  return [lane.resident === null ? "resident unknown" : residentLabel(lane.resident)];
}

function presenceCell(lane: AgentLane, now: number): string {
  const presence = presenceOf(lane);
  if (presence === "waiting") return "waiting for a listener";

  const parked = sinceAge(lane.since, now);
  if (parked === null) return presence;
  return presence === "live" ? `live, parked ${parked} ago` : `lapsed, last parked ${parked} ago`;
}

/**
 * `since` as an age, or `null` when it is not an instant at all — in which case
 * the row prints the bare verdict rather than `parked NaNs ago`. The state is
 * the fact a reader needs; the age is the detail beside it.
 *
 * Exported for `corpus queue status`, which renders the same `{live, since}`
 * pair at the workspace's grain (CLI-046). One reading of `since` there and
 * here, for the reason `formatAge` gives about ages: two surfaces answering
 * "when was somebody last here" must not disagree about the answer.
 */
export function sinceAge(since: string | null, now: number): string | null {
  if (since === null) return null;
  const seen = Date.parse(since);
  return Number.isNaN(seen) ? null : formatAge(now - seen);
}

export const agentsCommand: WorkspaceCommandSpec = {
  name: "agents",
  summary: "Who is running: every lane, its resident, and whether anybody is listening.",
  description:
    "Reads `GET /api/agents` and prints one row per **lane** of the queue (SPEC.md §7): the " +
    "orchestrator's, plus one for every standalone thread that has been given a resident. Each " +
    "row names the lane and the conversation it is, who is resident on it, whether a listener is " +
    "parked on it right now and since when, and the server's one-line account of what it is " +
    "doing. The `orchestrator` row is always there — it exists before anything is designated and " +
    "survives the last release.\n\n" +
    "**The resident cell tells three states apart**, because they are three different facts about " +
    "a conversation: `a general resident` is an agent with no profile document — the ordinary " +
    "designation, which needs nothing to exist in the workspace first; `researcher (doc_r1)` is a " +
    `profile a reader can open; and \`researcher (${PROFILE_MISSING})\` is a designation whose ` +
    `profile has since been ${MISSING_PROFILE_CAUSES_PHRASE}, which changes nothing about who ` +
    "owns the lane and is reported rather than silently substituted. " +
    `${ARCHIVING_IS_NOT_A_CAUSE}, so the cell keeps printing its id.\n\n` +
    "**The same cell says what the lane runs at**, where the designation chose a weight (SPEC.md " +
    "§7, rider signed 2026-08-19): `researcher (doc_r1) at heavy`, `a general resident at heavy`. " +
    "The word is a level's key from this workspace's own agent guidance, never a model name, and " +
    "a designation that chose none prints nothing extra — no token is invented for an unstated " +
    "weight, the same rule a null `name` carries. The weight is orthogonal to the profile, so " +
    "all four combinations are ordinary rows.\n\n" +
    "**Presence is the parked request and nothing else.** A lane is live exactly while somebody " +
    "holds a parked `corpus queue idle --thread <id>`: there is no heartbeat to send, no " +
    "registration to keep fresh and nothing to reap, so an agent that stops parking stops being " +
    "present whether it exited cleanly, crashed or was killed. That is why this verb only " +
    "**reads** — nothing anywhere in this CLI announces an agent, and starting a listener is how " +
    "one becomes visible here.\n\n" +
    "**A lane with nobody on it is an ordinary, recoverable state, not a fault.** `waiting for a " +
    "listener` means the server has observed no park on that lane — which is also what every lane " +
    "reads as just after a restart, since presence is held in memory and nothing about it is " +
    "persisted; `lapsed` means a listener was there and has " +
    `been gone longer than the grace window (${GRACE_WINDOW}). In both cases that lane's pending ` +
    "work **waits for a listener** — it does not fall to anybody else. The rider signed " +
    "2026-08-25 removed the fallback that used to make a lapsed lane's work claimable by the " +
    "orchestrator: answering in a resident's place is a different agent writing in its name, " +
    "not a slower version of the same answer. So a lane's `pending` count is a launch " +
    "instruction, and the orchestrator reads this roster to know which lanes are owed one.\n\n" +
    "The `summary` is display material: the contract promises its length and nothing about its " +
    "content, and how it is derived may change. **Never parse it** — everything worth branching " +
    "on is a field of its own under `--json`, which carries the roster exactly as the server " +
    "sent it, `since` still an ISO instant so you compute ages against your own clock.\n\n" +
    "This is a different read from `corpus thread show`'s `resident` line. That line is the " +
    "**designation**, which is thread state; this is **presence**, which is an observation about " +
    "a request the server is holding. The two are answered by different endpoints and may " +
    "honestly disagree for a moment — a designated agent that has just stopped parking is still " +
    "the thread's resident and is no longer live.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus agents",
      description:
        'One row per lane — `th_4b8e2c "Q3 planning" · researcher (doc_r1) at heavy · live, ' +
        "parked 2m ago — reading the mortgage docs` — with a lapsed or unattended lane shown " +
        "rather than hidden, and the `at …` omitted on a lane whose designation chose no weight.",
    },
    {
      command: "corpus agents --json",
      description:
        'The roster verbatim: `{"agents":[{"lane":"orchestrator","resident":null,"live":true,' +
        '"since":"2026-08-16T09:00:00.000Z","summary":null,"origin":null},…]}`. On a thread lane ' +
        "`resident` is an object whose `name` is null for a general resident, so a null `resident` " +
        "there means the server could not name one at all. Its `weight` is the level the lane " +
        "runs at, or null when the designation chose none.",
    },
    {
      command: "corpus agents --json | jq -r '.agents[] | select(.live) | .lane'",
      description: "The lanes something is actually listening on, one per line.",
    },
  ],
  handler: (context) => runAgents(context),
};
