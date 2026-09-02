import type { DocRow } from "@corpus/contract";
import { isAddressableTarget, weightLabel, type LaneRow, type WeightLevel } from "@corpus/kit";
import type { MenuAction } from "../menu/menuModel";

/**
 * Designating and releasing a resident, as menu actions — SPEC.md §7's
 * *"Designation is user-only state on the thread, set and released like any
 * other thread field"*, offered where a person acts on the conversation.
 *
 * ## Why a declared list rather than a control
 *
 * §10 binds the conversation's right-click menu to *"exactly that item's
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
 *
 * ## The level the resident runs at, chosen here because there is nowhere else
 *
 * SPEC.md §7's rider signed 2026-08-19: *"A resident's weight is set when it is
 * designated, not per message."* A running agent cannot change what it is
 * without discarding the conversation it is holding, so the designation is the
 * **only** place the choice exists — and until UI-168 the app offered it
 * nowhere, sending no weight on every designation it had ever made.
 *
 * **The vocabulary is the workspace's own and is not model names.** A weight is
 * a level's *key* from the tier table in the workspace's orchestrate skill
 * (`packages/kit/src/weight/weightLevels.ts`), which is the same set the
 * composer's address control offers and the same reason §10's signed non-goal —
 * no model names in the UI — holds by construction here. This module holds no
 * vocabulary: {@link ResidentActionsInput.levels} arrives from the declaration,
 * and a workspace that declares none gets **no weight rows at all** and
 * designates exactly as it did before.
 *
 * **Choosing nothing stays the ordinary case.** The rows are a radio set whose
 * first member is {@link LAUNCHER_WEIGHT_LABEL} — *the launcher decides* — and
 * it is the one standing until somebody presses another. Nothing chosen sends
 * no `weight` key, which is what absence means on the wire (CONTRACT-067), so a
 * person who ignores the rows makes exactly the designation this menu made
 * before the rows existed.
 *
 * **The rows do not restate what a weight governs.** That rule has one wording,
 * the contract's `RESIDENT_WEIGHT_BOUNDARY`, and it is about a weight stated on
 * a *message* meeting a resident's lane — a composer's question, answered where
 * a person reaches for a message weight (`addressModel.ts`'s
 * `residentWeightSentence`) and not where they choose a designation's level. A
 * fresh site here would be a fourth restatement of a rule CONTRACT-064 records
 * drifting across eight.
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
 * **That last filter guards a state the projection cannot produce**, measured
 * against the real projector (SERVER-127's review pass): `title: ""`, a
 * whitespace-only title and a blank `name:` are all *absent* to `asString`, which
 * falls through to `titleFromPath` — non-blank for every path a root admits. It
 * is kept as a cheap guard on a field the wire types as a plain string, not
 * because such a row has ever been seen.
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
 * …and on a conversation whose resident is **already** general, where the only
 * thing the act changes is the level.
 *
 * "Replace with a general resident" would be false there — nobody is displaced —
 * and the item is offered at all only because the weight differs (see
 * {@link residentActions}'s skip). Naming the re-designation is what stops the
 * menu describing a swap it is not making.
 */
export const REDESIGNATE_GENERAL_LABEL = "Re-designate the general resident";

/** The lead every weight row wears, so the set reads as one question. */
export const WEIGHT_LABEL_LEAD = "Weight —";

/**
 * The choice that means **no level**, in the two words every designating
 * surface uses for it — this menu's row, and the global composer's owner
 * weight control (UI-185), which shares the constant rather than rewording the
 * same outcome.
 */
export const LAUNCHER_DECIDES_LABEL = "the launcher decides";

/**
 * The row that means **no level**, and the one standing until somebody presses
 * another.
 *
 * It is an explicit member of the set rather than an unpressed state, because
 * "the launcher decides" is a real outcome the contract names and reports back
 * (`Resident.weight` null), not the absence of one. A set whose default could
 * only be reached by *not* pressing anything would also have no way back once a
 * level was pressed — and then every designation the app made would be
 * opinionated, which is the thing this row exists to prevent.
 */
export const LAUNCHER_WEIGHT_LABEL = `${WEIGHT_LABEL_LEAD} ${LAUNCHER_DECIDES_LABEL}`;

/** Its second line, in the contract's own terms for a null `Resident.weight`. */
export const LAUNCHER_WEIGHT_META = "no level is stated, and the launcher says what it chose";

