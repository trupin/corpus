import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-066 in a real browser: the document body's width is the reader's to
 * choose (SPEC.md §10's rider, signed 2026-08-04).
 *
 * > *"The document body has a comfortable default width, and the reader can
 * > change it — in column view and in full screen — with the width persisting
 * > across navigation and reload… Widening applies to the whole body uniformly,
 * > prose included. Anchored thread placement follows the body when it moves,
 * > and the control is operable from the keyboard like every other affordance."*
 *
 * Only a browser can testify to any of it. The default measure is `62ch`, and
 * `ch` is font-dependent, so the number this suite asserts a *change* against is
 * whatever the machine's serif makes of it — every assertion here is therefore
 * relative to a width the page has just been asked for, never to a constant.
 * The margin cascade is measured geometry too: `marginLayout.ts` reads live
 * rects, so "the card is still beside its highlight after a resize" is a claim
 * about a `ResizeObserver` firing on a real reflow, which jsdom cannot have.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
  // Wide enough that the body has gutter to be dragged into, and well inside
  // `MAX_COLUMN_WIDTH`. The point of the issue is that a column this size used
  // to draw 517px of prose and ~380px of nothing.
  extra: { width: 900 },
};

/** A second column, so a thread can be opened as the document it is. */
const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 2,
  query: { type: "thread" },
  // Wide, for the same reason the inbox is: the point is the gutter a
  // conversation opened as a document has, and a default column has none.
  extra: { width: 900 },
};

/**
 * A body with the two constructs that motivated the report — a wide table and a
 * long fenced line — plus prose long enough to reflow when the measure moves.
 * The anchor is on a phrase in the first paragraph, so the margin card has a
 * highlight to sit beside.
 */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: [
    "Short memo about lender spreads and the shape of the yield curve, written",
    "long enough that the paragraph reflows whenever the reading measure moves.",
    "",
    "| Lender | Product | Rate | Fee | Notes |",
    "| --- | --- | --- | --- | --- |",
    "| Alpha | 5y fix | 6.1% | 999 | early repayment charge applies |",
    "",
    "```txt",
    "a-very-long-token-that-has-nowhere-to-break-and-therefore-tests-the-measure",
    "```",
    "",
  ].join("\n"),
  anchors: [
    {
      anchorId: "anc_1",
      threadId: "th_1",
      exact: "lender spreads",
      prefix: "Short memo about ",
      suffix: " and the shape",
    },
  ],
};

const THREAD: StubRow = {
  id: "th_1",
  type: "thread",
  title: 'Re: "lender spreads"',
  path: "data/docs/threads/th_1.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhich lenders?\n",
  parent: "doc_note",
};

/**
 * A document long enough that its anchor is below the fold — the fixture for
 * the scroll regression below.
 */
const LONG_NOTE: StubRow = {
  id: "doc_long",
  title: "The long memo",
  body: [
    ...Array.from(
      { length: 40 },
      (_, index) =>
        `Paragraph ${String(index + 1)} of filler, here to put the anchored line a long way below the fold.\n`,
    ),
    "The buried sentence nobody can see without scrolling to it.",
    "",
  ].join("\n"),
  anchors: [
    {
      anchorId: "anc_long",
      threadId: "th_long",
      exact: "buried sentence",
      prefix: "The ",
      suffix: " nobody can see",
    },
  ],
};

const LONG_THREAD: StubRow = {
  id: "th_long",
  type: "thread",
  title: 'Re: "buried sentence"',
  path: "data/docs/threads/th_long.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhere is it?\n",
  parent: "doc_long",
};

const HANDLE = '[role="separator"][aria-label="Document width"]';

/**
 * The measured body, and not a `.doc-body` nested inside it.
 *
 * A rendered turn is a `.doc-body.turn-markdown`, so a conversation on the page
 * puts a second one in the tree — capped by the card it sits in, which is the
 * point: an anchored conversation follows the document rather than taking a
 * width of its own.
 */
const BODY = ".doc-body:not(.turn-markdown)";

