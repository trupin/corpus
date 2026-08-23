import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-146: a document does not move after it has been painted.
 *
 * Opening a reader widens its column (`board/columnWidth.ts`, UI-113), and
 * `Column.css` used to ease that width over 0.25s. That was free while the
 * reader was a fixed stack. It stopped being free when `.fm-form` began
 * rendering at all times (UI-093): the form's grid is
 * `repeat(auto-fit, minmax(min(16ch, 100%), 1fr))`, so its row count follows
 * the column's width by design (SHARED-061) — and the body paints *inside* the
 * animation, so the form collapsed 3 rows → 2 → 1 while a person was looking at
 * the text under it.
 *
 * Measured per animation frame on this note, from the body's first painted
 * frame to its last:
 *
 * ```
 * t=221  colW=336    bodyTop=444.5  bodyW=306    closing=990.4  formH=161.4
 * t=241  colW=403.8  bodyTop=422.3  bodyW=373.8  closing=919.6  formH=146.9
 * t=253  colW=466.4  bodyTop=361.3  bodyW=436.4  closing=858.7  formH=106.2
 * t=303  colW=523.3  bodyTop=346.8  bodyW=493.3  closing=722.7  formH=91.7
 * ```
 *
 * The body rose 97.7px, its measure grew 211.2px, and its closing paragraph
 * travelled 267.7px — all of it after the reader was on screen. §10's own
 * justification for SHARED-057 is that a box which changes size pushes whatever
 * is stacked against it, and this is that, at a scale a person reads through.
 *
 * The three tests below are the three ways it reached a person. The first is
 * the plain open. The second is the same open with the document already in the
 * query cache — a second column, or a reopen — where even a column that jumps
 * instantly used to paint one frame at the old width before the width effect
 * ran. The third is the one that made this P0: a right-click landing inside the
 * animation window made Chromium scroll `.reader-scroll` 103px to keep the
 * caret in view, moving the document a quarter of the viewport at the instant
 * the person opened a context menu on a specific word.
 *
 * **No pixel constant is asserted here.** Every assertion is "the same as the
 * first painted frame", which is the claim a reader actually makes, and it
 * holds at any column width, any font and any viewport.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const SECOND_VIEW: StubRow = { ...VIEW, id: "doc_view_second", title: "Second", order: 2 };

/** Long enough to wrap differently at a narrow width, and taller than the reader. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Lender checklist",
  path: "data/docs/inbox/doc_note.md",
  body: [
    "A first paragraph long enough to wrap several times in a narrow column and",
    "fewer times once the column has taken its reading width.",
    "",
    "A second paragraph with a specific sentence in it that a person would want to",
    "right-click, which is the gesture this file exists for.",
    "",
    "A third paragraph, so the body is taller than the reader and the scroller has",
    "somewhere to go if something decides to move it.",
    "",
    "A fourth paragraph, so the body is taller than the reader and the scroller has",
    "somewhere to go if something decides to move it.",
    "",
    "A fifth paragraph, so the body is taller than the reader and the scroller has",
    "somewhere to go if something decides to move it.",
    "",
    "A sixth paragraph, so the body is taller than the reader and the scroller has",
    "somewhere to go if something decides to move it.",
    "",
    "The closing paragraph, which is this file's interior sentinel.",
    "",
  ].join("\n"),
};

/**
 * A conversation, for the half of this claim a document body cannot make
 * (UI-136 finding 2).
 *
 * It was filed as *"a reader column resolves its width asynchronously — 345px at
 * first paint and 558px settled"*, measured by UI-129 on a **thread** reader and
 * worked around in `image-geometry.spec.ts` with a settle helper. The width half
 * of that is gone: UI-146 stopped the column animating open and UI-149 removed
 * the reader-open widening altogether, so a column renders at its chosen width
 * whether it is reading or not. Measured after both, sampling the reader's
 * `.doc-main` every animation frame for 4s from before the row was clicked, the
 * width is one value from its first frame — 410px in a path column, 306px opened
 * in a 336px query column, for a note and for a conversation alike.
 *
 * A conversation is a different renderer over a different tree (`.doc-body` is
 * `.thread-conversation` here, and its paragraphs are turns), so the three tests
 * above could all pass while a thread reader still moved. This is the fixture
 * that closes that gap.
 */
