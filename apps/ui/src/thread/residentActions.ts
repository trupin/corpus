import type { DocRow } from "@corpus/contract";
import { isAddressableTarget, type LaneRow } from "@corpus/kit";
import type { MenuAction } from "../menu/menuModel";

/**
 * Designating and releasing a resident, as menu actions — SPEC.md §7's
 * *"Designation is user-only state on the thread, set and released like any
 * other thread field"*, offered where a person acts on the conversation.
 *
 * ## Why a declared list rather than a control
 *
 * §11 binds the conversation's right-click menu to *"exactly that item's
 * existing actions"*, and `menuModel.ts` exists so the ⋯ sheet and the context
 * menu cannot come to offer different ones. A designation is an action on this
 * thread, so it belongs in that list; a dialog beside it would be a second
 * surface with its own drift.
 *
 * ## The act leads; the profiles refine it
 *
 * §7's rider makes naming a profile optional and naming none *"the ordinary
 * case … requires nothing to exist first"*, so the first item is the
 * designation itself and the directory is what follows it. It used to be the
 * other way round, and in a workspace with no `agent-def` documents that left
 * one disabled line saying there was nothing to pick — the feature v0.10.0 is
 * named for was unreachable from the UI (UI-122). **The general offer therefore
 * does not depend on the directory at all**: not on what it holds, and not on
 * whether it has answered.
 *
 * ## The names come from the mention directory, because they are the same names
 *
 * §7 designates by the **invocable name** — the one `@<subagent>` would have
 * written — resolved against the workspace's `type: agent-def` documents (§8).
 * So the refinement is that directory, read through the very query the `@`
 * autocomplete reads (`MENTION_DOC_TYPE`), and a person picks the word they
 * already type rather than learning a second vocabulary.
 *
 * ## The vocabulary for *who* is resident is the kit's, not this file's
 *
 * A `Resident` has three shapes since CONTRACT-061, and the board badge and the
 * composer's recipient row render the same three. Everything this file says
 * about them therefore reads `LaneRow.kind`, `LaneRow.profile`,
 * `LaneRow.profileDoc` and `LaneRow.note` rather than re-deriving them from a
 * name — `packages/kit/src/recipient/laneRows.ts` is where a lane turns into
 * words, and a menu that decided for itself what a missing profile is called
 * would be the second description drifting from the first.
 *
 * The split between the middle two is the one to keep straight: `profile` is
 * what the resident is **called** and is what a label says; `profileDoc` is
 * which document it **is** and is the only one of the two anything compares.
 * `note` is the last of them, and the reason this list grew: it is what is worth
 * saying about the resident beyond naming them — §7's missing-profile report,
 * empty for every other kind — and until PR #49's second review the menu was the
 * one resident surface that did not read it, so a `profile-gone` lane offered a
 * release byte-identical to a healthy lane's. See {@link releaseMeta}.
 *
 * ## Only where a designation is legal, and only for a person
 *
 * A thread with a **parent** may not have a resident at all — §7: *"a thread on
 * a document is about that document, and a resident owns a conversation rather
 * than a passage"* — so a card on a document offers nothing here rather than an
 * item that would earn a `409`. Nothing gates on the actor: designation is
 * user-only and this surface has no other kind of user.
 */

/** The one field of an agent-def row this needs: what it is invocable as. */
export interface AgentDefRow {
  readonly id: string;
  readonly name: string;
}

