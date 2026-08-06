/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage.js";
import {
  COLLAPSE_STATE_VERSION,
  COLLAPSE_STORAGE_KEY,
  EMPTY_COLLAPSE_STATE,
  MAX_OVERRIDES_PER_SURFACE,
  clearCollapseState,
  columnSurface,
  dropStaleOverride,
  isThreadCollapsed,
  placedCollapsed,
  readCollapseState,
  readStateOf,
  resolvedRuleCollapses,
  strongerReadState,
  surfaceOverrides,
  withOverride,
  withSurface,
  writeCollapseState,
  type SurfaceOverrides,
  type ThreadCollapseSubject,
} from "./threadCollapse.js";

/**
 * SPEC.md §11's collapse rules as arithmetic, away from any component.
 *
 * The three sentences under test are the ones the rider spends most of its
 * length on, and each of them is a thing that would be a bug if it drifted: the
 * rule set is closed at one, unread outranks the rule, and the last thing that
 * happened wins.
 */

function subject(overrides: Partial<ThreadCollapseSubject> = {}): ThreadCollapseSubject {
  return { threadId: "th_1", status: "open", readState: "read", ...overrides };
}

describe("the one rule", () => {
  it("collapses a resolved thread and nothing else", () => {
    expect(resolvedRuleCollapses(subject({ status: "resolved" }))).toBe(true);
    expect(resolvedRuleCollapses(subject())).toBe(false);
    expect(resolvedRuleCollapses(subject({ status: "archived" }))).toBe(false);
  });

  it("never folds a conversation holding a turn nobody has seen", () => {
    expect(resolvedRuleCollapses(subject({ status: "resolved", readState: "unread" }))).toBe(false);
    expect(placedCollapsed(subject({ status: "resolved", readState: "unread" }))).toBe(false);
  });

  /**
   * PR #25 re-review, MAJOR. Some placements have no row to read `unread` off —
   * a standalone thread, or one past its parent's first page of thread rows —
   * and used to answer the interlock with a guess. The rule asks for knowledge,
   * so it stands down on `unknown` exactly as it does on `unread`: a fold hides
   * the turns (SPEC.md §7), and a surface that cannot vouch that they have been
   * read cannot make §11's promise about what the fold costs.
   */
  it("never folds a conversation whose read state it does not know", () => {
    expect(resolvedRuleCollapses(subject({ status: "resolved", readState: "unknown" }))).toBe(
      false,
    );
    expect(placedCollapsed(subject({ status: "resolved", readState: "unknown" }))).toBe(false);
    // …and the rule does fold the same conversation once the answer is known.
    expect(placedCollapsed(subject({ status: "resolved", readState: "read" }))).toBe(true);
  });

  it("reads the projection's flag, and its null as no answer rather than as read", () => {
    expect(readStateOf(true)).toBe("unread");
    expect(readStateOf(false)).toBe("read");
    // `DocRow.unread` is null on a non-thread — the contract's "no answer".
    expect(readStateOf(null)).toBe("unknown");
    expect(readStateOf(undefined)).toBe("unknown");
  });

  /**
   * The direction a placement's record moves, and the reason it has one: reading
   * a conversation must never make it foldable, so the merge is monotonic and
   * only a status change takes the answer fresh (`ThreadCollapseApi.place`).
   */
  it("keeps the more cautious of two answers about the same conversation", () => {
    expect(strongerReadState("read", "unread")).toBe("unread");
    expect(strongerReadState("unread", "read")).toBe("unread");
    expect(strongerReadState("read", "unknown")).toBe("unknown");
    expect(strongerReadState("unknown", "read")).toBe("unknown");
    // Unseen turns outrank not knowing: the badge is worth keeping.
    expect(strongerReadState("unknown", "unread")).toBe("unread");
    expect(strongerReadState("read", "read")).toBe("read");
  });

  it("collapses a conversation nested deeper than the surface can draw", () => {
    expect(placedCollapsed(subject({ tooDeep: true }))).toBe(true);
  });

  /**
   * The interlock binds **the rule** — §11's words — and depth is not a rule:
   * `threadDepth.ts` says it is "what the surface can draw". Letting the
   * interlock jump the depth clamp drew a full card at a depth the surface had
   * already declared it could not usefully draw (PR #25 review, MINOR).
   */
  it("clamps depth even for an unread conversation, and only the rule stands down", () => {
    expect(placedCollapsed(subject({ tooDeep: true, readState: "unread" }))).toBe(true);
    expect(
      placedCollapsed(subject({ status: "resolved", tooDeep: true, readState: "unread" })),
    ).toBe(true);
    // The rule itself still yields to it, wherever the surface can draw.
    expect(placedCollapsed(subject({ status: "resolved", readState: "unread" }))).toBe(false);
  });

  /** Nothing about the clamp is a one-way door: it is placement, not policy. */
  it("still lets a reader expand a conversation the surface clamped", () => {
    const deep = subject({ tooDeep: true, readState: "unread" });
    expect(isThreadCollapsed({}, deep)).toBe(true);
    expect(isThreadCollapsed(withOverride({}, deep, false), deep)).toBe(false);
  });
});

