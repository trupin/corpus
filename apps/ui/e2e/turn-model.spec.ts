import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-090 in a real browser: an agent turn says which model wrote it (SPEC.md
 * §11, rider signed 2026-08-07), on every surface a turn is read from.
 *
 * **Why a browser suite and not only component tests.** The requirement is
 * "quickly identifiable", not "present in the DOM" — and the turn header is the
 * one row in this app where being in the DOM proves nothing about being on
 * screen: the two controls beside the model chip ship at `opacity: 0` and appear
 * only on hover. A jsdom suite cannot tell those two states apart, so the claim
 * that the model reads "without opening or hovering anything" is exactly the
 * claim only a real layout engine can settle. That assertion is below, and it is
 * made *against* the hover controls in the same row.
 *
 * The other thing only this suite can testify to is coverage of the placements.
 * §11 lists five — a card in the margin, a chip at its anchor, a thread in a
 * column, full screen, and a child thread nested under a turn — and which one a
 * conversation gets is decided by measuring a live element, which jsdom reports
 * as zero-width for everything. All five are entered here the way the app
 * decides between them.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real TanStack cache, real clicks. Which model wrote which turn is seeded where
 * the server keeps it — the thread document's frontmatter, keyed by turn
 * timestamp (SPEC.md §6) — never in the turn's own text.
 */

const OPUS = "claude-opus-4-20250514";
const HAIKU = "claude-haiku-4-20250514";

/** The four turns' timestamps, as their headings spell them (seconds, `Z`). */
const ASKED = "2026-08-07T09:00:00Z";
const ANSWERED = "2026-08-07T09:05:00Z";
const UNRECORDED = "2026-08-07T09:07:00Z";
const FILED = "2026-08-07T09:09:00Z";
/** The child thread's only turn — its own instant, so no locator is ambiguous. */
const NESTED = "2026-08-07T10:00:00Z";

const INBOX: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 2,
  query: { folder: "threads" },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve today.",
  anchors: [{ anchorId: "anc_open", threadId: "th_models", exact: "lender spreads" }],
};

/**
 * The conversation the rider has to be read against: a person's turn, an agent
 * turn nobody recorded a model for, and two agent turns naming **different**
 * models — so a surface that painted the thread's first model onto every agent
 * turn fails here instead of passing on an all-one-model thread.
 *
 * Its own anchor entry hangs the child thread off the second turn's text, which
 * is what makes the nested placement a real nesting rather than a card parked at
 * the bottom of the conversation.
 */
const THREAD: StubRow = {
  id: "th_models",
  type: "thread",
  title: "Which lenders?",
  path: "data/docs/threads/th_models.md",
  parent: "doc_note",
  body: [
    `## user · ${ASKED}`,
    "Which lenders?",
    "",
    `## agent · ${ANSWERED}`,
    "Three of them.",
    "",
    `## agent · ${UNRECORDED}`,
    "Filed under finance.",
    "",
    `## agent · ${FILED}`,
    "Retitled the note.",
    "",
  ].join("\n"),
  turnModels: { [ANSWERED]: OPUS, [FILED]: HAIKU },
  anchors: [{ anchorId: "anc_child", threadId: "th_child", exact: "Three of them." }],
};

/** A conversation about one of those turns — §11's "child thread nested under a turn". */
const CHILD: StubRow = {
  id: "th_child",
  type: "thread",
  title: "Which three?",
  path: "data/docs/threads/th_child.md",
  parent: "th_models",
  body: [`## agent · ${NESTED}`, "The three on the shortlist.", ""].join("\n"),
  turnModels: { [NESTED]: HAIKU },
};

const ROWS = [INBOX, THREADS_VIEW, NOTE, THREAD, CHILD] as const;

function turn(scope: Page | Locator, ts: string): Locator {
  return scope.locator(`.turn[data-turn-ts="${ts}"]`).first();
}

/**
 * What one turn says its model is — **its own** header, by direct child.
 *
 * A turn contains the conversations nested under it, and those have turns with
 * chips of their own, so a descendant query would report a parent turn as
 * carrying whatever its child thread said. This is the same reason
 * `collapse.spec.ts` reads a panel's fold state by direct child.
 */
function modelOf(scope: Page | Locator, ts: string): Locator {
  return turn(scope, ts).locator("> .turn-who > .turn-model");
}

/**
 * The whole rule, on one conversation: the two recorded models, and **nothing**
 * on the turn nobody recorded one for or on the turn a person wrote.
 */
async function expectTheRule(scope: Page | Locator): Promise<void> {
  await expect(modelOf(scope, ANSWERED)).toHaveText(OPUS);
  await expect(modelOf(scope, FILED)).toHaveText(HAIKU);
  // Absence, not an empty chip and not a placeholder: §11 says an unknown says
  // so by absence rather than by a plausible attribution nobody can check.
  await expect(modelOf(scope, UNRECORDED)).toHaveCount(0);
  await expect(modelOf(scope, ASKED)).toHaveCount(0);
  await expect(turn(scope, UNRECORDED).locator("> .turn-who")).not.toContainText("unknown");
}

async function board(page: Page, rows: readonly StubRow[] = ROWS): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
}

/** The thread as its own document, open in a column reader. */
async function openThreadInColumn(page: Page): Promise<Locator> {
  await board(page);
  await page.locator('.col[data-col="doc_view_threads"] .row[data-row-doc="th_models"]').click();
  const reader = page.locator('.reader[data-reader-doc="th_models"]');
  await expect(reader).toHaveCount(1);
  await turn(reader, ANSWERED).waitFor();
  return reader;
}

