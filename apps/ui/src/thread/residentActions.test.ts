import type { DocRow } from "@corpus/contract";
import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE, type LaneRow } from "@corpus/kit";
import { describe, expect, it, vi } from "vitest";
import {
  agentDefRows,
  designatedNotice,
  residentActions,
  DESIGNATE_LABEL,
  DESIGNATE_META,
  GENERAL_META,
  LEVEL_WEIGHT_META,
  NO_PROFILES_LABEL,
  NO_PROFILES_META,
  REDESIGNATE_GENERAL_LABEL,
  RELEASE_GENERAL_LABEL,
  RELEASE_META,
  REPLACE_GENERAL_LABEL,
  UNDECLARED_WEIGHT_META,
  WEIGHT_LABEL_LEAD,
  type ResidentActionsInput,
} from "./residentActions";

const RESIDENT: LaneRow = {
  lane: "th_root",
  name: "researcher",
  liveness: "live",
  working: false,
  line: "reading the policy",
  kind: "profiled",
  profile: "researcher",
  profileDoc: "doc_a",
  note: "",
  weight: null,
  mark: "",
  conversation: "Q3 planning",
};

/** §7's general resident: designated, and named by its conversation because it has no profile. */
const GENERAL: LaneRow = {
  ...RESIDENT,
  name: "Q3 planning",
  kind: "general",
  profile: null,
  profileDoc: null,
};

/**
 * §7's designation whose profile has since gone — renamed, deleted, or moved out
 * of `.claude/agents/` (`MISSING_PROFILE_CAUSES`; archiving is not one of them,
 * since an archived agent-def still resolves). Built with the kit's own `note`
 * and `mark` rather than a paraphrase, because what these tests are checking is
 * precisely that the menu says the kit's words.
 */
const PROFILE_GONE: LaneRow = {
  ...RESIDENT,
  kind: "profile-gone",
  profileDoc: null,
  note: MISSING_PROFILE_NOTE,
  mark: MISSING_PROFILE_MARK,
};

