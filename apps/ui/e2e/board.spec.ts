import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-003's board suite, in a real browser.
 *
 * Like the rest of the suite it runs against the Vite dev server with **no**
 * workspace server on `127.0.0.1:8765` — which for this issue is not a
 * limitation but a fixture: a board that can reach no pinned view documents is
 * exactly SPEC.md §10's zero-column case, and the honest answer to it is the
 * ghost column and nothing else.
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
  test("is a ghost column, and never a blank screen, with nothing pinned", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await page.goto("/");

    const ghost = page.locator(".board .ghost-col");
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText("New list — a folder, a view, or any filter");
    await expect(ghost.locator(".plus")).toHaveText("＋");
    // No column can exist without a pinned view document to back it.
    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  test("the ghost column matches the prototype in both themes", async ({ page }) => {
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
    await page.goto("/");
    const last = await page.evaluate(() => {
      const board = document.querySelector(".board");
      return board?.lastElementChild?.className ?? "";
    });
    expect(last).toContain("ghost-col");
  });

  test("the new-list picker opens at the click point, clamped to the viewport", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".ghost-col").click();

    const menu = page.locator(".ac-menu.open");
    await expect(menu).toBeVisible();
    // Presets are the library; folders come from `GET /api/tree`, which has no
    // server to answer it here, so the menu correctly offers none.
    await expect(menu.getByRole("menuitem", { name: /Due this week/ })).toBeVisible();
    // Plugin column types come from the registry (PLUGINS-001): the dev tree
    // carries plugins/_fixture, so its column type is a real picker entry.
    await expect(menu.locator("[data-newlist='plugin:_fixture/sample']")).toBeVisible();
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
   * folders, the presets and the registered plugin columns. Measured before the
   * fix, seven items and nothing unusual:
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
        scroll: node.scrollHeight,
        below: window.innerHeight - node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
      }));

      // Ordinary content, read rather than scrolled: the whole menu fits, and
      // it fits because it was given the room it had, not because the list
      // happens to be short today.
      expect(
        room.scroll,
        `${String(room.scroll)}px of items in a ${String(room.client)}px menu, ` +
          `with ${String(Math.round(room.below))}px of room below it`,
      ).toBeLessThanOrEqual(room.client + 1);

      // …and the bound really is the room: the menu never leaves the window,
      // which is what makes taking the whole of it safe (UI-136's direction).
      expect(room.bottom).toBeLessThanOrEqual(room.viewport);
    });
  }

  test("the picker closes on Escape and on a click outside", async ({ page }) => {
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

  test("a refused pin says so in a toast rather than pretending it worked", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await page.goto("/");
    await page.locator(".ghost-col").click();
    await page.getByRole("menuitem", { name: /Due this week/ }).click();

    const toast = page.locator(".toast[data-tone='error']");
    await expect(toast).toContainText("Pin failed", { timeout: 15_000 });
    // Nothing appeared on the board: the column exists only once the document does.
    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  test("stores no corpus state in the browser", async ({ page }) => {
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
