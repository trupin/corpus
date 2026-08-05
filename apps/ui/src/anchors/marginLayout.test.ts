/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  applyMargin,
  cascade,
  measureMargin,
  MARGIN_GUTTER_PX,
  type MarginItem,
} from "./marginLayout.js";

/**
 * The cascade, over synthetic offsets and heights — the prototype's
 * `layoutMargin()` reduced to the arithmetic that makes it correct
 * (sprint-011 TEST-117).
 */

function item(id: string, anchorTop: number | null, height: number): MarginItem {
  return { id, anchorTop, height };
}

describe("the cascade", () => {
  it("puts each card beside its anchor when there is room", () => {
    const layout = cascade([item("a", 0, 100), item("b", 300, 80)]);
    expect(layout.cards).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 300 },
    ]);
    expect(layout.minHeight).toBe(300 + 80 + MARGIN_GUTTER_PX);
  });

  it("pushes a card down rather than letting two overlap", () => {
    const layout = cascade([item("a", 0, 100), item("b", 40, 60), item("c", 50, 20)]);
    expect(layout.cards).toEqual([
      { id: "a", top: 0 },
      { id: "b", top: 112 },
      { id: "c", top: 184 },
    ]);
  });

  it("keeps a 12px gutter between every pair", () => {
    const heights = [100, 60, 20];
    const layout = cascade([item("a", 0, 100), item("b", 40, 60), item("c", 50, 20)]);
    layout.cards.forEach((card, index) => {
      const next = layout.cards[index + 1];
      if (next === undefined) return;
      expect(next.top - (card.top + (heights[index] ?? 0))).toBeGreaterThanOrEqual(
        MARGIN_GUTTER_PX,
      );
    });
  });

  it("sorts by anchor position, not by input order", () => {
    const layout = cascade([item("late", 500, 40), item("early", 20, 40)]);
    expect(layout.cards.map((card) => card.id)).toEqual(["early", "late"]);
  });

  it("reports a minimum height that holds every card", () => {
    const layout = cascade([item("a", 0, 100), item("b", 40, 60)]);
    const last = layout.cards.at(-1);
    expect(layout.minHeight).toBe((last?.top ?? 0) + 60 + MARGIN_GUTTER_PX);
  });

  /**
   * UI-062. A card with no measurable anchor used to collect the *initial*
   * `lastBottom` — zero — which sorted it above every anchored card, so a
   * comment on the last paragraph was drawn against the title.
   */
  it("keeps a card with no anchor in document order, not at the top", () => {
    const layout = cascade([item("anchored", 200, 50), item("loose", null, 50)]);
    expect(layout.cards).toEqual([
      { id: "anchored", top: 200 },
      { id: "loose", top: 262 },
    ]);
  });

  it("puts a card with no anchor at the top only when nothing precedes it", () => {
    const layout = cascade([item("loose", null, 50), item("anchored", 200, 50)]);
    expect(layout.cards).toEqual([
      { id: "loose", top: 0 },
      { id: "anchored", top: 200 },
    ]);
  });

  it("stacks a run of unanchored cards under the last anchor, in order", () => {
    const layout = cascade([
      item("first", 100, 50),
      item("loose-a", null, 50),
      item("loose-b", null, 50),
    ]);
    expect(layout.cards.map((card) => card.id)).toEqual(["first", "loose-a", "loose-b"]);
    expect(layout.cards.map((card) => card.top)).toEqual([100, 162, 224]);
  });

  it("answers an empty layout for no cards at all", () => {
    expect(cascade([])).toEqual({ cards: [], minHeight: 0 });
  });
});

/* ── The DOM half ───────────────────────────────────────────────────── */

function fixture(): { main: HTMLElement; margin: HTMLElement } {
  document.body.innerHTML = `
    <div id="main">
      <p>one <span class="anchor-hl" data-thread="th_1">quote</span></p>
      <p>two <span class="anchor-hl" data-thread="th_2">quote</span></p>
    </div>
    <div id="margin">
      <div class="thread-card" data-thread="th_1"><div class="thread-card" data-thread="th_c"></div></div>
      <div class="thread-card" data-thread="th_2"></div>
      <div class="thread-card" data-thread="th_3"></div>
    </div>`;
  const main = document.querySelector<HTMLElement>("#main");
  const margin = document.querySelector<HTMLElement>("#margin");
  if (main === null || margin === null) throw new Error("fixture");

  const tops: Record<string, number> = { th_1: 100, th_2: 400 };
  main.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
  for (const anchor of main.querySelectorAll<HTMLElement>(".anchor-hl")) {
    const id = anchor.getAttribute("data-thread") ?? "";
    anchor.getBoundingClientRect = () => ({ top: 50 + (tops[id] ?? 0) }) as DOMRect;
  }
  for (const card of margin.querySelectorAll<HTMLElement>(".thread-card")) {
    Object.defineProperty(card, "offsetHeight", { value: 60, configurable: true });
  }
  return { main, margin };
}

describe("measuring", () => {
  it("reads each card's anchor offset relative to the main column", () => {
    const { main, margin } = fixture();
    expect(measureMargin(main, margin)).toEqual([
      { id: "th_1", anchorTop: 100, height: 60 },
      { id: "th_2", anchorTop: 400, height: 60 },
      { id: "th_3", anchorTop: null, height: 60 },
    ]);
  });

  it("falls back to the pip when two anchors share one span", () => {
    const { main, margin } = fixture();
    // Identical ranges collapse into one `.anchor-hl`, which can name only one
    // thread; the second thread's pip is its own widget.
    const pip = document.createElement("span");
    pip.className = "anchor-pip";
    pip.setAttribute("data-pip-thread", "th_3");
    pip.getBoundingClientRect = () => ({ top: 50 + 400 }) as DOMRect;
    main.querySelector(".anchor-hl")?.after(pip);
    expect(measureMargin(main, margin).find((entry) => entry.id === "th_3")?.anchorTop).toBe(400);
  });

  it("ignores a nested child thread, which its own card lays out", () => {
    const { main, margin } = fixture();
    expect(measureMargin(main, margin).map((entry) => entry.id)).not.toContain("th_c");
  });
});

describe("applying", () => {
  it("writes each card's top and the column's minimum height", () => {
    const { main, margin } = fixture();
    applyMargin(margin, cascade(measureMargin(main, margin)));
    const card = (id: string): HTMLElement | null =>
      margin.querySelector<HTMLElement>(`:scope > .thread-card[data-thread="${id}"]`);
    expect(card("th_1")?.style.top).toBe("100px");
    expect(card("th_2")?.style.top).toBe("400px");
    // th_3 has no anchor, so it follows the last card that had one.
    expect(card("th_3")?.style.top).toBe("472px");
    expect(margin.style.minHeight).toBe("544px");
  });

  it("writes nothing that has not moved", () => {
    const { main, margin } = fixture();
    const layout = cascade(measureMargin(main, margin));
    applyMargin(margin, layout);
    const before = margin.style.minHeight;
    applyMargin(margin, layout);
    expect(margin.style.minHeight).toBe(before);
  });
});
