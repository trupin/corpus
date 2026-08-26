import {
  isAgentPresent,
  MISSING_PROFILE_CAUSES,
  ORCHESTRATOR_LANE,
  type AgentLane,
  type Lane,
  type MissingProfileCause,
} from "@corpus/contract";
import { humanizeElapsed } from "../time/elapsed.js";

/**
 * How a roster row reads in a composer — SPEC.md §7's *"the composer offers the
 * live roster"*, turned into the words on the screen.
 *
 * Pure, and separated from the control for the reason every liveness rule in
 * this repo now is: the honesty is in the wording, and wording that is derived
 * inside a component is wording no test reaches without rendering one.
 *
 * ## Four states, and the fourth is the absence of an answer
 *
 * `live`, `lapsed` and `waiting` are things the server observed. `unknown` is
 * what a lane reads as when the roster has no row for it — which happens when
 * the scope walk names a lane the roster does not list, in the window between a
 * designation landing and `["agents"]` being refetched. It is UI-098's rule at
 * this grain: **a lane we have not heard about is not a lane with nobody on it**,
 * so `unknown` says nothing about liveness rather than saying "waiting".
 *
 * ## This reads the roster and only the roster
 *
 * CONTRACT-053 records that `QueueStatus.agent` and `GET /api/agents` may
 * legitimately disagree for one grace window. Nothing here reads the queue
 * status, so the picker never presents the two as one fact; the console strip's
 * pill is the workspace-grained answer and this is the per-lane one.
 *
 * ## Who is resident is a second axis, and this module owns both
 *
 * Since SHARED-048 a designation may name **no** profile, so `Resident` has
 * three renderable shapes and a surface that reduced them to a name would print
 * one of them wrong (CONTRACT-061 — *"do not substitute a word for null and
 * print it as a name"*). {@link LaneRow} therefore carries the kind and the
 * profile beside the name, and every word any surface says about that axis is an
 * export of this file: the board badge, the conversation's menu and the
 * recipient picker read one vocabulary rather than each inventing a label
 * (UI-122).
 */

export type LaneLiveness = "live" | "lapsed" | "waiting" | "unknown";

/**
 * **Which of §7's residents a lane has**, or that it cannot be said.
 *
 * - `orchestrator` — the workspace's own lane, which belongs to no conversation
 *   and was designated by nobody.
 * - `general` — designated with **no profile**. §7 calls this the ordinary case:
 *   an agent working the conversation as the workspace's ordinary agent does.
 * - `profiled` — designated with a profile that still resolves to an `agent-def`
 *   document.
 * - `profile-gone` — designated with a profile that has since been renamed,
 *   deleted, or moved out of `.claude/agents/`. §7 keeps the designation and
 *   requires the miss be *reported* rather than silently substituted, which is
 *   what {@link MISSING_PROFILE_NOTE} is for. Not the same state as `general`:
 *   one is ordinary and one is worth mentioning. **Archiving the profile does
 *   not produce this kind** — an archived agent-def still resolves, so its lane
 *   is `profiled` — see {@link MISSING_PROFILE_CAUSES}.
 * - `unknown` — the roster has no row to read, or carries a designated lane with
 *   no resident on it at all. Says nothing either way, UI-098's rule at this
 *   grain.
 */
export type LaneResidentKind = "orchestrator" | "general" | "profiled" | "profile-gone" | "unknown";

