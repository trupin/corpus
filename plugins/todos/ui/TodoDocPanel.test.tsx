/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docSource, itemProblems } from "../items.js";
import { TodoDocPanel } from "./TodoDocPanel.js";
import { todoBody, todoDoc } from "./testing.js";

afterEach(cleanup);

/** `[text, done, due?]`, rendered into body task-list lines. */
type Line = readonly [string, boolean, string?];

/** The day every dated fixture below is read against. */
const TODAY = new Date("2026-07-20T12:00:00.000Z");

/** The panel takes no props but the document — it has no data path of its own. */
function panelFor(items: readonly Line[]): void {
  render(<TodoDocPanel doc={todoDoc("doc_week", {}, todoBody(items))} now={TODAY} />);
}

const stat = (which: "open" | "done"): string | null =>
  document.querySelector(`[data-stat-${which}]`)?.textContent ?? null;

describe("TodoDocPanel", () => {
  it("derives open and done counts from the document body", () => {
    panelFor([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
    expect(stat("open")).toBe("2");
    expect(stat("done")).toBe("1");
  });

  it.each([
    [[] as readonly Line[], "0", "0", 0],
    [
      [
        ["a", false],
        ["b", false],
      ] as readonly Line[],
      "2",
      "0",
      0,
    ],
    [
      [
        ["a", true],
        ["b", true],
      ] as readonly Line[],
      "0",
      "2",
      100,
    ],
  ])("reports %#: %s open, %s done, %i%% complete", (items, open, done, complete) => {
    panelFor(items);
    expect(stat("open")).toBe(open);
    expect(stat("done")).toBe(done);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(String(complete));
  });

  it("treats a body with no task lines as an empty list", () => {
    render(<TodoDocPanel doc={todoDoc("doc_new", {})} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("0");
  });

  it("still counts a not-yet-migrated document's frontmatter items", () => {
    render(
      <TodoDocPanel
        doc={todoDoc("doc_legacy", {
          items: [
            { text: "a", done: false, ts: "2026-07-20T09:00:00.000Z" },
            { text: "b", done: true, ts: "2026-07-20T09:00:00.000Z" },
          ],
        })}
      />,
    );
    expect(stat("open")).toBe("1");
    expect(stat("done")).toBe("1");
  });

  it("shows a due chip only when open items carry deadlines", () => {
    // Only the open one counts: a completed item's deadline is history.
    panelFor([
      ["a", false, "2026-08-01"],
      ["b", true, "2026-08-02"],
    ]);
    expect(screen.getByText("1 due")).toBeTruthy();
    cleanup();
    panelFor([["a", false]]);
    expect(screen.queryByText(/due/)).toBeNull();
  });

  /**
   * SPEC.md §12: the overdue treatment applies wherever items are shown, and
   * this was the one surface showing a deadline count without it — a list with
   * a deadline three weeks gone read exactly like one due next month, on the
   * very screen the user opened to work on it.
   */
  describe("the overdue treatment", () => {
    const chip = (): HTMLElement | null => document.querySelector("[data-todo-overdue]");

    it("marks the chip and says how many, when an open deadline has passed", () => {
      panelFor([
        ["a", false, "2026-07-10"],
        ["b", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("2 due · 1 overdue");
      expect(chip()?.className).toContain("overdue");
    });

    it("leaves the chip plain when every deadline is still ahead", () => {
      panelFor([["a", false, "2026-08-01"]]);
      expect(chip()?.textContent).toBe("1 due");
      expect(chip()?.className).not.toContain("overdue");
      expect(chip()?.getAttribute("data-todo-overdue")).toBe("0");
    });

    it("never calls a completed item overdue, however long ago it was due", () => {
      panelFor([
        ["a", true, "2026-01-01"],
        ["b", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("1 due");
      expect(chip()?.className).not.toContain("overdue");
    });

    it("counts every passed deadline, not just the first", () => {
      panelFor([
        ["a", false, "2026-07-01"],
        ["b", false, "2026-07-10"],
        ["c", false, "2026-08-01"],
      ]);
      expect(chip()?.textContent).toBe("3 due · 2 overdue");
    });
  });

  it("names the plugin, as the design's panel does", () => {
    panelFor([]);
    expect(screen.getByText("plugin: todos")).toBeTruthy();
  });

  it("recomputes when the body changes, holding no state of its own", () => {
    const { rerender } = render(
      <TodoDocPanel doc={todoDoc("doc_week", {}, todoBody([["a", false]]))} />,
    );
    expect(stat("open")).toBe("1");
    rerender(<TodoDocPanel doc={todoDoc("doc_week", {}, todoBody([["a", true]]))} />);
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("1");
  });
});

/**
 * PLUGINS-008 — the three states a workspace written before PLUGINS-005 can be
 * in, and the one it should be in.
 *
 * Each of them rendered a todo document with **no checkboxes and no
 * explanation**: the filed bug (items in frontmatter, empty body) showed a
 * healthy stats strip over a blank page, a hand-edited key showed nothing at
 * all, and a dual-stored document showed a perfectly normal reader over a
 * document the server refuses every item write to. The remedy is the same verb
 * in all three, and it is a CLI verb — so the notice names it and never offers
 * it as a control.
 */
describe("the legacy-storage notice", () => {
  const LEGACY = [
    { text: "Book the passport appointment", done: false, ts: "2026-07-20T09:00:00.000Z" },
    { text: "Send the signed form", done: true, ts: "2026-07-20T09:00:00.000Z" },
  ];

  const notice = (): HTMLElement | null => document.querySelector("[data-todo-legacy]");
  const kind = (): string | null => notice()?.getAttribute("data-todo-legacy") ?? null;

  /** TEST-1051 — a legacy document announces itself, by name. */
  describe("a list whose items are still in frontmatter", () => {
    const renderLegacy = (): void => {
      render(<TodoDocPanel doc={todoDoc("doc_legacy", { items: LEGACY })} />);
    };

    it("says the items are in frontmatter and names the migrate verb verbatim", () => {
      renderLegacy();
      expect(kind()).toBe("frontmatter");
      expect(notice()?.textContent).toContain("`items` frontmatter");
      expect(screen.getByText("corpus todos migrate")).toBeTruthy();
    });

    it("phrases the remedy as something the agent or the CLI runs, never as a control", () => {
      renderLegacy();
      const region = notice();
      expect(region?.textContent).toMatch(/Ask the agent to migrate it, or run/);
      expect(region?.textContent).toContain("from the CLI");
      // Nothing in the whole notice is a control: no button, no input, no link.
      expect(region?.querySelectorAll("button, input, a, [role='button']")).toHaveLength(0);
    });

    /** TEST-1052 — the legacy items are visible, and are not interactive. */
    it("renders every item with its state, under a collapsed disclosure", () => {
      renderLegacy();
      const list = document.querySelector("[data-todo-legacy-items]");
      // Collapsed by default: the content is in the DOM, the disclosure is shut,
      // so a seventeen-item legacy list cannot bury the body it sits above.
      expect(list?.getAttribute("data-todo-legacy-items")).toBe("2");
      expect((list as HTMLDetailsElement | null)?.open).toBe(false);
      expect(screen.getByText("2 items, stored in frontmatter")).toBeTruthy();

      const rows = [...document.querySelectorAll("[data-todo-legacy-item]")];
      expect(rows.map((row) => row.getAttribute("data-todo-legacy-item"))).toEqual([
        "open",
        "done",
      ]);
      expect(rows.map((row) => row.textContent)).toEqual([
        "☐Book the passport appointment",
        "☑Send the signed form",
      ]);
    });

    it("shows one item as one item, in the singular", () => {
      render(<TodoDocPanel doc={todoDoc("doc_one", { items: [LEGACY[0]] })} />);
      expect(screen.getByText("1 item, stored in frontmatter")).toBeTruthy();
    });

    it("keeps a legacy item's due date visible rather than dropping it", () => {
      render(
        <TodoDocPanel
          doc={todoDoc("doc_due", { items: [{ text: "a", done: false, due: "2026-08-01" }] })}
        />,
      );
      expect(screen.getByText("2026-08-01")).toBeTruthy();
    });

    /**
     * TEST-1052 / TEST-1058 — clicking an item changes nothing and issues no
     * request. The panel has no client and the rows carry no handler, so the
     * proof is structural: nothing focusable, nothing that answers a click, and
     * no `fetch` from the whole render.
     */
    it("issues no request and changes nothing when an item is clicked", () => {
      const fetchStub = vi.fn();
      vi.stubGlobal("fetch", fetchStub);
      try {
        renderLegacy();
        const rows = [...document.querySelectorAll("[data-todo-legacy-item]")];
        const before = rows.map((row) => row.outerHTML);
        for (const row of rows) fireEvent.click(row);
        expect(rows.map((r) => r.outerHTML)).toEqual(before);
        expect(fetchStub).not.toHaveBeenCalled();
        // No checkbox in that list is focusable or keyboard-toggleable.
        expect(
          document.querySelectorAll(
            "[data-todo-legacy-item] input, [data-todo-legacy-item] [tabindex]",
          ),
        ).toHaveLength(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /** TEST-1054 — the notice adds a region, it does not alter a number. */
    it("reports exactly the numbers the same list reports once migrated", () => {
      renderLegacy();
      const legacy = { open: stat("open"), done: stat("done") };
      cleanup();
      render(
        <TodoDocPanel
          doc={todoDoc(
            "doc_migrated",
            {},
            todoBody([
              ["Book the passport appointment", false],
              ["Send the signed form", true],
            ]),
          )}
        />,
      );
      expect(legacy).toEqual({ open: stat("open"), done: stat("done") });
      expect(legacy).toEqual({ open: "1", done: "1" });
    });
  });

  /**
   * TEST-1059 / TEST-1062 — a malformed legacy key says so instead of
   * vanishing, and the panel still refuses to publish numbers it cannot stand
   * behind.
   */
  describe("a list whose legacy key no longer parses", () => {
    const BAD = todoDoc("doc_bad", { items: "nope" });

    it("renders the notice with the plugin's own diagnostic, and no stats", () => {
      render(<TodoDocPanel doc={BAD} />);
      expect(kind()).toBe("malformed");
      // Verbatim what `itemProblems` says — the notice is not a second opinion.
      for (const problem of itemProblems(docSource(BAD))) {
        expect(screen.getByText(problem)).toBeTruthy();
      }
      expect(screen.getByText("items: must be a list of items; found string")).toBeTruthy();
      expect(screen.getByText("corpus todos migrate")).toBeTruthy();
    });

    it("shows no counts and no progress bar — the notice replaces the blank", () => {
      render(<TodoDocPanel doc={BAD} />);
      expect(stat("open")).toBeNull();
      expect(stat("done")).toBeNull();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(document.querySelector(".doc-panel")).toBeNull();
      // …and it renders no read-only list either: there is nothing readable.
      expect(document.querySelector("[data-todo-legacy-items]")).toBeNull();
    });
  });

  /** TEST-1060 — a dual-storage document stops looking healthy. */
  describe("a list storing items in the body and in frontmatter", () => {
    const DUAL = todoDoc("doc_dual", { items: LEGACY }, todoBody([["Call the plumber", false]]));

    it("says the document needs migrating before an edit will stick", () => {
      render(<TodoDocPanel doc={DUAL} />);
      expect(kind()).toBe("dual");
      expect(notice()?.textContent).toContain("It needs migrating");
      // Precise about who is refused: a core body edit still saves, so the
      // notice names the agent and the CLI rather than claiming otherwise.
      expect(notice()?.textContent).toContain("the agent and the CLI refuse every item write");
      expect(screen.getByText("corpus todos migrate")).toBeTruthy();
    });

    it("uses the sentence the write refusal uses, not a second wording", () => {
      render(<TodoDocPanel doc={DUAL} />);
      const problems = itemProblems(docSource(DUAL));
      expect(problems).toHaveLength(1);
      for (const problem of problems) expect(screen.getByText(problem)).toBeTruthy();
    });

    /** The body is readable, so the numbers below the notice are still right. */
    it("keeps the stats strip, computed from the body that wins", () => {
      render(<TodoDocPanel doc={DUAL} />);
      expect(stat("open")).toBe("1");
      expect(stat("done")).toBe("0");
    });
  });

  /** TEST-1053 — a migrated document is byte-identical to today. */
  it("renders no notice at all for a document whose items are in its body", () => {
    const { container } = render(
      <TodoDocPanel
        doc={todoDoc(
          "doc_migrated",
          {},
          todoBody([
            ["a", false],
            ["b", true],
          ]),
        )}
      />,
    );
    expect(notice()).toBeNull();
    // The panel is still the element it always was, not a fragment around one.
    expect((container.firstChild as HTMLElement | null)?.className).toBe("doc-panel");
    expect(container.children).toHaveLength(1);
  });

  /**
   * TEST-1057 — an empty legacy key is a migration, not a notice-worthy list.
   * The key still has to go, but the next write clears it silently: nothing is
   * invisible and nothing is refused, so there is nothing to announce.
   */
  it.each([[[]], [null]])("says nothing about an empty legacy key (%s)", (items) => {
    render(<TodoDocPanel doc={todoDoc("doc_empty_legacy", { items })} />);
    expect(notice()).toBeNull();
    expect(stat("open")).toBe("0");
    expect(stat("done")).toBe("0");
  });

  /**
   * TEST-1056 — migration clears the notice with no reload.
   *
   * `corpus todos migrate` folds the key into the body and removes it in one
   * write; the panel holds no state, so the invalidation that redelivers the
   * document is the whole mechanism. The numbers do not move, because they were
   * always the same items.
   */
  it("drops the notice the moment the document arrives migrated", () => {
    const { rerender } = render(<TodoDocPanel doc={todoDoc("doc_legacy", { items: LEGACY })} />);
    expect(kind()).toBe("frontmatter");
    const before = { open: stat("open"), done: stat("done") };

    rerender(
      <TodoDocPanel
        doc={todoDoc(
          "doc_legacy",
          {},
          todoBody([
            ["Book the passport appointment", false],
            ["Send the signed form", true],
          ]),
        )}
      />,
    );
    expect(notice()).toBeNull();
    expect({ open: stat("open"), done: stat("done") }).toEqual(before);
  });
});
