import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-019 in a real browser: a column's width is a property of its view document
 * (SPEC.md §11), adjusted by dragging its edge.
 *
 * A real pointer drag is the point — jsdom has no layout and no pointer capture
 * — and so is the `PUT` it ends in. That the write reaches disk, is
 * auto-committed and squashes on idle is the issue's real-app drill.
 */

function view(extra: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "doc_view_inbox",
    type: "view",
    title: "Inbox",
    path: "data/docs/views/inbox.md",
    pinned: true,
    order: 1,
    query: { folder: "inbox" },
    extra,
  };
}

const NOTE = { id: "doc_note", title: "Mortgage options", body: "6.4% this week." };

test.describe("column width", () => {
  test("renders the width the view document carries, and the default without one", async ({
    page,
  }) => {
    await stubCorpus(page, [view({ width: 480 }), NOTE]);
    await page.goto("/");
    await expect(page.locator(".col[data-col]")).toHaveCSS("width", "480px");
  });

  test("falls back to the default when the stored width is nonsense", async ({ page }) => {
    await stubCorpus(page, [view({ width: "very wide" }), NOTE]);
    await page.goto("/");
    await expect(page.locator(".col[data-col]")).toHaveCSS("width", "336px");
  });

  test("follows the drag and writes the width once, into the view document", async ({ page }) => {
    const corpus = await stubCorpus(page, [view(), NOTE]);
    await page.goto("/");

    const column = page.locator(".col[data-col]");
    await expect(column).toHaveCSS("width", "336px");

    const handle = page.getByRole("separator", { name: "Resize Inbox" });
    const box = await handle.boundingBox();
    if (box === null) throw new Error("the resize handle has no box");

    const startX = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    // Many moves, one write.
    await page.mouse.move(startX + 40, y);
    await page.mouse.move(startX + 90, y);
    await page.mouse.move(startX + 140, y);
    await page.mouse.up();

    await expect(column).toHaveCSS("width", "476px");
    const writes = await corpus.of("PUT", "/api/docs/doc_view_inbox");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ extra: { width: 476 } });
  });

  test("the merge leaves the view document's other frontmatter alone", async ({ page }) => {
    const corpus = await stubCorpus(page, [view({ mine: "keep me" }), NOTE]);
    await page.goto("/");

    const handle = page.getByRole("separator", { name: "Resize Inbox" });
    await handle.focus();
    await page.keyboard.press("ArrowRight");

    await expect
      .poll(async () => (await corpus.doc("doc_view_inbox"))?.extra)
      .toEqual({
        mine: "keep me",
        width: 352,
      });
    const stored = await corpus.doc("doc_view_inbox");
    expect(stored?.query).toEqual({ folder: "inbox" });
    expect(stored?.pinned).toBe(true);
    expect(stored?.order).toBe(1);
  });

  test("the chosen width survives a reload, from the document and not from storage", async ({
    page,
  }) => {
    await stubCorpus(page, [view({ width: 520 }), NOTE]);
    await page.goto("/");
    await expect(page.locator(".col[data-col]")).toHaveCSS("width", "520px");

    await page.reload();
    await expect(page.locator(".col[data-col]")).toHaveCSS("width", "520px");
  });

  test("opening a document widens the column relative to its chosen base", async ({ page }) => {
    await stubCorpus(page, [view({ width: 300 }), NOTE]);
    await page.goto("/");

    const column = page.locator(".col[data-col]");
    await expect(column).toHaveCSS("width", "300px");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();
    // 300 × (560 / 336) — not a fixed 560.
    await expect(column).toHaveCSS("width", "500px");
  });

  /**
   * UI-023: the widening stops at the reader's content measure. A column
   * dragged to 900 px used to open a reader 900 px wide around a body capped at
   * `62ch` — everything past the measure was dead gutter.
   */
  test("a column wider than the content measure opens the reader at the measure", async ({
    page,
  }) => {
    await stubCorpus(page, [view({ width: 900 }), NOTE]);
    await page.goto("/");

    const column = page.locator(".col[data-col]");
    await expect(column).toHaveCSS("width", "900px");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();
    await expect(column).toHaveCSS("width", "560px");

    // Closing the reader returns the column to the base it carries.
    await page.locator(".col.reading .back").click();
    await expect(column).toHaveCSS("width", "900px");
  });

  test("snap scrolling and the ghost column are unchanged", async ({ page }) => {
    await stubCorpus(page, [view({ width: 700 }), NOTE]);
    await page.goto("/");

    await expect(page.locator(".col[data-col]")).toHaveCSS("scroll-snap-align", "start");
    await expect(page.locator(".board .ghost-col")).toHaveCSS("width", "220px");
  });

  test("there is no settings panel", async ({ page }) => {
    await stubCorpus(page, [view(), NOTE]);
    await page.goto("/");

    await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(0);
    await expect(page.locator("[data-settings], .settings, .settings-panel")).toHaveCount(0);
  });
});
