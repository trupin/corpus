/** @vitest-environment jsdom */
import type { RevealItem } from "@corpus/kit/plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseOccurrence,
  collapse,
  findRevealRange,
  flashRange,
  indexText,
  REVEAL_FLASH_MS,
  revealItem,
  scrollRangeIntoView,
} from "./reveal";

/**
 * UI-037's search-and-flash, against real DOM.
 *
 * The interesting cases are all about a quote and a rendering that were never
 * the same string: the words are split across elements by inline markup, joined
 * across blocks by nothing at all, and wrapped wherever the layout felt like
 * it. A reveal that only matched a single text node would work on the fixture
 * and fail on every document with a bold word in it.
 */

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

function item(exact: string, extra: Partial<RevealItem> = {}): RevealItem {
  return { kind: "item", exact, ...extra };
}

describe("collapse", () => {
  it.each([
    ["Call the plumber", "Call the plumber"],
    ["Call   the\n plumber", "Call the plumber"],
    ["\n  Call the plumber\n", "Call the plumber"],
    ["   ", ""],
  ])("normalises %j to %j", (input, expected) => {
    expect(collapse(input)).toBe(expected);
  });
});

describe("indexText", () => {
  it("flattens a paragraph and maps every character back to its text node", () => {
    const host = mount("<p>Buy milk</p>");
    const index = indexText(host);
    expect(index.text).toBe("Buy milk");
    expect(index.points).toHaveLength(index.text.length);
    const first = index.points[0];
    expect(first?.node.data).toBe("Buy milk");
    expect(first?.offset).toBe(0);
  });

  it("joins inline markup without inventing a space", () => {
    const host = mount("<p>Buy <strong>milk</strong> today</p>");
    expect(indexText(host).text).toBe("Buy milk today");
  });

  it("separates two blocks that would otherwise read as one word", () => {
    const host = mount("<p>Buy milk</p><p>Next</p>");
    expect(indexText(host).text).toBe("Buy milk Next");
  });

  it("collapses the whitespace a renderer left between lines", () => {
    const host = mount("<p>Buy\n   milk</p>");
    expect(indexText(host).text).toBe("Buy milk");
  });

  it("ignores script and style content", () => {
    const host = mount("<style>p{color:red}</style><p>Buy milk</p>");
    expect(indexText(host).text).toBe("Buy milk");
  });
});

describe("chooseOccurrence", () => {
  const haystack = "Call the plumber Call the plumber Call the plumber";

  it("takes the first match when nothing disambiguates", () => {
    expect(chooseOccurrence(haystack, "Call the plumber", "", "")).toBe(0);
  });

  it("takes the occurrence the prefix frames", () => {
    expect(chooseOccurrence(haystack, "Call the plumber", "Call the plumber ", "")).toBe(17);
  });

  it("takes the occurrence the suffix frames", () => {
    expect(chooseOccurrence(haystack, "Call the plumber", "", " Call the plumber")).toBe(0);
  });

  it("requires both when both are given", () => {
    // Only the middle one has a plumber on each side of it.
    expect(
      chooseOccurrence(haystack, "Call the plumber", "Call the plumber ", " Call the plumber"),
    ).toBe(17);
  });

  /**
   * The frame is a hint about *which* one, not a second thing to find: a
   * document edited since the caller read it still contains the quote, and
   * flashing the first one beats flashing nothing.
   */
  it("falls back to the first match when the frame no longer fits", () => {
    expect(chooseOccurrence(haystack, "Call the plumber", "gone ", "also gone")).toBe(0);
  });

  it("answers null when the text is not there at all", () => {
    expect(chooseOccurrence(haystack, "Book the passport", "", "")).toBeNull();
  });
});

describe("findRevealRange", () => {
  it("ranges over the match, exactly", () => {
    const host = mount("<p>Buy milk today</p>");
    const range = findRevealRange(host, item("milk"));
    expect(range?.toString()).toBe("milk");
  });

  it("ranges across the elements an inline mark split the words into", () => {
    const host = mount("<p>Buy <strong>milk</strong> today</p>");
    const range = findRevealRange(host, item("Buy milk today"));
    expect(range?.toString()).toBe("Buy milk today");
  });

  it("matches a quote whose whitespace does not match the rendering", () => {
    const host = mount("<li>Book the passport appointment</li>");
    expect(findRevealRange(host, item("Book the\n  passport appointment"))?.toString()).toBe(
      "Book the passport appointment",
    );
  });

  it("picks the duplicate the prefix names", () => {
    const host = mount("<ul><li>Call the plumber</li><li>Call the plumber</li></ul>");
    const range = findRevealRange(host, item("Call the plumber", { prefix: "Call the plumber " }));
    const chosen = range?.startContainer.parentElement;
    expect(chosen).toBe(host.querySelectorAll("li")[1]);
  });

  it("answers null for text the document does not contain", () => {
    const host = mount("<p>Buy milk</p>");
    expect(findRevealRange(host, item("Sell milk"))).toBeNull();
  });

  it("answers null for an empty quote rather than ranging over nothing", () => {
    const host = mount("<p>Buy milk</p>");
    expect(findRevealRange(host, item("   "))).toBeNull();
  });
});