async function openNote(page: Page): Promise<void> {
  await stubCorpus(page, [VIEW, NOTE, THREAD]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
}

/** The rendered width of the first match, to the pixel. */
async function widthOf(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
}

/** Drags the handle by `dx`, the way a pointer does. */
async function dragBy(page: Page, selector: string, dx: number): Promise<void> {
  const handle = page.locator(selector);
  const box = await handle.boundingBox();
  if (box === null) throw new Error("the width handle has no box");
  const y = box.y + Math.min(box.height / 2, 120);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx / 2, y);
  await page.mouse.move(box.x + box.width / 2 + dx, y);
  await page.mouse.up();
}

test.describe("the document body's width, in a column", () => {
  test("starts at the shipped measure, with the handle at the body's own edge", async ({
    page,
  }) => {
    await openNote(page);

    const body = await widthOf(page, `.reader ${BODY}`);
    // 62ch of the shipped serif. Font-dependent, so the claim is a band, not a
    // number: `columnWidth.ts` records ~495px (Palatino) to ~601px (Georgia).
    expect(body).toBeGreaterThan(450);
    expect(body).toBeLessThan(650);
    // …and well inside a 900px column, which is the gutter the report is about.
    expect(await widthOf(page, ".col.reading")).toBe(900);

    // The handle sits at the body's right edge and entirely outside it, so it
    // can never swallow a click meant for the last character of a line.
    const edges = await page.evaluate((bodySelector) => {
      const measured = document.querySelector(`.reader ${bodySelector}`);
      const handle = document.querySelector('.reader [aria-label="Document width"]');
      if (measured === null || handle === null) return null;
      return {
        body: measured.getBoundingClientRect().right,
        handleLeft: handle.getBoundingClientRect().left,
        handleWidth: handle.getBoundingClientRect().width,
      };
    }, BODY);
    expect(edges).not.toBeNull();
    expect(Math.abs((edges?.body ?? 0) - (edges?.handleLeft ?? 0))).toBeLessThan(2);
    expect(edges?.handleWidth).toBeGreaterThan(0);
  });

  test("follows a pointer drag, and everything measured widens with it", async ({ page }) => {
    await openNote(page);
    const before = await widthOf(page, `.reader ${BODY}`);

    await dragBy(page, `.reader ${HANDLE}`, 220);

    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBeGreaterThan(Math.round(before) + 180);

    const after = await widthOf(page, `.reader ${BODY}`);
    // *"Widening applies to the whole body uniformly, prose included"* — the
    // paragraph, the table and the fence all use the width, and the panels
    // below the body line up with them.
    const paragraph = await widthOf(page, `.reader ${BODY} p`);
    const fence = await widthOf(page, `.reader ${BODY} pre`);
    expect(paragraph).toBeGreaterThan(before + 180);
    expect(fence).toBeGreaterThan(before + 180);
    // The title carries the same measure — it is the one element above the body
    // that does, and at the default it is wider than the body because `ch`
    // resolves against its own 24px serif. Once a width is chosen there is no
    // `ch` left to disagree about, and the two edges line up.
    expect(Math.abs((await widthOf(page, ".reader .title-grow")) - after)).toBeLessThan(2);
    // The table is free to be narrower than the measure — it is sized by its
    // cells — but it must not be *capped* below it any more.
    expect(await widthOf(page, `.reader ${BODY} table`)).toBeLessThanOrEqual(after + 1);
  });

  /** *"…and the control is operable from the keyboard like every other affordance."* */
  test("moves from the keyboard, without a pointer anywhere near it", async ({ page }) => {
    await openNote(page);
    const before = await widthOf(page, `.reader ${BODY}`);

    await page.locator(`.reader ${HANDLE}`).focus();
    for (let press = 0; press < 6; press += 1) await page.keyboard.press("ArrowRight");

    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(Math.round(before) + 6 * 16);

    for (let press = 0; press < 3; press += 1) await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(Math.round(before) + 3 * 16);

    // The control reports what the body actually measures. It is a `separator`
    // with a `tabindex`, so ARIA requires the value — and a value nobody keeps
    // true is worse than the box it describes. The number is not observed
    // continuously (see `DocWidthContext`); it is read at the moments it is
    // used, and a commit is one of them.
    await expect(page.locator(`.reader ${HANDLE}`)).toHaveAttribute(
      "aria-valuenow",
      String(Math.round(before) + 3 * 16),
    );
  });

  test("survives navigation to another document, and a reload", async ({ page }) => {
    await openNote(page);
    const before = await widthOf(page, `.reader ${BODY}`);
    await dragBy(page, `.reader ${HANDLE}`, 200);
    const chosen = await widthOf(page, `.reader ${BODY}`);
    // The drag has to have done something, or "it survived" is a claim about a
    // default that was never changed.
    expect(chosen).toBeGreaterThan(before + 150);

    // Navigation: §10 asks for a width that persists across it, and navigation
    // is exactly what changes the document — so the width is the reader's.
    await page.locator(".reader .back").click();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(Math.round(chosen));

    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(Math.round(chosen));
  });

  /** It is a reading posture, not corpus state: nothing reaches the server. */
  test("writes nothing to the corpus", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    await page.locator(`.reader ${HANDLE}`).focus();
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBeGreaterThan(0);
    expect(await corpus.of("PUT")).toHaveLength(0);
    // …and the column's own width is untouched: the two are different gestures.
    await expect(page.locator(".col.reading")).toHaveCSS("width", "900px");
  });

  /**
   * The width control does not stop the reader scrolling — the class of defect
   * UI-066 nearly shipped.
   *
   * The first version put a `ResizeObserver` on the rail and called `setState`
   * from a **layout** effect. Nothing about the width was wrong — the body
   * measured correctly at every size — and the reader stopped scrolling: a
   * reveal found its line, drew the flash on it, and left `scrollTop` at 0 with
   * the line 584px below the fold, 20 runs out of 20. A control that changes
   * geometry shares a commit with the machinery that scrolls to a target, and it
   * can undo that scroll without looking wrong itself.
   *
   * **What this test does and does not cover, stated rather than implied.** It
   * reveals through the comments list, which is the `jumpToThread` seam. That
   * seam is *not* the one the defect broke — checked, by restoring the observer
   * and watching this test stay green — and the one that broke is
   * `revealItem`/`trackReveal`, pinned in `reveal.spec.ts`, which caught it
   * 20/20 and is where it stays caught. Reproducing that seam here would mean a
   * second copy of its fixture, and two copies of one seam drift. So this pins
   * the half a width suite can honestly own — the
   * reader still scrolls to what it was asked to show, with the control on
   * screen — and `docWidthControl.test.tsx` pins the rule the defect broke:
   * this control observes nothing and updates no state before paint.
   */
  test("does not stop the reader scrolling to a revealed line", async ({ page }) => {
    await stubCorpus(page, [VIEW, LONG_NOTE, LONG_THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_long"]').click();
    await page.locator(".reader .ProseMirror").waitFor();
    // The control is on screen: this test is about what it does to its neighbour.
    await expect(page.locator(`.reader ${HANDLE}`)).toHaveCount(1);

    const scrollTop = async (): Promise<number> =>
      page.locator(".reader .reader-scroll").evaluate((element) => element.scrollTop);
    expect(await scrollTop()).toBe(0);

    await page.locator(".reader .comments-btn").click();
    await page.locator('.reader [data-reveal-thread="th_long"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    await expect.poll(scrollTop).toBeGreaterThan(0);
    // …and the anchored line is on screen, not merely somewhere below it.
    await expect(page.locator('.reader .anchor-hl[data-thread="th_long"]')).toBeInViewport();
  });

  /**
   * A thread **is** a document (SPEC.md §5), so one opened in a reader resizes
   * like any other — the clarification the user made unprompted on 2026-08-06.
   */
  test("resizes a thread opened as a document too", async ({ page }) => {
    await stubCorpus(page, [VIEW, THREADS_VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.col[data-col="doc_view_threads"] .row[data-row-doc="th_1"]').click();
    const reader = page.locator('.reader[data-reader-doc="th_1"]');
    await expect(reader).toHaveCount(1);
    await reader.locator(".thread-conversation").waitFor();

    const before = await widthOf(page, `.reader[data-reader-doc="th_1"] ${BODY}`);
    await reader.locator(HANDLE).focus();
    for (let press = 0; press < 8; press += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader[data-reader-doc="th_1"] ${BODY}`)))
      .toBe(Math.round(before) + 8 * 16);
  });
});

test.describe("the document body's width, in full screen", () => {
  test("has its own width, and the column keeps its own", async ({ page }) => {
    await openNote(page);
    const inColumn = await widthOf(page, `.reader ${BODY}`);

    await page.locator(`.reader ${HANDLE}`).focus();
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowRight");
    const columnChosen = Math.round(inColumn) + 4 * 16;
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(columnChosen);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await page.locator(`.focus ${BODY}`).waitFor();

    // Focus mode opens at *its* default, not at the column's chosen width: a
    // full viewport and a 900px column are not the same room.
    const inFocus = await widthOf(page, `.focus ${BODY}`);
    expect(Math.round(inFocus)).not.toBe(columnChosen);

    await page.locator(`.focus ${HANDLE}`).focus();
    for (let press = 0; press < 10; press += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(Math.round(inFocus) + 10 * 16);

    // …and the column behind it is exactly where it was left.
    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBe(columnChosen);
  });

  /**
   * The acceptance criterion this whole issue was scheduled last for.
   *
   * SHARED-057 says nothing resizes because of what it holds; a person dragging
   * an edge is the exception it names, and everything measured off the body is
   * now moving on purpose. Anchored placement is measured off the body
   * (`anchors/marginLayout.ts` reads live rects), so the card and its connector
   * have to come with it. Nothing in `anchors/` was changed to make this true —
   * the `ResizeObserver` on `.doc-main` already watched for exactly this.
   */
  test("keeps an anchored margin card beside its highlight across a resize", async ({ page }) => {
    await openNote(page);
    await page.locator(".reader .anchor-hl").waitFor();
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();

    const focus = page.locator(".focus.open");
    await expect(focus.locator(".with-margin")).toHaveCount(1);
    const card = focus.locator('.focus-margin > [data-thread-panel="th_1"]');
    await expect(card).toHaveCount(1);

    const offsets = async (): Promise<{ anchorTop: number | null; cardTop: number | null }> =>
      focus.evaluate((root) => {
        const main = root.querySelector(".doc-main");
        const origin = main?.getBoundingClientRect().top ?? 0;
        const anchor = main?.querySelector('.anchor-hl[data-thread="th_1"]') ?? null;
        const placed = root.querySelector('.focus-margin > [data-thread-panel="th_1"]');
        return {
          anchorTop:
            anchor === null ? null : Math.round(anchor.getBoundingClientRect().top - origin),
          cardTop: placed === null ? null : Math.round(placed.getBoundingClientRect().top - origin),
        };
      });

    await expect.poll(async () => (await offsets()).cardTop).toBe((await offsets()).anchorTop);
    const bodyBefore = await widthOf(page, `.focus ${BODY}`);

    await dragBy(page, `.focus ${HANDLE}`, 120);
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBeGreaterThan(Math.round(bodyBefore) + 150);

    // The body moved on purpose, and the conversation came with it — the card's
    // top still equals its highlight's, measured from the same origin.
    await expect.poll(async () => (await offsets()).cardTop).toBe((await offsets()).anchorTop);
    // The card itself did **not** take a width of its own: it follows the
    // document it is anchored to, and the margin column is still 300px.
    expect(Math.round(await widthOf(page, ".focus-margin"))).toBe(300);
    // …and the margin still fits: the drag reserves the card's own column, so
    // widening the body never pushes the conversation off the surface.
    const fits = await page.evaluate(() => {
      const scroll = document.querySelector(".focus-scroll");
      const margin = document.querySelector(".focus-margin");
      if (scroll === null || margin === null) return null;
      const box = scroll.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(scroll).paddingRight);
      return margin.getBoundingClientRect().right <= box.left + scroll.clientWidth - padding + 1;
    });
    expect(fits).toBe(true);
  });
});
