import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-104, from the only place it can be seen: a real editor with autosave on.
 *
 * §11 gives the document view **autosave and no save button**, so opening a
 * document and typing one character anywhere in it writes the whole body back.
 * A table that gains a column on that save is not a formatting difference — it
 * is the user's file, restructured, committed under their authorship, with
 * nothing on the page that says so.
 *
 * The table below carries both halves of the defect, in the spelling real
 * documents use:
 *
 * - **row 94** is what an agent wrote and GFM reads as ragged: a bare `|`
 *   inside a cell, so the row has four cells under a three-column header.
 *   Before the fix the printer laid the table out as a matrix as wide as its
 *   widest row — the header grew a fourth column, the delimiter row grew a
 *   fourth `---`, and every other row grew an empty cell;
 * - **row 95** holds a reference with an alias, which is spelled with a pipe.
 *   That one is the *writer's* fault outright: `[[id|alias]]` printed bare into
 *   a cell splits the row on the next read, so a correctly written file became
 *   a wrong one — and it did not even settle, because the split row then
 *   widened the table on the save after that.
 *
 * As in `list-blocks.spec.ts`, the stub is the transport and nothing above it:
 * real React, real ProseMirror, real TipTap, real autosave debounce, and the
 * assertion is against the bytes the editor put on the wire. The disk-and-git
 * half stays in the issue's real-app log.
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

/** The reference row 95 points at, so the ref resolves to a title like any other. */
const EARLIER: StubRow = {
  id: "doc_z9y8x7",
  title: "The earlier draft",
  path: "data/docs/inbox/earlier.md",
  body: "Superseded.\n",
};

/** The eval table as an agent wrote it: one bare pipe, one aliased reference. */
const NOTE_BODY = [
  "The eval table, as an agent wrote it:",
  "",
  "| Test | Result | Notes                                 |",
  "| ---- | ------ | ------------------------------------- |",
  "| 94   | PASS   | 3 pending, 200\\|0 skipped             |",
  "| 95   | PASS   | see [[doc_z9y8x7\\|the earlier draft]] |",
  "",
  "A closing paragraph, nowhere near any of it.",
  "",
].join("\n");

const NOTE: StubRow = {
  id: "doc_note",
  title: "Eval report",
  path: "data/docs/inbox/doc_note.md",
  body: NOTE_BODY,
};

const CLOSING = "A closing paragraph, nowhere near any of it.";
const EDITED = "A closing paragraph the user rewrote, nowhere near any of it.";

/** The pipe that is content, in each of the two constructs that carry one. */
const FOLDED_SURPLUS = "3 pending, 200\\|0 skipped";
const ALIASED_REFERENCE = "see [[doc_z9y8x7\\|the earlier draft]]";

/** How many cells a `|`-delimited row has: its unescaped pipes, less the two edges. */
function cellCount(row: string): number {
  return (row.match(/(?<!\\)\|/g) ?? []).length - 1;
}

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, EARLIER, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  return corpus;
}

/**
 * Replaces the closing paragraph by selecting it and typing over it — the same
 * shape as `list-blocks.spec.ts`, and for the same reason: `End` goes to the
 * end of the *visual* line, so on a paragraph the column wraps it lands
 * mid-sentence.
 */
async function rewriteClosingParagraph(page: Page, text: string): Promise<void> {
  const closing = page.locator(".reader .ProseMirror > p").last();
  await expect(closing).toHaveText(CLOSING);
  await closing.click({ clickCount: 3 });
  await page.keyboard.type(text);
  await expect(closing).toHaveText(text);
}

async function savedBody(corpus: StubCorpus, atLeast = 1): Promise<string> {
  await expect
    .poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(atLeast);
  return (await corpus.doc("doc_note"))?.body ?? "";
}

test.describe("a pipe inside a table cell, through the editor and autosave", () => {
  test("typing elsewhere writes the table back with the same columns", async ({ page }) => {
    const corpus = await openNote(page);

    await rewriteClosingParagraph(page, EDITED);

    const saved = await savedBody(corpus);
    expect(saved).toContain(EDITED);

    const rows = saved.split("\n").filter((line) => line.startsWith("|"));
    // Header, delimiter and two body rows, every one of them three cells wide.
    expect(rows).toHaveLength(4);
    expect(rows.map(cellCount)).toEqual([3, 3, 3, 3]);

    expect(saved).toContain(FOLDED_SURPLUS);
    expect(saved).toContain(ALIASED_REFERENCE);

    expect(saved).toBe(NOTE_BODY.replace(CLOSING, EDITED));
  });

  test("a second save changes nothing again — the printer is a fixed point", async ({ page }) => {
    const corpus = await openNote(page);
    await rewriteClosingParagraph(page, EDITED);
    const first = await savedBody(corpus);

    await page.keyboard.type(" Twice.");
    const second = await savedBody(corpus, 2);

    expect(second).toBe(first.replace(EDITED, `${EDITED} Twice.`));
    const rows = second.split("\n").filter((line) => line.startsWith("|"));
    expect(rows.map(cellCount)).toEqual([3, 3, 3, 3]);
    expect(second).toContain(ALIASED_REFERENCE);
  });
});