/**
 * The name to **designate by**, and the document it belongs to.
 *
 * The name is the title, because that is what `GET /api/docs` carries; the
 * server resolves a name against both the file stem and the title,
 * case-insensitively, so the title of an addressable row always resolves. A row
 * whose title is blank is dropped rather than offered — an item labelled with
 * nothing is not an offer, and designating by an empty name is a `400`.
 *
 * **The title is a spelling and not an identity.** What the server *stores* is
 * the name it resolved to — the `invocableName`, which for a file under
 * `.claude/agents/` is the **stem** — so designating `Bookkeeper` makes a
 * resident called `bookkeeper`. That is why the id travels beside the name: it
 * is the only field of a row that can be compared with a lane's resident (see
 * {@link residentActions}).
 *
 * **A row with no invocable name is not offered at all** (UI-123). SERVER-125
 * stopped indexing an off-root `type: agent-def` as a mention target, and it took
 * the title alias with it: a document *about* a persona, filed under
 * `data/docs/`, is now addressable under no spelling and a designation naming it
 * earns a `404` that names the file. So the gate is `isAddressableTarget` — the
 * kit's, the same one the `@` autocomplete applies, because two copies of this
 * rule is exactly how both surfaces came to offer what the server refuses.
 *
 * The filter is here and not in the query: `GET /api/docs?type=agent-def` still
 * returns every agent-def, and it must — the board's `type:` filter and the
 * seeded "Skills & agents" view read it, and the dropped document stays listed,
 * readable and editable. All it loses is a menu item promising a designation
 * that cannot land.
 */
export function agentDefRows(
  rows: readonly DocRow[] | undefined,
): readonly AgentDefRow[] | undefined {
  if (rows === undefined) return undefined;
  return rows
    .filter((row) => isAddressableTarget(row))
    .map((row) => ({ id: row.id, name: row.title.trim() }))
    .filter((row) => row.name !== "");
}

/** What a designation item's second line says. */
export const DESIGNATE_META = "owns this conversation and everything that grows out of it";

/** …and a general one's, which leads with what it is not before what it does. */
export const GENERAL_META = `no profile — ${DESIGNATE_META}`;

/** …and a release's, which states the consequence rather than the act. */
export const RELEASE_META = "back to ordinary routing — nothing already queued moves";

/**
 * The release item's second line: **who** is being released, where there is
 * something worth saying about them, and then what releasing does.
 *
 * `note` is `LaneRow.note` — §7's missing-profile report in the kit's words
 * (`MISSING_PROFILE_NOTE`), empty for every other kind of resident, so no
 * ordinary lane gains a clause it did not have. Joined ahead of
 * {@link RELEASE_META} rather than replacing it, in the same order and with the
 * same separator the board badge's title and the recipient picker's statement
 * line use — `name — note — line`, with the item's label carrying the name and
 * this carrying the other two. Four surfaces, one sentence.
 *
 * The note and not the mark: `laneRows.ts` reserves the short form for rows that
 * sit side by side, and a menu item has a line to itself.
 */
export function releaseMeta(note: string): string {
  return [note, RELEASE_META].filter((part) => part !== "").join(" — ");
}

/** The act itself, offered whatever the agent-def directory holds. */
export const DESIGNATE_LABEL = "Designate a resident";

/** …and the same act on a conversation that already has a profiled resident. */
export const REPLACE_GENERAL_LABEL = "Replace with a general resident";

/**
 * Releasing a resident there is no profile to name.
 *
 * The profiled case says "Release researcher"; this one names nobody rather than
 * a word standing in for a profile (CONTRACT-061), and the meta beside it
 * already says what release does.
 */
export const RELEASE_GENERAL_LABEL = "Release the resident";

