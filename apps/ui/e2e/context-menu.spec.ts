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

/**
 * UI-036's subject: a document whose type the todos plugin owns, so the board
 * paints its row with the plugin's `ListItem` instead of the kit's `Row`. It is
 * still a core document in a core column, and the row menu is core's.
 */
const TODO = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: "- [ ] Call the plumber\n",
};

/** A **plugin column**: everything in its body is the plugin's own surface. */
const TODOS_COLUMN_VIEW = {
  id: "doc_view_todos",
  type: "view",
  title: "Todos",
  path: "data/docs/views/todos.md",
  pinned: true,
  order: 3,
  column: "todos/todos",
  query: { type: "todo" },
};

/**
 * The todos plugin's own aggregate (`GET /api/x/todos/lists/at/<fingerprint>`),
 * which both its row preview and its column read. Registered **after**
 * `stubCorpus`, whose `**\/api\/**` handler would otherwise swallow it —
 * Playwright matches the most recently added route first. Without it a todo row
 * renders degraded, which would make the menu assertions below less than the
 * real thing.
 */
async function stubTodoLists(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/x/todos/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [
          {
            docId: TODO.id,
            title: TODO.title,
            open: 1,
            done: 0,
            items: [{ text: "Call the plumber", done: false }],
          },
        ],
      }),
    });
  });
}

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

    // SPEC.md §5: unarchiving returns a document to `resolved` — the state
    // archiving already implied — not to `open` (SERVER-108). Archiving is
    // resolved-and-hidden, so the inverse is resolved-and-visible; coming back
    // `open` would reopen work the archive had already settled.
    await expect.poll(async () => (await corpus.doc("doc_other"))?.status).toBe("resolved");
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

  /**
   * UI-036, and the regression it pins (sprint-023 TEST-1073, TEST-1078).
   *
   * Core suppressed its own row menu for every document type that had a plugin
   * `ListItem`, so a `todo` document — the shipped case — had **no** menu at
   * all: no open, no open in focus, no archive, no delete, no staleness, from
   * either input path. The signed v1 exclusion (SPEC.md §11, SHARED-004 item 4)
   * is about surfaces a plugin *renders*; a todo document listed in an ordinary
   * column is a core subject in a core surface, and the menu's actions are
   * built from the `DocRow` core already holds.
   */
  test("gives a todo document row the same menu a note row gets", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE, TODO]);
    await stubTodoLists(page);
    await page.goto("/");

    const todoRow = page.locator('.row[data-row-doc="doc_todo"]');
    await expect(todoRow).toBeVisible();
    // The plugin's `ListItem` really is what painted it — the precondition the
    // old bail keyed on, now proved present rather than assumed.
    await expect(todoRow).toHaveClass(/todo-row/);
    await expect(todoRow.locator(".todo-items .t")).toContainText("Call the plumber");

    await todoRow.click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Actions for Inbox chores" });
    await expect(menu).toBeVisible();
    const acts = await menu
      .getByRole("menuitem")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"]));
    expect(acts).toEqual(["open", "open-focus", "archive", "delete"]);

    // The same set the note row in the same column offers.
    await page.keyboard.press("Escape");
    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    const noteActs = await page
      .getByRole("menu")
      .getByRole("menuitem")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"]));
    expect(noteActs).toEqual(acts);

    // And an action taken from it acts on the document, through the core route.
    await page.keyboard.press("Escape");
    await todoRow.click({ button: "right" });
    await menu.locator('[data-act="archive"]').click();
    await expect.poll(async () => (await corpus.doc("doc_todo"))?.status).toBe("archived");
    expect(await corpus.of("POST", "/api/docs/doc_todo/archive")).toHaveLength(1);
  });

  /** The keyboard half of the same rule (TEST-1074). */
  test("⇧F10 opens the todo row's menu, with its first item focused", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, TODO]);
    await stubTodoLists(page);
    await page.goto("/");

    const todoRow = page.locator('.row[data-row-doc="doc_todo"]');
    await todoRow.hover();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".row.kbd")).toHaveAttribute("data-row-doc", "doc_todo");

    await page.keyboard.press("Shift+F10");

    const menu = page.getByRole("menu", { name: "Actions for Inbox chores" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-act="open"]')).toBeFocused();
  });

  /**
   * The negative UI-036 owns, restated for the SPEC §11 amendment of
   * 2026-08-02 (TEST-1075, as the amendment leaves it).
   *
   * When this test was written the rule was "a plugin column body's rows keep
   * the **browser's** menu", because v1 excluded plugin-rendered surfaces
   * outright. The user reversed that exclusion in writing, and PLUGINS-009 is
   * the reversal: a plugin may now contribute its own menu through the kit. So
   * a row inside `[data-plugin-surface]` does open a menu again — the *plugin's*.
   *
   * What UI-036 is actually about survives untouched, and is what is asserted
   * here: **core** paints no menu over a surface it handed to a plugin. Core's
   * frame is `[data-ctx-menu]`; the plugin's is its own element, built from the
   * kit's `.ac-menu` and carrying the item's actions rather than a document's.
   * The distinction is the whole rule — the exclusion reads on where the markup
   * came from, never on a document's type.
   */
  test("leaves a plugin column body's own rows to the plugin, never to core", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, TODOS_COLUMN_VIEW, TODO]);
    await stubTodoLists(page);
    await page.goto("/");

    const item = page.locator('.col[data-col="doc_view_todos"] .check').first();
    await expect(item).toContainText("Call the plumber");
    await expect(page.locator('.col[data-col="doc_view_todos"] [data-plugin-surface]')).toHaveCount(
      1,
    );

    await item.click({ button: "right" });
    // Core's own frame never appears over a plugin surface…
    await expect(page.locator("[data-ctx-menu]")).toHaveCount(0);
    // …and what does appear is the plugin's, naming the item rather than a document.
    await expect(page.locator("[data-todo-menu]")).toHaveAttribute(
      "aria-label",
      "Actions for Call the plumber",
    );

    // The core column beside it is unaffected: same page, same gesture, core's menu.
    await page.keyboard.press("Escape");
    await page.locator('.row[data-row-doc="doc_todo"]').click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Actions for Inbox chores" })).toBeVisible();
    await expect(page.locator("[data-ctx-menu]")).toHaveCount(1);
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

  /**
   * UI-030, and the first e2e case that has ever touched the ⋯ *button*
   * popover — every other test in this file goes through the right-click frame.
   *
   * The evaluator's finding was that this menu was decorative from the
   * keyboard: `↓` and Tab both left `document.activeElement` on the ⋯ trigger,
   * so `↵` re-toggled the trigger and no action could be run without a mouse.
   * Nothing below touches the pointer after the reader is open.
   */
  test("the ⋯ popover is operable from the keyboard alone", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();

    const dots = page.locator(".reader [data-doc-menu]");
    await dots.focus();
    /*
     * Space, not ↵, and deliberately: with no menu open the scope is still the
     * board's, so `rows.open` matches `↵` on the document listener and
     * `preventDefault()` cancels the focused button's activation before it can
     * open anything. Nothing binds Space, so the trigger's own default action
     * survives. That preemption is the board's, not this sheet's — UI-030 is
     * about what the keyboard can do *inside* the popover, which is everything
     * below — and it is reported as its own finding.
     */
    await page.keyboard.press("Space");

    const menu = page.getByRole("menu", { name: "Document actions" });
    await expect(menu).toBeVisible();
    // Focus is in the sheet, not still on the trigger — the finding itself.
    await expect(dots).not.toBeFocused();

    // esc first: it closes, runs nothing, and gives the trigger its focus back.
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="review"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(dots).toBeFocused();
    expect((await corpus.doc("doc_note"))?.status).toBe("open");

    // Then the drill from the issue: open, arrow to Archive, ↵ — it runs.
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[data-act="archive"]')).toBeFocused();
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("archived");
    await expect(menu).toHaveCount(0);
  });
});
