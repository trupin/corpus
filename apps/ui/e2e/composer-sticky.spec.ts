import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-110 in a real browser, and it has to be a browser.
 *
 * `position: sticky` **fails silently**: an ancestor that clips, a scroll
 * container that is not the one you thought, a `min-height: 0` missing from a
 * flex chain — any of them and the element simply scrolls away as it always did,
 * with the class list still saying `in-use` and the stylesheet still saying
 * `position: sticky`. A component test asserting either would pass against the
 * exact bug this issue was filed about.
 *
 * So the apparatus is the scroll: put a conversation taller than the column in
 * front of a real layout engine, scroll it, and ask where the box actually is.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** Turns enough to overflow any plausible column height. */
const TURNS = Array.from(
  { length: 30 },
  (_, index) =>
    `## user · 2026-07-01T09:${String(index).padStart(2, "0")}:00Z\nParagraph ${String(index)} of a long conversation that has to be scrolled.\n`,
).join("\n");

const THREAD: StubRow = {
  id: "th_long",
  type: "thread",
  title: "A long conversation",
  path: "data/docs/inbox/th_long.md",
  body: TURNS,
};

async function openThread(page: Page): Promise<void> {
  await stubCorpus(page, [VIEW, THREAD]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_long"]').first().click();
  await page.locator('.reader[data-reader-doc="th_long"]').waitFor();
}

/** The scrolling surface the reader actually uses, whichever it is. */
async function scrollSurfaceToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollable = [...document.querySelectorAll<HTMLElement>("*")].filter(
      (element) => element.scrollHeight > element.clientHeight + 40,
    );
    for (const element of scrollable) element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

test.describe("the composer you are typing in stays visible (UI-110)", () => {
  test("stays on screen while the conversation above it is scrolled", async ({ page }) => {
    await openThread(page);

    const composer = page.locator(".composer").first();
    const reply = composer.locator('textarea[aria-label="Reply"]');
    await reply.waitFor();

    // Scroll to the bottom first so the composer is genuinely in view, then type
    // — this is the user's flow: start writing, then go back up to re-read.
    await reply.scrollIntoViewIfNeeded();
    await reply.click();
    await reply.fill("A reply I am part-way through writing");

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    await scrollSurfaceToTop(page);

    // The question is not "does it have the class" but "is it on screen".
    const box = await composer.boundingBox();
    expect(box, "the composer should still be laid out").not.toBeNull();
    expect(box?.y ?? Infinity).toBeLessThan((viewport?.height ?? 0) - 20);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(0);

    // And it is still the box holding the draft — not a second one scrolled into
    // place, which would look identical to a screenshot.
    await expect(reply).toHaveValue("A reply I am part-way through writing");
  });

  test("an untouched composer is in ordinary flow and costs the column nothing", async ({
    page,
  }) => {
    // The other half of the rule: an affordance, not a permanent bar. If this
    // fails, the fix has quietly taken vertical space from every conversation.
    await openThread(page);
    const composer = page.locator(".composer").first();
    await composer.waitFor();

    const position = await composer.evaluate((element) => getComputedStyle(element).position);
    expect(position).not.toBe("sticky");
  });
});
