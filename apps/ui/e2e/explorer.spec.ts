import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-150 — SPEC.md §10, rider 1: **the explorer is column zero**.
 *
 * A retractable panel at the left edge of the board showing the workspace as a
 * tree. It takes width from the board the way the console takes height, it
 * remembers its width and its open state browser-locally, and it is closed by
 * default. A click opens a **preview path** on the board carrying
 * `default-open`; the next click replaces it; a double click keeps it. A
 * `type: board` row **is** the board. A folder's menu offers §9.2's folder acts.
 */

/**
 * A column on the board, so the board really holds **rows**.
 *
 * Seeded for one reason: the keyboard assertion below says the tree's `↑`/`↓`
 * do not also move the board's row cursor, and a board with no rows makes that
 * assertion vacuous — it would pass against a tree that had never declared
 * `data-shortcuts="off"` at all.
 */
const FINANCE_VIEW: StubRow = {
  id: "doc_view_finance",
  type: "view",
  title: "Finance",
  path: "data/docs/views/finance.md",
  query: { folder: "finance" },
};

const FILES_BOARD: StubRow = {
  id: "doc_board_files",
  type: "board",
  title: "Files",
  path: "data/docs/boards/doc_board_files.md",
  order: 1,
  columns: [FINANCE_VIEW.id],
  defaultOpen: true,
};

/**
 * A second board, **first in `order` and not the default**, so a spec that
 * assumed "the first tab receives" would pick the wrong one — which is the trap
 * the seed itself sets (UI-148: `default-open` sits on Files, `order: 3`).
 */
const ATTENTION_BOARD: StubRow = {
  id: "doc_board_attention",
  type: "board",
  title: "Attention",
  path: "data/docs/boards/doc_board_attention.md",
  order: 0,
  columns: [],
};

const NOTE_A: StubRow = {
  id: "doc_alpha",
  title: "Mortgage options",
  path: "data/docs/finance/alpha.md",
  body: "Three lenders.",
};
const NOTE_B: StubRow = {
  id: "doc_beta",
  title: "Rate table",
  path: "data/docs/finance/beta.md",
  body: "Rates.",
};
const NOTE_C: StubRow = {
  id: "doc_gamma",
  title: "Zeta payoff model",
  path: "data/docs/finance/gamma.md",
  body: "Fifteen years.",
};
const ARCHIVED: StubRow = {
  id: "doc_old",
  title: "Old carrier quote",
  path: "data/docs/finance/old.md",
  status: "archived",
  body: "Superseded.",
};
const TRIAGE_NOTE: StubRow = {
  id: "doc_inboxed",
  title: "Unfiled thought",
  path: "data/docs/inbox/one.md",
  body: "Later.",
};

const CORPUS: readonly StubRow[] = [
  FILES_BOARD,
  ATTENTION_BOARD,
  FINANCE_VIEW,
  NOTE_A,
  NOTE_B,
  NOTE_C,
  ARCHIVED,
  TRIAGE_NOTE,
];

const toggle = (page: Page) => page.getByRole("button", { name: "Toggle explorer" });
const folderRow = (page: Page, path: string) => page.locator(`[data-tree-folder="${path}"]`);
const docRow = (page: Page, id: string) => page.locator(`[data-tree-doc="${id}"]`);

async function openBoard(page: Page, rows: readonly StubRow[] = CORPUS): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
}

/** Opens the panel and expands `finance/`. */
async function openTree(page: Page, rows: readonly StubRow[] = CORPUS): Promise<void> {
  await openBoard(page, rows);
  await toggle(page).click();
  await folderRow(page, "finance").click();
  await docRow(page, "doc_alpha").waitFor();
}

