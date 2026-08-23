import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-149 — SPEC.md §10, rider 3: **a row opens a path**.
 *
 * The acts and rules are `design/navigation.html`'s, ported onto the real
 * board: a row click opens a reader column directly right of its column; a link
 * followed inside a path column continues it; no document appears twice in one
 * path (re-centre instead); a second pick from the origin replaces the whole
 * path; "open here" is the reader the column always had; restart/new-right/
 * close live on the path column; "close paths" is one act on the bar; and every
 * `open()` with no origin — the search overlay's `↵`, a link inside full
 * screen — lands as a **loose path at the left edge**.
 */

const INBOX_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** A chain to walk: A → B → C, and B links back to A for the loop rule. */
const NOTE_A: StubRow = {
  id: "doc_alpha",
  title: "Mortgage options",
  body: "Start from [[doc_beta]] before deciding.",
};
const NOTE_B: StubRow = {
  id: "doc_beta",
  title: "Rate table",
  body: "Back to [[doc_alpha]], or on to [[doc_gamma]].",
};
const NOTE_C: StubRow = { id: "doc_gamma", title: "Payoff model", body: "Fifteen years." };
const NOTE_D: StubRow = { id: "doc_delta", title: "Insurance renewal", body: "Three carriers." };

const CORPUS = [INBOX_VIEW, NOTE_A, NOTE_B, NOTE_C, NOTE_D];

async function openBoard(page: Page, rows: readonly StubRow[] = CORPUS): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator('.row[data-row-doc="doc_alpha"]').waitFor();
}

/** Opens A's path off its row and waits for the reader. */
async function openAlphaPath(page: Page): Promise<void> {
  await page.locator('.row[data-row-doc="doc_alpha"]').click();
  await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
}

/** Follows the body ref to `docId` inside the given path column. */
async function followRef(page: Page, fromCol: string, docId: string): Promise<void> {
  await page.locator(`.pcol[data-col="${fromCol}"] .doc-body [data-corpus-ref="${docId}"]`).click();
}

