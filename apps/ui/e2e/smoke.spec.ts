import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { DARK_BG, LIGHT_ACCENT, LIGHT_BG } from "./tokens";

const boardCss = readFileSync(
  fileURLToPath(new URL("../src/shell/Board.css", import.meta.url)),
  "utf8",
);

/**
 * UI-001 smoke suite. Runs against the real Vite dev server with **no**
 * workspace server on `127.0.0.1:8765` — the shell must render and report that
 * honestly. The proxy paths are exercised with `curl` against a real origin and
 * recorded in the issue's E2E log (re-verified in SERVER-003).
 */

/*
 * Each test gets a fresh browser context, so `localStorage` starts empty and
 * every test begins in `system` mode. Do NOT reset it with `addInitScript` —
 * that re-runs on reload and would erase the very value the reload tests are
 * checking survives.
 */

function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
}

function themeAttribute(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

test.describe("shell", () => {
  test("boots with the three regions in document order and no uncaught error", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await page.goto("/");

    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".board")).toBeVisible();
    await expect(page.locator(".console-strip")).toBeVisible();

    const order = await page.evaluate(() =>
      [...(document.querySelector(".app")?.children ?? [])].map((child) => child.className),
    );
    expect(order).toEqual(["topbar", "board", "console"]);
    expect(uncaught).toEqual([]);
  });

  test("top bar matches the design prototype", async ({ page }) => {
    await page.goto("/");

    const wordmark = page.locator(".wordmark");
    await expect(wordmark).toContainText("Corpus");
    await expect(wordmark.locator("small")).toHaveText("workbench");
    await expect(wordmark).toHaveCSS("font-family", /Iowan Old Style|Palatino|Georgia|serif/);
    await expect(wordmark.locator("small")).toHaveCSS("text-transform", "uppercase");
    await expect(wordmark.locator("small")).toHaveCSS("font-family", /mono|Menlo|Consolas/i);

    const search = page.locator(".searchbar");
    expect(await search.evaluate((element) => element.tagName)).toBe("BUTTON");
    await expect(search).toContainText("Search corpus — documents, threads, skills…");
    await expect(search.locator("kbd")).toHaveText("⌘K");
    await expect(page.locator(".searchbar input")).toHaveCount(0);

    const compose = page.locator(".btn-compose");
    await expect(compose).toContainText("＋ Ask / Capture");
    await expect(compose.locator("kbd")).toHaveText("c");
    await expect(compose).toHaveCSS("background-color", LIGHT_ACCENT);
  });

  test("the not-yet-wired affordances are enabled and inert", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");

    for (const selector of [".searchbar", ".btn-compose"]) {
      const button = page.locator(selector);
      await expect(button).toBeEnabled();
      expect(await button.getAttribute("aria-disabled")).toBeNull();
      await button.click();
    }

    await expect(page.locator(".topbar")).toBeVisible();
    expect(uncaught).toEqual([]);
  });

  test("the board is a horizontal snap scroller that takes the flexible middle", async ({
    page,
  }) => {
    await page.goto("/");
    const board = page.locator(".board");

    await expect(board).toHaveCSS("overflow-x", "auto");
    await expect(board).toHaveCSS("overflow-y", "hidden");
    // Authored as `x proximity`; Chromium serialises the computed value as `x`
    // because `proximity` is the initial strictness. Assert both ends: the
    // effective axis in the browser, and the declaration in the stylesheet.
    await expect(board).toHaveCSS("scroll-snap-type", /^x( proximity)?$/);
    expect(boardCss).toContain("scroll-snap-type: x proximity;");

    const grow = await page.evaluate(() => ({
      topbar: window.getComputedStyle(document.querySelector(".topbar") as Element).flexGrow,
      board: window.getComputedStyle(document.querySelector(".board") as Element).flexGrow,
      console: window.getComputedStyle(document.querySelector(".console") as Element).flexGrow,
    }));
    expect(grow).toEqual({ topbar: "0", board: "1", console: "0" });
  });

  test("the console strip pushes the board and never overlays it", async ({ page }) => {
    await page.goto("/");
    const console_ = page.locator(".console");

    const position = await console_.evaluate(
      (element) => window.getComputedStyle(element).position,
    );
    expect(["static", "relative"]).toContain(position);

    const boardBox = await page.locator(".board").boundingBox();
    const consoleBox = await console_.boundingBox();
    expect(boardBox).not.toBeNull();
    expect(consoleBox).not.toBeNull();
    if (boardBox === null || consoleBox === null) return;
    expect(consoleBox.y).toBeGreaterThanOrEqual(boardBox.y + boardBox.height - 1);
    // One collapsed line: the strip's own height, not a drawer.
    expect(consoleBox.height).toBeLessThan(48);
  });

  test("no sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app > aside")).toHaveCount(0);
  });
});

