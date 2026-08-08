import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * Repairing a detached comment, in a real browser (UI-086; SERVER-059 phase B).
 *
 * A thread whose selector never byte-matched is detached for the life of its
 * document — reconciliation only ever carries an anchor forward or orphans it,
 * and it has no diff for a quote that never resolved. The only party holding the
 * evidence is the person who wrote the comment, so the product's job is to
 * enumerate and to ask, never to answer.
 *
 * The fixture is the adversarial one on purpose: **four parallel siblings**, one
 * of which the quote no longer names. SERVER-055's safety tests passed on two
 * items, which was shape-luck rather than safety.
 *
 * The stub is the transport and nothing above it — real React, real ProseMirror,
 * real clicks, real mutation. The disk-and-git half stays in the issue's
 * real-app log, as sprint-016 Adjudication 19 requires.
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

/** Q2's line is gone; Q1, Q3 and Q4 survive, byte-identical but for a digit. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Weekly actions",
  body: [
    "# Weekly actions",
    "",
    "- Review the Q1 report by Friday",
    "- Review the Q3 report by Friday",
    "- Review the Q4 report by Friday",
    "",
  ].join("\n"),
  anchors: [
    {
      anchorId: "anc_orphan",
      threadId: "th_orphan",
      // Never in this document: the population SERVER-059 is about.
      exact: "Review the Q2 report by Friday",
    },
  ],
};

const THREAD: StubRow = {
  id: "th_orphan",
  type: "thread",
  title: 'Re: "Review the Q2 report by Friday"',
  path: "data/docs/threads/th_orphan.md",
  body: "## user · 2026-07-01T09:00:00Z\nWho owns this one?\n",
  parent: "doc_note",
};

/** A second thread, anchored to Q3 — the text §6 forbids a repair overlapping. */
const OCCUPANT: StubRow = {
  id: "th_q3",
  type: "thread",
  title: 'Re: "Review the Q3 report by Friday"',
  path: "data/docs/threads/th_q3.md",
  body: "## user · 2026-07-01T09:10:00Z\nStill on track?\n",
  parent: "doc_note",
};

const WITH_OCCUPANT: StubRow = {
  ...NOTE,
  anchors: [
    ...(NOTE.anchors ?? []),
    {
      anchorId: "anc_q3",
      threadId: "th_q3",
      exact: "Review the Q3 report by Friday",
      prefix: "- ",
      suffix: "\n- Review the Q4",
    },
  ],
};

async function openNote(page: Page, rows: readonly StubRow[]): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
}

