import { MENU_MARGIN } from "../src/menu/menuModel";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-003's board suite, in a real browser.
 *
 * Like the rest of the suite it runs against the Vite dev server with **no**
 * workspace server on `127.0.0.1:8765`. Since UI-148 that is no longer a fixture
 * for the zero-column case: a column is a view document **a board lists**, so a
 * board is needed before a column can be absent from one. The empty-board tests
 * below stub a `type: board` document with `columns: []`, which is SPEC.md §10's
 * zero-column case stated the way rider 2 states it.
 *
 * The column CRUD half — a drag writing `order` into a view document, `＋`
 * creating into a folder, unpin archiving rather than deleting — is verified
 * against a real `corpus` server and a real browser in the issue's E2E
 * Verification Log. It is deliberately not here: `playwright.config.ts` starts
 * one Vite whose proxy target is fixed, and `smoke.spec.ts` asserts the console
 * strip reads exactly "server unreachable", which is only true while 8765 is
 * unbound. Pointing this suite at a spawned server would turn three unrelated
 * tests red (sprint-009 Open Conflict 12 — the recommendation is explicitly
 * droppable, and this is why it was dropped).
 */

test.describe("the board", () => {
  /**
   * The board document lists no columns, so the board says so and offers the
   * ghost — never a blank screen (SPEC.md §10, rider 2).
   */
  const EMPTY_BOARD: StubRow = {
    id: "doc_board_empty",
    type: "board",
    title: "Files",
    path: "data/docs/boards/files.md",
    order: 1,
    columns: [],
    defaultOpen: true,
  };

  test("a board with no columns shows the empty state and the ghost column", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");

    // The bar is drawn from the document, and it is the showing board.
    await expect(page.locator('.boardbar .board-tab[data-board="doc_board_empty"]')).toHaveClass(
      /\bon\b/,
    );

    const empty = page.locator(".board .board-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Files is empty");
    await expect(empty).toContainText("boards/doc_board_empty.md");

    const ghost = page.locator(".board .ghost-col");
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText("New list — a folder, a view, or any filter");
    await expect(ghost.locator(".plus")).toHaveText("＋");
    // No column can exist without the board listing a view document.
    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  test("the ghost column matches the prototype in both themes", async ({ page }) => {
    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");
    const ghost = page.locator(".board .ghost-col");
    const toggle = page.getByRole("button", { name: /^Theme:/ });

    for (const _theme of ["light", "dark"]) {
      await toggle.click();
      await expect(ghost).toHaveCSS("width", "220px");
      await expect(ghost).toHaveCSS("border-style", "dashed");
      await expect(ghost).toHaveCSS("cursor", "pointer");
      await expect(ghost).toHaveCSS("box-shadow", "none");
    }
  });

  test("the ghost column is the last thing in the scroller", async ({ page }) => {
    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");
    await expect(page.locator(".board .ghost-col")).toBeVisible();
    const last = await page.evaluate(() => {
      const board = document.querySelector(".board");
      return board?.lastElementChild?.className ?? "";
    });
    expect(last).toContain("ghost-col");
  });

  test("the new-list picker opens at the click point, clamped to the viewport", async ({
    page,
  }) => {
    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");
    await page.locator(".ghost-col").click();

    const menu = page.locator(".ac-menu.open");
    await expect(menu).toBeVisible();
    // Presets are the library; folders come from `GET /api/tree`, which the
    // stub now derives from the seeded paths (UI-150) — so this seed's one
    // folder, `boards/`, is offered beside the five presets. It answered
    // `{ folders: [] }` until then, and every folder branch of this menu was
    // therefore unreachable from any spec.
    await expect(menu.getByRole("menuitem", { name: /Due this week/ })).toBeVisible();
    await expect(menu.locator("[data-newlist='folder:boards']")).toHaveCount(1);
    // Folders, presets and the search — three sources and no fourth. Nothing
    // in this menu is discovered at runtime.
    await expect(menu.locator("[data-newlist]")).toHaveCount(6);
    // "From current search" needs a search query, and UI-009 owns that.
    await expect(menu.locator("[data-newlist='search:current']")).toHaveCount(0);

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  /**
   * **The picker is as tall as the room below it** — SPEC.md §10's rider
   * authorized 2026-08-21 (SHARED-061), measured in a real browser (UI-142).
   *
   * It is the second surface that audit found bounded well below its room, and
   * arguably the first a person meets: the ghost column is what an empty board
   * offers, and this menu is what it opens. `.ac-menu`'s shared 200px ceiling
   * is the right register for a completion list — corpus-driven, filtered by
   * typing — and the wrong one here, where the items are the workspace's own
   * folders, the presets and the current search. Measured before the fix, seven
   * items and nothing unusual:
   *
   *     1280×720    menu 272×200   219px of items in a 198px box   361px of room below
   *     1728×1080   menu 272×200   219px of items in a 198px box   541px of room below
   *
   * The same clipped box in a window twice the size, an item cut in half at the
   * fold, and the rest behind a scrollbar.
   *
   * Nothing here names a size, deliberately: a pixel count true in one machine's
   * fonts is false in another's, and v0.15.0 lost a CI cycle to exactly that.
   */
  const FOLDERS: readonly StubRow[] = Array.from({ length: 6 }, (_unused, index) => ({
    id: `doc_note_${String(index)}`,
    title: `Note ${String(index)}`,
    path: `data/docs/folder-${String(index)}/note.md`,
  }));

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1728, height: 1080 },
  ] as const) {
    test(`the new-list picker takes the room below it at ${String(size.width)}×${String(size.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await stubCorpus(page, [...FOLDERS]);
      await page.goto("/");
      await page.locator(".ghost-col").click();
      const menu = page.locator(".ac-menu.open");
      await expect(menu).toBeVisible();

      const room = await menu.evaluate((node) => ({
        client: node.clientHeight,
        // The **border box**, which is what `max-height` bounds under
        // `box-sizing: border-box` — so this is the number to compare against
        // the room, and `clientHeight` is it minus the border and any scrollbar.
        outer: node.getBoundingClientRect().height,
        scroll: node.scrollHeight,
        below: window.innerHeight - node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
      }));

      /*
       * **The menu is as tall as the room below it.** That is the invariant
       * UI-142 restored, and it is stated as the invariant rather than as "the
       * whole list fits": once `GET /api/tree` really answers (UI-150 made the
       * stub derive it), a workspace of folders produces more items than any
       * window has room for, and §10 is explicit that scrolling is right for
       * content that cannot fit and wrong for content that was not given room.
       * Asserting "it fits" measured the seed; this measures the box.
       *
       * The defect it guards is unchanged and would still fail here by 141px: a
       * `200px` ceiling in a room of 353 leaves the box far below both terms.
       *
       * The slack is `2 * MENU_MARGIN`, measured: `--newlist-room-h` is set to
       * `innerHeight - top - MENU_MARGIN` and the painted border box came out
       * 4px under it — 337px of box in 345px of room. One margin is the
       * component's own; the second is the tolerance for that measured gap,
       * and it is small enough that a 200px ceiling still fails by 137px.
       */
      expect(
        Math.round(room.outer),
        `a ${String(Math.round(room.outer))}px menu with ${String(Math.round(room.below))}px of ` +
          `room below it, holding ${String(room.scroll)}px of items`,
      ).toBeGreaterThanOrEqual(Math.min(room.scroll, Math.floor(room.below) - 2 * MENU_MARGIN));

      // …and the bound really is the room: the menu never leaves the window,
      // which is what makes taking the whole of it safe (UI-136's direction).
      expect(room.bottom).toBeLessThanOrEqual(room.viewport);
    });
  }

  test("the picker closes on Escape and on a click outside", async ({ page }) => {
    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");
    await page.locator(".ghost-col").click();
    await expect(page.locator(".ac-menu.open")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".ac-menu.open")).toHaveCount(0);

    await page.locator(".ghost-col").click();
    await expect(page.locator(".ac-menu.open")).toBeVisible();
    await page.locator(".topbar").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".ac-menu.open")).toHaveCount(0);
  });

  test("a refused new list says so in a toast rather than pretending it worked", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await stubCorpus(page, [EMPTY_BOARD]);
    // The board reads fine and the **write** is refused, which is the case this
    // is about: `POST /api/docs` answered `500` after the picker was opened.
    await page.route("**/api/docs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "internal", message: "the write path is down" }),
      });
    });
    await page.goto("/");
    await page.locator(".ghost-col").click();
    await page.getByRole("menuitem", { name: /Due this week/ }).click();

    const toast = page.locator(".toast[data-tone='error']");
    await expect(toast).toContainText("New list failed", { timeout: 15_000 });
    // Nothing appeared on the board: the column exists only once the document does.
    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  /**
   * **A view document a workspace already holds still opens, still pins and
   * still renders its query** (SHARED-066), whatever extra keys its frontmatter
   * carries.
   *
   * `column: "<something>/<something>"` is the concrete case, because a
   * workspace's older view documents carry one and the key names nothing this
   * build defines. SPEC.md §9.1 says what happens to any key the core does not
   * define: it is extra frontmatter, preserved verbatim and never interpreted.
   * So the column has to be indistinguishable from one whose file never carried
   * the key — not a missing-renderer card, not a dropped column, and above all
   * not a board that fails to paint.
   *
   * Asserted in a real browser against the shipped board, because the failure
   * this guards against is a person's board coming up empty after an upgrade,
   * and that is a rendering fact rather than a parsing one.
   */
  test("renders a view whose frontmatter carries a key this build does not define", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    const legacy: StubRow = {
      id: "doc_view_legacy",
      type: "view",
      title: "Chores",
      path: "data/docs/views/chores.md",
      query: { type: "todo" },
      extra: { column: "todos/todos" },
    };
    const chore: StubRow = {
      id: "doc_chore",
      type: "todo",
      title: "Call the plumber",
      path: "data/docs/inbox/call-the-plumber.md",
      body: "- [ ] Call the plumber\n",
    };
    await stubCorpus(page, [legacy, chore]);
    await page.goto("/");

    // It landed on the board: a column was drawn, and it is this view's.
    const column = page.locator('.col[data-col="doc_view_legacy"]');
    await expect(column).toBeVisible();
    // As an ordinary view, with its stored query shown as the chips any column
    // shows — no card standing in for a renderer that was never found.
    await expect(column.locator(".col-kind")).toHaveText("view");
    await expect(column.locator(".col-card-error")).toHaveCount(0);
    await expect(column.locator(".chips > .chip").first()).toHaveText("type: todo");
    // And the query ran: the row it selects is in the column.
    await expect(column.locator('.row[data-row-doc="doc_chore"]')).toBeVisible();
    await expect(column.locator('.row[data-row-doc="doc_chore"] .row-title')).toHaveText(
      "Call the plumber",
    );
    // It opens: clicking the row gives the ordinary reader — in a path column
    // to the right, as every row click does since UI-149 (rider 3).
    await column.locator('.row[data-row-doc="doc_chore"]').click();
    await expect(page.locator(".pcol .reader .ProseMirror")).toBeVisible();

    expect(uncaught).toEqual([]);
  });

  test("stores no corpus state in the browser", async ({ page }) => {
    await stubCorpus(page, [EMPTY_BOARD]);
    await page.goto("/");
    await page.locator(".ghost-col").click();
    await page.keyboard.press("Escape");

    const stored = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]),
      ),
    );
    // The board writes a local entry only once it has columns; whatever is here,
    // none of it may be a query, an order, or a column identity.
    const blob = JSON.stringify(stored);
    expect(blob).not.toContain("query");
    expect(blob).not.toContain("order");
    expect(Object.keys(stored).every((key) => key.startsWith("corpus."))).toBe(true);
  });
});
