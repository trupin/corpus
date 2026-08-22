import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * What the browser stub does with a route nobody taught it (UI-085).
 *
 * It used to answer `200 {}`. That made every omission silent and general: the
 * caller failed somewhere downstream reading a field off an empty object, or did
 * not fail at all, and the request that was never handled appeared in no report.
 * Six core routes had been living on that fallback unnoticed.
 *
 * So this file asserts the two halves of the cure — that an unhandled route is
 * **refused, by name**, and that the route the fallback was hiding when UI-085
 * was filed now behaves like the server's: `POST /api/threads/{id}/turns`, where
 * a person's reply reopens a resolved conversation (SPEC.md §8, SHARED-019
 * Amendment 1). That behaviour was uncoverable from the board before this.
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
};

/** Settled, and about the whole document — so it is listed below the body. */
const RESOLVED_THREAD: StubRow = {
  id: "th_done",
  type: "thread",
  title: "Settled",
  path: "data/docs/threads/th_done.md",
  body: "## user · 2026-07-01T09:00:00Z\nSettled?\n\n## agent · 2026-07-01T09:01:00Z\nSettled.\n",
  parent: "doc_note",
  status: "resolved",
};

test.describe("an unhandled route", () => {
  test("is refused with the method and the path, not answered with an empty success", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    const answer = await page.evaluate(async () => {
      const response = await fetch("/api/nothing-here", { method: "POST" });
      return { status: response.status, body: await response.text() };
    });

    expect(answer.status).toBe(501);
    expect(answer.body).toContain("POST /api/nothing-here");
    expect(answer.body).toContain("no handler");
    expect(await corpus.unhandled()).toContain("POST /api/nothing-here");
  });

  test("does not fire for the routes the board actually issues on a first paint", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').first().click();
    await page.locator(".reader .ProseMirror").waitFor();

    // The regression guard for the removal itself: opening a document exercises
    // the docs, threads, tree, queue, agents, health, index and jobs routes, and
    // every one of them now has a handler that means something.
    expect(await corpus.unhandled()).toEqual([]);
  });
});

test.describe("replying to a resolved conversation", () => {
  test("reopens it, from the board, exactly as the server does", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, NOTE, RESOLVED_THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').first().click();
    await page.locator(".reader .ProseMirror").waitFor();

    // Resolved, so §10's one rule places it collapsed. Expanding it is the
    // reader's own act, and it is what puts the reply box on screen.
    const panel = page.locator('[data-thread-panel="th_done"]');
    await panel.locator("[data-thread-expand]").click();
    await expect(panel.locator(".chip.t-status")).toHaveText("resolved");
    await expect(panel.locator(".composer-hint")).toHaveText("reopens on reply");

    await panel.locator('[data-composer="th_done"]').fill("One more thing.");
    await panel.locator('[data-composer="th_done"]').press("Meta+Enter");

    // The conversation says it is open again, and so does the corpus behind it.
    await expect(panel.locator(".chip.t-status")).toHaveText("open");
    await expect.poll(async () => (await corpus.doc("th_done"))?.status).toBe("open");
    expect(await corpus.of("POST", "/api/threads/th_done/turns")).toHaveLength(1);
    expect(await corpus.unhandled()).toEqual([]);
  });
});
