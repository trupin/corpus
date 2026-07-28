import { expect, test } from "./coverage";

/**
 * UI-003's board suite, in a real browser.
 *
 * Like the rest of the suite it runs against the Vite dev server with **no**
 * workspace server on `127.0.0.1:8765` — which for this issue is not a
 * limitation but a fixture: a board that can reach no pinned view documents is
 * exactly SPEC.md §11's zero-column case, and the honest answer to it is the
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
    await expect(menu).toContainText("plugin column types appear here too");
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
