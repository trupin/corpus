import { SCOPE_PAGE_SIZE, type ScopeMember, type ScopeMemberVia } from "@corpus/contract";
import {
  CorpusRequestError,
  LAUNCH_WEIGHT_CLAUSE,
  weightLabel,
  type LaneRow,
  type WeightLevel,
} from "@corpus/kit";
import { DESIGNATE_LABEL } from "../thread/residentActions";

/**
 * The words the console's **Residents** tab says — who is resident, and what
 * they own (SPEC.md §7 and §11; UI-125, requested by the user 2026-08-19).
 *
 * Pure and apart from the components, for the reason every liveness rule in this
 * repo is: the honesty is in the wording, and wording derived inside a component
 * is wording no test reaches without rendering one.
 *
 * ## Almost nothing here is new vocabulary, on purpose
 *
 * A lane's **name, liveness, line, mark and note** are `laneRows`' — the module
 * that already owns every lane state, including `MISSING_PROFILE_CAUSES`, which
 * exists because that one claim was typed ten times and four of them were false
 * (SHARED-053). A **weight** is read through `weightLabel` and reported with
 * `LAUNCH_WEIGHT_CLAUSE`, the composer's own words for a designation that named
 * no level. What is genuinely new is what no other surface has had to say: what
 * an *edge* into a scope means, what the page bound is, and what the
 * orchestrator's lane is when it has no scope to show.
 *
 * ## What is deliberately not said
 *
 * **"Listening since …" is not offered for a live lane.** `AgentLane.since` is
 * *when a listener was last observed parked*, and it advances on every re-arm —
 * so it is the age of the evidence, never the length of a session, and a line
 * reading "listening for 3h" would be a claim the wire cannot support. Where the
 * field is meaningful — a lapse — `laneLine` already renders it as `last seen
 * 12m ago`, and that is the one rendering of it this tab shows.
 *
 * **The scope is never re-derived.** Membership is computed server-side by the
 * same walk the queue routes with (CONTRACT-068), so this file labels what
 * arrives and computes no membership of its own: two implementations of one rule
 * is the defect `scripts/mention-offer-parity.test.ts` exists to prevent, and
 * `scopeWalk.ts` records what it cost the last time it happened.
 */

/** The tab's own name, in the console's tab strip. */
export const RESIDENTS_TAB_LABEL = "Residents";

/** …and the console's original body, which keeps its place as the default tab. */
export const JOBS_TAB_LABEL = "Jobs";

export type ConsoleTab = "jobs" | "residents";

export const CONSOLE_TABS: readonly { readonly id: ConsoleTab; readonly label: string }[] = [
  { id: "jobs", label: JOBS_TAB_LABEL },
  { id: "residents", label: RESIDENTS_TAB_LABEL },
];

/**
 * Said while `GET /api/agents` has not answered.
 *
 * Not "no lanes": the contract makes the orchestrator's row unconditional, so an
 * empty roster would be a bug rather than a workspace without agents, and a tab
 * asserting emptiness out of a read that has not landed is UI-098's defect at
 * this grain.
 */
export const ROSTER_PENDING_NOTE = "reading the roster…";

/** …and while `GET /api/threads/{id}/scope` has not answered for the chosen lane. */
export const SCOPE_PENDING_NOTE = "reading this lane's scope…";

/**
 * The empty state — a workspace where nothing has been designated (SPEC.md §7).
 *
 * Followable rather than a diagnostic: it names the act and the exact menu item
 * that performs it, and it takes that item's label from the menu itself, so a
 * reworded menu cannot leave this sentence pointing at a control that no longer
 * reads that way.
 */
export const NO_DESIGNATIONS_NOTE = `No conversation has a resident yet. Open a standalone conversation's own menu and choose “${DESIGNATE_LABEL}”.`;

/**
 * What the orchestrator's lane says where a scope would be (SPEC.md §7).
 *
 * It has no scope to list — scope is defined for a designated thread, and
 * everything outside every scope falls here — so the tab states the lane's
 * meaning rather than rendering an empty list, which would read as *this agent
 * owns nothing* about the lane that owns everything else. The second clause is
 * §7's fallback: past the grace window a lapsed lane's pending events become
 * visible to this lane's unscoped claim.
 */
export const ORCHESTRATOR_SCOPE_NOTE =
  "This lane has no scope. Every event that falls in no resident's scope is enqueued here, and a lapsed lane's pending work becomes claimable here too.";

/**
 * Said when the server cut the page (SPEC.md §7; `SCOPE_PAGE_SIZE`).
 *
 * The bound is stated rather than hidden, because a capped list that looks
 * complete is exactly the failure `truncated` exists to prevent — and §7's own
 * reason for the cap is that a scope must not become an enumeration. The order
 * is the server's: the root first, then most recently updated, so what fell off
 * is what nothing has touched for longest.
 */
export const SCOPE_BOUND_NOTE = `Bounded at ${String(SCOPE_PAGE_SIZE)} members — the most recently touched are listed, and the rest of this scope is not.`;

/**
 * A scope read refused with `409`: this thread holds no resident.
 *
 * Reachable without anyone doing anything wrong — a lane released in another
 * tab, or a conversation resolved, while this page still holds the roster that
 * named it (SPEC.md §7: resolution releases the resident with the thread). So it
 * says what happened, not that something failed.
 */
