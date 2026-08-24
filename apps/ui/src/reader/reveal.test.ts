/** @vitest-environment jsdom */
import type { RevealItem } from "@corpus/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseOccurrence,
  collapse,
  findRevealRange,
  flashRange,
  indexText,
  REVEAL_FLASH_MS,
  REVEAL_QUIET_FRAMES,
  REVEAL_WAIT_MS,
  revealItem,
  revealMissNotice,
  revealPatience,
  REVEAL_SETTLED_ATTRIBUTE,
  scrollRangeIntoView,
  surfaceSettled,
  surfaceText,
  type RevealLook,
  type RevealSurface,
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
   * The real-app drill of PLUGINS-010, in a unit test.
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

/**
 * UI-140. The old ladder retried five times 80 ms apart and then spent the
 * navigation instruction whether or not anything had been drawn — so a cold
 * open whose body took longer than ~320 ms to render opened the document at the
 * top, drew nothing, and forgot what it was for. Measured at 2.5% of opens.
 *
 * What is pinned here is the replacement's one claim: **it never concludes
 * "absent" from a surface that has told it nothing.**
 */
describe("revealPatience", () => {
  /** A surface still arriving: it has words on it, but no verdict about itself. */
  function pending(text: string): RevealSurface {
    return { text, settled: false };
  }

  /** A surface that says it has arrived at what it is showing. */
  function arrived(text: string): RevealSurface {
    return { text, settled: true };
  }

  /** Feeds `looks` at the same surface, one notional frame apart. */
  function feed(
    patience: ReturnType<typeof revealPatience>,
    surface: RevealSurface,
    looks: number,
    from = 0,
  ): RevealLook {
    let last = patience(surface, from);
    for (let index = 1; index < looks; index += 1) last = patience(surface, from + index * 16);
    return last;
  }

  it("keeps looking, past any millisecond budget, while the surface has not moved", () => {
    const patience = revealPatience();
    // Far more looks than the old five, and the surface has said nothing: this
    // is the `Loading…` gap, and it is "not there yet", not "not there".
    const verdict = feed(patience, pending("Loading…"), 100);
    expect(verdict.giveUp).toBeNull();
  });

  it("searches only on the looks where the surface changed", () => {
    const patience = revealPatience();
    expect(patience(pending("Loading…"), 0).search).toBe(true);
    expect(patience(pending("Loading…"), 16).search).toBe(false);
    expect(patience(arrived("Buy milk"), 32).search).toBe(true);
    expect(patience(arrived("Buy milk"), 48).search).toBe(false);
  });

  it("searches again when a surface answers without its text changing", () => {
    const patience = revealPatience();
    // The conversation list answering "none at all" is the case: the same empty
    // reading either side of the one moment that makes it conclusive.
    expect(patience(pending(""), 0).search).toBe(true);
    expect(patience(pending(""), 16).search).toBe(false);
    expect(patience(arrived(""), 32).search).toBe(true);
  });

  it("accepts the words are absent once the surface has arrived and gone quiet", () => {
    const patience = revealPatience();
    patience(pending("Loading…"), 0);
    // The body lands. From here the surface has moved once and is still.
    expect(patience(arrived("Sell bread"), 16).giveUp).toBeNull();
    for (let frame = 1; frame < REVEAL_QUIET_FRAMES; frame += 1) {
      expect(patience(arrived("Sell bread"), 16 + frame * 16).giveUp).toBeNull();
    }
    expect(patience(arrived("Sell bread"), 16 + REVEAL_QUIET_FRAMES * 16).giveUp).toBe("absent");
  });

  /**
   * The warm open, and the defect this half of the mechanism was added for (PR
   * #54 review). A cached document renders its body in the same commit that
   * gives the reader content, so the reveal's *first* look is at a finished
   * surface that will never change again. Concluding arrival from movement
   * alone, `absent` is unreachable here: the reveal could only run out the
   * ceiling and then report a document that loaded perfectly as one that failed
   * to load, in the tone kept for faults.
   */
  it("concludes absence from a first look at a surface that says it has arrived", () => {
    const patience = revealPatience();
    // No `Loading…` before it, and nothing after it: one state, forever.
    for (let frame = 0; frame <= REVEAL_QUIET_FRAMES; frame += 1) {
      const verdict = patience(arrived("Sell bread"), frame * 16);
      // Well inside the ceiling — the point is that it never gets there.
      expect(frame * 16).toBeLessThan(REVEAL_WAIT_MS);
      if (frame < REVEAL_QUIET_FRAMES) expect(verdict.giveUp).toBeNull();
      else expect(verdict.giveUp).toBe("absent");
    }
  });

  it("does not conclude absence from a still surface that has said nothing", () => {
    const patience = revealPatience();
    // The same shape as the warm open above, minus the one claim that makes it
    // conclusive: this must reach the ceiling rather than the verdict.
    const verdict = feed(patience, pending("Loading…"), REVEAL_QUIET_FRAMES * 3);
    expect(verdict.giveUp).toBeNull();
  });

  it("starts the quiet count again every time the surface moves", () => {
    const patience = revealPatience();
    patience(pending("Loading…"), 0);
    patience(arrived("half a body"), 16);
    // One frame short of the verdict, and then the renderer moves again.
    for (let frame = 1; frame < REVEAL_QUIET_FRAMES; frame += 1) {
      expect(patience(arrived("half a body"), 16 + frame * 16).giveUp).toBeNull();
    }
    expect(patience(arrived("a whole body"), 1_000).giveUp).toBeNull();
    expect(
      feed(patience, arrived("a whole body"), REVEAL_QUIET_FRAMES - 1, 1_016).giveUp,
    ).toBeNull();
  });

  it("stops at the ceiling when the surface never settles", () => {
    const patience = revealPatience();
    // A surface that changes on every look never goes quiet, so only the
    // ceiling can end it — and it must.
    for (let frame = 0; frame * 16 < REVEAL_WAIT_MS; frame += 1) {
      expect(patience(pending(`frame ${String(frame)}`), frame * 16).giveUp).toBeNull();
    }
    expect(patience(pending("frame last"), REVEAL_WAIT_MS).giveUp).toBe("unresolved");
  });

  it("waits far longer than the 320 ms budget it replaces", () => {
    // The measured worst gap between the reader's placeholder and its rendered
    // body, on a laptop running eight browsers, was 1733 ms.
    expect(REVEAL_WAIT_MS).toBeGreaterThan(1_733);
  });
});

