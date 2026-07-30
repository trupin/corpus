import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-018 in a real browser: right-clicking an actionable item opens that item's
 * own actions, and leaves the browser's menu alone where it is the useful one
 * (SPEC.md §11).
 *
 * A real right-click is the only way to prove this — `contextmenu` is a native
 * gesture and `preventDefault` on it is the whole mechanism, neither of which
 * jsdom models. The corpus half of the evidence (an action taken from the menu
 * actually changing the workspace, with the commit to show for it) is the
 * issue's real-app drill.
 */

const INBOX_VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

const NOTE = { id: "doc_note", title: "Mortgage options", body: "6.4% this week." };
const OTHER = { id: "doc_other", title: "Rates" };

test.describe("the context menu", () => {
  test("opens a row's own actions at the pointer", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    const row = page.locator('.row[data-row-doc="doc_note"]');
    await expect(row).toBeVisible();
    await row.click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(4);
    await expect(menu.locator('[data-act="open"]')).toBeVisible();
    await expect(menu.locator('[data-act="open-focus"]')).toBeVisible();
    await expect(menu.locator('[data-act="archive"]')).toBeVisible();
    await expect(menu.locator('[data-act="delete"]')).toBeVisible();
  });

  test("targets the item under the cursor, not the keyboard highlight", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE, OTHER]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').hover();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".row.kbd")).toHaveAttribute("data-row-doc", "doc_note");

    await page.locator('.row[data-row-doc="doc_other"]').click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="archive"]').click();

    await expect.poll(async () => (await corpus.doc("doc_other"))?.status).toBe("archived");
    expect((await corpus.doc("doc_note"))?.status).toBe("open");
  });

  test("keeps deletion behind its explicit confirmation", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    const item = page.getByRole("menu").locator('[data-act="delete"]');
    await item.click();
    expect(await corpus.of("DELETE")).toHaveLength(0);
    await expect(item).toContainText("Really delete?");

    await item.click();
    await expect.poll(async () => (await corpus.of("DELETE")).length).toBe(1);
  });

  test("dismisses on escape, and walks with the arrow keys", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="open"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="open-focus"]')).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("⇧F10 opens the menu on the keyboard highlight, focused", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').hover();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".row.kbd")).toHaveAttribute("data-row-doc", "doc_note");

    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-act="open"]')).toBeFocused();
  });

  test("a column header offers its own three acts", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator(".col-head").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "List options for Inbox" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(3);
  });

  test("leaves the native menu alone on a selection, in a field, and off any item", async ({
    page,
  }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    // Off any item: the empty part of the board.
    await page.locator(".board").click({ button: "right", position: { x: 5, y: 5 } });
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Inside the editor, which is a contenteditable.
    await page.locator('.row[data-row-doc="doc_note"]').click();
    const body = page.locator(".doc-body[contenteditable]");
    await expect(body).toBeVisible();
    await body.click({ button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(0);

    // The title field.
    await page.getByLabel("Document title").click({ button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("the open reader offers its ⋯ set", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();

    // The chip strip above the title: part of the reader, not an editable.
    await page.locator(".fm-chips").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-act="review"]')).toBeVisible();
    await expect(menu.locator('[data-act="archive"]')).toBeVisible();
    await expect(menu.locator('[data-act="delete"]')).toBeVisible();
    await expect(menu.locator('[data-act="open"]')).toHaveCount(0);
  });
});
