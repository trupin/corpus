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
  // jsdom defines neither, so deleting restores the genuine absence the
  // feature-detection in `reveal.ts` exists for.
  delete (Range.prototype as Partial<Range>).getClientRects;
  delete (Range.prototype as Partial<Range>).getBoundingClientRect;
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

  it("hands back a handle that removes the flash early", () => {
    vi.useFakeTimers();
    mount("<p>Buy milk</p>");
    const range = document.createRange();
    range.getClientRects = () =>
      [{ top: 1, left: 1, width: 10, height: 10 }] as unknown as DOMRectList;
    const flash = flashRange(range, document.body);
    flash.stop();
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
    // And the timer that would have removed it is harmless afterwards.
    vi.advanceTimersByTime(REVEAL_FLASH_MS);
    expect(document.querySelector("[data-reveal-flash]")).toBeNull();
    // A gone flash reports as gone, which is what stops the tracking loop.
    expect(flash.follow()).toBe(false);
  });

  /**
   * `follow` re-measures rather than redraws. The fade is a CSS animation on
   * the box, so replacing the element each frame would restart it and the
   * highlight would never fade — the boxes have to be the same elements,
   * moved.
   */
  it("moves the same boxes onto the range's new rectangles", () => {
    vi.useFakeTimers();
    mount("<p>Buy milk</p>");
    let top = 580;
    const range = document.createRange();
    range.getClientRects = () =>
      [{ top, left: 20, width: 100, height: 18 }] as unknown as DOMRectList;

    const flash = flashRange(range, document.body);
    const box = document.querySelector<HTMLElement>(".reveal-flash");
    expect(box?.style.top).toBe("580px");

    top = 527;
    expect(flash.follow()).toBe(true);
    expect(box?.style.top).toBe("527px");
    expect(document.querySelectorAll(".reveal-flash")).toHaveLength(1);
    // The very same element: a new one would start the fade again.
    expect(document.querySelector(".reveal-flash")).toBe(box);
    flash.stop();
  });

  it("leaves the boxes where they are when the geometry goes away", () => {
    vi.useFakeTimers();
    mount("<p>Buy milk</p>");
    let rects = [{ top: 40, left: 4, width: 90, height: 18 }];
    const range = document.createRange();
    range.getClientRects = () => rects as unknown as DOMRectList;

    const flash = flashRange(range, document.body);
    rects = [];
    expect(flash.follow()).toBe(true);
    // Frozen, not vanished: a renderer that swapped the text nodes under the
    // flash should not make the highlight disappear mid-fade.
    expect(document.querySelector<HTMLElement>(".reveal-flash")?.style.top).toBe("40px");
    flash.stop();
  });
});

describe("revealItem", () => {
  /**
   * jsdom has no layout, so the geometry a real browser would measure is
   * stated: `Range` gets the rectangles the test wants, and the container gets
   * a viewport. Removed again in `afterEach` — jsdom defines neither method, so
   * deleting restores the real absence the rest of the suite relies on.
   */
  function stageLayout(container: HTMLElement, rectTop: () => number): void {
    Range.prototype.getClientRects = () =>
      [{ top: rectTop(), left: 20, width: 120, height: 18 }] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => ({ top: rectTop(), height: 18 }) as DOMRect;
    container.getBoundingClientRect = () => ({ top: 0, height: 600 }) as DOMRect;
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
  }

  async function frames(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }

  /**
   * PLUGINS-010's drill, in a unit test.
   *
   * A reveal fires as soon as the document has content, and the document is not
   * finished laying out then: on a cold open the next frame is where the chips
   * row un-wraps and the editor re-flows, lifting the body ~50 px. The box was
   * drawn once, so it stayed at the old coordinates and the user saw the
   * highlight one or two lines below the line they had clicked.
   */
  it("keeps the flash on its line when the layout settles a frame later", async () => {
    const container = mount("<div class='reader-scroll'><p>Buy milk</p></div>")
      .firstElementChild as HTMLElement;
    let top = 580;
    stageLayout(container, () => top);

    const undo = revealItem(container, item("Buy milk"));
    const box = document.querySelector<HTMLElement>(".reveal-flash");
    expect(box?.style.top).toBe("580px");

    top = 527;
    await frames(2);

    expect(box?.style.top).toBe("527px");
    // The same element throughout: the fade must not restart every frame.
    expect(document.querySelector(".reveal-flash")).toBe(box);
    undo?.();
  });

  it("stops following once the flash has been taken away", async () => {
    const container = mount("<div class='reader-scroll'><p>Buy milk</p></div>")
      .firstElementChild as HTMLElement;
    let top = 580;
    stageLayout(container, () => top);

    const undo = revealItem(container, item("Buy milk"));
    undo?.();
    top = 100;
    await frames(2);
    expect(document.querySelector(".reveal-flash")).toBeNull();
  });

  /**
   * The rule scroll restoration already follows, for the same reason: once the
   * reader has moved on its own, the surface never touches it again. Tracking
   * the *boxes* continues either way — a highlight left behind while its text
   * scrolls away is the same defect in a different frame.
   */
  it("stops re-aiming the scroll the moment the reader is moved by hand", async () => {
    const container = mount("<div class='reader-scroll'><p>Buy milk</p></div>")
      .firstElementChild as HTMLElement;
    stageLayout(container, () => 900);

    const undo = revealItem(container, item("Buy milk"));
    // 900 below the container's top, less the 200 px (600/3) parking margin.
    expect(container.scrollTop).toBe(700);

    container.scrollTop = 120;
    await frames(3);
    expect(container.scrollTop).toBe(120);
    undo?.();
  });

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
