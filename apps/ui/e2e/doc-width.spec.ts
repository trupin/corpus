import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-163 in a real browser: a column's body fills the column, and full screen
 * keeps its own width (SPEC.md §10's rider, signed 2026-08-23, replacing the
 * body-width rider of 2026-08-04).
 *
 * > *"In a column the body is as wide as the column: the column's own edge is
 * > the single gesture, and the body follows it with no second act. … Full
 * > screen is the other case, and it keeps its control. … It is sticky in the
 * > browser-local set, it survives navigation and reload, and it is unrelated
 * > to any column's width — neither follows the other. Full screen's default is
 * > wider than a default column."*
 *
 * Only a browser can testify to any of it. A column's default body width is now
 * the column's own width — a real number in a view document — while full
 * screen's is `66ch`, font-dependent, so the "wider by default" comparison
 * cannot be read off two stylesheets: both sides are measured here. The margin
 * cascade is measured geometry too: `marginLayout.ts` reads live rects, so "the
 * card is still beside its highlight after a resize" is a claim about a
 * `ResizeObserver` firing on a real reflow, which jsdom cannot have.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
  // Wide enough that a capped body would leave a visible gutter, and well
  // inside `MAX_COLUMN_WIDTH`. Before the rider a column this size drew 517px
  // of prose and ~380px of nothing — the defect the rider deletes.
  extra: { width: 900 },
};

/** The same view at the shipped default width, for the "wider by default" claim. */
const DEFAULT_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** A second column, so a thread can be opened as the document it is. */
const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 2,
  query: { type: "thread" },
  extra: { width: 900 },
};

/**
 * A body with the two constructs that motivated the original report — a wide
 * table and a long fenced line — plus prose long enough to reflow when the room
 * moves. The anchor is on a phrase in the first paragraph, so the margin card
 * has a highlight to sit beside.
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

const STORAGE_KEY = "corpus.docWidth";

async function openNote(page: Page, rows: readonly StubRow[] = [VIEW, NOTE, THREAD]) {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  // "Open here" — the column's own reader, at the column's own width. A plain
  // click opens a 440px path column (UI-149, rider 3), which is a different
  // room than the one each test names.
  await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
  await page.locator('[role="menuitem"][data-act="open-here"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  return corpus;
}

/** The rendered width of the first match, to the pixel. */
async function widthOf(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
}

/**
 * The room the column gives its reader: `.reader-scroll`'s content box — or,
 * with the margin up, the body's own grid track, which is what is left of that
 * box after the margin column's 300px and the 30px gap.
 */