describe("precedence — the last thing that happened wins", () => {
  it("lets the reader's own fold beat the rule, in both directions", () => {
    const resolved = subject({ status: "resolved" });
    expect(isThreadCollapsed({}, resolved)).toBe(true);
    expect(isThreadCollapsed(withOverride({}, resolved, false), resolved)).toBe(false);

    const open = subject();
    expect(isThreadCollapsed({}, open)).toBe(false);
    expect(isThreadCollapsed(withOverride({}, open, true), open)).toBe(true);
  });

  it("lets the reader fold an unread conversation by hand — the override binds the rule, not them", () => {
    const unread = subject({ status: "resolved", readState: "unread" });
    expect(isThreadCollapsed({}, unread)).toBe(false);
    expect(isThreadCollapsed(withOverride({}, unread, true), unread)).toBe(true);
  });

  it("re-asserts the rule when the status changes, in both directions", () => {
    // Expanded by hand while resolved…
    const overrides = withOverride({}, subject({ status: "resolved" }), false);
    // …says nothing about the same thread once it has been reopened.
    expect(isThreadCollapsed(overrides, subject({ status: "open" }))).toBe(false);

    // Folded by hand while open…
    const folded = withOverride({}, subject(), true);
    // …and resolving it lands on the rule, which agrees here.
    expect(isThreadCollapsed(folded, subject({ status: "resolved" }))).toBe(true);
    // Reopening it puts it back to the rule's answer, not the old gesture's.
    expect(isThreadCollapsed(folded, subject({ status: "open" }))).toBe(true);
  });

  it("drops a stale override so a status flipping back cannot resurrect it", () => {
    const overrides = withOverride({}, subject({ status: "resolved" }), false);
    const pruned = dropStaleOverride(overrides, subject({ status: "open" }));
    expect(pruned["th_1"]).toBeUndefined();
    // Resolved again: the rule, not the gesture two status changes ago.
    expect(isThreadCollapsed(pruned, subject({ status: "resolved" }))).toBe(true);
    // And a matching status is left exactly as it was, by identity.
    expect(dropStaleOverride(overrides, subject({ status: "resolved" }))).toBe(overrides);
  });

  it("keeps one entry per thread, most recently decided last", () => {
    let overrides: SurfaceOverrides = {};
    for (let index = 0; index <= MAX_OVERRIDES_PER_SURFACE; index += 1) {
      overrides = withOverride(overrides, subject({ threadId: `th_${String(index)}` }), true);
    }
    expect(Object.keys(overrides)).toHaveLength(MAX_OVERRIDES_PER_SURFACE);
    // The oldest decision is the one that went.
    expect(overrides["th_0"]).toBeUndefined();
    expect(overrides[`th_${String(MAX_OVERRIDES_PER_SURFACE)}`]).toBeDefined();
  });
});

describe("the stored blob", () => {
  it("round-trips one surface without disturbing another", () => {
    const storage = memoryStorage();
    const first = withOverride({}, subject({ status: "resolved" }), false);
    writeCollapseState(withSurface(EMPTY_COLLAPSE_STATE, columnSurface("col_a"), first), storage);

    const second = withOverride({}, subject({ threadId: "th_2" }), true);
    writeCollapseState(
      withSurface(readCollapseState(storage), columnSurface("col_b"), second),
      storage,
    );

    const state = readCollapseState(storage);
    expect(surfaceOverrides(state, columnSurface("col_a"))["th_1"]).toEqual({
      collapsed: false,
      status: "resolved",
    });
    expect(surfaceOverrides(state, columnSurface("col_b"))["th_2"]?.collapsed).toBe(true);
    // Two columns showing the same document keep their own (SPEC.md §11).
    expect(surfaceOverrides(state, columnSurface("col_b"))["th_1"]).toBeUndefined();
  });

  it("reads anything unrecognised as no folds at all", () => {
    expect(readCollapseState(memoryStorage({ [COLLAPSE_STORAGE_KEY]: "{" }))).toEqual(
      EMPTY_COLLAPSE_STATE,
    );
    expect(readCollapseState(memoryStorage({ [COLLAPSE_STORAGE_KEY]: "[]" }))).toEqual(
      EMPTY_COLLAPSE_STATE,
    );
    expect(
      readCollapseState(
        memoryStorage({ [COLLAPSE_STORAGE_KEY]: JSON.stringify({ version: 0, surfaces: {} }) }),
      ),
    ).toEqual(EMPTY_COLLAPSE_STATE);
    // An entry that is not an override is dropped; the surface around it lives.
    const mixed = JSON.stringify({
      version: COLLAPSE_STATE_VERSION,
      surfaces: {
        "col:a": { th_1: { collapsed: "yes" }, th_2: { collapsed: true, status: "open" } },
      },
    });
    const state = readCollapseState(memoryStorage({ [COLLAPSE_STORAGE_KEY]: mixed }));
    expect(surfaceOverrides(state, "col:a")).toEqual({ th_2: { collapsed: true, status: "open" } });
  });

  it("shrugs off storage that is not there, rather than refusing to render", () => {
    expect(readCollapseState(null)).toEqual(EMPTY_COLLAPSE_STATE);
    expect(readCollapseState(throwingStorage())).toEqual(EMPTY_COLLAPSE_STATE);
    expect(() => {
      writeCollapseState(EMPTY_COLLAPSE_STATE, throwingStorage());
    }).not.toThrow();
    expect(() => {
      clearCollapseState(throwingStorage());
    }).not.toThrow();
  });
});