const THREAD: StubRow = {
  id: "th_convo",
  type: "thread",
  title: "About the checklist",
  path: "data/docs/inbox/th_convo.md",
  body: Array.from(
    { length: 8 },
    (_unused, index) =>
      `## ${index % 2 === 0 ? "user" : "agent"} · 2026-07-01T09:0${String(index)}:00Z\n\n` +
      `Turn ${String(index)}, long enough to wrap several times in a narrow column and ` +
      "fewer times once the column has taken its reading width.\n",
  ).join("\n"),
};

/** One animation frame's worth of the geometry a reader can see. */
interface Frame {
  /**
   * `.doc-body`'s position and measure. `top` and `closing` are viewport
   * coordinates; `left` is **relative to the hosting column card**, because
   * since UI-149 (rider 3) opening a document snap-scrolls the board to bring
   * the new path column into view — deliberate, user-visible navigation, not
   * the content-driven reflow this suite exists to forbid. Movement *inside*
   * the column still fails: the body's offset within its card never changes.
   */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  /** The last paragraph's top — the body's *interior*, which reflow moves most. */
  readonly closing: number;
  /** What the reader is scrolled to. Chromium moves this on its own. */
  readonly scrollTop: number;
}

/**
 * Records `.doc-body`'s geometry on every animation frame for `ms`, starting
 * from the frame it first exists in.
 *
 * A settle helper answers "has it stopped?", which a spec can wait out. This
 * answers "did it ever move?", which it cannot — and that is the claim: the
 * first frame a person could have read is the frame every later one matches.
 */
