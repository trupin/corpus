import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * Walks the arrow keys down to `item` and leaves the focus on it.
 *
 * Counting keystrokes to an item was how these tests used to reach one, and it
 * made them assertions about the **length** of a menu that other issues keep
 * adding to — UI-067's Comments entry moved every ⋯ item down by one and broke
 * two of them at once. What the spec claims is that the arrows reach an item and
 * `↵` runs it, so that is what this walks.
 */
async function arrowTo(page: Page, item: Locator): Promise<void> {
  const focused = (): Promise<boolean> =>
    item.evaluate((element) => element === document.activeElement);
  for (let step = 0; step < 12; step += 1) {
    if (await focused()) return;
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
}

/**
 * UI-018 in a real browser: right-clicking an actionable item opens that item's
 * own actions, and leaves the browser's menu alone where it is the useful one
 * (SPEC.md §10).
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
  order: 1,
  query: { folder: "inbox" },
};

/** The second column UI-020 needs: somewhere an archived document is visible. */
const ARCHIVE_VIEW = {
  id: "doc_view_archive",
  type: "view",
  title: "Archive",
  path: "data/docs/views/archive.md",
  order: 2,
  query: { status: "archived" },
};

const NOTE = { id: "doc_note", title: "Mortgage options", body: "6.4% this week." };
const OTHER = { id: "doc_other", title: "Rates" };

/**
 * UI-036's subject: a document whose `type:` this build does not define. `todo`
 * is the real case, because workspaces already hold them — the set of types on
 * the wire is not the set any one build knows (SPEC.md §5). It is an ordinary
 * document in an ordinary column, and it gets the ordinary row menu.
 */
const TODO = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: "- [ ] Call the plumber\n",
};

test.describe("the context menu", () => {
  test("opens a row's own actions at the pointer", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    const row = page.locator('.row[data-row-doc="doc_note"]');
    await expect(row).toBeVisible();
    await row.click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.locator('[data-act="open"]')).toBeVisible();
    await expect(menu.locator('[data-act="open-focus"]')).toBeVisible();
    // UI-094: `resolve` is a note's action too — SPEC.md §5's three statuses are
    // one vocabulary, not a per-type one (rider signed 2026-08-12).
    await expect(menu.locator('[data-act="resolve"]')).toBeVisible();
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
   * SPEC.md §10: "`esc` dismisses, arrows navigate, `↵` activates". UI-028 —
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
   * UI-036, and the regression it pins (sprint-023 TEST-1073, TEST-1078) —
   * SPEC.md §12's M6 at the row menu.
   *
   * **No document type suppresses this menu.** The failure it guards against is
   * a row with no menu at all — no open, no open in focus, no archive, no
   * delete, no staleness, from either input path — which is what a build that
   * decided menus by `type:` would give a `todo` document. The actions are built
   * from the `DocRow` the client already holds, so an unrecognised type changes
   * nothing.
   */
  test("gives a row of an unrecognised type core's whole menu", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE, TODO]);
    await page.goto("/");

    const todoRow = page.locator('.row[data-row-doc="doc_todo"]');
    await expect(todoRow).toBeVisible();

    await todoRow.click({ button: "right" });

    const menu = page.getByRole("menu", { name: "Actions for Inbox chores" });
    await expect(menu).toBeVisible();
    const acts = await menu
      .getByRole("menuitem")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"]));

    // Item for item the same set the note beside it gets — `resolve` included
    // (SPEC.md §10: every document's status is its own to set).
    await page.keyboard.press("Escape");
    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    const noteActs = await page
      .getByRole("menu")
      .getByRole("menuitem")
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"]));
    expect(acts).toEqual(noteActs);
    expect(acts).toContain("resolve");

    // And an action taken from it acts on the document, through the core route.
    await page.keyboard.press("Escape");
    await todoRow.click({ button: "right" });
    await menu.locator('[data-act="archive"]').click();
    await expect.poll(async () => (await corpus.doc("doc_todo"))?.status).toBe("archived");
    expect(await corpus.of("POST", "/api/docs/doc_todo/archive")).toHaveLength(1);
  });

  /** The keyboard half of the same rule (TEST-1074). */
  test("⇧F10 opens that row's menu too, with its first item focused", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, TODO]);
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
     * Space, and for a while Space only: with no menu open the scope was still
     * the board's, so `rows.open` matched `↵` on the document listener and
     * `preventDefault()` cancelled the focused button's activation before it
     * could open anything. Nothing binds Space, so the trigger's own default
     * action survived. That preemption was the board's, not this sheet's, and it
     * was reported as its own finding and fixed in UI-032 — `↵` opens the same
     * popover now, and the case below is the whole path on that key. Space is
     * kept here because it is what a keyboard user reaches for second, and
     * because nothing must ever bind it.
     */
    await page.keyboard.press("Space");

    const menu = page.getByRole("menu", { name: "Document actions" });
    await expect(menu).toBeVisible();
    // Focus is in the sheet, not still on the trigger — the finding itself.
    await expect(dots).not.toBeFocused();

    // esc first: it closes, runs nothing, and gives the trigger its focus back.
    await page.keyboard.press("ArrowDown");
    await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(dots).toBeFocused();
    expect((await corpus.doc("doc_note"))?.status).toBe("open");

    // Then the drill from the issue: open, arrow to Archive, ↵ — it runs.
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await arrowTo(page, menu.locator('[data-act="archive"]'));
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("archived");
    await expect(menu).toHaveCount(0);
  });

  /**
   * UI-032, and the acceptance criterion UI-030 could not meet: the **whole**
   * no-pointer path on `↵` alone — the key a keyboard user actually presses on a
   * focused button, and the one the board was cancelling. It reached the ⋯
   * trigger, the fence copy button and the console's tabs alike, and each was
   * patched where it was found until `Shortcut.yieldsToFocusedControl` replaced
   * the patches with one rule.
   *
   * Only a real browser runs a default action, so the assertions are that the
   * popover **opened** and that the act **ran** — a corpus change, not a
   * keystroke.
   */
  test("the ⋯ popover opens and runs an action on ↵ alone", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();

    const dots = page.locator(".reader [data-doc-menu]");
    await dots.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu", { name: "Document actions" });
    await expect(menu).toBeVisible();
    await expect(dots).not.toBeFocused();

    await arrowTo(page, menu.locator('[data-act="archive"]'));
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("archived");
    await expect(menu).toHaveCount(0);
  });
});