test.describe("a row opens a path (rider 3)", () => {
  test("the reader opens in a new column right of the row's column, which keeps its width", async ({
    page,
  }) => {
    await openBoard(page);
    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await expect(column).toHaveCSS("width", "336px");

    await openAlphaPath(page);

    // The query column did not widen and still shows its list (rider 3).
    await expect(column).toHaveCSS("width", "336px");
    await expect(column.locator(".col-list")).toBeVisible();
    // The path column has its own width — the prototype's 440.
    const pcol = page.locator(".pcol");
    await expect(pcol).toHaveCSS("width", "440px");
    // The band sits directly right of the origin column.
    const columnBox = await column.boundingBox();
    const bandBox = await page.locator(".path").boundingBox();
    expect(bandBox as { x: number }).not.toBeNull();
    expect((bandBox as { x: number }).x).toBeGreaterThan(
      (columnBox as { x: number; width: number }).x + (columnBox as { width: number }).width - 1,
    );
    // The origin row is highlighted while its path is open.
    await expect(page.locator('.row.origin[data-row-doc="doc_alpha"]')).toBeVisible();
    // The head names the origin column.
    await expect(page.locator(".pcol-from")).toContainText("Inbox");
    // The bar's pill counts it.
    await expect(page.locator(".paths-pill")).toContainText("1 path · 1 column");
  });

  test("a link followed inside a path column continues the path to the right", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);

    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();

    const cols = page.locator(".pcol");
    await expect(cols).toHaveCount(2);
    // The continuation head names the document it came from.
    await expect(page.locator('.pcol[data-col="path:1:1"] .pcol-from')).toContainText(
      "Mortgage options",
    );
    await expect(page.locator(".paths-pill")).toContainText("1 path · 2 columns");

    // A row of another document elsewhere on the board carries the dot.
    await expect(page.locator('.row.open-elsewhere[data-row-doc="doc_beta"]')).toBeVisible();
  });

  test("no loops: a document already in the path re-centres, closing nothing", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);

    // B links back to A — already the first column of this path.
    await followRef(page, "path:1:1", "doc_alpha");

    // Nothing closed, nothing opened; the toast says what happened instead.
    await expect(page.locator(".pcol")).toHaveCount(2);
    await expect(page.locator(".toast")).toContainText("Already in this path");
  });

  test("a second pick from the origin column replaces the whole path", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);

    await page.locator('.row[data-row-doc="doc_delta"]').click();

    await expect(page.locator('.pcol .reader[data-reader-doc="doc_delta"]')).toBeVisible();
    await expect(page.locator(".pcol")).toHaveCount(1);
    await expect(page.locator('.row.origin[data-row-doc="doc_delta"]')).toBeVisible();
    await expect(page.locator(".row.origin")).toHaveCount(1);
  });

  test("⌥↵ opens here — the column's own reader, no path", async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+Enter");

    await expect(page.locator('.reader[data-reader-column="doc_view_inbox"]')).toBeVisible();
    await expect(page.locator(".pcol")).toHaveCount(0);
  });

  test("the row menu offers Open, Open here and Open in full screen", async ({ page }) => {
    await openBoard(page);
    await page.locator('.row[data-row-doc="doc_alpha"]').click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu.locator('[data-act="open"]')).toContainText("Open");
    await expect(menu.locator('[data-act="open-here"]')).toContainText("Open here");
    await expect(menu.locator('[data-act="open-focus"]')).toContainText("Open in full screen");

    await menu.locator('[data-act="open"]').click();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
  });

  test("restart the path here makes this column the root of a loose path in place", async ({
    page,
  }) => {
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);

    await page.locator('.pcol[data-col="path:1:1"] [aria-label="Path actions"]').click();
    await page.locator('[role="menuitem"][data-act="restart"]').click();

    await expect(page.locator(".pcol")).toHaveCount(1);
    await expect(page.locator(".path")).toHaveClass(/\bloose\b/);
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();
    await expect(page.locator(".pcol-from")).toContainText("no origin");
    // The origin row's highlight went with the origin.
    await expect(page.locator(".row.origin")).toHaveCount(0);
  });

  test("new path to the right opens a loose sibling rooted at this document", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);

    await page.locator('.pcol [aria-label="Path actions"]').click();
    await page.locator('[role="menuitem"][data-act="new-right"]').click();

    await expect(page.locator(".path")).toHaveCount(2);
    await expect(page.locator(".path.loose")).toHaveCount(1);
    await expect(page.locator(".paths-pill")).toContainText("2 paths · 2 columns");
    // The original keeps its origin row.
    await expect(page.locator('.row.origin[data-row-doc="doc_alpha"]')).toBeVisible();
  });

  test("esc closes the active path column; the bar and ⇧esc close every path", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);

    // esc: the active path column (the newest) and everything after it. The
    // ref click left the caret in the editor, whose surface owns Escape while
    // it is focused — so step off it first, onto the new column's own head.
    await page.locator('.pcol[data-col="path:1:1"] .pcol-from').click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pcol")).toHaveCount(1);

    // Grow it again, then close everything from the bar.
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);
    const closePaths = page.locator(".close-paths");
    await expect(closePaths).toBeEnabled();
    await closePaths.click();

    await expect(page.locator(".path")).toHaveCount(0);
    await expect(page.locator(".paths-pill")).toContainText("no paths");
    await expect(closePaths).toBeDisabled();
    await expect(page.locator(".toast").last()).toContainText("Closed 1 path");

    // And the keyboard form: ⇧esc.
    await openAlphaPath(page);
    await page.keyboard.press("Shift+Escape");
    await expect(page.locator(".path")).toHaveCount(0);
  });

  test("the search overlay's ↵ lands as a loose path at the left edge", async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press("ControlOrMeta+k");
    // The exact title, so no create row sits ahead of the hit in the cursor
    // order, and a bare ↵ opens the first result.
    await page.getByLabel("Search query").fill("Payoff model");
    await page.locator('.sr[data-sr="doc_gamma"]').waitFor();
    await page.keyboard.press("Enter");

    await expect(page.locator('.pcol .reader[data-reader-doc="doc_gamma"]')).toBeVisible();
    await expect(page.locator(".path")).toHaveClass(/\bloose\b/);
    // The left edge: the band is the board's first child, before every column.
    const first = page.locator(".board > *").first();
    await expect(first).toHaveClass(/\bpath\b/);
    await expect(page.locator(".row.origin")).toHaveCount(0);
  });

  test("a link followed inside full screen closes it and lands as a loose path", async ({
    page,
  }) => {
    await openBoard(page);
    await openAlphaPath(page);
    // Full screen on the path column's document.
    await page.keyboard.press("f");
    await expect(page.locator(".focus.open")).toBeVisible();

    await page.locator('.focus .doc-body [data-corpus-ref="doc_beta"]').click();

    await expect(page.locator(".focus.open")).toHaveCount(0);
    await expect(page.locator('.path.loose .reader[data-reader-doc="doc_beta"]')).toBeVisible();
    const first = page.locator(".board > *").first();
    await expect(first).toHaveClass(/\bloose\b/);
  });

  test("the newest path column is fully in view at a 13″ width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();

    // Snap scrolling follows the newest column: fully inside the viewport.
    await expect
      .poll(async () => {
        const box = await page.locator('.pcol[data-col="path:1:1"]').boundingBox();
        if (box === null) return false;
        return box.x >= 0 && box.x + box.width <= 1280;
      })
      .toBe(true);
  });

  test("paths survive a reload — browser-local, like navigation stacks", async ({ page }) => {
    await openBoard(page);
    await openAlphaPath(page);
    await followRef(page, "path:1:0", "doc_beta");
    await expect(page.locator(".pcol")).toHaveCount(2);

    await page.reload();
    await expect(page.locator(".pcol")).toHaveCount(2);
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();
    await expect(page.locator('.row.origin[data-row-doc="doc_alpha"]')).toBeVisible();
  });
});