/** The commented document, where the conversation is placed against its anchor. */
async function openNote(page: Page): Promise<Locator> {
  await board(page);
  await page.locator('.col[data-col="doc_view_inbox"] .row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  await page.locator(".reader .anchor-hl").first().waitFor();
  await page.locator(".reader [data-thread-panel]").first().waitFor();
  return page.locator('.reader[data-reader-doc="doc_note"]');
}

test.describe("which model wrote a turn", () => {
  test("reads at a glance in a thread open in a column", async ({ page }) => {
    const reader = await openThreadInColumn(page);
    await expectTheRule(reader);
  });

  test("reads at a glance in full screen", async ({ page }) => {
    const reader = await openThreadInColumn(page);
    await reader.locator("[data-expand]").click();
    const focus = page.locator(".focus.open");
    await expect(focus).toHaveCount(1);
    await turn(focus, ANSWERED).waitFor();

    await expectTheRule(focus);
  });

  test("reads at a glance on the chip at its anchor, in a narrow column", async ({ page }) => {
    const reader = await openNote(page);
    // The narrow placement: no margin, so the conversation sits at its anchor.
    await expect(page.locator(".reader .with-margin")).toHaveCount(0);
    await turn(reader, ANSWERED).waitFor();

    await expectTheRule(reader);

    // The chip gives rather than the row: it stays inside the conversation it
    // sits in, so the hover controls beside it are never pushed out of reach.
    const chip = await modelOf(reader, ANSWERED).boundingBox();
    const card = await reader.locator('[data-thread-panel="th_models"]').boundingBox();
    expect((chip?.x ?? 0) + (chip?.width ?? 0)).toBeLessThanOrEqual(
      (card?.x ?? 0) + (card?.width ?? 0),
    );
  });

  test("reads at a glance on the card in the margin", async ({ page }) => {
    await openNote(page);
    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    const focus = page.locator(".focus.open");
    await expect(focus.locator(".focus-margin")).toHaveCount(1);
    await turn(focus, ANSWERED).waitFor();

    await expectTheRule(focus);
  });

  test("reads at a glance on a child thread nested under a turn", async ({ page }) => {
    const reader = await openThreadInColumn(page);
    const nested = reader.locator('[data-thread-panel="th_child"]');
    await expect(nested).toHaveCount(1);
    // Nested under the turn it is about, not parked below the conversation.
    await expect(turn(reader, ANSWERED).locator('[data-thread-panel="th_child"]')).toHaveCount(1);

    await expect(modelOf(nested, NESTED)).toHaveText(HAIKU);
  });

  /**
   * The assertion this suite exists for. "Quickly identifiable" is a claim about
   * what is on screen, and the two controls sharing this row are the app's own
   * counter-example: they are in the DOM at rest and invisible until hovered. If
   * the model were drawn like them it would pass every DOM test and answer
   * nobody's question.
   */
  test("is on screen at rest, unlike the hover-revealed controls beside it", async ({ page }) => {
    const reader = await openThreadInColumn(page);
    const chip = modelOf(reader, ANSWERED);

    await expect(chip).toBeVisible();
    expect(await chip.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    const box = await chip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // And whole, not ellipsized: `toHaveText` reads the text node and passes on
    // a chip clipped to `claude-opus-4-20250…`, which answers the question with
    // the half of the name that does not distinguish one model from another.
    // The first `max-width` shipped here did exactly that.
    expect(await chip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    // The same row's comment control, at rest: present, and not showing.
    const control = turn(reader, ANSWERED).locator("> .turn-who > .turn-comment");
    await expect(control).toHaveCount(1);
    expect(await control.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
  });

  /**
   * §11 fixes exactly what a collapsed line reports — that it exists, what it is
   * about, who spoke last, how many turns, and whether anything is unread — and
   * says the set is closed. The model is not in it.
   */
  test("is not in the line a collapsed conversation folds down to", async ({ page }) => {
    const reader = await openNote(page);
    const panel = reader.locator('[data-thread-panel="th_models"]');
    await expect(modelOf(panel, ANSWERED)).toHaveText(OPUS);

    // The conversation's **own** fold control, not the nested child's.
    await panel.locator("> .thread-card > .t-head > .t-collapse").click();

    const line = panel.locator("> [data-thread-expand]");
    await expect(line).toHaveCount(1);
    await expect(panel.locator(".turn-model")).toHaveCount(0);
    await expect(line).not.toContainText(OPUS);
    await expect(line).not.toContainText(HAIKU);
    // The five things the line does report are untouched by all this.
    await expect(line).toContainText("4 turns");
    await expect(line).toContainText("agent");
    await expect(line).toContainText("lender spreads");
  });

  /**
   * The model rides on the turn's **timestamp**, and a revision keeps that
   * identity (SPEC.md §6: same author, same timestamp, no new turn). So a body
   * rewritten in place still names the model that wrote it.
   */
  test("survives a turn revised in place", async ({ page }) => {
    const revised: StubRow = {
      ...THREAD,
      body: THREAD.body?.replace("Three of them.", "Three of them — corrected: four.") ?? "",
      // The child's anchor quote went with the rewrite; the conversation is now
      // an orphan, which is §6's own answer and not this feature's business.
      anchors: [],
    };
    await board(page, [INBOX, THREADS_VIEW, NOTE, revised, CHILD]);
    await page.locator('.col[data-col="doc_view_threads"] .row[data-row-doc="th_models"]').click();
    const reader = page.locator('.reader[data-reader-doc="th_models"]');
    await turn(reader, ANSWERED).waitFor();

    await expect(turn(reader, ANSWERED)).toContainText("Three of them — corrected: four.");
    await expectTheRule(reader);
  });
});
