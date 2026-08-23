import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-132 — the toast stack, in a real browser.
 *
 * SPEC.md §10's rider (signed 2026-08-20) rules out the shape this suite pins:
 * *"an element that grows pushes whatever is stacked above it… the element
 * under the cursor moves out from under it."* The toast stack was that shape
 * with a timer in place of a hover. `.toast-wrap` was bottom-anchored and the
 * oldest toast — the first of the three to run out of its six seconds — was the
 * bottom child, so every expiry dropped the survivors 47px toward the anchor,
 * through the `✕` a person was already reaching for.
 *
 * Everything here runs against the Vite dev server with **no** workspace server
 * on `127.0.0.1:8765`, like `board.spec.ts`. That is a fixture rather than a
 * limitation: `e` with nothing open and `r` with no thread both raise a real
 * toast through the real keyboard seam without touching the network, so the
 * geometry can be measured without a fixture server deciding when it moves.
 *
 * **The clock is driven, never waited on.** `page.clock.install()` freezes time
 * before the app loads and `clock.runFor` advances it by the exact interval the
 * assertion needs, so "the oldest expired and the other two did not" is a fact
 * about the code and not a race against a real six-second timer.
 */

/** Long enough to wrap past the two lines the toast reserves. */
const LONG_REFUSAL =
  "Pin refused because the view document this list would need already exists under " +
  "another name in the same folder, and creating a second one would leave two " +
  "columns claiming the same query.";

/** Two of the six-second dwells, driven rather than waited on. */
const TWO_DWELLS_MS = 12_000;

/** `e` with nothing open or highlighted, and `r` with no thread: no network. */
async function raise(page: Page, key: "e" | "r"): Promise<void> {
  await page.keyboard.press(key);
}