test.describe("the panel (rider 1)", () => {
  test("is closed by default, opens from the bar and from ⌘B, and both survive a reload", async ({
    page,
  }) => {
    await openBoard(page);
    await expect(page.locator(".explorer")).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    await toggle(page).click();
    await expect(page.locator(".explorer")).toBeVisible();
    await expect(page.locator(".explorer")).toHaveCSS("width", "260px");

    await page.reload();
    await page.locator(".board").waitFor();
    // Browser-local and remembered (rider 1).
    await expect(page.locator(".explorer")).toBeVisible();

    // ⌘B retracts it, and the retraction is remembered too.
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.locator(".explorer")).toHaveCount(0);
    await page.reload();
    await page.locator(".board").waitFor();
    await expect(page.locator(".explorer")).toHaveCount(0);
  });

  /**
   * The drawer rule (§10): it takes width from the board, it never overlays it.
   * Measured rather than asserted about CSS, because the failure this rules out
   * is a panel that *looks* right and covers the left-most column — which is
   * exactly where the explorer's own preview path lands.
   */
  test("takes width from the board rather than covering it", async ({ page }) => {
    await openBoard(page);
    const before = await page.locator(".board-wrap").boundingBox();
    await toggle(page).click();
    await expect(page.locator(".explorer")).toBeVisible();

    const panel = await page.locator(".explorer").boundingBox();
    const after = await page.locator(".board-wrap").boundingBox();
    expect(panel).not.toBeNull();
    expect(after).not.toBeNull();
    // The board starts where the panel ends, and is narrower by its width.
    expect(Math.round((after as { x: number }).x)).toBe(
      Math.round((panel as { x: number; width: number }).x + (panel as { width: number }).width),
    );
    expect((after as { width: number }).width).toBeLessThan((before as { width: number }).width);
  });

  test("resizes by dragging the handle, and remembers the width across a reload", async ({
    page,
  }) => {
    await openBoard(page);
    await toggle(page).click();
    const handle = page.locator(".explorer-resizer");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const start = box as { x: number; y: number; width: number; height: number };

    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 60, start.y + start.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".explorer")).toHaveCSS("width", "320px");

    await page.reload();
    await page.locator(".board").waitFor();
    await expect(page.locator(".explorer")).toHaveCSS("width", "320px");
  });

  /**
   * `⌘B` is declared `allowInInput` — it is chrome, not a document key, and a
   * person writing is exactly who wants the tree out of the way. Which puts it
   * on the same chord as ProseMirror's **bold**, and this is the assertion that
   * the editor keeps it: ProseMirror handles the key and calls
   * `preventDefault()`, and the shortcut registry skips a prevented event.
   */
  test("yields ⌘B to the editor, where it is bold", async ({ page }) => {
    await openBoard(page);
    await toggle(page).click();
    await expect(page.locator(".explorer")).toBeVisible();

    await page.locator('.row[data-row-doc="doc_alpha"]').click();
    const body = page.locator(".pcol .doc-editor .ProseMirror").first();
    await body.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");

    await expect(body.locator("strong")).toHaveCount(1);
    // The panel did not move: the editor consumed the key.
    await expect(page.locator(".explorer")).toBeVisible();
  });

  test("resizes from the keyboard, so the handle is not mouse-only", async ({ page }) => {
    await openBoard(page);
    await toggle(page).click();
    await page.locator(".explorer-resizer").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".explorer")).toHaveCSS("width", "292px");
  });
});

test.describe("the tree (rider 1)", () => {
  test("asks for nothing until a folder is expanded, then lists it once", async ({ page }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();
    await folderRow(page, "finance").waitFor();

    /*
     * `includeArchived=true` is what tells the *tree's* listing apart from the
     * board column's over the same folder — the explorer is the one list that
     * includes archived documents (rider 1). Without that clause the assertion
     * would be satisfied by the column's own query and prove nothing.
     */
    const treeListing = (call: { readonly search: string }): boolean =>
      call.search.includes("folder=finance") && call.search.includes("includeArchived=true");

    expect((await corpus.of("GET", "/api/docs")).filter(treeListing)).toHaveLength(0);

    await folderRow(page, "finance").click();
    await docRow(page, "doc_alpha").waitFor();
    expect((await corpus.of("GET", "/api/docs")).filter(treeListing)).not.toHaveLength(0);
  });

  test("keeps archived documents, marked — the one list that does", async ({ page }) => {
    await openTree(page);
    const archived = docRow(page, "doc_old");
    await expect(archived).toBeVisible();
    await expect(archived).toHaveClass(/archived/);
    await expect(archived.locator(".tag")).toHaveText("archived");
  });

  test("says so when a folder's listing reached its bound (§10)", async ({ page }) => {
    // Twelve documents in one folder against a limit the spec lowers by asking
    // for a folder the stub answers in full — the bound line is what a real
    // corpus of thousands would show.
    const many: StubRow[] = Array.from({ length: 120 }, (_value, index) => ({
      id: `doc_bulk${String(index)}`,
      title: `Bulk ${String(index).padStart(3, "0")}`,
      path: `data/docs/bulk/${String(index)}.md`,
      body: "x",
    }));
    await openBoard(page, [FILES_BOARD, FINANCE_VIEW, ...many]);
    await toggle(page).click();
    await folderRow(page, "bulk").click();
    await expect(page.locator("[data-tree-bound='bulk']")).toHaveText(
      "100 of 120 — the listing reached its bound",
    );
  });

  test("titles truncate rather than widening the panel", async ({ page }) => {
    const long: StubRow = {
      id: "doc_long",
      title: "A title long enough that no reasonable panel could ever hold the whole of it at once",
      path: "data/docs/finance/long.md",
      body: "x",
    };
    await openTree(page, [...CORPUS, long]);
    await expect(page.locator(".explorer")).toHaveCSS("width", "260px");
    const name = docRow(page, "doc_long").locator(".name");
    // The text is cut by the box rather than the box grown by the text.
    const overflow = await name.evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).textOverflow,
    );
    expect(overflow).toBe("ellipsis");
  });
});