export interface LaneRow {
  readonly lane: Lane;
  /** The name a person reads: the resident's, or {@link ORCHESTRATOR_LABEL}. */
  readonly name: string;
  readonly liveness: LaneLiveness;
  /** The one line beside the name. Empty only for `unknown`, which has nothing to say. */
  readonly line: string;
  /** Which kind of resident this lane has — see {@link LaneResidentKind}. */
  readonly kind: LaneResidentKind;
  /**
   * The profile this lane's resident was designated with, or `null` when it was
   * designated with none — **never a word standing in for one**. It is what a
   * surface names the resident by when there is a name to give (the menu's
   * "Release researcher"), and `null` is what stops it inventing one.
   *
   * It is a **name and not an identity**: ask {@link LaneRow.profileDoc} which
   * document this resident is.
   */
  readonly profile: string | null;
  /**
   * The document {@link LaneRow.profile} resolves to **right now**, or `null` —
   * for a general resident, which named no profile, and for one whose profile
   * has gone (`Resident.docId`, CONTRACT-061).
   *
   * It is the only half of a resident a surface may **compare**. The server
   * resolves a designation against a document's invocable name *and* its title
   * alike, and stores the name it resolved to — which for a file under
   * `.claude/agents/` is the **stem**, while `GET /api/docs` carries the
   * **title**. Since SERVER-122 and CLI-050 file a created agent-def there, the
   * two legitimately differ (`bookkeeper` against `Bookkeeper`), and a surface
   * asking *is this directory row the one already resident?* asked of the names
   * gets `false` on a lane that agent is sitting on. Asked of this field it is
   * the same question the server answered, so case, stem-vs-title and every
   * other spelling difference cannot come into it.
   */
  readonly profileDoc: string | null;
  /**
   * What is worth saying about *who* is resident, as opposed to whether they are
   * there — which is {@link LaneRow.line}. Empty for every kind but
   * `profile-gone`, whose missing profile §7 requires be reported.
   */
  readonly note: string;
  /**
   * The **weight this lane's resident works at** — a level key from the
   * workspace's own tier table, the same vocabulary a message's `weight` carries
   * — or `null` (SPEC.md §7, rider signed 2026-08-19: *"a resident's weight is
   * set when it is designated, not per message"*).
   *
   * `null` on a resident's lane means the launcher chose, and is reported as
   * that rather than as a level (`Resident.weight`, CONTRACT-067). The
   * orchestrator's lane and an `unknown` row carry `null` because there is no
   * designation to read it from — ask {@link LaneRow.kind} which of the two a
   * `null` is, exactly as for {@link LaneRow.profile}. It is a **key and not a
   * label**: the composer maps it through the declared levels before showing it,
   * and shows the key itself when the guidance no longer declares it.
   */
  readonly weight: string | null;
  /**
   * {@link LaneRow.note}'s fact at the width of a **row in a list** — empty
   * exactly where the note is, because one kind produces both. A surface with a
   * line to itself says the note; one whose rows sit side by side says this.
   */
  readonly mark: string;
  /** The conversation this lane is, or null for the orchestrator's. */
  readonly conversation: string | null;
}

/**
 * What the orchestrator's lane is called in a composer.
 *
 * "agent" rather than "orchestrator": §10 keeps the product's vocabulary out of
 * the surface — the person asking has one agent unless they designated another,
 * and the lane's wire name is `orchestrator` for the queue's benefit, not
 * theirs.
 */
export const ORCHESTRATOR_LABEL = "agent";

/** A designated lane whose frontmatter names no resident still names a conversation. */
export const UNNAMED_RESIDENT_LABEL = "this conversation";

/**
 * What a **general resident** is called on a surface that shows one lane on the
 * conversation the lane *is* — the board badge (SPEC.md §10).
 *
 * There, {@link laneName}'s answer (the conversation's own title) would be a
 * tautology, so the badge prints the role instead. Deliberately not a name and
 * unmistakable as one: it names the role and negates the profile in the same
 * breath, which is what keeps CONTRACT-061's prohibition — *"a badge printing
 * `agent` or `general` beside real profile names is the trap"* — from being
 * re-opened by the surface that needed a word most. It is also not "no
 * resident": there is one, and it owns this conversation.
 *
 * A **list** of lanes uses {@link laneName} instead, because a role word repeats
 * across every general lane and a person cannot pick between two rows reading
 * the same thing; the conversation's title tells them apart, which is what
 * `LaneOrigin.title` is on the wire for.
 */