/**
 * Said when the workspace defines no profiles — **beside** the offer rather than
 * in place of it.
 *
 * It used to be `NO_AGENT_DEFS`, and it used to substitute for the whole offer:
 * a disabled "Designate a resident" whose second line read *"no agent-def
 * documents in this workspace"*. That was a dead end, and it was the defect
 * UI-122 exists to remove — but it is still worth saying, for the reason it was
 * worth saying then. A menu that simply stopped after one item leaves a person
 * who came looking for their agent-defs with nothing to distinguish *"this
 * workspace has none"* from *"this menu forgot to offer them"*.
 *
 * What changed is what it has to be: news rather than a diagnostic. The absence
 * of profiles is not a misconfiguration — §7 makes a profile the refinement and
 * not the requirement — so it says so in the same breath, and it sits on a
 * disabled line under an offer that works.
 *
 * ## Why the root is named, and why the line does not say which absence this is
 *
 * Since UI-123 the list is gated by {@link agentDefRows}, so this line has two
 * causes that read alike: a workspace with no `agent-def` documents, and one
 * whose `agent-def` documents are all filed where nothing loads them. The old
 * wording — *"add a `type: agent-def` document"* — was **advice that reproduces
 * the second state**: `corpus doc create --type agent-def --folder data/docs/…`
 * makes exactly such a document, the board lists it under "Skills & agents", and
 * this line still says there are no profiles (PR #50 review).
 *
 * So the sentence names the root. That makes it true of both causes rather than
 * only the first, which is the property that matters: advice a person can follow
 * without landing back where they started.
 *
 * It does **not** distinguish them, deliberately.
 *
 *   - **One remedy.** Both absences are answered by the same act — put an
 *     agent-def under `.claude/agents/`. A second sentence keyed on the cause
 *     would vary the diagnosis while the instruction stayed put.
 *   - **The ladder does not stop at two.** A blank-titled agent-def is dropped
 *     by this same branch for a third reason, an archived one for a fourth; to
 *     tell any of them apart the menu would have to carry the rows it discarded
 *     and a reason each. UI-122's lesson is that this item is *news beside an
 *     offer that works*, not a diagnostics panel — it earned its place back by
 *     being one line.
 *   - **The board already says it better.** The dropped document is listed, with
 *     its folder on the row and its path in the reader; §11's own surface for
 *     "what does this workspace hold" is one column away and can be precise
 *     where two lines of menu meta cannot.
 */
export const NO_PROFILES_LABEL = "No profiles yet";

export const NO_PROFILES_META =
  "a resident does not need one — add a type: agent-def document under .claude/agents/";

export interface ResidentActionsInput {
  /** True for a thread on a document, which §7 forbids a resident. */
  readonly hasParent: boolean;
  /**
   * This conversation's roster row, or `undefined` when the roster has not
   * answered *or* has answered and this thread is not a lane. The two are told
   * apart by `rosterAnswered`, because offering "Release" on a thread whose
   * roster row simply has not arrived would be an action against a state nobody
   * reported.
   */
  readonly resident: LaneRow | undefined;
  /** Whether `GET /api/agents` has answered at all (UI-098's rule). */
  readonly rosterAnswered: boolean;
  /**
   * The workspace's agent-defs, from the mention directory, or `undefined` while
   * it has not answered.
   *
   * The distinction is smaller than it was and still real: since UI-122 the
   * directory gates only the *refinement*, so a general designation is offered
   * either way and the menu never dead-ends on it. What it still decides is
   * whether {@link NO_PROFILES_LABEL} may be said, and an unanswered read saying
   * "no profiles yet" would be UI-098's rule broken for the length of one fetch.
   */
  readonly agents: readonly AgentDefRow[] | undefined;
  readonly pending: boolean;
  /** Designate with no profile: §7's general resident. */
  readonly onDesignateGeneral: () => void;
  readonly onDesignate: (name: string) => void;
  readonly onRelease: () => void;
}

/**
 * The items to append to a conversation's menu — possibly none.
 *
 * Ordered as the decision is made: release first where there is something to
 * release, since it is one item and the alternative is a list; then the act
 * itself; then the profiles that refine it, in the directory's own order.
 */
