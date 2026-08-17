import type { DocRow } from "@corpus/contract";
import type { LaneRow } from "@corpus/kit";
import { describe, expect, it, vi } from "vitest";
import {
  agentDefRows,
  NO_AGENT_DEFS,
  residentActions,
  type ResidentActionsInput,
} from "./residentActions";

const RESIDENT: LaneRow = {
  lane: "th_root",
  name: "researcher",
  liveness: "live",
  line: "reading the policy",
  conversation: "Q3 planning",
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

  it("offers nothing at all from a directory that has not answered", () => {
    expect(agentDefRows(undefined)).toEqual([]);
  });
});

describe("residentActions", () => {
  it("offers every agent the workspace defines, by its invocable name", () => {
    const actions = residentActions(input());
    expect(ids(actions)).toEqual(["resident-designate-doc_a", "resident-designate-doc_b"]);
    expect(actions[0]?.label).toBe("Designate researcher");
  });

  it("designates by the name and nothing else", () => {
    const onDesignate = vi.fn();
    const actions = residentActions(input({ onDesignate }));
    actions[1]?.run(() => undefined);
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
   */
  it("offers nothing while the roster has not answered", () => {
    expect(residentActions(input({ rosterAnswered: false }))).toEqual([]);
  });

  it("offers the release first, and does not re-offer whoever is already resident", () => {
    const actions = residentActions(input({ resident: RESIDENT }));
    expect(ids(actions)).toEqual(["resident-release", "resident-designate-doc_b"]);
    expect(actions[0]?.label).toBe("Release researcher");
    // Single-valued, so the second is a replacement and says so.
    expect(actions[1]?.label).toBe("Replace with editor");
  });

  it("releases without naming anybody", () => {
    const onRelease = vi.fn();
    const actions = residentActions(input({ resident: RESIDENT, onRelease }));
    actions[0]?.run(() => undefined);
    expect(onRelease).toHaveBeenCalledWith();
  });

  /**
   * A workspace with no `agent-def` documents. Saying why there is nothing to
   * pick is worth one disabled line; an empty menu would look like a bug.
   */
  it("says why there is nothing to designate rather than staying silent", () => {
    const actions = residentActions(input({ agents: [] }));
    expect(ids(actions)).toEqual(["resident-none"]);
    expect(actions[0]?.disabled).toBe(true);
    expect(actions[0]?.meta).toBe(NO_AGENT_DEFS);
  });

  it("disables every item while a designation is in flight", () => {
    const actions = residentActions(input({ resident: RESIDENT, pending: true }));
    expect(actions.every((action) => action.disabled === true)).toBe(true);
  });
});
