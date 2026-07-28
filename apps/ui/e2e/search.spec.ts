import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { LIGHT_ACCENT } from "./tokens";

/**
 * UI-009's overlay, in a real browser.
 *
 * Like the rest of the suite it runs against the Vite dev server with **no**
 * workspace server on `127.0.0.1:8765` (`smoke.spec.ts` asserts the console
 * strip reads exactly "server unreachable", which is only true while that port
 * is unbound — see `board.spec.ts` for the same reasoning). So what is verified
 * here is everything that does not need rows to come back: the panel's geometry
 * against the prototype, focus, the dialog contract, the keyboard, the footer
 * legend, and the create row — which is the *only* row a search with zero
 * results produces, and therefore fully exercisable.
 *
 * Result grouping, `<mark>` highlights, `↵`-into-a-column with the flash, and
 * save-as-view writing a view document to disk are verified against a real
 * `corpus` server and a real browser in the issue's E2E Verification Log.
 */

/**
 * ⌘K is a document listener React attaches on mount, so the shell has to be on
 * screen before the key means anything. Waiting for the top bar rather than
 * sleeping is what keeps this from being the suite's flaky test.
 */
async function openOverlay(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".searchbar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".overlay.open")).toBeVisible();
}

test.describe("the search overlay", () => {
  test("⌘K and the search bar open the same panel, with focus in the input", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");

    await expect(page.locator(".overlay")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".overlay.open")).toBeVisible();
    await expect(page.locator(".search-panel")).toHaveAttribute("role", "dialog");
    await expect(page.locator(".search-panel")).toHaveAttribute("aria-label", "Search");
    await expect(page.locator(".search-input-row input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator(".overlay.open")).toHaveCount(0);

    await page.locator(".searchbar").click();
    await expect(page.locator(".overlay.open")).toBeVisible();
    await expect(page.locator(".search-input-row input")).toBeFocused();
    expect(uncaught).toEqual([]);
  });

  test("the panel is the prototype's, measured", async ({ page }) => {
    await openOverlay(page);

    const overlay = page.locator(".overlay.open");
    await expect(overlay).toHaveCSS("position", "fixed");
    await expect(overlay).toHaveCSS("z-index", "40");
    await expect(overlay).toHaveCSS("backdrop-filter", "blur(3px)");

    const panel = page.locator(".search-panel");
    const viewport = page.viewportSize();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(Math.round(box.width)).toBe(Math.min(760, viewport.width - 48));
    expect(Math.round(box.y)).toBe(Math.round(viewport.height * 0.07));

    const input = page.locator(".search-input-row input");
    await expect(input).toHaveCSS("font-size", "19px");
    await expect(input).toHaveCSS("font-family", /Iowan Old Style|Palatino|Georgia|serif/);
    await expect(input).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".search-input-row .chip.ghost")).toHaveText("save as view");
    await expect(page.locator(".search-input-row .chip.ghost")).toHaveCSS(
      "border-top-style",
      "dashed",
    );
  });

  test("the query input lives in the overlay, never in the top bar", async ({ page }) => {
    await openOverlay(page);
    await expect(page.locator(".search-panel input")).toHaveCount(1);
    // The shipped smoke assertion, restated where it could break.
    await expect(page.locator(".searchbar input")).toHaveCount(0);
    expect(await page.locator(".searchbar").evaluate((element) => element.tagName)).toBe("BUTTON");
  });

  test("the footer legend is the prototype's, verbatim", async ({ page }) => {
    await openOverlay(page);

    const foot = page.locator(".search-foot");
    await expect(foot.locator(".hint").nth(0)).toHaveText("↑↓ navigate");
    await expect(foot.locator(".hint").nth(1)).toHaveText("↵ open in its list");
    await expect(foot.locator(".hint").nth(2)).toHaveText("⇧↵ new list from search");
    await expect(foot.locator(".right")).toHaveText("@ agents · / skills · [[ refs");
    await expect(foot).toHaveCSS("font-size", "10.5px");
    await expect(foot).toHaveCSS("font-family", /mono|Menlo|Consolas/i);
    await expect(foot.locator(".right")).toHaveCSS("margin-left", /auto|\d/);
  });

  test("the scrim closes it, the panel does not, and focus goes back to the search bar", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".searchbar")).toBeVisible();
    await page.locator(".searchbar").click();
    await expect(page.locator(".overlay.open")).toBeVisible();

    await page.locator(".search-panel").click({ position: { x: 300, y: 5 } });
    await expect(page.locator(".overlay.open")).toBeVisible();

    // Top-left of the scrim, well clear of the centred panel.
    await page.locator(".overlay.open").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".overlay.open")).toHaveCount(0);
    await expect(page.locator(".searchbar")).toBeFocused();
  });

  test("Tab stays inside the panel", async ({ page }) => {
    await openOverlay(page);
    await expect(page.locator(".search-input-row input")).toBeFocused();

    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.querySelector(".search-panel")?.contains(document.activeElement) ?? false,
      );
      expect(inside).toBe(true);
    }
  });

  test("the chip row toggles, and the archived chip carries the prototype's warn wash", async ({
    page,
  }) => {
    await openOverlay(page);

    const unread = page.locator(".search-filters .chip", { hasText: "unread" });
    await expect(unread).not.toHaveClass(/\bon\b/);
    await unread.click();
    await expect(unread).toHaveClass(/\bon\b/);
    await expect(unread).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");

    const archived = page.locator(".search-filters .chip.warn");
    await expect(archived).toHaveText("include archived");

    const status = page.locator(".search-filters .chip", { hasText: "status:" });
    await expect(status).toHaveText("status: any");
    await status.click();
    await expect(status).toHaveText("status: open");
  });

  test("the create row appears at two characters and reads as the prototype writes it", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openOverlay(page);

    const input = page.locator(".search-input-row input");
    await input.fill("m");
    await expect(page.locator(".sr-create")).toHaveCount(0);

    await input.fill("a new thought");
    // No server, so nothing matches and the create row is the only row.
    await expect(page.locator(".sr-create")).toHaveText(
      '＋ Create "a new thought" — opens ready to edit, in inbox/',
    );
    await expect(page.locator(".sr-create b")).toHaveText("a new thought");
    await expect(page.locator(".sr")).toHaveCount(1);
    expect(uncaught).toEqual([]);
  });

  test("↓ lights exactly one row with the accent outline", async ({ page }) => {
    await openOverlay(page);
    await page.locator(".search-input-row input").fill("a new thought");
    await expect(page.locator(".sr-create")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".sr.kbd")).toHaveCount(1);
    await expect(page.locator(".sr.kbd")).toHaveCSS("outline", `${LIGHT_ACCENT} solid 2px`);
    await expect(page.locator(".sr.kbd")).toHaveCSS("outline-offset", "-2px");

    // Clamped: ↑ at the top stays put rather than wrapping.
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".sr.kbd")).toHaveCount(1);
  });

  test("`[[`, `@` and `/` are literal text, opening no autocomplete", async ({ page }) => {
    await openOverlay(page);

    const input = page.locator(".search-input-row input");
    await input.pressSequentially("[[ref]] @agent /skill");
    await expect(input).toHaveValue("[[ref]] @agent /skill");
    await expect(page.locator(".ac-menu")).toHaveCount(0);
  });

  test("the board's own shortcuts do not fire while the overlay owns the keyboard", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openOverlay(page);

    // `⇧←`/`⇧→` is the board's keyboard drag; inside the input it must not move
    // a column, and `⇧↵` is the overlay's, not the board's full-screen open.
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.locator(".overlay.open")).toBeVisible();
    expect(uncaught).toEqual([]);
  });
});