export const GENERAL_RESIDENT_LABEL = "resident, no profile";

/**
 * **Every act that can empty `Resident.docId` on a lane that named a profile**,
 * in the words a person reads — and the *only* source of those words, because
 * {@link MISSING_PROFILE_NOTE} is composed from this list rather than written
 * beside it.
 *
 * The list itself lives in `@corpus/contract` and is re-exported here — one home,
 * not a copy held equal by a test (SHARED-054). `AgentNameSchema`/`ResidentSchema`'s
 * `docId` description is where this rule is canonical, and it now composes from
 * the same array rather than restating it. `docId` re-resolves the
 * stored name on every read (`currentResident`, `apps/server/src/threads/read.ts`)
 * through `resolveMentionTarget`, so it empties exactly when the name stops
 * resolving: the file is gone, its stem changed, or it left `.claude/agents/` —
 * the root a persona has to be under to be addressable at all (SERVER-125).
 *
 * **Archiving is not one of them, and that is stated here rather than left out.**
 * An archived `agent-def` is still under the root and still resolves: `targetRows`
 * selects on `type` with no status filter, `targetIndex` skips a row on the
 * off-root gate alone, and archiving cannot move an agent-def — `folderMove`
 * (`apps/server/src/docs/archive.ts`) only relocates paths already under the two
 * skill roots, so for every other type archiving writes frontmatter and leaves
 * the path, which is the gate's sole input. Its resident keeps its `docId` and
 * stays designatable, so telling a person their working archived profile is gone
 * is a false statement about a lane that is fine. The claim survived one sweep
 * by omission, which is why it is now a sentence somebody has to delete rather
 * than a silence somebody has to notice (PR #50, third review).
 *
 * `scripts/missing-profile-parity.test.ts` measures all four acts against the
 * real projector and the real `currentResident`, and fails unless this list is
 * *exactly* the acts that empty the field — so a cause added here without one,
 * or an act that starts emptying it without a cause, is a failing test rather
 * than a sentence nobody re-measures.
 */
export { MISSING_PROFILE_CAUSES, type MissingProfileCause };

/**
 * What a lane whose profile has gone says about it — SPEC.md §7's *"the missing
 * profile is reported rather than silently substituted"*, as the report.
 *
 * Stated as what happened rather than as a fault: the designation stands and the
 * resident goes on owning its scope, so this is news about the profile and never
 * an error about the conversation.
 *
 * **Composed from {@link MISSING_PROFILE_CAUSES}, never written out.** The list
 * of causes was wrong here for a release — it named archiving, which cannot
 * produce this state — and it was wrong at seven other sites in the same
 * wording, because each was typed. Deriving the sentence means there is one
 * place to correct and one place a parity test has to check.
 */
export const MISSING_PROFILE_NOTE = `its profile is gone — ${MISSING_PROFILE_CAUSES[0]}, ${MISSING_PROFILE_CAUSES[1]}, or ${MISSING_PROFILE_CAUSES[2]} since`;

/**
 * The **same report**, at the width of a lane in a list — the recipient picker's
 * row, where {@link MISSING_PROFILE_NOTE}'s sentence would be longer than every
 * other lane on the line put together.
 *
 * Not a second fact and not a softer one: both come from the kind, through
 * {@link laneNote} and {@link laneMark}, so no surface can end up saying one and
 * meaning the other. The sentence is still what a surface says wherever it has
 * room — the picker's statement line and its titles carry it in full.
 *
 * It goes **beside** the name and never in place of it: it qualifies
 * "researcher", so a lane whose profile has gone is still named by the profile
 * the designation stands on (CONTRACT-061).
 */
export const MISSING_PROFILE_MARK = "profile gone";

/** A live lane the server had nothing else to say about. */
export const LIVE_WITHOUT_SUMMARY = "listening";

/** A lane nothing has ever parked on (SPEC.md §7 — presence is the parked idle, and nothing else). */
export const NEVER_SEEN_LINE = "no listener yet";

