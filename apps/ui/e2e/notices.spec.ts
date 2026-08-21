import type { Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";

/**
 * UI-139 — **a refusal a keyboard-only or touch user can finish reading**, in a
 * real browser (SPEC.md §11's Notices paragraph, rider authorized 2026-08-21).
 *
 * ## Why this suite has to be a browser and not jsdom
 *
 * The defect it closes is invisible to jsdom and to a pointer-driven spec
 * alike, which is exactly how the floor got set without anyone noticing. A
 * toast is clamped to two lines and reveals the rest on a `title`. jsdom has no
 * layout, so it never sees the clamp cut anything; a spec that moves the mouse
 * onto the toast sees the tooltip and calls the reveal reached. Neither is the
 * person this issue is about: a `title` on a non-focusable `<span>` produces no
 * tooltip on focus in any browser, and touch has no hover at all. So every
 * assertion below about *reaching* the reason is made with the keyboard only —
 * `page.keyboard`, never `page.mouse` — and the raise is the one gesture that
 * is allowed a pointer, because a touch user can tap.
 *
 * ## The fixture
 *
 * No workspace server on `127.0.0.1:8765`, like `toast-stack.spec.ts` and
 * `board.spec.ts`: `e` with nothing open raises a real confirmation through the
 * real keyboard seam, and a pin refused with a `409` raises a real refusal
 * whose reason is a server string. The clock is driven rather than waited on,
 * so "the toast has expired and the notice has not" is a fact about the code.
 */

/**
 * A refusal at the length a server really sends.
 *
 * Long enough to be cut **twice over**: it wraps past two lines in the toast's
 * 360px box, and past two lines again in the drawer, which is roughly 590px
 * wide at the runner's viewport. The second half matters — measured at 200
 * characters, this text fits the drawer in exactly two lines, so a tab that had
 * quietly reintroduced the clamp would have passed a "not cut" assertion by
 * having nothing to cut. It is a fixture that has to be able to fail.
 */
const LONG_REFUSAL =
  "Pin refused because the view document this list would need already exists under " +
  "another name in the same folder, and creating a second one would leave two " +
  "columns claiming the same query. Rename the existing document, or pin it " +
  "instead of creating a new one — the queries are identical, and two columns " +
  "answering the same question is the state this refusal exists to prevent.";

/** How far focus may travel before we call the strip unreachable. */
const TAB_BUDGET = 60;

async function refuseEveryPin(page: Page): Promise<void> {
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
}

/**
 * Raises a refusal through the real ghost-column path, with a real 409 behind
 * it. `expected` is how many error toasts should be up once it lands — counted
 * rather than matched on text, because two refusals coexist under a frozen
 * clock and a text assertion over two matching toasts is a strict-mode failure
 * waiting for a timing change.
 */
async function refusePin(page: Page, expected = 1): Promise<void> {
  await page.locator(".ghost-col").click();
  await page.getByRole("menuitem", { name: /Due this week/ }).click();
  await expect(page.locator('.toast[data-tone="error"]')).toHaveCount(expected, {
    timeout: 15_000,
  });
  await expect(page.locator('.toast[data-tone="error"]').last()).toContainText("Pin failed");
}

/** What the keyboard is on, as a selector-ish description of the focused node. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (node === null) return "none";
    const id = node.id === "" ? "" : `#${node.id}`;
    const cls = node.className === "" ? "" : `.${node.className.split(" ").join(".")}`;
    return `${node.tagName.toLowerCase()}${id}${cls}`;
  });
}

/**
 * Tabs until the focused element matches, with **no pointer involved at all**.
 * Returns how many presses it took, so a regression that merely makes the path
 * longer is visible rather than silent.
 */
async function tabUntil(page: Page, selector: string): Promise<number> {
  for (let presses = 1; presses <= TAB_BUDGET; presses++) {
    await page.keyboard.press("Tab");
    const there = await page.evaluate(
      (target) => document.activeElement?.matches(target) === true,
      selector,
    );
    if (there) return presses;
  }
  throw new Error(`${selector} was not reachable within ${String(TAB_BUDGET)} Tab presses`);
}

test.describe("a refusal outlives its toast", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await refuseEveryPin(page);
    await page.goto("/");
    await expect(page.locator(".ghost-col")).toBeVisible();
  });

  /**
   * The acceptance criterion, end to end: raise a refusal whose reason is longer
   * than two lines, reach the whole of it with the keyboard alone, let the toast
   * expire, and read it again.
   */
  test("is readable to the keyboard alone, before and after the toast expires", async ({
    page,
  }) => {
    await refusePin(page);
    const toast = page.locator('.toast[data-tone="error"]');
    const message = toast.locator(".msg");

    // The gap this issue closes, stated as a measurement rather than a claim:
    // the toast really does cut the reason, and the reveal really is a `title`
    // on a `<span>` that takes no focus.
    expect(await message.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const whole = await message.getAttribute("title");
    expect(whole).toContain(LONG_REFUSAL);
    expect(await message.evaluate((node) => node.tabIndex)).toBe(-1);

    // From here on, the keyboard and nothing else.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    const toStrip = await tabUntil(page, ".console-strip");
    expect(toStrip).toBeLessThanOrEqual(TAB_BUDGET);

    await page.keyboard.press("Enter");
    await expect(page.locator(".console-body")).toBeVisible();

    await tabUntil(page, "#console-tab-notices");
    expect(await focused(page)).toContain("console-tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#console-tab-notices")).toHaveAttribute("aria-selected", "true");

    // The whole reason, on screen, in one node — not on a tooltip, and not cut.
    const notice = page.locator(".notice-msg").first();
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(whole ?? "");
    expect(await notice.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);

    // The toast's dwell runs out. Expiry is unchanged — that is the rider's
    // call 4 — and the record is what makes it safe.
    await page.clock.runFor(7000);
    await expect(page.locator(".toast")).toHaveCount(0);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(LONG_REFUSAL);
  });

  /**
   * SHARED-058 call 5. A record nobody is told about helps only a person who
   * already knew to look — and the marker that tells them must not itself be a
   * thing that moves the one line that always renders (§11's rider).
   */
  test("marks the console for a refusal, without re-widthing the strip", async ({ page }) => {
    const mark = page.locator(".c-notice-mark");
    /*
     * The pill's **x**, not its box: it is the first thing to the right of the
     * marker, so it is what a marker that appeared would push — while its width
     * is its own text's and changes when the queue status lands, which is a
     * different question and not this one.
     */
    const pillX = async (): Promise<number | undefined> =>
      (await page.locator(".agent-pill").boundingBox())?.x;

    await expect(mark).toHaveAttribute("data-unread", "false");
    await expect(page.locator(".agent-pill")).toBeVisible();
    const reserved = await mark.boundingBox();
    const before = await pillX();
    expect(reserved).not.toBeNull();
    expect(before).not.toBeUndefined();

    // A confirmation marks nothing: a dot that lit for every saved document is
    // noise, and noise is how a marker stops being read.
    await page.keyboard.press("e");
    await expect(page.locator(".toast")).toHaveCount(1);
    await expect(mark).toHaveAttribute("data-unread", "false");

    await refusePin(page);
    await expect(mark).toHaveAttribute("data-unread", "true");
    await expect(mark).toBeVisible();

    // Lighting it moved nothing: its own box is the box it always had, and the
    // pill beside it starts where it started.
    expect(await mark.boundingBox()).toEqual(reserved);
    expect(await pillX()).toBe(before);

    // Opening the tab clears it — with the keyboard, like everything else here.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await tabUntil(page, ".console-strip");
    await page.keyboard.press("Enter");
    await tabUntil(page, "#console-tab-notices");
    await page.keyboard.press("Enter");
    await expect(page.locator(".notice-msg").first()).toBeVisible();
    await expect(mark).toHaveAttribute("data-unread", "false");
  });

  /**
   * UI-132's guarantee, at the one seam this issue adds: the drawer opening is a
   * board-height change, and the stack must not be part of it.
   */
  test("does not move the toast stack when the drawer opens", async ({ page }) => {
    await page.keyboard.press("e");
    const toast = page.locator('.toast[data-slot="0"]');
    await expect(toast).toBeVisible();
    const before = await toast.boundingBox();
    expect(before).not.toBeNull();

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await tabUntil(page, ".console-strip");
    await page.keyboard.press("Enter");
    await expect(page.locator(".console-body")).toBeVisible();

    expect(await toast.boundingBox()).toEqual(before);
  });

  /**
   * Several refusals at once, and the same one twice: each is its own notice
   * with its own time, because two refusals of the same write at two moments are
   * two facts about the session.
   */
  test("lists every notice of the session, newest first", async ({ page }) => {
    await page.keyboard.press("e");
    await page.clock.runFor(1200);
    await refusePin(page);
    await page.clock.runFor(1200);
    await refusePin(page, 2);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await tabUntil(page, ".console-strip");
    await page.keyboard.press("Enter");
    await tabUntil(page, "#console-tab-notices");
    await page.keyboard.press("Enter");

    const rows = page.locator(".notice");
    await expect(rows).toHaveCount(3);
    // Newest first: the two refusals, then the confirmation that came before.
    const tones = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tone")),
    );
    expect(tones).toEqual(["error", "error", "info"]);
    // The identical refusal twice, at two times — not folded into one row.
    const times = await page
      .locator(".notice-time")
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(times).toHaveLength(3);
  });
});
