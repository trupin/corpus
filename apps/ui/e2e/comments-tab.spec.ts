import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * The comments list and its composer, in a real browser (UI-063, UI-067 —
 * SPEC.md §11's rider, signed 2026-08-04).
 *
 * **Why a browser and not only component tests.** Three of the claims are about
 * things jsdom has no notion of. The switch is in a head UI-135 measured as
 * overflowing its column, so "one control out, one control in" is a width claim
 * (`reader-head-geometry.spec.ts` owns the measurement; what is here is that the
 * control is reachable and does what it says). The reveal is a scroll and a
 * flash over a body ProseMirror renders. And the tab **unmounts** the body, so
 * "the editor comes back" is a real remount of a real editor rather than a
 * re-render of a stub.
 *
 * The stub is the transport and nothing above it: real React, real cache, real
 * clicks.
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

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve today.",
  anchors: [
    // Resolves: the quote is in the body.
    { anchorId: "anc_live", threadId: "th_anchored", exact: "lender spreads" },
    // Does not: the document moved out from under it.
    { anchorId: "anc_gone", threadId: "th_orphan", exact: "a phrase since deleted" },
  ],
};

const ANCHORED: StubRow = {
  id: "th_anchored",
  type: "thread",
  title: "Which lenders?",
  path: "data/docs/threads/th_anchored.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhich lenders?\n",
  parent: "doc_note",
};

const ORPHAN: StubRow = {
  id: "th_orphan",
  type: "thread",
  title: "Still true?",
  path: "data/docs/threads/th_orphan.md",
  body: "## user · 2026-07-01T09:01:00Z\nStill true?\n",
  parent: "doc_note",
};

/** No anchor entry at all — a remark about the whole document, and settled. */
const WHOLE: StubRow = {
  id: "th_whole",
  type: "thread",
  title: "About the memo",
  path: "data/docs/threads/th_whole.md",
  body: "## user · 2026-07-02T09:00:00Z\nNice memo.\n",
  parent: "doc_note",
  status: "resolved",
};

/** A document nobody has commented on: 💬 has nothing to count. */
const NOTE_ALONE: StubRow = {
  id: "doc_alone",
  title: "Nothing said yet",
  body: "A memo with no conversations on it.",
};

const ROWS = [VIEW, NOTE, ANCHORED, ORPHAN, WHOLE] as const;

const READER = '.reader[data-reader-doc="doc_note"]';

async function openNote(
  page: Page,
  rows: readonly StubRow[] = ROWS,
  docId = "doc_note",
): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).first().click();
  await page.locator(`.reader[data-reader-doc="${docId}"] .ProseMirror`).waitFor();
  return corpus;
}

/** The switch: one toggle, pressed while the list is showing. */
const toggle = (page: Page): Locator => page.locator(`${READER} .comments-btn`);

const rows = (page: Page): Locator => page.locator(`${READER} [data-comment-row]`);

async function showComments(page: Page): Promise<void> {
  await toggle(page).click();
  await page.locator(`${READER} .comments-tab`).waitFor();
}

