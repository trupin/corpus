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
  pinned: true,
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

/** One animation frame's worth of the geometry a reader can see. */
interface Frame {
  /** `.doc-body`'s viewport position and measure. */
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
        frames.push({
          top: round(box.top),
          left: round(box.left),
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
