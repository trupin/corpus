import type { ViewQuery } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-038 in a real browser: the column header's chips and its sort label share
 * one row at every column width.
 *
 * This one has to be a real browser — the whole rule is "does this text fit
 * beside those chips", which is a question only a layout engine answers, and
 * the reported failure was a wrap, which jsdom cannot have. The narrowing is a
 * real pointer drag on the column's own resize handle, so what is asserted is
 * the state a user produces; the widening back is the proof that the
 * degradation is reversible rather than sticky.
 *
 * The measured numbers behind the widths chosen here (Chromium, 11px mono):
 * `type=thread&status=open` needs 308.3 px for its two chips and
 * "last activity ↓"; `type=todo` needs 190.6 px. A 336 px column — the board's
 * default — offers 306 px, which is exactly why the two-chip column is the one
 * that was reported wrapping.
 */

const VIEW_ID = "doc_view_threads";

function view(width: number, query: ViewQuery = {}): StubRow {
  return {
    id: VIEW_ID,
    type: "view",
    title: "Conversations",
    path: "data/docs/views/threads.md",
    order: 1,
    // Two chips and the default `-updated` sort: "last activity ↓".
    query: Object.keys(query).length === 0 ? { type: "thread", status: "open" } : query,
    extra: { width },
  };
}

const NOTE = { id: "doc_note", title: "Mortgage options", body: "6.4% this week." };

/** The column, its chips row, and the label under test (never the copy). */
function head(page: Page): {
  column: Locator;
  chips: Locator;
  chip: Locator;
  sort: Locator;
} {
  const column = page.locator(".col[data-col]");
  return {
    column,
    chips: column.locator(".chips"),
    chip: column.locator(".chips > .chip"),
    sort: column.locator(".chips > .sort"),
  };
}

/** Drags the column's right edge by `dx`, the way a user resizes a column. */
async function dragEdge(page: Page, dx: number): Promise<void> {
  const handle = page.getByRole("separator", { name: "Resize Conversations" });
  const box = await handle.boundingBox();
  if (box === null) throw new Error("the resize handle has no box");
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

/** One row: the label shares the last chip's band, and starts after it ends. */
async function assertOneRow(page: Page): Promise<void> {
  const { chips, chip, sort } = head(page);
  const rowBox = await chips.boundingBox();
  const sortBox = await sort.boundingBox();
  const chipBox = await chip.last().boundingBox();
  if (rowBox === null || sortBox === null || chipBox === null) {
    throw new Error("the chips row has no box");
  }

  // A wrapped row is two chip bands tall. This one is one label tall.
  expect(rowBox.height).toBeLessThan(sortBox.height * 2);
  expect(chipBox.y).toBeLessThan(sortBox.y + sortBox.height);
  expect(sortBox.y).toBeLessThan(chipBox.y + chipBox.height);
  // No overlap: the label starts where the last chip ends, or after it (half a
  // pixel of slack for a fractional layout, not for an overlap).
  expect(sortBox.x).toBeGreaterThanOrEqual(chipBox.x + chipBox.width - 0.5);
  // Whole, inside the row: the direction glyph is never what gets cut. Past the
  // width where even the short label fits, the chips are what the row clips.
  expect(sortBox.x + sortBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
}

test.describe("column header", () => {
  test("keeps the chips and the sort label on one row, narrow and wide", async ({ page }) => {
    await stubCorpus(page, [view(400), NOTE]);
    await page.goto("/");

    const { column, chips, sort } = head(page);
    await expect(column).toHaveCSS("width", "400px");
    await expect(sort).toHaveText("last activity ↓");
    await assertOneRow(page);
    const wideRow = await chips.boundingBox();

    // Narrow the column to its floor (240 px) with a real drag.
    await dragEdge(page, -400);
    await expect(column).toHaveCSS("width", "240px");

    // The label degrades to exactly the form the user asked for, glyph kept.
    await expect(sort).toHaveText("last ↓");
    await expect(sort).toHaveAttribute("data-sort-compact", "");
    await assertOneRow(page);

    // Still one line: the row is no taller than it was at 400 px.
    const narrowRow = await chips.boundingBox();
    expect(narrowRow?.height).toBeCloseTo(wideRow?.height ?? 0, 0);
  });

  test("restores the full label when the width comes back", async ({ page }) => {
    await stubCorpus(page, [view(240), NOTE]);
    await page.goto("/");

    const { column, sort } = head(page);
    await expect(sort).toHaveText("last ↓");

    await dragEdge(page, 400);
    await expect(column).toHaveCSS("width", "640px");
    await expect(sort).toHaveText("last activity ↓");
    await expect(sort).not.toHaveAttribute("data-sort-compact", "");
    await assertOneRow(page);

    // And degrades again, so nothing about it is one-way.
    await dragEdge(page, -400);
    await expect(sort).toHaveText("last ↓");
  });

  test("degrades nothing while the label fits, however narrow the column", async ({ page }) => {
    // One short chip: at the same 240 px the two-chip column degrades at, this
    // one has room to spare. The rule is fit, not the column's width.
    await stubCorpus(page, [view(240, { type: "todo" }), { ...NOTE, type: "todo" }]);
    await page.goto("/");

    const { column, sort } = head(page);
    await expect(column).toHaveCSS("width", "240px");
    await expect(sort).toHaveText("last activity ↓");
    await assertOneRow(page);
  });

  test("measures against a copy nobody can see or read", async ({ page }) => {
    await stubCorpus(page, [view(240), NOTE]);
    await page.goto("/");

    const probe = page.locator(".col[data-col] .chips-probe");
    await expect(probe).toHaveCount(1);
    await expect(probe).toBeHidden();
    await expect(probe).toHaveCSS("position", "absolute");
    // Out of flow and at its intrinsic width: it is what the row is measured
    // against, so it must never be the thing that shrinks. In this column it is
    // wider than the row it sits in — which is the whole reason it is there.
    const widths = await page.evaluate(() => {
      const row = document.querySelector(".chips");
      const copy = document.querySelector(".chips-probe");
      return {
        row: row?.getBoundingClientRect().width ?? 0,
        copy: copy?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(widths.copy).toBeGreaterThan(widths.row);

    // Nothing visible on the board still shows the full label.
    await expect(page.getByText("last activity ↓").filter({ visible: true })).toHaveCount(0);
    await expect(head(page).sort).toHaveText("last ↓");
  });
});