export const SCOPE_RELEASED_NOTE =
  "This conversation has no resident any more, so it has no scope — its work routes as it did before there was one.";

/** …and the lead-in for every other failure, which is a failure and says so. */
export const SCOPE_FAILED_LEAD = "This lane's scope could not be read";

/**
 * What an edge into the scope means, **at a row's width** — the `via` the
 * server's own walk reported, in the words a person reads.
 *
 * Reported and never re-derived: `via` is the edge `walkScope` took on its way
 * to the root, so a reader that recomputed it from `kind` would be answering a
 * different question with the same word.
 */
export const SCOPE_VIA_MARKS: Readonly<Record<ScopeMemberVia, string>> = {
  self: "the conversation",
  parent: "under it",
  origin: "written from it",
};

/** The same three, where a sentence fits: the hover, and a member's title. */
export const SCOPE_VIA_NOTES: Readonly<Record<ScopeMemberVia, string>> = {
  self: "the designated conversation itself — the root of this lane",
  parent: "a thread whose parent chain reaches this conversation",
  origin: "a document written from this conversation",
};

/**
 * One member's hover: what it is, how it got here, and its own status.
 *
 * The status is included because an **archived** document is still in scope —
 * membership is the walk over `origin` and `parent`, which archiving does not
 * touch, so detaching is the only way out (SPEC.md §7) — and a row that showed
 * an archived document with nothing to say about it would look like a stale
 * listing.
 */
export function scopeMemberTitle(member: ScopeMember): string {
  return `${member.title} — ${SCOPE_VIA_NOTES[member.via]} · ${member.status}`;
}

/**
 * Which lane the detail pane shows.
 *
 * `chosen` is the lane a person clicked, or `null` for "follow the roster". The
 * server lists the orchestrator's row first, so the fallback is that lane — the
 * one row every workspace has. A choice survives every refresh that still
 * contains it, and falls back the moment it does not: a released lane must not
 * strand the pane on a row the roster no longer names.
 */
export function resolveSelectedLane(
  rows: readonly Pick<LaneRow, "lane">[],
  chosen: string | null,
): string | null {
  if (chosen !== null && rows.some((row) => row.lane === chosen)) return chosen;
  return rows[0]?.lane ?? null;
}

/**
 * **What weight this lane's resident works at**, or `""` when there is no
 * designation to read one from (SPEC.md §7's rider, signed 2026-08-19).
 *
 * Three answers, and the third is silence. A recorded level is shown through the
 * workspace's own declared table — `weightLabel` falls back to the key when the
 * guidance stopped declaring it, which is a true thing to show and not an
 * invented one. `null` on a designated lane is the launcher's choice, said in the
 * composer's own words rather than as a level nobody set (CONTRACT-067). The
 * orchestrator's lane and a lane the roster has not described have no
 * designation at all, so they say nothing — never "unset", which would be a
 * claim about a designation that does not exist.
 */
export function laneWeightLabel(row: LaneRow, levels: readonly WeightLevel[]): string {
  if (row.kind === "orchestrator" || row.kind === "unknown") return "";
  return row.weight === null ? LAUNCH_WEIGHT_CLAUSE : weightLabel(levels, row.weight);
}

/**
 * The one line about **who** this lane's resident is and **whether they are
 * there** — the lane's own three clauses, joined exactly as the board badge and
 * the composer's statement join them, so one lane reads the same on every
 * surface: who, what is worth saying about them (§7's missing-profile report),
 * and whether they are listening.
 */
export function laneStatement(row: LaneRow): string {
  return [row.name, row.note, row.line].filter((part) => part !== "").join(" — ");
}

/**
 * How many members are on the page, and whether that is the whole scope.
 *
 * The completeness word is spent only on a definite `truncated: false`. There is
 * no total on the wire — deliberately, since counting one would cost the very
 * enumeration the bound prevents — so a page whose truncation nobody has stated
 * is *listed*, never *in scope*: the count is of what arrived, and only the
 * server's own flag can turn it into a claim about the scope.
 */
export function scopeCountLabel(count: number, truncated: boolean | undefined): string {
  const members = count === 1 ? "1 member" : `${String(count)} members`;
  return truncated === false ? `${members} in scope` : `${members} listed`;
}

/**
 * What went wrong reading a scope, or `null` when nothing did.
 *
 * The `409` is separated from every other failure because it is not one: §7
 * defines a scope only for a designated thread, so the refusal means the
 * designation has gone — news about the lane rather than a fault to report.
 * Everything else keeps the server's own message, which is more specific than
 * anything this file could write about a failure it cannot see.
 */
export function scopeFailure(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof CorpusRequestError && error.status === 409) return SCOPE_RELEASED_NOTE;
  // `String(error)` on an `unknown` stringifies a plain object as
  // `[object Object]`, which reads as a bug rather than as news. A thrown
  // non-Error keeps the lead alone, which says less and says it truthfully.
  if (error instanceof Error) return `${SCOPE_FAILED_LEAD}: ${error.message}`;
  if (typeof error === "string" && error !== "") return `${SCOPE_FAILED_LEAD}: ${error}`;
  return SCOPE_FAILED_LEAD;
}
