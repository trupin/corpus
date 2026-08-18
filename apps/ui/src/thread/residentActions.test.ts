import type { DocRow } from "@corpus/contract";
import type { LaneRow } from "@corpus/kit";
import { describe, expect, it, vi } from "vitest";
import {
  agentDefRows,
  designatedNotice,
  residentActions,
  DESIGNATE_LABEL,
  GENERAL_META,
  NO_PROFILES_LABEL,
  NO_PROFILES_META,
  RELEASE_GENERAL_LABEL,
  REPLACE_GENERAL_LABEL,
  type ResidentActionsInput,
} from "./residentActions";

const RESIDENT: LaneRow = {
  lane: "th_root",
  name: "researcher",
  liveness: "live",
  line: "reading the policy",
  kind: "profiled",
  profile: "researcher",
  profileDoc: "doc_a",
  note: "",
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
    onDesignateGeneral: vi.fn(),
    onDesignate: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
}

const ids = (actions: readonly { readonly id: string }[]): readonly string[] =>
  actions.map((action) => action.id);

describe("agentDefRows", () => {
  it("offers a row by the name a mention would have written", () => {
    const rows = [{ id: "doc_a", title: "researcher" }] as unknown as DocRow[];
    expect(agentDefRows(rows)).toEqual([{ id: "doc_a", name: "researcher" }]);
  });

  it("drops a row with nothing to call it, rather than offering a blank item", () => {
    const rows = [{ id: "doc_a", title: "  " }] as unknown as DocRow[];
    expect(agentDefRows(rows)).toEqual([]);
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

  it("designates with no profile, naming nobody", () => {
    const onDesignateGeneral = vi.fn();
    const onDesignate = vi.fn();
    const actions = residentActions(input({ agents: [], onDesignateGeneral, onDesignate }));
    actions[0]?.run(() => undefined);
    expect(onDesignateGeneral).toHaveBeenCalledWith();
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

  it("offers the general act first, then every profile the workspace defines", () => {
    const actions = residentActions(input());
    expect(ids(actions)).toEqual([
      "resident-designate-general",
      "resident-designate-doc_a",
      "resident-designate-doc_b",
    ]);
    expect(actions[1]?.label).toBe("Designate researcher");
  });

  it("designates by the name and nothing else", () => {
    const onDesignate = vi.fn();
    const actions = residentActions(input({ onDesignate }));
    actions[2]?.run(() => undefined);
    expect(onDesignate).toHaveBeenCalledWith("editor");
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
   * §7 reports a designation whose profile has since been renamed or archived
   * rather than substituting for it — so the resident is still named. It **is**
   * re-offered, and that is not the same skip: with no document resolving the
   * designation, designating an agent-def is a write with a real effect rather
   * than the no-op the skip exists to suppress.
   */
  it("names a resident whose profile has gone, and offers the directory to replace it", () => {
    const gone: LaneRow = {
      ...RESIDENT,
      kind: "profile-gone",
      profileDoc: null,
      note: "its profile is gone",
      mark: "profile gone",
    };
    const actions = residentActions(input({ resident: gone }));
    expect(actions[0]?.label).toBe("Release researcher");
    expect(ids(actions)).toContain("resident-designate-doc_a");
    expect(actions[2]?.label).toBe("Replace with researcher");
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