async function sampleFrames(page: Page, ms: number): Promise<void> {
  await page.evaluate((duration) => {
    const frames: Frame[] = [];
    (window as unknown as { __openFrames: Frame[] }).__openFrames = frames;
    const start = performance.now();
    const round = (value: number): number => Math.round(value * 10) / 10;
    const tick = (): void => {
      const now = performance.now();
      const body = document.querySelector(".reader .doc-body");
      const paragraphs = document.querySelectorAll(".reader .doc-body p");
      const scroller = document.querySelector(".reader .reader-scroll");
      const last = paragraphs[paragraphs.length - 1];
      if (body !== null && last !== undefined) {
        const box = body.getBoundingClientRect();
        const host = body.closest(".col");
        const hostLeft = host === null ? 0 : host.getBoundingClientRect().left;
        frames.push({
          top: round(box.top),
          left: round(box.left - hostLeft),
          width: round(box.width),
          closing: round(last.getBoundingClientRect().top),
          scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : -1,
        });
      }
      if (now - start < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function recordedFrames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => (window as unknown as { __openFrames: Frame[] }).__openFrames);
}

/**
 * Every frame equals the first one.
 *
 * Reported as the distinct frames rather than as a count, so a failure names
 * what moved and by how much instead of only that something did.
 */
function assertNothingMoved(frames: Frame[]): void {
  expect(frames.length, "the sampler saw no painted body at all").toBeGreaterThan(2);
  const first = frames[0];
  const distinct = frames.filter((frame, index) => {
    const previous = index === 0 ? undefined : frames[index - 1];
    return previous === undefined || JSON.stringify(frame) !== JSON.stringify(previous);
  });
  expect(
    distinct,
    `the body moved after its first painted frame: ${JSON.stringify(distinct)}`,
  ).toEqual([first]);
}

/**
 * Every frame's **measure** equals the first frame's — where the body starts and
 * how wide it is.
 *
 * The weaker half of {@link assertNothingMoved}, and it is the right claim for a
 * conversation rather than a document. A thread's turns render into the body
 * after it exists, so its height and the position of its last paragraph go on
 * changing for a few frames — content arriving, which SPEC.md §10 permits and
 * which is what `settle.ts` legitimately waits for. What §10 forbids, and what
 * UI-136 finding 2 reported, is the *box* changing: a column whose width lands
 * after everything laid out against it. That is what this asserts, from the
 * first frame the body was painted in.
 */
function assertMeasureNeverMoved(frames: Frame[]): void {
  expect(frames.length, "the sampler saw no painted body at all").toBeGreaterThan(2);
  const first = frames[0];
  if (first === undefined) throw new Error("no frames");
  const measure = ({ left, width }: Frame): Record<string, number> => ({ left, width });
  const distinct = frames
    .map(measure)
    .filter(
      (frame, index, all) =>
        index === 0 || JSON.stringify(frame) !== JSON.stringify(all[index - 1]),
    );
  expect(
    distinct,
    `the reader's measure changed after its first painted frame: ${JSON.stringify(distinct)}`,
  ).toEqual([measure(first)]);
}

test.describe("a document does not move once it is painted", () => {
  test("the body's every frame is the frame it was first painted in", async ({ page }) => {
    await stubCorpus(page, [VIEW, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    // Sampling starts *before* the click, so the first recorded frame is the
    // first frame the body existed in — there is no window to be measured after.
    await sampleFrames(page, 1500);
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .doc-body").waitFor();
    await page.waitForTimeout(1600);

    assertNothingMoved(await recordedFrames(page));
  });

  test("and again when the document is already in the cache", async ({ page }) => {
    await stubCorpus(page, [VIEW, SECOND_VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(".col[data-col]")).toHaveCount(2);

    // Read it once in the first column, so the second column's reader has its
    // body to paint in the very commit it mounts in. That is the case a width
    // decided after the paint cannot cover.
    await page.locator('.col[data-col="doc_view_inbox"] .row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .doc-body").waitFor();
    await page.locator(".reader .back").first().click();
    await expect(page.locator(".reader")).toHaveCount(0);

    await sampleFrames(page, 1200);
    await page.locator('.col[data-col="doc_view_second"] .row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .doc-body").waitFor();
    await page.waitForTimeout(1300);

    assertNothingMoved(await recordedFrames(page));
  });

  test("a right-click the instant it opens scrolls nothing", async ({ page }) => {
    await stubCorpus(page, [VIEW, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    // No settle between these steps, deliberately: the whole defect lived in
    // the ~250ms a person can act inside, and waiting it out is what hid it.
    await sampleFrames(page, 3000);
    await page.locator('.row[data-row-doc="doc_note"]').click();
    const sentence = page.locator(".reader .doc-body p", { hasText: "right-click" }).first();
    // The menu opens on a selection (`useSelectionContextMenu`), so the gesture
    // is the reported one: select the sentence, then right-click it.
    await sentence.click({ clickCount: 3 });
    const before = await readerPosition(page);
    await sentence.click({ button: "right" });
    await expect(page.locator("[data-ctx-menu]")).toBeVisible();
    const after = await readerPosition(page);

    expect(after, "the document moved under the context menu").toEqual(before);

    // And the whole gesture, frame by frame: neither the reader's scroll nor
    // the body's position may have moved at any point between the row click and
    // the menu. The pause is only so the sampler has frames on both sides of the
    // menu opening — it is not a settle, and the frames before it are the ones
    // that carried the defect.
    await page.waitForTimeout(300);
    assertNothingMoved(await recordedFrames(page));
  });

  /**
   * The same box, one renderer over — see {@link THREAD}.
   * `.thread-conversation` *is* the `.doc-body` the sampler reads, so nothing
   * here needs a second apparatus; what it needs is the other renderer under it.
   *
   * {@link assertMeasureNeverMoved} rather than {@link assertNothingMoved},
   * and the difference is the finding. Measured here, a conversation's first two
   * distinct frames are
   *
   *     {top: 346.7, left: 15, width: 410, closing: 346.7}
   *     {top: 348.7, left: 15, width: 410, closing: 1032.4}
   *
   * — the turns arriving under a body that was already 410px wide and already
   * 15px inside its card. The measure never moves, which is the claim UI-136
   * finding 2 said could not be made; the interior does, which is content
   * landing and is the one thing `settle.ts` is still for.
   */
  test("a conversation's measure is the measure it was first painted with", async ({ page }) => {
    await stubCorpus(page, [VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await sampleFrames(page, 1500);
    await page.locator('.row[data-row-doc="th_convo"]').click();
    await page.locator(".reader .thread-conversation .turn").first().waitFor();
    await page.waitForTimeout(1600);

    assertMeasureNeverMoved(await recordedFrames(page));
  });
});

/** Where the document sits, and where the reader is scrolled to. */
async function readerPosition(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const body = document.querySelector(".reader .doc-body");
    const scroller = document.querySelector(".reader .reader-scroll");
    const round = (value: number): number => Math.round(value * 10) / 10;
    const box = body?.getBoundingClientRect();
    return {
      top: round(box?.top ?? -1),
      width: round(box?.width ?? -1),
      scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : -1,
    };
  });
}