/** …and a level row's, which says what the choice is a property of. */
export const LEVEL_WEIGHT_META = "the level this resident is designated at";

/**
 * …and one the guidance has stopped declaring, which is still what will be sent.
 *
 * The same sentence the composer's address control puts on such an option
 * (`WEIGHT_UNKNOWN_TITLE`), for the same reason: the table is the workspace's
 * own and it can be edited under a standing designation, and substituting a
 * surviving level would be the menu lying about the request.
 */
export const UNDECLARED_WEIGHT_META =
  "this workspace's guidance no longer declares this level — it is still what the request will state";

/**
 * How an act's second line reports the level it will send, or says nothing.
 *
 * Joined onto the act rather than left to the rows alone: the rows sit below the
 * acts, so an act that did not name its own level would be describing a
 * different write from the one it performs. Nothing is appended where nothing is
 * chosen, which keeps the ordinary designation's wording byte-identical to what
 * it was before this feature.
 */
export function withWeightMeta(meta: string, label: string | undefined): string {
  return label === undefined ? meta : `${meta} — at ${label}`;
}

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
 *   - **The ladder does not stop at two.** An archived agent-def is dropped by
 *     this same branch for a third reason; to tell any of them apart the menu
 *     would have to carry the rows it discarded and a reason each. (A fourth,
 *     the blank title, was cited here until SERVER-127's review pass measured it
 *     unreachable — the argument stands on the archived case, and citing a state
 *     the projection cannot produce would have been the species of claim this
 *     release spent seven sites correcting.) UI-122's lesson is that this item is
 *     *news beside an offer that works*, not a diagnostics panel — it earned its
 *     place back by
 *     being one line.
 *   - **The board already says it better.** The dropped document is listed, with
 *     its folder on the row and its path in the reader; §10's own surface for
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
  /**
   * The levels this workspace declares, lightest first (`useWeightLevels`).
   *
   * **Empty means no weight rows at all** — never a fallback list. The table is
   * the workspace's own and can legitimately be absent, unreadable or on an
   * older template, and a designation must still be possible there.
   */
  readonly levels: readonly WeightLevel[];
  /** The level standing for the *next* designation, or `undefined` for none. */
  readonly weight: string | undefined;
  /** States a level, or clears it back to "the launcher decides". */
  readonly onChooseWeight: (key: string | undefined) => void;
  /** Designate with no profile: §7's general resident. */
  readonly onDesignateGeneral: (weight: string | undefined) => void;
  readonly onDesignate: (name: string, weight: string | undefined) => void;
  readonly onRelease: () => void;
}

/**
 * The rows to draw: the declared levels, plus the standing one when the guidance
 * has stopped declaring it.
 *
 * The same rule the composer's `weightOptions` follows, and it matters more here
 * because the standing choice is read off a **designation** that may be months
 * old: dropping it would leave a radio set with nothing checked and a resident
 * whose recorded level the menu refuses to name. Never a level the guidance does
 * not declare *and* nobody chose.
 */
function weightOptions(input: ResidentActionsInput): readonly WeightLevel[] {
  const { levels, weight } = input;
  if (weight === undefined || levels.some((level) => level.key === weight)) return levels;
  return [...levels, { label: weight, key: weight }];
}

/**
 * The weight rows — a radio set, or nothing at all.
 *
 * `keepOpen` on every one of them: a row states what the *act above* will send,
 * so a press that closed the menu would take the act away with the choice.
 */
function weightActions(input: ResidentActionsInput): readonly MenuAction[] {
  if (input.levels.length === 0) return [];
  const rows: MenuAction[] = [
    {
      id: "resident-weight-launch",
      label: LAUNCHER_WEIGHT_LABEL,
      meta: LAUNCHER_WEIGHT_META,
      checked: input.weight === undefined,
      keepOpen: true,
      disabled: input.pending,
      run: () => {
        input.onChooseWeight(undefined);
      },
    },
  ];
  for (const level of weightOptions(input)) {
    const declared = input.levels.some((have) => have.key === level.key);
    rows.push({
      id: `resident-weight-${level.key}`,
      // The **label**, which is what the guidance calls the level and what a
      // person picks by; the key is what travels. Rewording the table reworders
      // this menu with no code change, and a choice made yesterday still
      // resolves, because the key survived the rewording. An undeclared one has
      // no label to show but its own key, which is a true thing to show and not
      // an invented one.
      label: `${WEIGHT_LABEL_LEAD} ${level.label}`,
      meta: declared ? LEVEL_WEIGHT_META : UNDECLARED_WEIGHT_META,
      checked: input.weight === level.key,
      keepOpen: true,
      disabled: input.pending,
      run: () => {
        input.onChooseWeight(level.key);
      },
    });
  }
  return rows;
}