/**
 * UI-094 in a real browser: right-clicking an ordinary document offers Resolve,
 * and taking it changes the corpus.
 *
 * The corpus half is what makes these more than a render assertion — the stub
 * stores what the write left behind, so "resolved" here is the document's own
 * status and not a class on a row. The real-workspace drill (the file on disk
 * and the commit) is in the issue's E2E log.
 */
test.describe("Resolve on any document", () => {
  const ARCHIVED_NOTE = {
    id: "doc_shelved",
    title: "Old plan",
    path: "data/docs/inbox/old-plan.md",
    status: "archived" as const,
    body: "Superseded.",
  };

  test("resolves a note from its row menu, and the note keeps its place", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    const row = page.locator('.row[data-row-doc="doc_note"]');
    await row.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Mortgage options" });
    await expect(menu.locator('[data-act="resolve"]')).toContainText("Resolve");
    await menu.locator('[data-act="resolve"]').click();

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("resolved");
    // SHARED-031: resolving is a statement about what is left to do, never a way
    // to tidy the board. The row is still in the column it was in.
    await expect(row).toBeVisible();

    // And the way back is where you found it: the same menu now reads Reopen.
    await row.click({ button: "right" });
    await expect(menu.locator('[data-act="resolve"]')).toContainText("Reopen");
    await menu.locator('[data-act="resolve"]').click();
    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("open");
    await expect(row).toBeVisible();
  });

  test("resolves through PUT /api/docs/{id}, never the thread route", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
    await page
      .getByRole("menu", { name: "Actions for Mortgage options" })
      .locator('[data-act="resolve"]')
      .click();

    await expect.poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length).toBe(1);
    expect((await corpus.of("PUT", "/api/docs/doc_note"))[0]?.body).toEqual({
      status: "resolved",
    });
    expect(await corpus.of("POST")).toHaveLength(0);
    expect(await corpus.unhandled()).toEqual([]);
  });

  test("offers the reader's ⋯ sheet the same act, on the same terms", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader [data-doc-menu]").click();
    const sheet = page.getByRole("menu", { name: "Document actions" });
    await expect(sheet.locator('[data-act="resolve"]')).toContainText("Resolve");
    await sheet.locator('[data-act="resolve"]').click();

    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("resolved");
  });

  /**
   * Resolve is offered on **every** document, because no document's status is
   * computed from its content — which is what SPEC.md §10 says, and what stops a
   * workspace's `type: todo` documents losing an act they can perform.
   */
  test("offers it on a document whose type this build does not recognise", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW, TODO]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_todo"]').click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Inbox chores" });
    await expect(menu.locator('[data-act="resolve"]')).toContainText("Resolve");
    await menu.locator('[data-act="resolve"]').click();

    await expect.poll(async () => (await corpus.doc("doc_todo"))?.status).toBe("resolved");
  });

  /** SERVER-039 refuses `PUT {status}` on an archived document (§5's top rung). */
  test("withholds it from an archived document, and offers Unarchive instead", async ({ page }) => {
    await stubCorpus(page, [INBOX_VIEW, ARCHIVE_VIEW, ARCHIVED_NOTE]);
    await page.goto("/");

    await page.locator('.row[data-row-doc="doc_shelved"]').click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for Old plan" });
    await expect(menu.locator('[data-act="resolve"]')).toHaveCount(0);
    await expect(menu.locator('[data-act="unarchive"]')).toBeVisible();
  });
});
