import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * The anchor layer's **behaviour**, in a real browser — the half
 * `anchors.spec.ts` declines to assert because it is a stylesheet suite.
 *
 * UI-027 is why this file exists. Every anchor assertion the suite had was
 * either a computed style over hand-written markup or, in `todos.spec.ts`, a
 * highlight the page had just *created*. Nothing anywhere loaded a document
 * that already had an anchor on it, and that is the state that shipped broken:
 * `offsetsComparable` rejected any body whose final newline the serializer
 * would have added, so a document created without one — which is most of them —
 * showed no highlight, no pip, no chip and no aligned margin card, forever.
 * These tests open documents that arrive with anchors already resolved, and the
 * first one's body deliberately ends without a newline.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real TanStack cache, real ProseMirror, real decorations, real clicks. The
 * disk-and-git half stays in the issue's real-app log, as sprint-016
 * Adjudication 19 requires.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

/** The regression's shape: a body the serializer would add a final newline to. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve.",
  anchors: [
    {
      anchorId: "anc_1",
      threadId: "th_1",
      exact: "lender spreads",
      prefix: "Short memo about ",
      suffix: " and the shape",
    },
  ],
};

const THREAD: StubRow = {
  id: "th_1",
  type: "thread",
  title: 'Re: "lender spreads"',
  path: "data/docs/threads/th_1.md",
  body: "Which lenders?",
  parent: "doc_note",
};

async function openNote(page: Page, rows: readonly StubRow[]): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
}

test.describe("a document that arrives with an anchor already on it", () => {
  test("paints the highlight over the anchored words on a fresh load", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);

    const highlight = page.locator(".reader .anchor-hl");
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("lender spreads");
    await expect(highlight).toHaveAttribute("data-thread", "th_1");
    await expect(highlight).toHaveAttribute("data-anchor", "anc_1");
    // Drawn over the editable body, not beside it.
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(1);
    // …and it is the shipped treatment, not a bare span.
    await expect(highlight).toHaveCSS("border-bottom-width", "2px");
    await expect(page.locator(".reader .anchor-pip")).toHaveText("1");
  });

  test("keeps the highlight across a reload", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await expect(page.locator(".reader .anchor-hl")).toHaveCount(1);

    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator(".reader .anchor-hl")).toHaveText("lender spreads");
  });

  test("opens the thread when the highlight is clicked (SPEC.md §11)", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await expect(page.locator(".thread-slot.expanded")).toHaveCount(0);

    await page.locator(".reader .anchor-hl").click();

    const expanded = page.locator('.thread-slot.expanded[data-slot-thread="th_1"]');
    await expect(expanded).toHaveCount(1);
    // It is the anchored thread that opened, and it says which words it is about.
    await expect(expanded).toContainText("lender spreads");
  });

  test("keeps the chip at the anchor while the column is narrow", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);

    await expect(page.locator(".reader .anchor-slot .t-chip")).toHaveCount(1);
    // A narrow column is chip mode: no margin gutter, no margin cards.
    await expect(page.locator(".reader .with-margin")).toHaveCount(0);
    await expect(page.locator(".focus-margin")).toHaveCount(0);
  });

  test("moves the card into the margin, aligned to its anchor, in focus mode", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await page.locator(".reader .anchor-hl").waitFor();

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    const focus = page.locator(".focus.open");
    await expect(focus).toHaveCount(1);
    await expect(focus.locator(".with-margin")).toHaveCount(1);

    const card = focus.locator('.focus-margin > .thread-card[data-thread="th_1"]');
    await expect(card).toHaveCount(1);
    // The cascade positions absolutely; until it runs every card sits at 0.
    const offsets = await focus.evaluate((root) => {
      const main = root.querySelector(".doc-main");
      const origin = main?.getBoundingClientRect().top ?? 0;
      const anchor = main?.querySelector('.anchor-hl[data-thread="th_1"]') ?? null;
      const placed = root.querySelector('.focus-margin > .thread-card[data-thread="th_1"]');
      return {
        anchorTop: anchor === null ? null : Math.round(anchor.getBoundingClientRect().top - origin),
        cardTop: placed === null ? null : Math.round(placed.getBoundingClientRect().top - origin),
      };
    });
    expect(offsets.anchorTop).not.toBeNull();
    expect(offsets.cardTop).toBe(offsets.anchorTop);
    // The margin replaces the chip rather than doubling it.
    await expect(focus.locator(".anchor-slot .t-chip")).toBeHidden();
  });
});

test.describe("an anchor whose quote has left the body", () => {
  const ORPHANED: StubRow = {
    ...NOTE,
    body: "Short memo about pricing and the shape of the yield curve.",
  };

  test("renders as a detached thread and leaves no phantom highlight (SPEC.md §6)", async ({
    page,
  }) => {
    await openNote(page, [VIEW, ORPHANED, THREAD]);

    await expect(page.locator('[data-thread-section="detached"]')).toHaveCount(1);
    await expect(page.locator(".reader .anchor-hl")).toHaveCount(0);
    await expect(page.locator(".reader .anchor-pip")).toHaveCount(0);
    // Still fully usable: the thread is listed, with its quote.
    await expect(page.locator('[data-thread-section="detached"] .t-chip')).toHaveCount(1);
  });
});