function input(overrides: Partial<ResidentActionsInput> = {}): ResidentActionsInput {
  return {
    hasParent: false,
    resident: undefined,
    rosterAnswered: true,
    agents: [
      { id: "doc_a", name: "researcher" },
      { id: "doc_b", name: "editor" },
    ],
    pending: false,
    // The default is a workspace that declares **nothing**, which is the
    // shipping state for any workspace on a template older than AGENT-015 — so
    // every assertion written before UI-168 goes on describing a menu with no
    // weight rows, and the rows are opted into by the tests that are about them.
    levels: [],
    weight: undefined,
    onChooseWeight: vi.fn(),
    onDesignateGeneral: vi.fn(),
    onDesignate: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
}

/** A declaration in the shape `weightLevels.ts` parses out of the tier table. */
const LEVELS = [
  { label: "Small and mechanical", key: "light" },
  { label: "Standard", key: "standard" },
  { label: "Heavy or judgment-laden", key: "heavy" },
] as const;

const ids = (actions: readonly { readonly id: string }[]): readonly string[] =>
  actions.map((action) => action.id);

/**
 * An `agent-def` row as `GET /api/docs?type=agent-def` reports it. The **path**
 * is load-bearing since UI-123 — it is what decides whether the row may be
 * offered at all — so no fixture here may omit it.
 */
const agentDefRow = (id: string, title: string, path: string): DocRow =>
  ({ id, title, path }) as unknown as DocRow;

describe("agentDefRows", () => {
  it("offers a row by the name a mention would have written", () => {
    const rows = [agentDefRow("doc_a", "researcher", ".claude/agents/researcher.md")];
    expect(agentDefRows(rows)).toEqual([{ id: "doc_a", name: "researcher" }]);
  });

  /**
   * The common shape since SERVER-122: the title is a *spelling* and the server
   * resolves it against the stem too, so the menu keeps sending what it reads
   * off the row.
   */
  it("designates by the title, which the server still resolves for an addressable row", () => {
    const rows = [agentDefRow("doc_b", "Bookkeeper", ".claude/agents/bookkeeper.md")];
    expect(agentDefRows(rows)).toEqual([{ id: "doc_b", name: "Bookkeeper" }]);
  });

  it("drops a row with nothing to call it, rather than offering a blank item", () => {
    const rows = [agentDefRow("doc_a", "  ", ".claude/agents/blank.md")];
    expect(agentDefRows(rows)).toEqual([]);
  });

  /**
   * UI-123. SERVER-125 stopped indexing an off-root `type: agent-def` as a
   * mention target under any spelling — the title alias went with it — so
   * designating this row now earns a `404` naming the file. The menu asks the
   * kit's `isAddressableTarget`, the same gate the `@` autocomplete applies,
   * because two copies of this rule is how both surfaces came to offer what the
   * server refuses.
   */
  it("does not offer a document *about* a persona that the server cannot resolve", () => {
    const rows = [
      agentDefRow("doc_a", "Researcher", ".claude/agents/researcher.md"),
      agentDefRow("doc_l", "Legacy", "data/docs/inbox/legacy.md"),
    ];
    expect(agentDefRows(rows)).toEqual([{ id: "doc_a", name: "Researcher" }]);
  });

  /**
   * And the dropped row is dropped *here*, at the point it would become an
   * offer, not upstream: the query still asks for every agent-def, and the board
   * and the seeded "Skills & agents" view still list this document.
   */
  it("drops the row without touching the list it came from", () => {
    const rows = [agentDefRow("doc_l", "Legacy", "data/docs/inbox/legacy.md")];
    expect(agentDefRows(rows)).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  /**
   * Not an empty list. UI-098's rule: a directory that has not answered is not a
   * workspace with no agent-defs, and only the second may be said out loud.
   */
  it("keeps a directory that has not answered distinguishable from an empty one", () => {
    expect(agentDefRows(undefined)).toBeUndefined();
  });
});

describe("residentActions", () => {
  /**
   * The defect UI-122 exists for. A fresh workspace has no `agent-def`
   * documents, and until this the whole offer was replaced by one disabled line
   * saying so — the feature v0.10.0 is named for could not be reached from the
   * UI at all.
   */
  it("offers the act itself in a workspace that defines no profiles", () => {
    const actions = residentActions(input({ agents: [] }));
    expect(ids(actions)).toEqual(["resident-designate-general", "resident-no-profiles"]);
    const [designate] = actions;
    expect(designate?.label).toBe(DESIGNATE_LABEL);
    expect(designate?.disabled).toBe(false);
    expect(designate?.meta).toBe(GENERAL_META);
  });

  it("designates with no profile and no level, naming nobody and stating nothing", () => {
    const onDesignateGeneral = vi.fn();
    const onDesignate = vi.fn();
    const actions = residentActions(input({ agents: [], onDesignateGeneral, onDesignate }));
    actions[0]?.run(() => undefined);
    // `undefined` and not a key: absence is what the launcher-decides case is,
    // and it is what the hook turns into an absent `weight` on the wire.
    expect(onDesignateGeneral).toHaveBeenCalledWith(undefined);
    expect(onDesignate).not.toHaveBeenCalled();
  });

  /**
   * Worth saying, and not worth saying as a fault: §7 makes a profile the
   * refinement rather than the requirement, so the line says the absence is fine
   * in the same breath as reporting it — and it sits under an offer that works.
   */
  it("states the absence of profiles without reading as an error", () => {
    const actions = residentActions(input({ agents: [] }));
    const note = actions.find((action) => action.id === "resident-no-profiles");
    expect(note?.disabled).toBe(true);
    expect(note?.label).toBe(NO_PROFILES_LABEL);
    expect(note?.meta).toBe(NO_PROFILES_META);
    expect(note?.meta).toContain("a resident does not need one");
  });

  /**
   * PR #50 review. Since UI-123 this line has two causes — no `agent-def`
   * documents, and `agent-def` documents none of which is addressable — and its
   * advice has to be followable in **both**. It said *"add a `type: agent-def`
   * document"*, which in the second state describes what the person already did:
   * `--folder data/docs/…` makes exactly that, the board lists it, and this line
   * goes on saying there are no profiles. Naming the root is what makes one
   * sentence true of both, which is why it is asserted and not merely spelled.
   */
  it("says where a profile has to live, so its advice cannot reproduce this state", () => {
    const offRoot = [agentDefRow("doc_l", "Legacy", "data/docs/inbox/legacy.md")];
    const bothCauses = [agentDefRows([]), agentDefRows(offRoot)];

    for (const agents of bothCauses) {
      const note = residentActions(input({ agents })).find(
        (action) => action.id === "resident-no-profiles",
      );
      expect(note?.meta).toBe(NO_PROFILES_META);
      expect(note?.meta).toContain(".claude/agents/");
    }
  });

  it("offers the general act first, then every profile the workspace defines", () => {
    const actions = residentActions(input());
    expect(ids(actions)).toEqual([
      "resident-designate-general",
      "resident-designate-doc_a",
      "resident-designate-doc_b",
    ]);
    expect(actions[1]?.label).toBe("Designate researcher");
  });

  it("designates by the name, and states no level where none was chosen", () => {
    const onDesignate = vi.fn();
    const actions = residentActions(input({ onDesignate }));
    actions[2]?.run(() => undefined);
    expect(onDesignate).toHaveBeenCalledWith("editor", undefined);
  });

  /**
   * SPEC.md §7: "a thread on a document is *about* that document, and a resident
   * owns a conversation rather than a passage". So the offer is absent rather
   * than present-and-refused — an item that exists only to earn a `409` is not
   * an action.
   */
  it("offers nothing on a thread that may not have a resident at all", () => {
    expect(residentActions(input({ hasParent: true }))).toEqual([]);
  });

  /**
   * UI-098's rule. Without the roster we cannot tell "Designate" from "Replace
   * with", and either label would be a claim about a state nobody reported.
   * Unchanged by UI-122: the general offer is unconditional on the *directory*,
   * never on the roster.
   */
  it("offers nothing while the roster has not answered", () => {
    expect(residentActions(input({ rosterAnswered: false }))).toEqual([]);
    expect(residentActions(input({ rosterAnswered: false, agents: [] }))).toEqual([]);
  });

  /**
   * The directory in flight. The offer stands — that is the whole point — but
   * "No profiles yet" is withheld, because it would be a claim about a read
   * nobody has received.
   */
  it("offers the act, and says nothing about profiles, while the directory is in flight", () => {
    const actions = residentActions(input({ agents: undefined }));
    expect(ids(actions)).toEqual(["resident-designate-general"]);
  });

  it("offers the release first, and does not re-offer whoever is already resident", () => {
    const actions = residentActions(input({ resident: RESIDENT }));
    expect(ids(actions)).toEqual([
      "resident-release",
      "resident-designate-general",
      "resident-designate-doc_b",
    ]);
    expect(actions[0]?.label).toBe("Release researcher");
    // Single-valued, so the rest are replacements and say so.
    expect(actions[1]?.label).toBe(REPLACE_GENERAL_LABEL);
    expect(actions[2]?.label).toBe("Replace with editor");
  });

  it("releases without naming anybody", () => {
    const onRelease = vi.fn();
    const actions = residentActions(input({ resident: RESIDENT, onRelease }));
    actions[0]?.run(() => undefined);
    expect(onRelease).toHaveBeenCalledWith();
  });

  /**
   * A general resident has no profile, and `LaneRow.name` falls through to the
   * conversation's own title — so naming it here would read as releasing the
   * thread. It names nobody instead (CONTRACT-061: never a word where a profile
   * name goes).
   */
  it("releases a general resident without inventing a profile to name", () => {
    const actions = residentActions(input({ resident: GENERAL }));
    expect(actions[0]?.label).toBe(RELEASE_GENERAL_LABEL);
    expect(actions[0]?.label).not.toContain("Q3 planning");
  });

  it("does not re-offer a general designation to a conversation that already has one", () => {
    const actions = residentActions(input({ resident: GENERAL }));
    expect(ids(actions)).toEqual([
      "resident-release",
      "resident-designate-doc_a",
      "resident-designate-doc_b",
    ]);
    expect(actions[1]?.label).toBe("Replace with researcher");
  });

  /**
   * The two are matched on the resident's **document** rather than on the row's
   * display name, which for a general resident is its conversation's title —
   * otherwise an agent-def titled the same as the conversation would silently
   * vanish from the list.
   */
  it("keeps offering an agent-def that happens to share the conversation's title", () => {
    const actions = residentActions(
      input({ resident: GENERAL, agents: [{ id: "doc_c", name: "Q3 planning" }] }),
    );
    expect(ids(actions)).toContain("resident-designate-doc_c");
  });

  /**
   * The guard the PR #49 review measured. The `profile` skill writes title
   * `Bookkeeper` into `.claude/agents/bookkeeper.md`, and since SERVER-122 and
   * CLI-050 that is where a created agent-def lives — so the server resolves the
   * designation to the **stem** and the resident is `bookkeeper`, while this
   * directory row still says `Bookkeeper`. Compared as names the guard missed,
   * and the menu offered replacing Bookkeeper with Bookkeeper. It is the
   * document that is compared, so no spelling difference — stem against title,
   * case, or anything else — can get past it.
   */
  it("does not re-offer the resident's own agent-def when its title and its stem differ", () => {
    const bookkeeper: LaneRow = { ...RESIDENT, name: "bookkeeper", profile: "bookkeeper" };
    const actions = residentActions(
      input({
        resident: bookkeeper,
        agents: [
          { id: "doc_a", name: "Bookkeeper" },
          { id: "doc_b", name: "editor" },
        ],
      }),
    );
    expect(ids(actions)).not.toContain("resident-designate-doc_a");
    expect(ids(actions)).toContain("resident-designate-doc_b");
  });

  /**
   * And the converse: two agent-defs, one of them titled exactly as the resident
   * is called but a **different document**. Matched on names, the wrong row was
   * dropped and the one that would actually change anything was the one hidden.
   */
  it("drops the resident's own row, not whichever one is spelled like it", () => {
    const actions = residentActions(
      input({
        resident: RESIDENT,
        agents: [
          { id: "doc_a", name: "Fieldwork" },
          { id: "doc_b", name: "researcher" },
        ],
      }),
    );
    expect(ids(actions)).not.toContain("resident-designate-doc_a");
    expect(ids(actions)).toContain("resident-designate-doc_b");
  });

  /**
   * §7 reports a designation whose profile has since gone rather than
   * substituting for it — so the resident is still named. It **is**
   * re-offered, and that is not the same skip: with no document resolving the
   * designation, designating an agent-def is a write with a real effect rather
   * than the no-op the skip exists to suppress.
   */
  it("names a resident whose profile has gone, and offers the directory to replace it", () => {
    const actions = residentActions(input({ resident: PROFILE_GONE }));
    expect(actions[0]?.label).toBe("Release researcher");
    expect(ids(actions)).toContain("resident-designate-doc_a");
    expect(actions[2]?.label).toBe("Replace with researcher");
  });

  /**
   * PR #49's second review. The label alone is byte-identical to a healthy
   * lane's — that is what naming the standing designation costs — so the report
   * has to be on the item, and the second line is where it goes. §7's *"the
   * missing profile is reported rather than silently substituted"* now holds on
   * the surface where the release is actually chosen, and not only on the badge,
   * the picker and `corpus agents`.
   */
  it("reports the gone profile on the release, in the kit's words", () => {
    const gone = residentActions(input({ resident: PROFILE_GONE }))[0];
    const healthy = residentActions(input({ resident: RESIDENT }))[0];

    expect(gone?.label).toBe(healthy?.label);
    expect(gone?.meta).not.toBe(healthy?.meta);
    expect(gone?.meta).toBe(`${MISSING_PROFILE_NOTE} — ${RELEASE_META}`);
  });

  /**
   * Not a fourth phrasing. The note is the kit's export verbatim and the
   * consequence is still said — the report is joined ahead of it, in the order
   * and with the separator the badge's title and the picker's statement line
   * already use.
   */
  it("keeps the kit's sentence intact and still says what releasing does", () => {
    const gone = residentActions(input({ resident: PROFILE_GONE }))[0];
    expect(gone?.meta).toContain(MISSING_PROFILE_NOTE);
    expect(gone?.meta).toContain(RELEASE_META);
    expect(gone?.meta?.indexOf(MISSING_PROFILE_NOTE)).toBeLessThan(
      gone?.meta?.indexOf(RELEASE_META) ?? -1,
    );
    // The short form belongs to rows that sit side by side; a menu item has a
    // line to itself, so it says the sentence and not the phrase.
    expect(gone?.meta).not.toContain(MISSING_PROFILE_MARK);
  });

  /**
   * Every other kind has an empty `note`, and an empty clause must not leave a
   * separator behind — a lane with nothing worth saying reads exactly as it did
   * before this existed.
   */
  it("adds no clause to a lane with nothing worth saying about its resident", () => {
    expect(residentActions(input({ resident: RESIDENT }))[0]?.meta).toBe(RELEASE_META);
    expect(residentActions(input({ resident: GENERAL }))[0]?.meta).toBe(RELEASE_META);
  });

  it("disables every offer while a designation is in flight", () => {
    const actions = residentActions(input({ resident: RESIDENT, pending: true }));
    expect(actions.every((action) => action.disabled === true)).toBe(true);
  });

  it("disables the general offer too while one is in flight", () => {
    const actions = residentActions(input({ agents: [], pending: true }));
    expect(actions[0]?.disabled).toBe(true);
  });
});

/**
 * UI-168: the level a resident runs at, chosen where the designation is made —
 * SPEC.md §7's rider signed 2026-08-19, and the only place the choice exists.
 */
describe("the designation's weight", () => {
  const weightIds = (actions: readonly { readonly id: string }[]): readonly string[] =>
    ids(actions).filter((id) => id.startsWith("resident-weight-"));

  /**
   * The shipping state for any workspace on a template older than AGENT-015, and
   * for one whose table is unreadable. It is not an edge case: `weightLevels.ts`
   * fails **clean**, so "declares nothing" and "declares something malformed"
   * are one answer, and both must still designate.
   */
  it("offers no rows at all where the workspace declares no levels", () => {
    const actions = residentActions(input({ levels: [] }));
    expect(weightIds(actions)).toEqual([]);
    expect(ids(actions)).toContain("resident-designate-general");
  });

  it("offers the workspace's own levels, lightest first, after the acts", () => {
    const actions = residentActions(input({ levels: LEVELS }));
    expect(ids(actions)).toEqual([
      "resident-designate-general",
      "resident-designate-doc_a",
      "resident-designate-doc_b",
      "resident-weight-launch",
      "resident-weight-light",
      "resident-weight-standard",
      "resident-weight-heavy",
    ]);
  });

  /**
   * The label a person picks by is the guidance's **Weight** cell; the key is
   * what travels. That split is what makes a rewording of the table safe, and it
   * is also §10's "no model names in the UI" holding by construction — this
   * module has no vocabulary of its own to leak one.
   */
  it("shows the declared label and never the key", () => {
    const rows = residentActions(input({ levels: LEVELS }));
    const heavy = rows.find((action) => action.id === "resident-weight-heavy");
    expect(heavy?.label).toBe(`${WEIGHT_LABEL_LEAD} Heavy or judgment-laden`);
    expect(heavy?.label).not.toContain("heavy");
  });

  /**
   * "The launcher decides" is a named outcome the contract reports back
   * (`Resident.weight` null), so it is a row that can be chosen — not a state
   * reachable only by never pressing anything, which would leave a person who
   * pressed a level with no way back and make every designation opinionated.
   */
  it("stands on the launcher's choice until a level is pressed, and comes back to it", () => {
    const onChooseWeight = vi.fn();
    const none = residentActions(input({ levels: LEVELS, onChooseWeight }));
    const launch = none.find((action) => action.id === "resident-weight-launch");
    expect(launch?.checked).toBe(true);
    expect(none.find((action) => action.id === "resident-weight-heavy")?.checked).toBe(false);

    const chosen = residentActions(input({ levels: LEVELS, weight: "heavy", onChooseWeight }));
    expect(chosen.find((action) => action.id === "resident-weight-launch")?.checked).toBe(false);
    expect(chosen.find((action) => action.id === "resident-weight-heavy")?.checked).toBe(true);

    chosen.find((action) => action.id === "resident-weight-launch")?.run(() => undefined);
    expect(onChooseWeight).toHaveBeenCalledWith(undefined);
    chosen.find((action) => action.id === "resident-weight-heavy")?.run(() => undefined);
    expect(onChooseWeight).toHaveBeenLastCalledWith("heavy");
  });

  /**
   * A row states what the **act above** will send, so a press that closed the
   * menu would have taken the act away with the choice.
   */
  it("keeps the menu open on every row, because the act is still to come", () => {
    const rows = residentActions(input({ levels: LEVELS })).filter((action) =>
      action.id.startsWith("resident-weight-"),
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.keepOpen === true)).toBe(true);
  });

  /** An act names the level it will send, so the item describes its own write. */
  it("names the chosen level on every act, and nothing where none is chosen", () => {
    const plain = residentActions(input({ levels: LEVELS }));
    expect(plain[0]?.meta).toBe(GENERAL_META);
    expect(plain[1]?.meta).toBe(DESIGNATE_META);

    const heavy = residentActions(input({ levels: LEVELS, weight: "heavy" }));
    expect(heavy[0]?.meta).toBe(`${GENERAL_META} — at Heavy or judgment-laden`);
    expect(heavy[1]?.meta).toBe(`${DESIGNATE_META} — at Heavy or judgment-laden`);
  });

  it("carries the chosen key to whichever act is run", () => {
    const onDesignateGeneral = vi.fn();
    const onDesignate = vi.fn();
    const actions = residentActions(
      input({ levels: LEVELS, weight: "light", onDesignateGeneral, onDesignate }),
    );
    actions[0]?.run(() => undefined);
    expect(onDesignateGeneral).toHaveBeenCalledWith("light");
    actions[1]?.run(() => undefined);
    expect(onDesignate).toHaveBeenCalledWith("researcher", "light");
  });

  /**
   * **"Same profile, new level" is not a no-op** — the skip that suppresses a
   * write with no effect must not suppress this one. The server writes it and
   * reports it (`threads/resident.ts`: *"a different weight is a different
   * state, so it writes"*), and a menu that hid the act would make re-weighing
   * unreachable on exactly the conversation somebody wanted to re-weigh.
   */
  it("re-offers a general resident at a different level, and calls it a re-designation", () => {
    const general = { ...GENERAL, weight: null };
    const same = residentActions(input({ levels: LEVELS, resident: general }));
    expect(ids(same)).not.toContain("resident-designate-general");

    const different = residentActions(
      input({ levels: LEVELS, resident: general, weight: "heavy" }),
    );
    const act = different.find((action) => action.id === "resident-designate-general");
    expect(act?.label).toBe(REDESIGNATE_GENERAL_LABEL);
    expect(act?.label).not.toContain("Replace");
  });

  it("re-offers the resident's own profile at a different level, without calling it a swap", () => {
    const resident = { ...RESIDENT, profileDoc: "doc_a", weight: "light" };
    const same = residentActions(input({ levels: LEVELS, resident, weight: "light" }));
    expect(ids(same)).not.toContain("resident-designate-doc_a");

    const different = residentActions(input({ levels: LEVELS, resident, weight: "heavy" }));
    const act = different.find((action) => action.id === "resident-designate-doc_a");
    expect(act?.label).toBe("Re-designate researcher");
    // Every other profile is still a replacement — the change is one row wide.
    expect(different.find((action) => action.id === "resident-designate-doc_b")?.label).toBe(
      "Replace with editor",
    );
  });

  /**
   * The direction that is easy to get backwards. Omitting the weight **clears**
   * it server-side, so going from a stated level back to the launcher's choice
   * is a real write and the act has to stay offered.
   */
  it("re-offers a weighted resident at the launcher's choice, which clears the level", () => {
    const resident = { ...GENERAL, weight: "heavy" };
    const back = residentActions(input({ levels: LEVELS, resident, weight: undefined }));
    expect(ids(back)).toContain("resident-designate-general");

    const unchanged = residentActions(input({ levels: LEVELS, resident, weight: "heavy" }));
    expect(ids(unchanged)).not.toContain("resident-designate-general");
  });

  /**
   * The table is the workspace's own and can be edited under a standing
   * designation, so a resident's recorded level may name a row that no longer
   * exists. Dropping it would leave a radio set with **nothing** checked and a
   * resident whose level the menu refuses to name; substituting a surviving
   * level would be the menu lying about the request.
   */
  it("keeps a level the guidance stopped declaring, and says so", () => {
    const actions = residentActions(input({ levels: LEVELS, weight: "exhaustive" }));
    const rows = actions.filter((action) => action.id.startsWith("resident-weight-"));
    // Exactly one member of the set holds, and it is the recorded one.
    expect(rows.filter((row) => row.checked === true).map((row) => row.id)).toEqual([
      "resident-weight-exhaustive",
    ]);
    const undeclared = rows.find((row) => row.id === "resident-weight-exhaustive");
    // No label to show but its own key — true, rather than invented.
    expect(undeclared?.label).toBe(`${WEIGHT_LABEL_LEAD} exhaustive`);
    expect(undeclared?.meta).toBe(UNDECLARED_WEIGHT_META);
    expect(rows.find((row) => row.id === "resident-weight-heavy")?.meta).toBe(LEVEL_WEIGHT_META);
    // …and the act names what it will actually send rather than staying silent.
    expect(actions[0]?.meta).toBe(`${GENERAL_META} — at exhaustive`);
  });

  it("disables the rows while a designation is in flight", () => {
    const rows = residentActions(input({ levels: LEVELS, pending: true })).filter((action) =>
      action.id.startsWith("resident-weight-"),
    );
    expect(rows.every((row) => row.disabled === true)).toBe(true);
  });

  /**
   * §7 forbids a resident on a thread with a parent, so there is nothing to
   * weigh either — the rows must not survive the gate the acts do not.
   */
  it("offers nothing on a thread that may not have a resident", () => {
    expect(residentActions(input({ levels: LEVELS, hasParent: true }))).toEqual([]);
    expect(residentActions(input({ levels: LEVELS, rosterAnswered: false }))).toEqual([]);
  });
});

describe("designatedNotice", () => {
  it("names the profile where the designation resolved to one", () => {
    expect(designatedNotice("researcher")).toContain("researcher is resident here");
  });

  it("says a general resident is here without inventing a name for it", () => {
    const notice = designatedNotice(null);
    expect(notice).toContain("has a resident, with no profile");
    expect(notice).not.toContain("released");
  });
});