/**
 * The items to append to a conversation's menu — possibly none.
 *
 * Ordered as the decision is made: release first where there is something to
 * release, since it is one item and the alternative is a list; then the act
 * itself; then the profiles that refine it, in the directory's own order; then
 * the level it runs at, which refines it the same way a profile does and so sits
 * where a refinement sits.
 */
export function residentActions(input: ResidentActionsInput): readonly MenuAction[] {
  if (input.hasParent) return [];
  // Nothing is offered from a roster that has not spoken: with no answer we
  // cannot tell "designate" from "replace", and either label would be a claim.
  if (!input.rosterAnswered) return [];

  const { resident, agents } = input;
  /**
   * What the acts below will say they send: the declared label, or the key
   * itself where the guidance stopped declaring it (`weightLabel`'s own
   * fallback), or nothing at all for "the launcher decides".
   *
   * Through the kit's derivation rather than a lookup that could miss, because a
   * standing choice read off an old designation is exactly the case a lookup
   * misses — and an act that sent a level while naming none would be describing
   * a different write from the one it performs.
   */
  const level = input.weight === undefined ? undefined : weightLabel(input.levels, input.weight);
  /**
   * Would designating again write the same `Resident` this thread already has?
   *
   * The comparison the skips below turn on, and it now has a third field.
   * Omitting the weight **clears** it server-side (`threads/resident.ts`'s
   * `chosen = weight ?? null`), so `heavy` → nothing is a real change and not a
   * no-op — which is why this compares `undefined` against `null` as equal and
   * against a key as different, rather than ignoring an absent choice.
   */
  const sameWeight = (input.weight ?? null) === (resident?.weight ?? null);
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
  /*
   * The act itself — offered whatever the directory holds, and skipped only
   * where it would change nothing: §7 makes designation single-valued, so
   * designating a general resident over a general resident is a write with no
   * effect, and an item that does nothing is not an action.
   *
   * **A different level is a different state, so it is not that case** (UI-168).
   * The skip used to be `resident?.kind !== "general"` alone, and with a weight
   * on the designation that sentence stopped being true: the same general
   * resident at a new level is a write the server performs and reports
   * (`threads/resident.ts` — "a different weight is a different state, so it
   * writes"), so suppressing it would have made the one act this menu exists for
   * unreachable on precisely the conversation somebody wanted to re-weigh.
   */
  const generalIsNoop = resident?.kind === "general" && sameWeight;
  if (!generalIsNoop) {
    items.push({
      id: "resident-designate-general",
      label:
        resident === undefined
          ? DESIGNATE_LABEL
          : resident.kind === "general"
            ? REDESIGNATE_GENERAL_LABEL
            : REPLACE_GENERAL_LABEL,
      meta: withWeightMeta(GENERAL_META, level),
      disabled: input.pending,
      run: () => {
        input.onDesignateGeneral(input.weight);
      },
    });
  }
  if (agents === undefined) return [...items, ...weightActions(input)];
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
    return [...items, ...weightActions(input)];
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
     *
     * **The level joins that question** (UI-168): the same profile at a new
     * level writes, so only the pair together is the no-op. Where the profile
     * matches and the level does not, the row stays and says
     * `Re-designate` — never `Replace with`, which would describe a swap that
     * displaces somebody when nobody is being displaced.
     */
    const sameProfile = agent.id === resident?.profileDoc;
    if (sameProfile && sameWeight) continue;
    items.push({
      id: `resident-designate-${agent.id}`,
      label:
        resident === undefined
          ? `Designate ${agent.name}`
          : sameProfile
            ? `Re-designate ${agent.name}`
            : `Replace with ${agent.name}`,
      meta: withWeightMeta(DESIGNATE_META, level),
      disabled: input.pending,
      run: () => {
        input.onDesignate(agent.name, input.weight);
      },
    });
  }
  return [...items, ...weightActions(input)];
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