test.describe("opening (riders 1 and 3)", () => {
  test("a click lands a preview path on the default-open board, not on the first tab", async ({
    page,
  }) => {
    await openTree(page);
    // Stand on the *other* board first. Attention is first in `order`; Files
    // carries `default-open` and is what receives, so a fallback that took "the
    // first tab" would leave the path here (UI-148's seed sets the same trap).
    await page.locator('.board-tab[data-board="doc_board_attention"] .board-tab-open').click();
    await expect(page.locator(".board-tab.on .board-tab-title")).toHaveText("Attention");

    await docRow(page, "doc_alpha").click();
    await expect(page.locator(".board-tab.on .board-tab-title")).toHaveText("Files");
    await expect(page.locator(".pcol")).toHaveCount(1);
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
    await expect(docRow(page, "doc_alpha")).toHaveClass(/origin/);
  });

  test("the next click replaces the preview rather than opening a second path", async ({
    page,
  }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").click();
    await expect(page.locator(".pcol")).toHaveCount(1);

    await docRow(page, "doc_beta").click();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();
    await expect(page.locator(".pcol")).toHaveCount(1);
    await expect(docRow(page, "doc_beta")).toHaveClass(/origin/);
    await expect(docRow(page, "doc_alpha")).not.toHaveClass(/origin/);
  });

  test("a double click keeps the path, and the next click opens a new preview beside it", async ({
    page,
  }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").dblclick();
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
    // Kept means detached: no tree row is the explorer's origin any more.
    await expect(page.locator(".tr.origin")).toHaveCount(0);

    await docRow(page, "doc_beta").click();
    await expect(page.locator(".pcol")).toHaveCount(2);
    await expect(docRow(page, "doc_beta")).toHaveClass(/origin/);
  });

  test("marks a document open on the showing board", async ({ page }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").dblclick();
    await expect(page.locator(".tr.origin")).toHaveCount(0);
    await expect(docRow(page, "doc_alpha").locator(".open-dot")).toBeVisible();
  });

  test("a board row is the board: it shows it rather than opening its document", async ({
    page,
  }) => {
    await openBoard(page);
    await toggle(page).click();
    await folderRow(page, "boards").click();
    await docRow(page, "doc_board_files").waitFor();

    await docRow(page, "doc_board_files").click();
    await expect(page.locator(".board-tab.on .board-tab-title")).toHaveText("Files");
    // Nothing opened: the row *is* the board, not a document to read.
    await expect(page.locator(".pcol")).toHaveCount(0);
  });

  test("restores an archived board before showing it", async ({ page }) => {
    const archivedBoard: StubRow = { ...ATTENTION_BOARD, status: "archived" };
    await openBoard(page, [FILES_BOARD, FINANCE_VIEW, archivedBoard, NOTE_A]);
    // Off the bar, but still in the tree (rider 1).
    await expect(page.locator(".board-tab")).toHaveCount(1);

    await toggle(page).click();
    await folderRow(page, "boards").click();
    await docRow(page, "doc_board_attention").waitFor();
    await expect(docRow(page, "doc_board_attention")).toHaveClass(/archived/);

    await docRow(page, "doc_board_attention").click();
    await expect(page.locator(".board-tab")).toHaveCount(2);
    await expect(page.locator(".board-tab.on .board-tab-title")).toHaveText("Attention");
  });
});

