import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-019 in a real browser: a column's width is a property of its view document
 * (SPEC.md §10), adjusted by dragging its edge.
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
    // The width write touched `extra` and nothing else: the view's own query and
    // title are as seeded (a view has no `pinned` and no `order` since rider 2).
    const stored = await corpus.doc("doc_view_inbox");
    expect(stored?.query).toEqual({ folder: "inbox" });
    expect(stored?.title).toBe("Inbox");
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

  /**
   * UI-149 (SPEC.md §10, rider 3): "a query column no longer widens when it
   * opens a reader: the reader column has its own width". A row click opens a
   * path column at 440px, and the query column keeps its chosen width at every
   * size — narrower than the old floor, or wider than the old ceiling. The
   * UI-113 widening machinery (`readingFloor`/`renderedWidth`) is deleted.
   */
  test("opening a document leaves the column at its chosen width — the reader is a path's", async ({
    page,
  }) => {
    await stubCorpus(page, [view({ width: 300 }), NOTE]);
    await page.goto("/");

    const column = page.locator(".qcol[data-col]");
    await expect(column).toHaveCSS("width", "300px");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".pcol .reader")).toBeVisible();
    await expect(column).toHaveCSS("width", "300px");
    await expect(page.locator(".pcol")).toHaveCSS("width", "440px");
  });

  test("a wide column keeps its width when a path opens and when it closes", async ({ page }) => {
    await stubCorpus(page, [view({ width: 900 }), NOTE]);
    await page.goto("/");

    const column = page.locator(".qcol[data-col]");
    await expect(column).toHaveCSS("width", "900px");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".pcol .reader")).toBeVisible();
    await expect(column).toHaveCSS("width", "900px");

    // Closing the path changes nothing either — the column never moved.
    await page.keyboard.press("Escape");
    await expect(page.locator(".pcol")).toHaveCount(0);
    await expect(column).toHaveCSS("width", "900px");
  });

  /**
   * The other half of UI-113, and it needed no code of its own: the resizer was
   * always live while a reader was open, but the rendered width was computed
   * from the reading formula rather than from the base the drag was setting — so
   * the edge moved, the stored width changed, and nothing visible happened. Once
   * the rendered width is the base, the drag works open or closed, identically.
   */
  test("the edge can be dragged while a reader is open, and the width sticks", async ({ page }) => {
    await stubCorpus(page, [view({ width: 700 }), NOTE]);
    await page.goto("/");

    const column = page.locator(".qcol[data-col]");
    // "Open here" keeps the reader in the column itself — the case this drag
    // test is about; a plain click now opens a path column instead (rider 3).
    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    await page.locator('[role="menuitem"][data-act="open-here"]').click();
    await expect(page.locator(".qcol .reader")).toBeVisible();
    await expect(column).toHaveCSS("width", "700px");

    const resizer = page.locator(".qcol .col-resizer");
    const box = await resizer.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move((box?.x ?? 0) + 3, (box?.y ?? 0) + 40);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) + 123, (box?.y ?? 0) + 40, { steps: 8 });
    await page.mouse.up();

    await expect(column).toHaveCSS("width", "820px");

    // And it survives closing the reader — the drag set the column's own width,
    // not a reading-session override.
    await page.locator(".col.reading .back").click();
    await expect(column).toHaveCSS("width", "820px");
  });

  test("snap scrolling and the ghost column are unchanged", async ({ page }) => {
    await stubCorpus(page, [view({ width: 700 }), NOTE]);
    await page.goto("/");

    await expect(page.locator(".qcol[data-col]")).toHaveCSS("scroll-snap-align", "start");
    await expect(page.locator(".board .ghost-col")).toHaveCSS("width", "220px");
  });

  test("there is no settings panel", async ({ page }) => {
    await stubCorpus(page, [view(), NOTE]);
    await page.goto("/");

    await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(0);
    await expect(page.locator("[data-settings], .settings, .settings-panel")).toHaveCount(0);
  });
});