export function residentActions(input: ResidentActionsInput): readonly MenuAction[] {
  if (input.hasParent) return [];
  // Nothing is offered from a roster that has not spoken: with no answer we
  // cannot tell "designate" from "replace", and either label would be a claim.
  if (!input.rosterAnswered) return [];

  const { resident, agents } = input;
  const items: MenuAction[] = [];
  if (resident !== undefined) {
    items.push({
      id: "resident-release",
      // Named where there is a profile to name, and by nobody where there is
      // not: a general resident has none, and `LaneRow.name` falls through to
      // the conversation's own title, which would read as releasing the thread.
      label: resident.profile === null ? RELEASE_GENERAL_LABEL : `Release ${resident.profile}`,
      /*
       * §7's *"the missing profile is reported rather than silently
       * substituted"*, on the surface where the release is actually chosen.
       * Without it a `profile-gone` lane's release item was byte-identical to a
       * healthy one's — the report held on the badge, in the picker and in
       * `corpus agents`, and nowhere on the menu a person acts from (PR #49
       * review). It qualifies the name in the label above rather than replacing
       * it: the designation stands, so the resident is still called what it was
       * designated as (CONTRACT-061).
       */
      meta: releaseMeta(resident.note),
      disabled: input.pending,
      run: () => {
        input.onRelease();
      },
    });
  }
  // The act itself — offered whatever the directory holds, and skipped only
  // where it would change nothing: §7 makes designation single-valued, so
  // designating a general resident over a general resident is a write with no
  // effect, and an item that does nothing is not an action.
  if (resident?.kind !== "general") {
    items.push({
      id: "resident-designate-general",
      label: resident === undefined ? DESIGNATE_LABEL : REPLACE_GENERAL_LABEL,
      meta: GENERAL_META,
      disabled: input.pending,
      run: () => {
        input.onDesignateGeneral();
      },
    });
  }
  if (agents === undefined) return items;
  if (agents.length === 0) {
    items.push({
      id: "resident-no-profiles",
      label: NO_PROFILES_LABEL,
      meta: NO_PROFILES_META,
      disabled: true,
      run: () => {
        /* News, not an offer: the act above is the one that works. */
      },
    });
    return items;
  }
  for (const agent of agents) {
    /*
     * Whoever is already resident is not re-offered, for the reason above — and
     * the question is asked of the **document**, never of a name.
     *
     * A designation resolves against an agent-def's invocable name *and* its
     * title alike, and what the server keeps is the name it resolved to: for a
     * file under `.claude/agents/` that is the stem, while this directory row
     * carries the title. Since SERVER-122 and CLI-050 file a created agent-def
     * there, the two differ routinely — the `profile` skill writes title
     * `Bookkeeper` to `.claude/agents/bookkeeper.md`, so the resident is
     * `bookkeeper` and this row says `Bookkeeper`. Compared as names, the guard
     * missed and the menu offered "Replace with Bookkeeper" on the very thread
     * Bookkeeper already resided on (PR #49 review). Lowercasing would only have
     * hidden it: the mismatch is title-against-stem, and case is one way of many
     * that shows.
     *
     * `LaneRow.profileDoc` is that resolution, as the server reports it, so this
     * asks the same question the server answered. It is null for a general
     * resident — whose display name is its conversation's, the case that first
     * forced this off `name` — and null for one whose profile has **gone**,
     * where re-offering is correct: nothing in the workspace answers to that
     * designation any more, so designating this row is a write with an effect,
     * not the no-op the skip exists to suppress.
     */
    if (agent.id === resident?.profileDoc) continue;
    items.push({
      id: `resident-designate-${agent.id}`,
      label: resident === undefined ? `Designate ${agent.name}` : `Replace with ${agent.name}`,
      meta: DESIGNATE_META,
      disabled: input.pending,
      run: () => {
        input.onDesignate(agent.name);
      },
    });
  }
  return items;
}

/**
 * What the board says once a designation lands — kept beside the actions so the
 * menu's vocabulary and the notice's are one file apart rather than two
 * components apart.
 *
 * `profile` is the resolved `Resident.name` off the response, so `null` is a
 * general resident and never a name this surface failed to read. The general
 * sentence names nobody rather than substituting a word for the missing profile
 * (CONTRACT-061).
 */
export function designatedNotice(profile: string | null): string {
  const consequence = "messages in this conversation and everything that grows out of it go to it";
  return profile === null
    ? `This conversation has a resident, with no profile — ${consequence}.`
    : `${profile} is resident here — ${consequence}.`;
}

export const RELEASED_NOTICE =
  "Resident released — this conversation is back on the agent's own lane.";