async function slotBox(page: Page, slot: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.toast[data-slot="${String(slot)}"]`).boundingBox();
  expect(box).not.toBeNull();
  return { x: box?.x ?? -1, y: box?.y ?? -1 };
}

/** Three toasts, two seconds apart, so exactly one dwell can be run out at a time. */
async function threeToasts(page: Page): Promise<void> {
  await raise(page, "e");
  await expect(page.locator(".toast")).toHaveCount(1);
  await page.clock.runFor(2000);
  await raise(page, "r");
  await expect(page.locator(".toast")).toHaveCount(2);
  await page.clock.runFor(2000);
  await raise(page, "e");
  await expect(page.locator(".toast")).toHaveCount(3);
}

test.describe("the toast stack", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    // A board with no columns, which is what the ghost belongs to since UI-148:
    // a column is a view document *a board lists*, so a workspace with no board
    // document has no ghost either.
    await stubCorpus(page, []);
    await page.goto("/");
    await expect(page.locator(".ghost-col")).toBeVisible();
  });

  test("does not move when the oldest expires under the pointer", async ({ page }) => {
    await threeToasts(page);

    // The middle toast is the one the pointer is aimed at, and it is the only
    // one of the three with its own text — `r`'s notice, not `e`'s.
    const middle = page.locator('.toast[data-slot="1"]');
    await expect(middle).toContainText("No thread to reply to");

    const before = { top: await slotBox(page, 2), middle: await slotBox(page, 1) };
    const close = await middle.locator(".close").boundingBox();
    expect(close).not.toBeNull();
    if (close === null) return;
    const aim = { x: close.x + close.width / 2, y: close.y + close.height / 2 };
    await page.mouse.move(aim.x, aim.y);

    // Past the first toast's six seconds, short of the other two.
    await page.clock.runFor(2200);
    await expect(page.locator(".toast")).toHaveCount(2);
    await expect(page.locator('.toast[data-slot="0"]')).toHaveCount(0);

    expect(await slotBox(page, 1)).toEqual(before.middle);
    expect(await slotBox(page, 2)).toEqual(before.top);

    // And the click a person was already committed to still lands on the toast
    // they aimed at, rather than on the one that used to be below it.
    await page.mouse.click(aim.x, aim.y);
    await expect(page.locator('.toast[data-slot="1"]')).toHaveCount(0);
    await expect(page.locator('.toast[data-slot="2"]')).toHaveCount(1);
  });

  test("does not move when a toast is dismissed by its ✕", async ({ page }) => {
    await threeToasts(page);
    const before = { top: await slotBox(page, 2), middle: await slotBox(page, 1) };

    await page.locator('.toast[data-slot="0"] .close').click();
    await expect(page.locator(".toast")).toHaveCount(2);
    expect(await slotBox(page, 1)).toEqual(before.middle);
    expect(await slotBox(page, 2)).toEqual(before.top);
  });

  test("does not move when a toast arrives", async ({ page }) => {
    await raise(page, "e");
    await expect(page.locator(".toast")).toHaveCount(1);
    const anchored = await slotBox(page, 0);

    await raise(page, "r");
    await expect(page.locator(".toast")).toHaveCount(2);
    expect(await slotBox(page, 0)).toEqual(anchored);

    await raise(page, "e");
    await expect(page.locator(".toast")).toHaveCount(3);
    expect(await slotBox(page, 0)).toEqual(anchored);
  });

  test("does not vanish from under the pointer, and goes when it leaves", async ({ page }) => {
    await raise(page, "e");
    const toast = page.locator('.toast[data-slot="0"]');
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Three whole dwells with the pointer resting on it.
    await page.clock.runFor(18_000);
    await expect(toast).toBeVisible();

    // Not immortal: it goes the moment the person is no longer on it.
    await page.mouse.move(4, 4);
    await expect(page.locator(".toast")).toHaveCount(0);
  });

  test("holds a toast the keyboard is on, and never moves the focus", async ({ page }) => {
    await threeToasts(page);
    const close = page.locator('.toast[data-slot="1"] .close');
    await close.focus();

    const focusedSlot = async (): Promise<string | null> =>
      page.evaluate(
        () => document.activeElement?.closest(".toast")?.getAttribute("data-slot") ?? null,
      );
    expect(await focusedSlot()).toBe("1");
    const before = await slotBox(page, 1);

    // The toast below it runs out. The focus ring must not follow it.
    await page.clock.runFor(2200);
    await expect(page.locator(".toast")).toHaveCount(2);
    expect(await focusedSlot()).toBe("1");
    expect(await slotBox(page, 1)).toEqual(before);

    // The focused toast's own dwell runs out, twice over, and it stays — while
    // the unfocused one above it goes on time, which is the control.
    await page.clock.runFor(12_000);
    await expect(page.locator(".toast")).toHaveCount(1);
    await expect(page.locator('.toast[data-slot="1"]')).toHaveCount(1);
    expect(await focusedSlot()).toBe("1");

    // Focus moves on, and the overdue toast goes with it.
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('.toast[data-slot="1"]')).toHaveCount(0);
  });

  test("keeps a toast's height off its text, and its neighbour's place off both", async ({
    page,
  }) => {
    await page.route("**/api/docs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "conflict", message: LONG_REFUSAL }),
      });
    });

    await raise(page, "e");
    await expect(page.locator(".toast")).toHaveCount(1);
    const short = page.locator('.toast[data-slot="0"]');
    const shortBox = await short.boundingBox();
    expect(shortBox).not.toBeNull();
    if (shortBox === null) return;

    // A refused pin, through the real path, with a refusal too long to fit.
    await page.locator(".ghost-col").click();
    await page.getByRole("menuitem", { name: /Due this week/ }).click();
    const tall = page.locator('.toast[data-slot="1"]');
    await expect(tall).toContainText("New list failed", { timeout: 15_000 });

    // The long notice did not decide its own height…
    const tallBox = await tall.boundingBox();
    expect(tallBox?.height).toBe(shortBox.height);
    // …and it certainly did not decide the other toast's place.
    expect(await slotBox(page, 0)).toEqual({ x: shortBox.x, y: shortBox.y });

    // What did not fit is cut rather than accommodated.
    const message = tall.locator(".msg");
    const clipped = await message.evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(clipped).toBe(true);
    // The whole of it is still what assistive tech reads.
    await expect(tall).toContainText(LONG_REFUSAL);
  });

  /**
   * PR #53's MAJOR against UI-132: the fixed box cuts the message, and a cut
   * with no reveal is SHARED-057 clause 2. It bites hardest on an **error**
   * toast, whose reason is a server string of no bounded length that appears on
   * no other surface — so the cut copy would be the only copy. Every toast
   * carries its whole message on a `title`, and the hold is what makes that
   * reachable: the tooltip needs a steady pointer, and a toast under the
   * pointer does not go until the pointer leaves.
   */
  test("reveals on a title what the clamp cuts, and stays up long enough to read", async ({
    page,
  }) => {
    await page.route("**/api/docs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "conflict", message: LONG_REFUSAL }),
      });
    });

    // The ordinary confirmation carries it too — the reveal is unconditional,
    // like every other clamped surface in this release.
    await raise(page, "e");
    const short = page.locator('.toast[data-slot="0"] .msg');
    expect(await short.getAttribute("title")).toBe(await short.textContent());

    await page.locator(".ghost-col").click();
    await page.getByRole("menuitem", { name: /Due this week/ }).click();
    const failed = page.locator('.toast[data-tone="error"]');
    await expect(failed).toContainText("New list failed", { timeout: 15_000 });

    const message = failed.locator(".msg");
    // The box really does cut this one…
    expect(await message.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    // …and the whole refusal, server string and all, is on the title.
    const revealed = await message.getAttribute("title");
    expect(revealed).toContain(LONG_REFUSAL);
    expect(revealed).toBe(await message.textContent());

    // Reachable, not theoretical: with the pointer on it the toast outlives two
    // whole dwells, so the tooltip has time to appear and be read.
    const box = await failed.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.clock.runFor(TWO_DWELLS_MS);
    await expect(failed).toBeVisible();
    expect(await message.getAttribute("title")).toBe(revealed);
  });

  test("reserves its slots without laying a lid over the console strip", async ({ page }) => {
    // Empty, the wrapper is not painted at all.
    await expect(page.locator(".toast-wrap")).toHaveCSS("display", "none");

    await raise(page, "e");
    await expect(page.locator(".toast")).toHaveCount(1);
    // Occupied, the reserve is three slots tall — and none of it takes the
    // pointer, so the console strip underneath is still clickable.
    await expect(page.locator(".toast-wrap")).toHaveCSS("pointer-events", "none");
    await expect(page.locator(".toast")).toHaveCSS("pointer-events", "auto");

    const empty = await page.locator(".toast-wrap").evaluate((wrap) => {
      const rect = wrap.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 4);
      return hit === null || hit.closest(".toast-wrap") === null;
    });
    expect(empty).toBe(true);
  });

  test("still keeps at most three, and never two toasts in one slot", async ({ page }) => {
    for (let index = 0; index < 5; index++) {
      await raise(page, "e");
      await page.clock.runFor(50);
    }
    await expect(page.locator(".toast")).toHaveCount(3);

    const slots = await page
      .locator(".toast")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-slot")));
    expect([...slots].sort()).toEqual(["0", "1", "2"]);
  });
});