test.describe("the Document / Comments switch", () => {
  test("is in the head, and shows one surface or the other", async ({ page }) => {
    await openNote(page);

    // Document: the body is there, the list is not.
    await expect(page.locator(`${READER} .ProseMirror`)).toBeVisible();
    await expect(page.locator(`${READER} .comments-tab`)).toHaveCount(0);
    await expect(toggle(page)).toHaveText("💬 3");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");

    await showComments(page);
    /*
     * …and the other way round. The **editor** is hidden rather than unmounted —
     * the reveal seam needs its anchored highlights to exist the moment the flash
     * is set (see `DocView`) — but every conversation the body places is
     * unmounted, which is what §7 requires: a card kept behind a hidden body
     * would mark a conversation seen that nobody looked at.
     */
    await expect(page.locator(`${READER} .ProseMirror`)).not.toBeVisible();
    await expect(page.locator(`${READER} .doc-body-slot`)).toHaveAttribute("hidden", "");
    await expect(page.locator(`${READER} .anchor-slot .thread-card`)).toHaveCount(0);
    await expect(page.locator(`${READER} [data-thread-section]`)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);

    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await toggle(page).click();
    await expect(page.locator(`${READER} .ProseMirror`)).toBeVisible();
  });

  test("is reachable from the keyboard, and says which state it is in", async ({ page }) => {
    await openNote(page);
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`${READER} .comments-tab`)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator(`${READER} .ProseMirror`)).toBeVisible();
  });

  /**
   * 💬 keeps its own condition, and that is a **measured** deviation from §11's
   * unconditional wording rather than a preference: at 560px with a parent title
   * at its cap the row has 13px of slack and the toggle needs 61px
   * (`comments/CommentsSwitch` carries the numbers). A document with no
   * conversations reaches the list through the ⋯ menu — which is also where
   * UI-067's "comment without selecting" starts on such a document, so this test
   * walks that whole path.
   */
  test("is absent on a document with no comments, which reaches the list on ⋯", async ({
    page,
  }) => {
    await openNote(page, [VIEW, NOTE_ALONE], "doc_alone");
    const reader = '.reader[data-reader-doc="doc_alone"]';
    await expect(page.locator(`${reader} .comments-btn`)).toHaveCount(0);

    await page.locator(`${reader} [data-doc-menu]`).click();
    await page.locator(`${reader} .comments-pop .cp-item`, { hasText: "Comments" }).first().click();
    await expect(page.locator(`${reader} .comments-tab`)).toBeVisible();

    /*
     * The state a person arrives at **deliberately**, to write the first comment
     * on a document. It gets its own sentence — not the filter one — and it names
     * the act rather than the absence, with the composer right under it.
     */
    await expect(page.locator(`${reader} .cm-empty`)).toHaveText(
      "No comments on this document yet. Write the first one below — no text selection needed.",
    );
    const field = page.locator(`${reader} [data-new-comment] textarea`);
    await expect(field).toBeVisible();
    await field.fill("The first thing anybody has said about this.");
    await field.press("Meta+Enter");
    await expect(page.locator(`${reader} [data-comment-row]`)).toHaveCount(1);
    await expect(page.locator(`${reader} .cm-empty`)).toHaveCount(0);

    // The way back appears with the list, and stays once the document has one.
    await expect(page.locator(`${reader} .comments-btn`)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("the list", () => {
  test("holds every conversation and says why each unanchored one has no anchor", async ({
    page,
  }) => {
    await openNote(page);
    await showComments(page);

    const why = (id: string): Locator =>
      page.locator(`${READER} [data-comment-row="${id}"] .cm-why-text`);
    await expect(why("th_anchored")).toHaveText("anchored to “lender spreads”");
    await expect(why("th_orphan")).toHaveText(
      "detached — the document no longer contains “a phrase since deleted”",
    );
    await expect(why("th_whole")).toHaveText("about the whole document — it never had an anchor");
  });

  test("filters on both axes, and names what a filter is hiding", async ({ page }) => {
    await openNote(page);
    await showComments(page);

    const choose = async (filter: string): Promise<void> => {
      await page.locator(`${READER} [data-filter="${filter}"]`).click();
    };

    await choose("status:open");
    await expect(rows(page)).toHaveCount(2);
    await choose("anchor:unanchored");
    // The combination the rider is about: open, and the document moved out from
    // under it.
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveAttribute("data-comment-row", "th_orphan");

    await choose("anchor:anchored");
    await choose("status:resolved");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator(`${READER} .cm-empty`)).toHaveText(
      "No resolved, anchored comments. 3 comments are hidden by these filters.",
    );
  });

  test("reveals an anchored row at its anchor, in the document", async ({ page }) => {
    await openNote(page);
    await showComments(page);

    await page.locator(`${READER} [data-reveal-thread="th_anchored"]`).click();

    // Back on the document half, with the conversation expanded and flashing at
    // its anchor — UI-037's seam, not a second mechanism.
    await expect(page.locator(`${READER} .ProseMirror`)).toBeVisible();
    await expect(
      page.locator(`${READER} [data-thread-panel="th_anchored"] .thread-card`),
    ).toBeVisible();
    await expect(page.locator(`${READER} .anchor-hl[data-thread="th_anchored"]`)).toHaveCount(1);
  });

  test("offers a detached row its way back, and offers it to nobody else", async ({ page }) => {
    await openNote(page);
    await showComments(page);
    await expect(
      page.locator(`${READER} [data-comment-row="th_orphan"] [data-reattach]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`${READER} [data-comment-row="th_anchored"] [data-reattach]`),
    ).toHaveCount(0);
  });

  test("resolves from the list, without a reload", async ({ page }) => {
    const corpus = await openNote(page);
    await showComments(page);

    const row = page.locator(`${READER} [data-comment-row="th_anchored"]`);
    await expect(row.locator(".chip.t-status")).toHaveText("open");
    await row.locator("[data-resolve]").click();

    /*
     * Resolving re-asserts §11's one rule, so the conversation folds where it
     * stands — the card and its status chip are gone, and the collapsed line
     * that replaces them says what it is. That is the assertion: the list
     * repainted from the mutation, with no reload.
     */
    await expect(row.locator("[data-thread-expand].resolved-chip")).toHaveCount(1);
    await expect(row.locator(".thread-card")).toHaveCount(0);
    await expect.poll(async () => (await corpus.doc("th_anchored"))?.status).toBe("resolved");
    // …and the anchored axis is unmoved by it: the two filters are independent.
    await expect(row).toHaveAttribute("data-anchor-state", "anchored");
  });
});

test.describe("writing a comment with no selection", () => {
  test("starts a new unanchored thread, and a second remark starts its own", async ({ page }) => {
    const corpus = await openNote(page);
    await showComments(page);

    const field = page.locator(`${READER} [data-new-comment] textarea`);
    await field.fill("A remark about the whole thing.");
    await field.press("Meta+Enter");
    await expect(rows(page)).toHaveCount(4);

    await field.fill("A second, unrelated remark.");
    await field.press("Meta+Enter");
    await expect(rows(page)).toHaveCount(5);

    const created = await corpus.of("POST", "/api/threads");
    expect(created).toHaveLength(2);
    for (const call of created) {
      const body = call.body as Record<string, unknown>;
      expect(body["parent"]).toBe("doc_note");
      // No selector: the thread is anchored to nothing, which is §6's
      // whole-document comment and not a new kind of object.
      expect(body["selector"]).toBeNull();
    }
    // Two threads, not two turns on one.
    expect(await corpus.of("POST", "/api/threads/th_new1/turns")).toHaveLength(0);
  });

  test("takes a newline on ↵, so a remark can have paragraphs", async ({ page }) => {
    const corpus = await openNote(page);
    await showComments(page);

    const field = page.locator(`${READER} [data-new-comment] textarea`);
    await field.click();
    await page.keyboard.type("First line.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second line.");
    expect(await corpus.of("POST", "/api/threads")).toHaveLength(0);
    await expect(field).toHaveValue("First line.\nSecond line.");

    await field.press("Meta+Enter");
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
  });

  test("replies in place to a conversation already in the list", async ({ page }) => {
    const corpus = await openNote(page);
    await showComments(page);

    const row = page.locator(`${READER} [data-comment-row="th_anchored"]`);
    await row.locator('[data-composer="th_anchored"]').fill("Three of them.");
    await row.locator('[data-composer="th_anchored"]').press("Meta+Enter");

    await expect(row.locator(".turn-body")).toHaveCount(2);
    expect(await corpus.of("POST", "/api/threads/th_anchored/turns")).toHaveLength(1);
    // A reply is a turn on that thread, not a child thread beside it.
    expect(await corpus.of("POST", "/api/threads")).toHaveLength(0);
  });
});

test.describe("in full screen", () => {
  test("carries the same switch and the same list", async ({ page }) => {
    await openNote(page);
    await page.locator(`${READER} [data-expand]`).click();
    await page.locator(".focus.open").waitFor();

    const focus = page.locator(".focus.open");
    await focus.locator(".comments-btn").click();
    await expect(focus.locator(".comments-tab")).toBeVisible();
    await expect(focus.locator("[data-comment-row]")).toHaveCount(3);
    await expect(focus.locator("[data-new-comment]")).toHaveCount(1);
  });
});