test.describe("a detached comment offers a way back", () => {
  test("is listed as detached and offers to find its place", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);

    const section = page.locator('[data-thread-section="detached"]');
    await expect(section).toBeVisible();
    await expect(section.locator('[data-thread-panel="th_orphan"]')).toHaveCount(1);

    const offer = page.locator('[data-reattach="th_orphan"]');
    await expect(offer).toBeVisible();
    await expect(offer.locator("[data-reattach-open]")).toHaveText("Find where it belongs…");
    // Nothing is offered until it is asked for.
    await expect(page.locator("[data-reattach-candidate]")).toHaveCount(0);
  });

  test("offers every sibling, with none of them chosen", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await page.locator("[data-reattach-open]").click();

    const candidates = page.locator("[data-reattach-candidate]");
    await expect(candidates).toHaveCount(3);
    await expect(candidates.nth(0)).toContainText("Review the Q1 report by Friday");
    await expect(candidates.nth(1)).toContainText("Review the Q3 report by Friday");
    await expect(candidates.nth(2)).toContainText("Review the Q4 report by Friday");

    // Each shows its neighbours, which is the whole evidence a person has.
    await expect(candidates.nth(0)).toContainText("Weekly actions");
    await expect(candidates.nth(1)).toContainText("Q4");

    // Nothing pre-selected: no checked control, no focused button, no score.
    await expect(page.locator("[data-reattach-candidate] :checked")).toHaveCount(0);
    const shown = await candidates.allTextContents();
    expect(shown.every((text) => !/%|score|similar|match/i.test(text))).toBe(true);
    const focusedInPicker = await page.evaluate(
      () => document.activeElement?.closest("[data-reattach]") !== null,
    );
    expect(focusedInPicker).toBe(false);

    // No claim of truncation, because the list is everything.
    await expect(page.locator("[data-reattach-limit]")).toHaveCount(0);
  });

  test("leaving it detached is available and writes nothing", async ({ page }) => {
    const stub = await stubCorpus(page, [VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    await page.locator("[data-reattach-open]").click();
    await expect(page.locator("[data-reattach-candidate]")).toHaveCount(3);

    await page.locator("[data-reattach-decline]").click();
    await expect(page.locator("[data-reattach-candidate]")).toHaveCount(0);
    await expect(page.locator("[data-reattach-open]")).toBeVisible();

    expect(await stub.of("POST", "/api/threads/th_orphan/reattach")).toHaveLength(0);
    const doc = await stub.doc("doc_note");
    expect(doc?.anchors[0]?.selector.exact).toBe("Review the Q2 report by Friday");
  });

  test("choosing the third sibling attaches the comment there, durably", async ({ page }) => {
    const stub = await stubCorpus(page, [VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    await page.locator("[data-reattach-open]").click();
    const candidates = page.locator("[data-reattach-candidate]");
    await expect(candidates).toHaveCount(3);
    await candidates.nth(2).locator("[data-reattach-attach]").click();

    // The detached section empties, and the anchor paints on the chosen line.
    await expect(page.locator('[data-reattach="th_orphan"]')).toHaveCount(0);
    const highlight = page.locator('.reader .anchor-hl[data-thread="th_orphan"]');
    await expect(highlight).toHaveText("Review the Q4 report by Friday");

    // The request carried the range and the guard, and nothing else.
    const sent = await stub.of("POST", "/api/threads/th_orphan/reattach");
    expect(sent).toHaveLength(1);
    const payload = sent[0]?.body as {
      range: { start: number; end: number };
      expectedText: string;
    };
    expect(Object.keys(payload).sort()).toEqual(["expectedText", "range"]);
    expect(payload.expectedText).toBe("Review the Q4 report by Friday");
    expect(payload.expectedText.length).toBe(payload.range.end - payload.range.start);

    // And the repair is in the store, as a recomputed selector rather than the
    // bytes the caller sent: the context is the document's own.
    const doc = await stub.doc("doc_note");
    expect(doc?.anchors[0]?.selector.exact).toBe("Review the Q4 report by Friday");
    expect(doc?.anchors[0]?.selector.prefix).toContain("Q3 report by Friday");

    // A reload finds it attached — not a per-session overlay.
    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator('.reader .anchor-hl[data-thread="th_orphan"]')).toHaveText(
      "Review the Q4 report by Friday",
    );
    await expect(page.locator('[data-thread-section="detached"]')).toHaveCount(0);
  });

  test("text another conversation already claims is shown and refused", async ({ page }) => {
    await openNote(page, [VIEW, WITH_OCCUPANT, THREAD, OCCUPANT]);
    await page.locator('[data-reattach="th_orphan"] [data-reattach-open]').click();

    const candidates = page.locator("[data-reattach-candidate]");
    await expect(candidates).toHaveCount(3);
    // The occupied one is still listed — hiding it would make the list quietly
    // incomplete at the place the person is most likely to be looking.
    await expect(candidates.nth(1)).toContainText("Review the Q3 report by Friday");
    await expect(candidates.nth(1).locator("[data-reattach-attach]")).toHaveCount(0);
    await expect(candidates.nth(1).locator("[data-reattach-taken]")).toHaveText(
      "Another conversation is already anchored to this text.",
    );
    await expect(page.locator("[data-reattach-attach]")).toHaveCount(2);
  });

  test("says plainly when nothing in the document resembles the quote", async ({ page }) => {
    const unrelated: StubRow = {
      ...NOTE,
      body: "# Shipping\n\nEntirely unrelated prose about containers and freight.\n",
    };
    await openNote(page, [VIEW, unrelated, THREAD]);
    await page.locator("[data-reattach-open]").click();

    await expect(page.locator("[data-reattach-empty]")).toContainText(
      "Nothing in this document resembles the quoted text",
    );
    await expect(page.locator("[data-reattach-attach]")).toHaveCount(0);
    // Declining is still there, which is the point of the empty case.
    await expect(page.locator("[data-reattach-decline]")).toBeVisible();
  });
});