async function columnRoom(page: Page): Promise<number> {
  return page.locator(".reader .reader-scroll").evaluate((element) => {
    const style = getComputedStyle(element);
    const content =
      element.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    return element.classList.contains("with-margin") ? content - 300 - 30 : content;
  });
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

test.describe("the document body, in a column", () => {
  test("fills the column's content box, and carries no width handle", async ({ page }) => {
    await openNote(page);

    // The column is the one width there is: the body's box is the room's box.
    const room = await columnRoom(page);
    expect(Math.abs((await widthOf(page, `.reader ${BODY}`)) - room)).toBeLessThan(1.5);
    // …and so is everything measured with it — the title above the body, and
    // the panels below it, line up at the same edge.
    expect(Math.abs((await widthOf(page, ".reader .title-grow")) - room)).toBeLessThan(1.5);
    expect(await widthOf(page, ".col.reading")).toBe(900);

    // No second gesture exists: nothing inside the column sizes text
    // independently of the column.
    await expect(page.locator(`.reader ${HANDLE}`)).toHaveCount(0);
    await expect(page.locator(".reader .doc-width-rail")).toHaveCount(0);
  });

  test("follows the column's edge in the same gesture, with no second act", async ({ page }) => {
    await openNote(page);
    const before = await columnRoom(page);
    expect(Math.abs((await widthOf(page, `.reader ${BODY}`)) - before)).toBeLessThan(1.5);

    // Drag the column's own edge — the single gesture the rider names.
    const resizer = page.locator(".col.reading .col-resizer");
    const box = await resizer.boundingBox();
    if (box === null) throw new Error("the column resizer has no box");
    await page.mouse.move(box.x + 3, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 - 120, box.y + 40, { steps: 8 });

    // Mid-drag, button still down: the text is already at the moved edge.
    await expect
      .poll(async () => {
        const room = await columnRoom(page);
        return Math.abs((await widthOf(page, `.reader ${BODY}`)) - room);
      })
      .toBeLessThan(1.5);
    expect(await columnRoom(page)).toBeLessThan(before - 100);

    await page.mouse.up();
    const after = await columnRoom(page);
    expect(after).toBeLessThan(before - 100);
    expect(Math.abs((await widthOf(page, `.reader ${BODY}`)) - after)).toBeLessThan(1.5);
    // The prose, the table's cap and the fence all moved with it.
    expect(await widthOf(page, `.reader ${BODY} pre`)).toBeLessThanOrEqual(after + 1);
    expect(await widthOf(page, `.reader ${BODY} table`)).toBeLessThanOrEqual(after + 1);
  });

  test("fills the column at the column's own minimum", async ({ page }) => {
    await openNote(page, [{ ...VIEW, extra: { width: 240 } }, NOTE, THREAD]);
    await expect(page.locator(".col.reading")).toHaveCSS("width", "240px");
    const room = await columnRoom(page);
    expect(room).toBeGreaterThan(150);
    expect(Math.abs((await widthOf(page, `.reader ${BODY}`)) - room)).toBeLessThan(1.5);
  });

  /**
   * The margin case: with anchored threads in the margin the body fills the
   * room **left by** the margin — the `minmax(0, 1fr)` track of the
   * `.reader-scroll.with-margin` grid, not the whole box and not less.
   *
   * **The class is applied by hand here, and that is stated rather than
   * hidden.** Margin mode in a column requires `.doc-main` to measure at least
   * `MARGIN_MIN_WIDTH` (1100px), and `MAX_COLUMN_WIDTH` is 960 — no gesture in
   * the app reaches the state today. The stylesheet keeps the rule because the
   * seam is real (`useAnchorLayer` toggles this exact class), so what is worth
   * pinning is the geometry the stylesheet answers when it fires: the body's
   * track is what the body fills.
   */
  test("fills the track the margin leaves, when the margin grid is up", async ({ page }) => {
    await openNote(page);
    await page.locator(".reader .reader-scroll").evaluate((element) => {
      element.classList.add("with-margin");
    });
    // One atomic read: the class is still up, and the body's box is the track's.
    const geometry = await page.locator(".reader .reader-scroll").evaluate((element) => {
      const style = getComputedStyle(element);
      const content =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const body = element.querySelector(".doc-body:not(.turn-markdown)");
      return {
        withMargin: element.classList.contains("with-margin"),
        track: content - 300 - 30,
        body: body?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(geometry.withMargin).toBe(true);
    expect(geometry.track).toBeGreaterThan(320);
    expect(Math.abs(geometry.body - geometry.track)).toBeLessThan(1.5);
  });

  /**
   * The width control does not stop the reader scrolling — the class of defect
   * UI-066 nearly shipped, kept pinned across the rider because the reveal
   * machinery it protects is unchanged. The control now lives in full screen
   * alone, so that is where it is on screen here.
   */
  test("full screen's control does not stop the reader scrolling to a revealed line", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW, LONG_NOTE, LONG_THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_long"]').click({ button: "right" });
    await page.locator('[role="menuitem"][data-act="open-here"]').click();
    await page.locator(".reader .ProseMirror").waitFor();
    await page.locator('.reader[data-reader-doc="doc_long"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await page.locator(`.focus ${BODY}`).waitFor();
    // The control is on screen: this test is about what it does to its neighbour.
    await expect(page.locator(`.focus ${HANDLE}`)).toHaveCount(1);

    const scrollTop = async (): Promise<number> =>
      page.locator(".focus .focus-scroll").evaluate((element) => element.scrollTop);
    expect(await scrollTop()).toBe(0);

    await page.locator(".focus .comments-btn").click();
    await page.locator('.focus [data-reveal-thread="th_long"]').click();
    await expect(page.locator(".focus .ProseMirror")).toBeVisible();

    await expect.poll(scrollTop).toBeGreaterThan(0);
    // …and the anchored line is on screen, not merely somewhere below it.
    await expect(page.locator('.focus .anchor-hl[data-thread="th_long"]')).toBeInViewport();
  });
});

test.describe("the document body's width, in full screen", () => {
  test("keeps its control, and the chosen width survives reopening and a reload", async ({
    page,
  }) => {
    await openNote(page);
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await page.locator(`.focus ${BODY}`).waitFor();

    const before = await widthOf(page, `.focus ${BODY}`);
    await dragBy(page, `.focus ${HANDLE}`, 100);
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBeGreaterThan(Math.round(before) + 150);
    const chosen = Math.round(await widthOf(page, `.focus ${BODY}`));

    // Close and reopen: one sticky value, not a per-visit one.
    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    await expect.poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`))).toBe(chosen);

    // …and a reload does not shake it loose.
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    await expect.poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`))).toBe(chosen);
  });

  /** *"…and the control is operable from the keyboard like every other affordance."* */
  test("moves from the keyboard, without a pointer anywhere near it", async ({ page }) => {
    await openNote(page);
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    const before = await widthOf(page, `.focus ${BODY}`);

    await page.locator(`.focus ${HANDLE}`).focus();
    for (let press = 0; press < 6; press += 1) await page.keyboard.press("ArrowRight");

    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(Math.round(before) + 6 * 16);

    for (let press = 0; press < 3; press += 1) await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(Math.round(before) + 3 * 16);

    // The control reports what the body actually measures — ARIA requires the
    // value, and a commit is one of the moments it is read.
    await expect(page.locator(`.focus ${HANDLE}`)).toHaveAttribute(
      "aria-valuenow",
      String(Math.round(before) + 3 * 16),
    );
  });

  /**
   * The independence criterion, both directions, in real geometry: *"A column's
   * width and full screen's width are unrelated: changing either leaves the
   * other exactly as it was."*
   */
  test("is unrelated to any column's width, in both directions", async ({ page }) => {
    await openNote(page);
    const columnBody = Math.round(await widthOf(page, `.reader ${BODY}`));

    // Direction one: drag full screen's handle. The column does not move.
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    const focusBefore = await widthOf(page, `.focus ${BODY}`);
    await page.locator(`.focus ${HANDLE}`).focus();
    for (let press = 0; press < 5; press += 1) await page.keyboard.press("ArrowRight");
    const focusChosen = Math.round(focusBefore) + 5 * 16;
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(focusChosen);

    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);
    expect(Math.round(await widthOf(page, `.reader ${BODY}`))).toBe(columnBody);
    await expect(page.locator(".col.reading")).toHaveCSS("width", "900px");

    // Direction two: drag the column's edge. Full screen does not move.
    const resizer = page.locator(".col.reading .col-resizer");
    const box = await resizer.boundingBox();
    if (box === null) throw new Error("the column resizer has no box");
    await page.mouse.move(box.x + 3, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 3 - 150, box.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.round(await widthOf(page, `.reader ${BODY}`)))
      .toBeLessThan(columnBody - 100);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(focusChosen);
  });

  /**
   * *"Full screen's default is wider than a default column, because full screen
   * is where a document is read at length."* Neither side is a stylesheet
   * constant any more — a column's default body is the column's 336px less its
   * padding, full screen's is `66ch` of a font only this browser knows — so the
   * comparison is measured, not inferred.
   */
  test("opens wider by default than a default column's body", async ({ page }) => {
    await openNote(page, [DEFAULT_VIEW, NOTE, THREAD]);
    await expect(page.locator(".col.reading")).toHaveCSS("width", "336px");
    const inColumn = await widthOf(page, `.reader ${BODY}`);
    expect(Math.abs(inColumn - (await columnRoom(page)))).toBeLessThan(1.5);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    const inFocus = await widthOf(page, `.focus ${BODY}`);
    expect(inFocus).toBeGreaterThan(inColumn);
    // 66ch of the shipped serif: font-dependent, so the pin is a band, not a
    // number — and the band sits entirely above any default column.
    expect(inFocus).toBeGreaterThan(450);
    expect(inFocus).toBeLessThan(780);
  });

  /** It is a reading posture, not corpus state: nothing reaches the server. */
  test("writes nothing to the corpus", async ({ page }) => {
    const corpus = await openNote(page);
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();

    await page.locator(`.focus ${HANDLE}`).focus();
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBeGreaterThan(0);
    expect(await corpus.of("PUT")).toHaveLength(0);
    // …and the column's own width is untouched: the two are different gestures.
    await page.keyboard.press("Escape");
    await expect(page.locator(".col.reading")).toHaveCSS("width", "900px");
  });

  /**
   * A blob from before the rider still holds per-column entries. The focus key
   * inside it is honoured — a user who set a full-screen width keeps it — the
   * column keys move nothing, and the first new choice prunes them.
   */
  test("honours a legacy blob's focus width, ignores its column keys, and prunes them", async ({
    page,
  }) => {
    await page.addInitScript(
      (blob) => {
        window.localStorage.setItem("corpus.docWidth", blob);
      },
      JSON.stringify({
        version: 1,
        surfaces: { "col:doc_view_inbox": 780, focus: 600, "col:doc_view_threads": 520 },
      }),
    );
    await openNote(page);

    // The column key names this very column, and the body ignores it: the
    // column's room is the only width.
    const room = await columnRoom(page);
    expect(Math.abs((await widthOf(page, `.reader ${BODY}`)) - room)).toBeLessThan(1.5);
    expect(Math.round(room)).not.toBe(780);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await page.locator(`.focus ${BODY}`).waitFor();
    await expect.poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`))).toBe(600);

    await page.locator(`.focus ${HANDLE}`).focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
      .toBe(JSON.stringify({ version: 1, surfaces: { focus: 616 } }));
  });

  /**
   * A thread **is** a document (SPEC.md §5), so one opened full screen resizes
   * like any other — the clarification the user made unprompted on 2026-08-06,
   * now living where the control lives.
   */
  /**
   * **The handle is at the body's right edge, for both kinds of body** — the
   * claim `.doc-width-rail` exists to make, and the one nothing asserted.
   *
   * The rail is an empty box carrying the same `max-width` and the same type the
   * body carries, so that its edge *is* the body's edge rather than a number
   * somebody kept in step. `FocusMode.css` asks those declarations to stay in
   * step; this is what makes the request enforceable, because the two bodies do
   * not share a type: a document's is `var(--serif)` and a conversation's is
   * `Reader.css`'s `var(--sans)`, and `66ch` is 685.94px in the one against
   * 605.65px in the other (measured, 1280×720). A rail that assumed serif drew
   * the handle 40px inside a conversation's right edge — over the last
   * characters of a line, which the rail's own note says must never happen — and
   * started a drag 40px short, so the first press narrowed the body by that much.
   *
   * The handle hangs entirely outside the measure (`right: -12px; width: 12px`),
   * so its **left** edge is the body's right edge, and that is what is compared.
   */
  for (const kind of ["a document", "a conversation"] as const) {
    test(`puts the handle at the right edge of ${kind}`, async ({ page }) => {
      await stubCorpus(page, [VIEW, THREADS_VIEW, NOTE, THREAD]);
      await page.goto("/");
      await page.locator(".board").waitFor();
      const row = kind === "a document" ? "doc_note" : "th_1";
      const column = kind === "a document" ? "doc_view_inbox" : "doc_view_threads";
      await page
        .locator(`.col[data-col="${column}"] .row[data-row-doc="${row}"]`)
        .click({ button: "right" });
      await page.locator('[role="menuitem"][data-act="open-here"]').click();
      await page.locator(`.reader[data-reader-doc="${row}"] [data-expand]`).click();
      await page.locator(`.focus ${BODY}`).waitFor();

      const edges = await page.locator(".focus").evaluate((focus, body: string) => {
        const measured = focus.querySelector(body);
        const handle = focus.querySelector('[role="separator"][aria-label="Document width"]');
        if (measured === null || handle === null) return null;
        return {
          bodyRight: Math.round(measured.getBoundingClientRect().right * 10) / 10,
          handleLeft: Math.round(handle.getBoundingClientRect().left * 10) / 10,
        };
      }, BODY);
      if (edges === null) throw new Error("no body or no handle");

      expect(
        Math.abs(edges.handleLeft - edges.bodyRight),
        `the handle is at ${String(edges.handleLeft)} and the body ends at ${String(edges.bodyRight)}`,
      ).toBeLessThan(1.5);
    });
  }

  test("resizes a thread opened as a document too", async ({ page }) => {
    await stubCorpus(page, [VIEW, THREADS_VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page
      .locator('.col[data-col="doc_view_threads"] .row[data-row-doc="th_1"]')
      .click({ button: "right" });
    await page.locator('[role="menuitem"][data-act="open-here"]').click();
    const reader = page.locator('.reader[data-reader-doc="th_1"]');
    await expect(reader).toHaveCount(1);
    await reader.locator(".thread-conversation").waitFor();
    // In the column: no handle, the conversation fills the column like any body.
    await expect(reader.locator(HANDLE)).toHaveCount(0);

    await page.locator('.reader[data-reader-doc="th_1"] [data-expand]').click();
    await page.locator(".focus .thread-conversation").waitFor();
    const before = await widthOf(page, `.focus ${BODY}`);
    await page.locator(`.focus ${HANDLE}`).focus();
    for (let press = 0; press < 8; press += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.round(await widthOf(page, `.focus ${BODY}`)))
      .toBe(Math.round(before) + 8 * 16);
  });

  /**
   * SHARED-057 says nothing resizes because of what it holds; a person dragging
   * an edge is the exception it names, and everything measured off the body is
   * moving on purpose. Anchored placement is measured off the body
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
