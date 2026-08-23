import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-151 — SPEC.md §10, rider 4: **the column strip**.
 *
 * "Above the board, one tab per column, in board order, grouped exactly as the
 * board groups them … a tab for a column off screen is dimmed. Clicking a tab
 * scrolls the board to that column and makes it the active one … A path tab
 * closes its column and everything after it."
 *
 * The board seeded here is **wider than the viewport on purpose**: eight
 * columns at 336px do not fit in 1280, so columns genuinely leave the screen
 * and the dimming rule is exercised rather than asserted against a board that
 * never scrolled. A fixture that fits would let every one of these pass with no
 * observer wired at all.
 */

const VIEW_TITLES = [
  "Inbox",
  "Attention",
  "Threads",
  "Finance",
  "House",
  "Health",
  "Travel",
  "Archive shelf",
] as const;

const VIEWS: readonly StubRow[] = VIEW_TITLES.map((title, index) => ({
  id: `doc_view_${String(index)}`,
  type: "view",
  title,
  path: `data/docs/views/v${String(index)}.md`,
  query: { folder: "inbox" },
}));

const NOTE_A: StubRow = {
  id: "doc_alpha",
  title: "Mortgage options",
  path: "data/docs/inbox/alpha.md",
  body: "Start from [[doc_beta]] before deciding.",
};
const NOTE_B: StubRow = {
  id: "doc_beta",
  title: "Rate table",
  path: "data/docs/inbox/beta.md",
  body: "Fifteen years.",
};

const CORPUS = [...VIEWS, NOTE_A, NOTE_B];

const KEYS = VIEWS.map((view) => view.id);

const tabs = (page: Page) => page.locator(".colbar .ctab");
const tab = (page: Page, key: string) => page.locator(`.colbar .ctab[data-col="${key}"]`);

async function openBoard(page: Page): Promise<void> {
  await stubCorpus(page, CORPUS);
  await page.goto("/");
  await expect(tabs(page)).toHaveCount(8);
}

/** How far the board is scrolled, in px. */
const scrollLeft = (page: Page): Promise<number> =>
  page.locator(".board").evaluate((node) => node.scrollLeft);

