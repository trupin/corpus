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

/** The second column UI-020 needs: somewhere an archived document is visible. */
const ARCHIVE_VIEW = {
  id: "doc_view_archive",
  type: "view",
  title: "Archive",
  path: "data/docs/views/archive.md",
  pinned: true,
  order: 2,
  query: { status: "archived" },
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

  /**
   * UI-020, and the half a browser can prove. SPEC.md §7 says an archived skill
   * is "restorable"; the menu offered Archive with no inverse, and the only
   * inverse the UI could reach was the `PUT` SERVER-039 refuses. The other half
   * — the folder actually moving to `.claude/skills-archived/` and the name
   * coming free of `corpus skill create`'s 409 — is only observable against a
   * real workspace and lives in the issue's real-app drill (Adjudication 19).
   */
  test("offers Unarchive on an archived row, and only there, calling the route that owns it", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [
      INBOX_VIEW,
      ARCHIVE_VIEW,
      NOTE,
      { ...OTHER, status: "archived", title: "Old rates" },
    ]);
    await page.goto("/");

    // A live row offers Archive and no inverse.
    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    let menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu.locator('[data-act="archive"]')).toBeVisible();
    await expect(menu.locator('[data-act="unarchive"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    const archivedRow = page.locator('.row[data-row-doc="doc_other"]');
    await expect(archivedRow).toBeVisible();

    await archivedRow.click({ button: "right" });
    menu = page.getByRole("menu", { name: "Actions for Old rates" });
    await expect(menu.locator('[data-act="unarchive"]')).toBeVisible();
    await expect(menu.locator('[data-act="archive"]')).toHaveCount(0);

    await menu.locator('[data-act="unarchive"]').click();

    await expect.poll(async () => (await corpus.doc("doc_other"))?.status).toBe("open");
    expect(await corpus.of("POST", "/api/docs/doc_other/unarchive")).toHaveLength(1);
    // Never the write SERVER-039 refuses with a 400 naming this route.
    expect(await corpus.of("PUT", "/api/docs/doc_other")).toHaveLength(0);
  });

  /** Adjudication 7: Archive moves onto its own route too, from every surface. */
  test("archives through POST …/archive rather than a status patch", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="archive"]').click();

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("archived");
    expect(await corpus.of("POST", "/api/docs/doc_note/archive")).toHaveLength(1);
    expect(await corpus.of("PUT", "/api/docs/doc_note")).toHaveLength(0);
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

  /**
   * SPEC.md §11: "`esc` dismisses, arrows navigate, `↵` activates". UI-028 —
   * the case above only ever exercised the arrows, and `↵` activated nothing in
   * any menu in the app: the board's own `↵` (`rows.open`) matched first on the
   * document listener and `preventDefault()` cancelled the focused button's
   * default action. Only a real browser performs that default action, so only a
   * real browser can prove the key now gets through — and the assertion is that
   * the **action ran**, not that a key was pressed.
   */
  for (const key of ["Enter", "NumpadEnter"] as const) {
    test(`activates the focused item on ${key}`, async ({ page }) => {
      await stubCorpus(page, [INBOX_VIEW, NOTE]);
      await page.goto("/");

      await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
      const menu = page.getByRole("menu");
      await page.keyboard.press("ArrowDown");
      await expect(menu.locator('[data-act="open"]')).toBeFocused();

      await page.keyboard.press(key);

      await expect(menu).toBeHidden();
      // Open ran: the row's reader is what the act produces.
      await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toBeVisible();
    });
  }

  test("still activates on Space, and esc still runs nothing", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.locator(".reader")).toHaveCount(0);

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toBeVisible();
  });

  test("takes the board's keys out of scope while it is open", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // `c` opens the compose overlay on the board; with a menu up it must not.
    await page.keyboard.press("c");
    await expect(page.locator(".overlay.open")).toHaveCount(0);
    await expect(menu).toBeVisible();
  });

  /**
   * PR #12 review, MINOR 16. Tab was neither trapped nor dismissing: focus left
   * a surface painted over the page while the menu stayed on screen. Only a real
   * browser moves focus on Tab, so only a real browser can prove this.
   */
  test("dismisses on Tab rather than letting focus walk out of it", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    const row = page.locator('.row[data-row-doc="doc_note"]');
    await row.hover();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await expect(menu.locator('[data-act="open"]')).toBeFocused();

    await page.keyboard.press("Tab");

    await expect(menu).toBeHidden();
    await expect(page.locator('[role="menuitem"]')).toHaveCount(0);
    // And the keyboard is not left inside a surface that no longer exists.
    const inMenu = await page.evaluate(
      () => document.activeElement?.closest('[role="menu"]') !== null,
    );
    expect(inMenu).toBe(false);
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

  /**
   * UI-024, report 2. A selection anywhere on the page used to send every
   * right-click to the browser's own menu — including the word the browser
   * auto-selects under the right-click itself, which is why the failure read as
   * "sometimes the row menu doesn't open".
   *
   * The selection is made in the page rather than by clicking, because a click
   * on a row opens it. **Where** the right-click then lands is not incidental:
   * Chromium clears a selection when the press falls outside it, so the only
   * gesture that carries a live selection into `contextmenu` is a right-click
   * *on the selected text* — which is exactly the reported case, the word under
   * the cursor.
   */
  async function selectWithin(page: import("@playwright/test").Page, selector: string) {
    await page.locator(selector).waitFor();
    await page.evaluate((target) => {
      const node = document.querySelector(target);
      if (node === null) throw new Error(`no ${target}`);
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, selector);
    expect((await page.evaluate(() => getSelection()?.toString())) ?? "").not.toBe("");
  }

  test("opens a row's menu on the selected word under the cursor", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    const title = page.locator('.row[data-row-doc="doc_note"] .row-title');
    await selectWithin(page, '.row[data-row-doc="doc_note"] .row-title');

    await title.click({ button: "right" });

    // The selection is still live at this point — the guard it used to trip.
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("Mortgage options");
    await expect(page.getByRole("menu", { name: "Actions for Mortgage options" })).toBeVisible();
  });

  test("opens a column header's menu on its own selected title", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await selectWithin(page, ".col-head .col-title");
    await page.locator(".col-head .col-title").click({ button: "right" });

    await expect(page.getByRole("menu", { name: "List options for Inbox" })).toBeVisible();
  });

  /** UI-024, report 1: the document body's own selection menu. */
  test("offers the selection's actions in the document body, Comment first", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    const paragraph = page.locator(".doc-body[contenteditable] p").first();
    await expect(paragraph).toBeVisible();
    await paragraph.selectText();

    await paragraph.click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Actions for the selection" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(4);
    expect(
      await menu
        .getByRole("menuitem")
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"])),
    ).toEqual(["comment", "copy", "cut", "paste"]);
    // And the reader's own document menu did not open over it.
    await expect(page.getByRole("menu", { name: "Actions for Mortgage options" })).toHaveCount(0);
  });

  test("comments on the selection through the same composer 💬 opens", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    const paragraph = page.locator(".doc-body[contenteditable] p").first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await expect(composer).toBeVisible();
    // The quote is the text that was right-clicked — the §6 selector's `exact`.
    await expect(composer.locator(".cm-quote")).toContainText("6.4% this week.");

    await composer.getByLabel("Comment").fill("is that the 30-year?");
    await composer.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = await corpus.of("POST", "/api/threads");
    expect(posted[0]?.body).toMatchObject({
      parent: "doc_note",
      selector: { exact: "6.4% this week." },
    });
    // The §6 anchor the thread lands with is not asserted here: the stub answers
    // `POST /api/threads` but pushes no invalidation, so the parent's highlight
    // is a real-app fact — proved in the issue's E2E log against a real server,
    // exactly as `anchors.spec.ts` documents for the rest of the anchor layer.
  });

  test("copies the selected text to the real clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    const paragraph = page.locator(".doc-body[contenteditable] p").first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="copy"]').click();

    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("6.4% this week.");
  });

  test("leaves the native menu alone in the editor with nothing selected, in a field, and off any item", async ({
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