describe("surfaceText", () => {
  it("reads the whole container, not one renderer's markup", () => {
    const host = mount("<div><p>Buy <strong>milk</strong></p><li>Sell bread</li></div>");
    expect(surfaceText(host.firstElementChild as HTMLElement)).toBe("Buy milkSell bread");
  });
});

/**
 * The surface's other answer (PR #54 review): whether it has finished arriving.
 * Declared by the renderer, and never inferred — a renderer that says nothing is
 * still arriving, which costs a reveal patience and never costs it a wrong
 * verdict.
 */
describe("surfaceSettled", () => {
  it("is false for a surface that has not said anything", () => {
    const host = mount('<div class="scroll"><p>Loading…</p></div>');
    expect(surfaceSettled(host.firstElementChild as HTMLElement)).toBe(false);
  });

  it("is true when the renderer marks what it has arrived at", () => {
    const host = mount(
      `<div class="scroll"><div ${REVEAL_SETTLED_ATTRIBUTE}><p>Buy milk</p></div></div>`,
    );
    expect(surfaceSettled(host.firstElementChild as HTMLElement)).toBe(true);
  });

  it("is true when the container is itself what arrived", () => {
    const host = mount(`<div ${REVEAL_SETTLED_ATTRIBUTE}><p>Buy milk</p></div>`);
    expect(surfaceSettled(host.firstElementChild as HTMLElement)).toBe(true);
  });
});

/** Giving up is not silent (UI-140): the reader is told which quote was lost. */
describe("revealMissNotice", () => {
  const target: RevealItem = { kind: "item", exact: "Book the passport appointment" };

  it("names the quote, and calls a document that moved on information", () => {
    const notice = revealMissNotice(target, "absent");
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Book the passport appointment");
    expect(notice.message).toContain("no longer on this document");
  });

  it("calls a document that never rendered a fault", () => {
    const notice = revealMissNotice(target, "unresolved");
    expect(notice.tone).toBe("error");
    expect(notice.message).toContain("did not finish loading");
  });

  /**
   * UI-144: a deleted document is a third fact, not the nearest of two. The
   * quote did not move — there is nowhere for it to have moved from.
   */
  it("says the document was deleted rather than that the quote moved", () => {
    const notice = revealMissNotice(target, "gone");
    expect(notice.tone).toBe("info");
    expect(notice.message).toContain("Book the passport appointment");
    expect(notice.message).toContain("this document was deleted");
    expect(notice.message).not.toContain("no longer on this document");
    expect(notice.message).not.toContain("did not finish loading");
  });

  it("cuts a quote too long to be a toast, and marks the cut", () => {
    const long = "x".repeat(200);
    const message = revealMissNotice({ kind: "item", exact: long }, "absent").message;
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(100);
  });

  it("collapses a quote captured with the file's line breaks in it", () => {
    const notice = revealMissNotice({ kind: "item", exact: "Buy\n  milk" }, "absent");
    expect(notice.message).toContain("Buy milk");
  });

  /**
   * A conversation's id is a key, not a name, so quoting it back would tell the
   * reader nothing they could act on. It is named by what it is instead.
   */
  it("names a conversation without misquoting its id", () => {
    const absent = revealMissNotice({ kind: "thread", threadId: "th_1" }, "absent");
    expect(absent.tone).toBe("info");
    expect(absent.message).toBe("That conversation is no longer on this document.");
    expect(absent.message).not.toContain("th_1");

    const unresolved = revealMissNotice({ kind: "thread", threadId: "th_1" }, "unresolved");
    expect(unresolved.tone).toBe("error");
    expect(unresolved.message).toContain("that conversation");
  });
});