test.describe("the column strip (rider 4)", () => {
  test("lists one tab per column, in board order, naming each view", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await openBoard(page);

    expect(
      await tabs(page).evaluateAll((nodes) => nodes.map((node) => node.dataset["col"])),
    ).toEqual([...KEYS]);
    await expect(page.locator(".colbar .ctab .ct")).toHaveText([...VIEW_TITLES]);
    // A query column has no ✕: only a path closes from the strip.
    await expect(page.locator(".colbar .ctab .cx")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  /**
   * The dimming rule, measured against a board that really does leave columns
   * off screen — and in both directions, so the observer is proved to withdraw
   * a verdict as well as to grant one.
   */
  test("dims the tabs of columns that are off screen, and follows the board as it scrolls", async ({
    page,
  }) => {
    await openBoard(page);

    // Where the board rests with the first column showing. It is not `0`: the
    // scroller's own left padding is inside the snap the first column takes.
    const home = await scrollLeft(page);
    const first = tab(page, KEYS[0] as string);
    const last = tab(page, KEYS[7] as string);

    // The eighth column is genuinely past the right edge — the fixture's whole
    // point. If this ever stops holding, the rest of this test proves nothing.
    const offScreen = await page
      .locator(`.col[data-col="${KEYS[7] as string}"]`)
      .evaluate((node) => {
        const board = node.closest(".board") as HTMLElement;
        return node.getBoundingClientRect().left >= board.getBoundingClientRect().right;
      });
    expect(offScreen, "the fixture must be wider than the viewport").toBe(true);

    await expect(first).toHaveClass(/\bseen\b/);
    await expect(last).not.toHaveClass(/\bseen\b/);

    // Scrolled to the far end: the verdicts swap.
    await page.locator(".board").evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect(last).toHaveClass(/\bseen\b/);
    await expect(first).not.toHaveClass(/\bseen\b/);

    // Clicking the first tab brings the board home and flips the set back.
    await first.locator(".ctab-go").click();
    await expect.poll(() => scrollLeft(page)).toBe(home);
    await expect(first).toHaveClass(/\bseen\b/);
    await expect(last).not.toHaveClass(/\bseen\b/);
    // …and that column is now the active one.
    await expect(first).toHaveClass(/\bon\b/);
    await expect(page.locator(`.col[data-col="${KEYS[0] as string}"]`)).toHaveClass(/\bkactive\b/);
  });

  test("scrolls a far column into view when its tab is clicked", async ({ page }) => {
    await openBoard(page);
    const home = await scrollLeft(page);

    await tab(page, KEYS[7] as string)
      .locator(".ctab-go")
      .click();

    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(home);
    await expect(tab(page, KEYS[7] as string)).toHaveClass(/\bseen\b/);
    await expect(tab(page, KEYS[7] as string)).toHaveClass(/\bon\b/);
  });

  /** Rider 4: "the keyboard's column movement follows the strip". */
  test("moves the outline with ← and →", async ({ page }) => {
    await openBoard(page);
    await tab(page, KEYS[0] as string)
      .locator(".ctab-go")
      .click();
    await expect(tab(page, KEYS[0] as string)).toHaveClass(/\bon\b/);

    await page.keyboard.press("ArrowRight");
    await expect(tab(page, KEYS[1] as string)).toHaveClass(/\bon\b/);
    await expect(tab(page, KEYS[0] as string)).not.toHaveClass(/\bon\b/);

    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, KEYS[0] as string)).toHaveClass(/\bon\b/);
  });

  /**
   * "The active tab … is itself kept in view inside the strip." Proved on a
   * strip that genuinely overflows: eight titles no 1280px bar has room for, so
   * walking to the last column has to scroll the strip or the outline lands
   * somewhere the user cannot see.
   */
  test("keeps the active tab in view inside the strip as the keyboard walks", async ({ page }) => {
    await stubCorpus(
      page,
      VIEW_TITLES.map((title, index) => ({
        id: `doc_view_${String(index)}`,
        type: "view",
        title: `${title} — everything we said about it this quarter`,
        path: `data/docs/views/v${String(index)}.md`,
        query: { folder: "inbox" },
      })),
    );
    await page.goto("/");
    await expect(tabs(page)).toHaveCount(8);

    const strip = page.locator(".colbar");
    // The strip must really overflow, or this test proves nothing.
    expect(
      await strip.evaluate((node) => node.scrollWidth > node.clientWidth),
      "the strip must be wider than the room it has",
    ).toBe(true);
    expect(await strip.evaluate((node) => node.scrollLeft)).toBe(0);
    // …and each title gives way rather than widening its tab.
    expect(
      await page
        .locator(".colbar .ctab .ct")
        .first()
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);

    await tab(page, KEYS[0] as string)
      .locator(".ctab-go")
      .click();
    for (let step = 0; step < 7; step += 1) await page.keyboard.press("ArrowRight");

    await expect(tab(page, KEYS[7] as string)).toHaveClass(/\bon\b/);
    await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  });

  /**
   * A path's tabs sit in the band its columns sit in, labelled with the path's
   * origin — and the ✕ closes that column **and everything after it**, which is
   * UI-149's `closeCol` reached from the strip.
   */
  test("groups a path's tabs and closes from a path tab", async ({ page }) => {
    await openBoard(page);

    await page
      .locator(`.col[data-col="${KEYS[0] as string}"] .row[data-row-doc="doc_alpha"]`)
      .click();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
    // Follow the body ref so the path is two columns long.
    await page.locator('.pcol .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();

    const group = page.locator(".colbar .cgroup");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".cfrom")).toContainText("Inbox");
    await expect(group.locator(".ctab .ct")).toHaveText(["Mortgage options", "Rate table"]);
    // The band sits between the origin column's tab and the next one.
    expect(
      await tabs(page).evaluateAll((nodes) => nodes.map((node) => node.dataset["col"])),
    ).toEqual([KEYS[0], "path:1:0", "path:1:1", ...KEYS.slice(1)]);

    // ✕ on the first path tab takes the whole path with it.
    const pathTab = tab(page, "path:1:0");
    await pathTab.hover();
    await pathTab.locator(".cx").click();

    await expect(page.locator(".colbar .cgroup")).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(8);
    await expect(page.locator(".pcol")).toHaveCount(0);
  });

  test("closes only the columns after the one whose ✕ was clicked", async ({ page }) => {
    await openBoard(page);

    await page
      .locator(`.col[data-col="${KEYS[0] as string}"] .row[data-row-doc="doc_alpha"]`)
      .click();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
    await page.locator('.pcol .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(page.locator(".colbar .cgroup .ctab")).toHaveCount(2);

    const second = tab(page, "path:1:1");
    await second.hover();
    await second.locator(".cx").click();

    await expect(page.locator(".colbar .cgroup .ctab")).toHaveCount(1);
    await expect(page.locator(".colbar .cgroup .ctab .ct")).toHaveText(["Mortgage options"]);
    await expect(tabs(page)).toHaveCount(9);
  });

  /**
   * **The strip is chrome** (SPEC.md §10 — "nothing resizes because of what it
   * holds"). Three measurements, no pixel constant: the strip is the same
   * height with a path band in it as without one, the board below starts at the
   * same place, and a title too long for a tab truncates in place instead of
   * widening it — with the whole title on the tooltip, §10's
   * reveal-rather-than-accommodate rule.
   */
  test("holds its height and the board's place whatever it holds", async ({ page }) => {
    await openBoard(page);

    const before = await page.evaluate(() => ({
      strip: document.querySelector(".colbar")?.getBoundingClientRect().height ?? 0,
      board: document.querySelector(".board")?.getBoundingClientRect().top ?? 0,
    }));
    expect(before.strip).toBeGreaterThan(0);

    await page
      .locator(`.col[data-col="${KEYS[0] as string}"] .row[data-row-doc="doc_alpha"]`)
      .click();
    await expect(page.locator(".colbar .cgroup")).toHaveCount(1);

    const after = await page.evaluate(() => ({
      strip: document.querySelector(".colbar")?.getBoundingClientRect().height ?? 0,
      board: document.querySelector(".board")?.getBoundingClientRect().top ?? 0,
    }));
    expect(after.strip).toBe(before.strip);
    expect(after.board).toBe(before.board);

    // A tab is bounded by the room it gets, and the text is what gives.
    const long = page.locator('.colbar .ctab[data-col="path:1:0"]');
    const width = await long.evaluate((node) => node.getBoundingClientRect().width);
    await page.locator('.pcol .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(page.locator(".colbar .cgroup .ctab")).toHaveCount(2);
    expect(await long.evaluate((node) => node.getBoundingClientRect().width)).toBe(width);
    await expect(long.locator(".ctab-go")).toHaveAttribute("title", "Mortgage options");
  });

  /** Rider 4's edge case: a board with no columns shows no strip at all. */
  test("shows nothing for a board with no columns", async ({ page }) => {
    await stubCorpus(page, [
      {
        id: "doc_board_empty",
        type: "board",
        title: "Empty",
        path: "data/docs/boards/empty.md",
        order: 1,
        columns: [],
        defaultOpen: true,
      },
    ]);
    await page.goto("/");
    await expect(page.locator(".board .board-empty")).toBeVisible();

    await expect(page.locator(".colbar")).toBeHidden();
  });
});