/**
 * What a lapsed lane says when **nothing is waiting on it** — it is quiet, and
 * quiet is not a fault (UI-174).
 *
 * This used to read *"the orchestrator will answer until it returns"*, which was
 * true under §7's fallback and became false with the rider signed 2026-08-25:
 * nobody else answers a resident's conversation now. A line that kept saying it
 * would be the product telling a person something that is not so, in the one
 * place they look to find out whether anything is wrong.
 */
export const LAPSED_QUIET = "no listener right now";

/** …and what a lapsed orchestrator says, which is the same fact without a name. */
export const LAPSED_ORCHESTRATOR = "nobody is listening";

/**
 * What a lapsed lane says when **something is waiting on it** (UI-174).
 *
 * §8's rider, amended 2026-08-25: *"where the lane has no listener running, the
 * row says **that**, and not merely that the work is queued: an agent that is
 * not running is the reason nothing is happening, and it is the one thing a
 * person can act on."*
 *
 * **It states the fact and stops.** It does not diagnose why the listener is
 * gone, and it does not tell the person to go and start one — the product gives
 * them no button that does, and an instruction nobody can follow reads as a
 * demand. It also must not read as an apology: §7's rule that an agent never
 * announces its own absence in somebody's conversation is about turns, and the
 * spirit of it belongs here too.
 */
export function lapsedWaiting(pending: number): string {
  const work = pending === 1 ? "1 message" : `${String(pending)} messages`;
  return `${work} waiting — its agent is not running`;
}

export function laneLiveness(row: AgentLane, now: Date): LaneLiveness {
  if (isAgentPresent(row, now)) return "live";
  return row.since === null ? "waiting" : "lapsed";
}

/**
 * The name to render for a lane **in a list of lanes**: its resident's profile,
 * or the conversation it owns when the designation named none, or the
 * orchestrator's label.
 *
 * A general resident falls through to the conversation rather than to a word for
 * the state: two general lanes named alike would be two rows a person cannot
 * choose between, and a word here sits beside real profile names with nothing to
 * tell them apart (CONTRACT-061). A surface showing one lane *on* its own
 * conversation prints {@link GENERAL_RESIDENT_LABEL} instead.
 *
 * ## The residual ambiguity, and why it is left standing
 *
 * A conversation **titled** `researcher` and a lane whose **profile** is
 * `researcher` therefore render the same word in one list. Both strings are real
 * — nothing is synthesised, so CONTRACT-061 holds — but a person cannot tell
 * which row is which. It is left as it is, deliberately (PR #49 review):
 *
 * - The only fix that works at rest is a mark on the **general** row, and
 *   general is §7's *ordinary* case. It would put a permanent qualifier on the
 *   common lane to disambiguate a collision that needs a conversation titled
 *   exactly like one of the workspace's agent-defs — and a role word repeated
 *   down a list of lanes beside real names is the shape CONTRACT-061 warns
 *   about, one step removed.
 * - Nothing is misrouted by it. Both rows are legal recipients, the pick is per
 *   message, and the statement line under the list names the lane's own summary
 *   and liveness as soon as a row is focused or hovered — so the two are
 *   distinguishable on inspection, only not at a glance.
 *
 * If it ever does bite, the shape to reach for is **list-local**: `laneRows`
 * sees the whole list, so it can qualify a name only where two rows collide, and
 * leave every other lane exactly as it reads today. Do not solve it by marking
 * every general lane.
 */
export function laneName(row: AgentLane): string {
  if (row.lane === ORCHESTRATOR_LANE) return ORCHESTRATOR_LABEL;
  return row.resident?.name ?? row.origin?.title ?? UNNAMED_RESIDENT_LABEL;
}

