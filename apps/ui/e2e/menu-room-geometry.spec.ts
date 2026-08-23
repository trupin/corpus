import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **The context menu is as large as its place allows** — SPEC.md §10's rider
 * signed 2026-08-21 (SHARED-061), measured in a real browser (UI-145).
 *
 * ## What was wrong, in numbers
 *
 * `apps/ui/src/menu/menu.css` declared `.ctx-menu { max-height: min(60vh,
 * 420px) }`. **That rule never applied.** `@corpus/kit`'s `.ac-menu { max-height:
 * 200px }` ties with it on specificity — one class each — and `main.tsx` imports
 * `./app/App` on the line above its kit stylesheets, so every kit rule is
 * injected after every app rule and wins every tie. Measured in Chromium before
 * the fix, on a 1280×720 window:
 *
 *     items   computed max-height   box   content   verdict
 *     -----   -------------------   ---   -------   -----------------------
 *       5     200px                 198     253     scrolls, 520px unused
 *       7     200px                 198     351     scrolls, 480px unused
 *
 * A five-item row menu scrolled in a window with 520px going spare, which is
 * the rider's *"scrolling is for content that cannot fit, never for content that
 * was not given room"* exactly.
 *
 * ## Why this file measures the computed value and never the declared one
 *
 * This is the point of the issue and not a detail of it. A test that reads the
 * stylesheet, or that opens a menu short enough to fit inside 200px, **passes
 * with the bug fully present** — UI-142 audited this very surface and recorded
 * it as latent on the strength of the declaration. So every assertion here reads
 * `getComputedStyle` off the painted element, and the fixtures are chosen to
 * overflow the number that used to be in force.
 *
 * ## And every assertion is a relationship
 *
 * Nothing below names a pixel count for the ceiling, because a ceiling that is a
 * constant is the defect. Each test states the rule: the ceiling is the distance
 * between the menu's top edge and the foot of the window, a larger window makes
 * it larger, and an ordinary menu is read rather than scrolled.
 */

const INBOX_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Mortgage options",
  path: "data/docs/inbox/mortgage-options.md",
  body: "6.4% this week.\n",
};

/**
 * The longest row menu this build can draw: a very stale document adds
 * *Still current* and *@agent triage* to the five every row has.
 *
 * It is here because **five items is not the ceiling of this menu and never
 * was** — UI-149 is about to add four more — so a spec that only ever opened
 * the five-item menu would stop being evidence the moment the menu grew. Seven
 * items measured 351px of content against the 200px that used to be in force.
 */
const STALE: StubRow = {
  id: "doc_stale",
  title: "Rates review",
  path: "data/docs/inbox/rates-review.md",
  body: "Older than the workspace's last threshold.\n",
  stale: "very-stale",
};

/** So `@` lists something beyond the generic `@agent`. */
const RESEARCHER: StubRow = {
  id: "doc_researcher",
  type: "agent-def",
  title: "Researcher",
  path: ".claude/agents/researcher.md",
  body: "Reads things.\n",
};

const CORPUS = [INBOX_VIEW, NOTE, STALE, RESEARCHER];

/** Enough rows that the column reaches the foot of a 720px window. */
const FILLER: readonly StubRow[] = Array.from({ length: 24 }, (_unused, index) => ({
  id: `doc_filler_${String(index)}`,
  title: `Filler ${String(index)}`,
  path: `data/docs/inbox/filler-${String(index)}.md`,
  body: "Nothing in particular.\n",
}));

/** The gap the menu keeps from the foot of the window (`MENU_MARGIN`). */
const MARGIN = 4;

interface MenuGeometry {
  readonly items: number;
  /** The ceiling actually in force, off `getComputedStyle` — never the declared one. */
  readonly maxHeight: number;
  /** The room between the menu's top edge and the foot of the window. */
  readonly room: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly top: number;
  readonly bottom: number;
  readonly viewport: number;
}

async function geometryOf(menu: Locator): Promise<MenuGeometry> {
  return menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      items: element.querySelectorAll('[role="menuitem"]').length,
      maxHeight: Number.parseFloat(getComputedStyle(element).maxHeight),
      room: globalThis.innerHeight - rect.top - 4,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      top: rect.top,
      bottom: rect.bottom,
      viewport: globalThis.innerHeight,
    };
  });
}

/** A point inside the lowest row the window currently shows. */
async function lowestVisibleRow(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    /*
     * Bounded by the **board**, not only by the window (UI-148). A column clips
     * its list, so a row scrolled past the fold still reports a rect above
     * `innerHeight` — and right-clicking there lands on the console strip
     * instead of on a row. The board bar took 38px off the board, which is what
     * made a latent fixture bug reachable at 1280×720.
     */
    const board = document.querySelector(".board")?.getBoundingClientRect();
    const floor = Math.min(globalThis.innerHeight, board?.bottom ?? globalThis.innerHeight);
    let best: { x: number; y: number } | null = null;
    for (const row of document.querySelectorAll(".row")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > floor || rect.height === 0) continue;
      if (best === null || rect.bottom > best.y) {
        best = { x: Math.round(rect.left + 8), y: Math.round(rect.bottom - 4) };
      }
    }
    if (best === null) throw new Error("no row is fully visible");
    return best;
  });
}

/** Right-clicks a row and returns the open menu. */
async function openRowMenu(page: Page, docId: string, at = { x: 6, y: 6 }): Promise<Locator> {
  const row = page.locator(`.row[data-row-doc="${docId}"]`);
  await expect(row).toBeVisible();
  await row.click({ button: "right", position: at });
  const menu = page.locator("[data-ctx-menu]");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("the context menu's ceiling", () => {
  test("is the room between the menu and the foot of the window, not a number", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);

    const measured: MenuGeometry[] = [];
    for (const height of [720, 1080]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto("/");
      const menu = await openRowMenu(page, "doc_note");
      const geometry = await geometryOf(menu);

      // The ceiling *is* the subtraction. A constant — 200, 420, or `60vh` —
      // cannot satisfy this at two viewport heights and one pointer position.
      expect(geometry.maxHeight).toBeCloseTo(geometry.room, 0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport - MARGIN + 1);
      measured.push(geometry);

      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }

    // A larger window makes it larger — SHARED-061's own test of a derived bound.
    const [short, tall] = measured;
    expect(short).toBeDefined();
    expect(tall).toBeDefined();
    expect(tall?.maxHeight ?? 0).toBeGreaterThan(short?.maxHeight ?? 0);
  });

  test("lets a five-item row menu be read rather than scrolled at 720px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubCorpus(page, CORPUS);
    await page.goto("/");

    const menu = await openRowMenu(page, "doc_note");
    const geometry = await geometryOf(menu);

    expect(geometry.items).toBe(5);
    // The reproduction: 198 against 253 before the fix.
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    // And it is not fitting by luck — the window has room to spare it did not use.
    expect(geometry.maxHeight).toBeGreaterThan(geometry.scrollHeight);
  });

  test("holds for a menu longer than five items", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubCorpus(page, CORPUS);
    await page.goto("/");

    const menu = await openRowMenu(page, "doc_stale");
    const geometry = await geometryOf(menu);

    // Seven today; UI-149 adds four more. The assertion is the rule, not the count.
    expect(geometry.items).toBeGreaterThan(5);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  });

  test("slides up at the foot of the window rather than scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubCorpus(page, [INBOX_VIEW, ...FILLER, STALE]);
    await page.goto("/");
    await expect(page.locator(".row").first()).toBeVisible();

    // The lowest row the window actually shows: right-clicking it leaves less
    // room below the pointer than the menu needs. Claiming the room *above* is
    // what a scrollbar would otherwise be hiding.
    const target = await lowestVisibleRow(page);
    await page.mouse.click(target.x, target.y, { button: "right" });
    const menu = page.locator("[data-ctx-menu]");
    await expect(menu).toBeVisible();
    const geometry = await geometryOf(menu);

    expect(geometry.top).toBeLessThan(target.y);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport - MARGIN + 1);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.maxHeight).toBeCloseTo(geometry.room, 0);
  });

  test("bounds an unfittable menu by the window and scrolls only then", async ({ page }) => {
    // A window shorter than the menu's own content: the one case where a
    // scrollbar is the honest answer, because the content *cannot* fit.
    await page.setViewportSize({ width: 1280, height: 260 });
    await stubCorpus(page, CORPUS);
    await page.goto("/");

    const menu = await openRowMenu(page, "doc_stale");
    const geometry = await geometryOf(menu);

    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    // It took every pixel the window had before it gave up: top at the margin,
    // bottom at the margin.
    expect(geometry.top).toBeCloseTo(MARGIN, 0);
    expect(geometry.maxHeight).toBeCloseTo(geometry.viewport - 2 * MARGIN, 0);
  });
});

test.describe("the completion menu", () => {
  /**
   * The two surfaces answer to `.ac-menu` and they do **not** want the same
   * bound, which is why the context menu's is now inline and this one's is not.
   *
   * A completion list is narrowed by typing: the next keystroke shortens it, so
   * a small window over a long list is a step in a loop rather than a cage, and
   * `200px` keeps the composer's line in view while the list is open. A context
   * menu is filtered by nothing — every item it will ever show is already on
   * screen — so its whole content is what a person has to read.
   */
  test("keeps its own 200px bound, which the context menu's fix does not touch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.keyboard.press("c");
    const box = page.getByLabel("Ask the agent, or capture a thought");
    await expect(box).toBeFocused();
    await box.pressSequentially("@");

    const menu = page.getByRole("listbox", { name: "Composer completions" });
    await expect(menu).toBeVisible();
    const bound = await menu.evaluate((element) => ({
      maxHeight: getComputedStyle(element).maxHeight,
      isContextMenu: element.classList.contains("ctx-menu"),
      inline: element.style.maxHeight,
    }));

    expect(bound.isContextMenu).toBe(false);
    expect(bound.inline).toBe("");
    expect(bound.maxHeight).toBe("200px");
  });
});