test.describe("theme", () => {
  test("the toggle cycles system → light → dark → system and repaints", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });

    // system: no attribute at all, so the OS media query stays in charge.
    expect(await themeAttribute(page)).toBeNull();
    await expect(toggle).toHaveAttribute("aria-label", /^Theme: system/);

    await toggle.click();
    expect(await themeAttribute(page)).toBe("light");
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
    await expect(toggle).toHaveAttribute("aria-label", /^Theme: light/);

    await toggle.click();
    expect(await themeAttribute(page)).toBe("dark");
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(toggle).toHaveAttribute("aria-label", /^Theme: dark/);

    expect(LIGHT_BG).not.toBe(DARK_BG);

    await toggle.click();
    expect(await themeAttribute(page)).toBeNull();
    await expect(toggle).toHaveAttribute("aria-label", /^Theme: system/);
  });

  test("the chosen theme survives a reload", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click();
    await toggle.click();
    expect(await themeAttribute(page)).toBe("dark");

    await page.reload();
    expect(await themeAttribute(page)).toBe("dark");
    expect(await bodyBackground(page)).toBe(DARK_BG);
  });

  test("the theme is applied before the bundle runs, so no light frame is painted", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click();
    await toggle.click();
    expect(await themeAttribute(page)).toBe("dark");

    // Block the module bundle: whatever sets `data-theme` now cannot be React.
    await page.route("**/src/main.tsx*", (route) => route.abort());
    await page.reload();

    // React demonstrably never ran (#root is empty), yet the attribute is
    // already there — set by the inline script in `index.html`, before paint.
    // The background is not asserted here: in dev the stylesheet is imported by
    // the very bundle this test blocks. The reload test above covers the paint.
    await expect(page.locator("#root")).toBeEmpty();
    expect(await themeAttribute(page)).toBe("dark");
  });

  test("system mode follows the OS preference live, writing no attribute", async ({ page }) => {
    await page.goto("/");
    expect(await themeAttribute(page)).toBeNull();

    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bodyBackground(page)).toBe(DARK_BG);
    expect(await themeAttribute(page)).toBeNull();

    await page.emulateMedia({ colorScheme: "light" });
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
    expect(await themeAttribute(page)).toBeNull();
  });

  test("focus rings match the prototype", async ({ page }) => {
    await page.goto("/");
    const compose = page.locator(".btn-compose");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(compose).toBeFocused();

    await expect(compose).toHaveCSS("outline-width", "2px");
    await expect(compose).toHaveCSS("outline-style", "solid");
    await expect(compose).toHaveCSS("outline-color", LIGHT_ACCENT);
    await expect(compose).toHaveCSS("outline-offset", "2px");
    await expect(compose).toHaveCSS("border-radius", "4px");
  });
});

test.describe("server state", () => {
  test("a failing health check fails soft with a notice in the console strip", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await page.goto("/");

    await expect(page.locator(".console-strip .c-failed")).toHaveText("server unreachable", {
      timeout: 15_000,
    });
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".board")).toBeVisible();
    expect(uncaught).toEqual([]);
  });

  test("an unknown route renders the shell rather than a blank page", async ({ page }) => {
    await page.goto("/nope");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".board")).toBeVisible();
    await expect(page.locator(".console-strip")).toBeVisible();
  });
});