describe("scrollRangeIntoView", () => {
  /**
   * jsdom has no layout, so geometry is stated rather than measured — which is
   * the only way to assert the arithmetic at all. What is being pinned is the
   * *policy*: a visible match is left alone, and a match off screen is parked a
   * third of the way down rather than at the very top.
   */
  function geometry(
    container: HTMLElement,
    { top, height, scrollTop }: { top: number; height: number; scrollTop: number },
    rangeTop: number,
  ): Range {
    container.getBoundingClientRect = () => ({ top, height }) as DOMRect;
    Object.defineProperty(container, "clientHeight", { value: height, configurable: true });
    container.scrollTop = scrollTop;
    const range = document.createRange();
    range.getBoundingClientRect = () => ({ top: rangeTop, height: 20 }) as DOMRect;
    return range;
  }

  it("leaves a match that is already on screen exactly where it is", () => {
    const container = mount("<div></div>").firstElementChild as HTMLElement;
    const range = geometry(container, { top: 100, height: 600, scrollTop: 320 }, 400);
    scrollRangeIntoView(container, range);
    expect(container.scrollTop).toBe(320);
  });

  it("brings a match below the fold to a third of the way down", () => {
    const container = mount("<div></div>").firstElementChild as HTMLElement;
    const range = geometry(container, { top: 100, height: 600, scrollTop: 0 }, 900);
    scrollRangeIntoView(container, range);
    // 800 below the container's top, less a 200px (600/3) margin.
    expect(container.scrollTop).toBe(600);
  });

  it("scrolls back up for a match above the fold", () => {
    const container = mount("<div></div>").firstElementChild as HTMLElement;
    const range = geometry(container, { top: 100, height: 600, scrollTop: 500 }, -300);
    scrollRangeIntoView(container, range);
    expect(container.scrollTop).toBe(500 - 400 - 200);
  });
});

describe("flashRange", () => {
  it("draws a box per client rectangle and takes them all away on its own", () => {
    vi.useFakeTimers();
    const host = mount("<p>Buy milk</p>");
    const range = document.createRange();
    range.getClientRects = () =>
      [
        { top: 10, left: 20, width: 100, height: 18 },
        { top: 28, left: 20, width: 60, height: 18 },
      ] as unknown as DOMRectList;
    flashRange(range, document.body);

    const layer = document.querySelector("[data-reveal-flash]");
    expect(layer).toBeTruthy();
    expect(layer?.querySelectorAll(".reveal-flash")).toHaveLength(2);
    const first = layer?.querySelector<HTMLElement>(".reveal-flash");
    expect(first?.style.top).toBe("10px");
    expect(first?.style.width).toBe("100px");
    // Decoration only: it must never eat a click meant for the text under it.
    expect(layer?.getAttribute("aria-hidden")).toBe("true");

    vi.advanceTimersByTime(REVEAL_FLASH_MS);
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
    expect(host.isConnected).toBe(true);
  });

  it("hands back an undo that removes the flash early", () => {
    vi.useFakeTimers();
    mount("<p>Buy milk</p>");
    const range = document.createRange();
    range.getClientRects = () =>
      [{ top: 1, left: 1, width: 10, height: 10 }] as unknown as DOMRectList;
    const undo = flashRange(range, document.body);
    undo();
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
    // And the timer that would have removed it is harmless afterwards.
    vi.advanceTimersByTime(REVEAL_FLASH_MS);
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
  });
});

describe("revealItem", () => {
  it("flashes the match and reports that it found it", () => {
    vi.useFakeTimers();
    const container = mount("<div class='reader-scroll'><p>Buy milk</p></div>")
      .firstElementChild as HTMLElement;
    const undo = revealItem(container, item("Buy milk"));
    expect(undo).not.toBeNull();
    expect(document.querySelector("[data-reveal-flash]")).toBeTruthy();
    undo?.();
  });

  it("reports a miss rather than flashing something arbitrary", () => {
    const container = mount("<div class='reader-scroll'><p>Buy milk</p></div>")
      .firstElementChild as HTMLElement;
    expect(revealItem(container, item("Call the plumber"))).toBeNull();
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
  });
});