test.describe("the menus", () => {
  test("offers the default board by name, keeping, full screen, and every other board", async ({
    page,
  }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu.getByRole("menuitem", { name: /Open in Files/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Open and keep/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Open in full screen/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Open in Attention/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Archive/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Delete/ })).toBeVisible();
  });

  test("opens full screen from the tree, which owns no column", async ({ page }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Open in full screen/ }).click();
    await expect(page.locator(".focus-overlay, .focus")).toBeVisible();
  });

  test("renames a folder, and the tree follows without a reload", async ({ page }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();

    await folderRow(page, "inbox").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Rename folder/ }).click();
    const field = page.getByLabel("Rename inbox");
    await field.fill("triage");
    await field.press("Enter");

    await expect(folderRow(page, "triage")).toBeVisible();
    await expect(folderRow(page, "inbox")).toHaveCount(0);
    const rename = (await corpus.of("POST", "/api/folders/rename"))[0];
    // Byte for byte, both whole paths, and nothing normalised (SERVER-136).
    expect(rename?.body).toEqual({ from: "inbox", to: "triage" });
  });

  test("archives a folder without moving anything, and says how many it listed", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();
    await folderRow(page, "finance").click();
    await docRow(page, "doc_alpha").waitFor();

    await folderRow(page, "finance").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Archive folder/ }).click();

    await expect(page.locator(".toast")).toContainText("nothing moved on disk");
    await expect(docRow(page, "doc_alpha")).toHaveClass(/archived/);
    expect((await corpus.of("POST", "/api/folders/archive"))[0]?.body).toEqual({
      path: "finance",
    });
  });

  test("asks twice before deleting a folder, and never claims to have counted its threads", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();

    await folderRow(page, "inbox").click({ button: "right" });
    const item = page.getByRole("menuitem", { name: /Delete folder/ });
    await item.click();
    // Armed, not sent: the first activation only re-labels.
    expect(await corpus.of("POST", "/api/folders/delete")).toHaveLength(0);
    await expect(page.locator('[role="menu"]')).toContainText("the tree counts");
    await expect(page.locator('[role="menu"]')).toContainText("orphaned records");

    await page.getByRole("menuitem", { name: /Really delete/ }).click();
    await expect(page.locator(".toast")).toContainText("survive as orphaned records");
    expect((await corpus.of("POST", "/api/folders/delete"))[0]?.body).toEqual({ path: "inbox" });
  });

  test("pins a folder as a column on the showing board", async ({ page }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();

    await folderRow(page, "finance").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Pin as a column/ }).click();

    await expect(page.locator(".toast")).toContainText("Pinned finance/");
    const created = (await corpus.of("POST", "/api/docs"))[0]?.body as Record<string, unknown>;
    expect(created["type"]).toBe("view");
    expect(created["query"]).toEqual({ folder: "finance" });
    // …and listed on the board document, which is the only way a column exists.
    expect(await corpus.of("PUT")).not.toHaveLength(0);
  });

  test("creates a document into the folder and opens it with its title selected", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await toggle(page).click();

    await folderRow(page, "finance").click({ button: "right" });
    await page.getByRole("menuitem", { name: /New document here/ }).click();

    await expect(page.locator(".pcol")).toHaveCount(1);
    const created = (await corpus.of("POST", "/api/docs"))[0]?.body as Record<string, unknown>;
    expect(created["folder"]).toBe("finance");
  });
});

test.describe("the keyboard inside the tree", () => {
  test("moves, expands and opens without touching the board's row cursor", async ({ page }) => {
    await openBoard(page);
    // The board really holds rows, so "the row cursor did not move" is a claim
    // about something rather than about an empty board.
    await page.locator(".col-list .row[data-row-doc]").first().waitFor();
    await toggle(page).click();
    await folderRow(page, "boards").focus();

    // `→` opens a closed folder rather than moving.
    await page.keyboard.press("ArrowRight");
    await docRow(page, "doc_board_files").waitFor();
    await expect(folderRow(page, "boards")).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowDown");
    await expect(docRow(page, "doc_board_attention")).toBeFocused();

    // `←` climbs back to the folder, and again collapses it.
    await page.keyboard.press("ArrowLeft");
    await expect(folderRow(page, "boards")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(docRow(page, "doc_board_files")).toHaveCount(0);

    /*
     * The board's own keys never fired. **Tested with `j`, not with `↓`**: the
     * tree calls `preventDefault()` on the arrows, and the registry skips a
     * prevented event — so an arrow proves nothing about the tree owning the
     * keyboard. `j` is a board binding the tree does not handle at all, and the
     * only thing that stops it is `data-shortcuts="off"` (falsified: removing
     * that attribute leaves an arrow-key assertion green and turns this red).
     */
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.locator(".row.kbd")).toHaveCount(0);
  });

  test("↵ opens and ⌥↵ keeps", async ({ page }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
    await expect(docRow(page, "doc_alpha")).toHaveClass(/origin/);

    await docRow(page, "doc_beta").focus();
    await page.keyboard.press("Alt+Enter");
    // Keep turns the preview into the kept path rather than adding one.
    await expect(page.locator(".tr.origin")).toHaveCount(0);
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_beta"]')).toBeVisible();
  });

  test("the context-menu key opens the row's menu", async ({ page }) => {
    await openTree(page);
    await docRow(page, "doc_alpha").focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menuitem", { name: /Open in Files/ })).toBeVisible();
  });
});