/** Which of §7's residents this lane has — see {@link LaneResidentKind}. */
export function laneResidentKind(row: AgentLane): LaneResidentKind {
  if (row.lane === ORCHESTRATOR_LANE) return "orchestrator";
  // A designated lane the roster lists with nobody on it. Off-contract rather
  // than impossible (`residentField`: null "occurs only on the orchestrator
  // lane"), so it is read as *we cannot say* — never as a general resident,
  // which is a designation somebody made.
  if (row.resident === null) return "unknown";
  if (row.resident.name === null) return "general";
  return row.resident.docId === null ? "profile-gone" : "profiled";
}

/** What is worth saying about who is resident, beyond naming them. */
export function laneNote(kind: LaneResidentKind): string {
  return kind === "profile-gone" ? MISSING_PROFILE_NOTE : "";
}

/** …and the same thing where only a phrase fits — see {@link MISSING_PROFILE_MARK}. */
export function laneMark(kind: LaneResidentKind): string {
  return kind === "profile-gone" ? MISSING_PROFILE_MARK : "";
}

function lastSeen(since: string, now: Date): string | null {
  const seen = Date.parse(since);
  if (Number.isNaN(seen)) return null;
  return humanizeElapsed(Math.max(0, now.getTime() - seen));
}

/**
 * The line beside the name.
 *
 * A live lane shows what the server says it is doing, because that is the most
 * useful true thing available; a lapsed one shows how long it has been gone and
 * what happens meanwhile, because a lapsed pick is legal and the person needs to
 * know what they are choosing.
 */
export function laneLine(row: AgentLane, liveness: LaneLiveness, now: Date): string {
  if (liveness === "live") return row.summary ?? LIVE_WITHOUT_SUMMARY;
  /*
   * **Work waiting outranks the age, in both not-live states** (UI-174).
   *
   * A lane nobody has ever parked on normally says so and nothing more. But a
   * lane with messages on it and no listener is the one row a person can act
   * on, and it is that whether the listener died an hour ago or never started —
   * so the pair is checked before either state's ordinary line.
   */
  if (row.pending > 0 && row.lane !== ORCHESTRATOR_LANE) return lapsedWaiting(row.pending);
  if (liveness === "waiting") return NEVER_SEEN_LINE;
  const quiet = row.lane === ORCHESTRATOR_LANE ? LAPSED_ORCHESTRATOR : LAPSED_QUIET;
  const age = row.since === null ? null : lastSeen(row.since, now);
  return age === null ? quiet : `last seen ${age} ago — ${quiet}`;
}

export function laneRow(row: AgentLane, now: Date): LaneRow {
  const liveness = laneLiveness(row, now);
  const kind = laneResidentKind(row);
  return {
    lane: row.lane,
    name: laneName(row),
    liveness,
    line: laneLine(row, liveness, now),
    kind,
    profile: row.resident?.name ?? null,
    profileDoc: row.resident?.docId ?? null,
    note: laneNote(kind),
    weight: row.resident?.weight ?? null,
    mark: laneMark(kind),
    conversation: row.origin?.title ?? null,
  };
}

/**
 * A lane the walk named but the roster does not list.
 *
 * It is offered rather than dropped: it is the computed default, so the composer
 * that hid it would be showing a list that does not contain the answer.
 */
export function unknownLaneRow(lane: Lane): LaneRow {
  return {
    lane,
    name: lane === ORCHESTRATOR_LANE ? ORCHESTRATOR_LABEL : UNNAMED_RESIDENT_LABEL,
    liveness: "unknown",
    line: "",
    // Not `general`, which is a designation somebody made: a lane nobody has
    // described says nothing about who is on it, in either direction.
    kind: lane === ORCHESTRATOR_LANE ? "orchestrator" : "unknown",
    profile: null,
    profileDoc: null,
    note: "",
    weight: null,
    mark: "",
    conversation: null,
  };
}

/** Every roster row as the composer reads it, the orchestrator's first (the server's order). */
export function laneRows(lanes: readonly AgentLane[], now: Date): readonly LaneRow[] {
  return lanes.map((row) => laneRow(row, now));
}
