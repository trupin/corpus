import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-103, from the only place it can be seen: a real editor with autosave on.
 *
 * §10 gives the document view **autosave and no save button**, so opening a
 * document and typing one character anywhere in it writes the whole body back.
 * That makes the serializer's fidelity a data-integrity property rather than a
 * formatting one, and it is why the assertion here is against the bytes the
 * editor put on the wire rather than against `serializeDoc` in isolation —
 * unit tests can prove the printer is a fixed point, and only this can prove
 * that the thing which actually saves the file is that printer, over a
 * document ProseMirror really parsed and really re-serialised.
 *
 * The body below is the reported construct and its neighbours: a further
 * paragraph of an outer list item after a nested sublist, after a blockquote,
 * and after a table. Before the fix each one lost its blank line on the first
 * save, and the *next* read moved the paragraph inside the block above it — a
 * paragraph silently leaving the outer item, in the user's own file, committed
 * under their authorship.
 *
 * It also holds the sublist the *first* fix got wrong. Keeping a sublist flush
 * under its paragraph is what makes every hand-written nested list survive, but
 * a sublist only stays where it was put if it may **interrupt** a paragraph —
 * and an ordered one that does not start at 1 may not. Printed flush it becomes
 * lazy continuation text, and the save after that escapes its markers to
 * `5\. item five` for good. The empty-first-item half of the same hole is not a
 * shape a file holds; it is two keystrokes, and it has its own test below.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real ProseMirror, real TipTap, real autosave debounce. The disk-and-git half
 * — the same edit against a `corpus init` workspace, with the file and
 * `git log` read after it — stays in the issue's real-app log, as
 * sprint-016 Adjudication 19 requires.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** Where the trailing paragraph has to still be after a save. */
const OUTER_ITEM_INDENT = "\n\n  A trailing paragraph of the outer item.";

/** Where it went before the fix: inside the nested item, at its indent. */
const NESTED_ITEM_INDENT = "\n    A trailing paragraph of the outer item.";

/** The reported construct and its neighbours, as a file would hold them. */
const NOTE_BODY = [
  "- Outer bullet leads in.",
  "  - Nested bullet one.",
  "  - Nested bullet two.",
  "",
  "  A trailing paragraph of the outer item.",
  "- Second outer bullet.",
  "",
  "  > A quotation inside a list item.",
  "",
  "  Prose after the quotation, which is not part of it.",
  "- Third outer bullet.",
  "",
  "  | Column | Meaning |",
  "  | ------ | ------- |",
  "  | a      | first   |",
  "",
  "  Prose after the table, which is not another row of it.",
  "- Fourth outer bullet.",
  "",
  "  5. item five",
  "  6. item six",
  "",
  "A closing paragraph, nowhere near any of it.",
  "",
].join("\n");

/** The ordered sublist's markers, which a flush printing turns into prose. */
const ORDERED_SUBLIST = "\n\n  5. item five\n  6. item six\n";

/** What the second save wrote once the first had made the markers prose. */
const ESCAPED_MARKERS = "5\\. item five";

const NOTE: StubRow = {
  id: "doc_note",
  title: "Lender checklist",
  path: "data/docs/inbox/doc_note.md",
  body: NOTE_BODY,
};

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  // Every gesture below aims at a measured point. The column no longer eases
  // open (UI-146), so this is now a guard against the reader's *other* late
  // arrivals rather than against the widening — see `settledReader`.
  await settledReader(page);
  return corpus;
}

/** The closing paragraph's text, before and after the edit these tests make. */
const CLOSING = "A closing paragraph, nowhere near any of it.";
const EDITED = "A closing paragraph the user rewrote, nowhere near any of it.";

/**
 * Replaces the closing paragraph by selecting it and typing over it.
 *
 * Selecting first, rather than clicking and pressing `End`: the reader's column
 * is narrow enough to wrap this paragraph, and `End` goes to the end of the
 * **visual** line, so the character landed mid-sentence on whichever runs the
 * layout happened to produce. A triple click selects the paragraph however it
 * wrapped, which makes the edit the same edit every run.
 */
async function rewriteClosingParagraph(page: Page, text: string): Promise<void> {
  const closing = page.locator(".reader .ProseMirror > p").last();
  await expect(closing).toHaveText(CLOSING);
  await closing.click({ clickCount: 3 });
  await page.keyboard.type(text);
  await expect(closing).toHaveText(text);
}

/**
 * Puts the caret at the end of a paragraph, and waits until it is really there.
 *
 * Neither of the two obvious ways works here. `End` goes to the end of the
 * **visual** line, so on a paragraph the column wraps it lands mid-sentence
 * (the hazard behind `soft-wrap`'s flake). And a triple click followed by
 * `ArrowRight` looks collapsed to `window.getSelection()` while ProseMirror
 * still holds a node selection, so the `Enter` after it *replaces* the
 * paragraph — observed here, deleting the very block the test is about.
 *
 * A click just inside the right edge of the paragraph's **last line box** has
 * neither problem: `getClientRects()` gives one rect per visual line however it
 * wrapped, and a plain click leaves an ordinary collapsed text caret.
 *
 * **`isCollapsed` alone is not the check, and it hid a real miss.** A caret is
 * collapsed wherever it is, so a click that landed nowhere near this paragraph
 * satisfied it and the `Enter`/`Tab` after it acted somewhere else entirely: on
 * this branch the gesture sank the whole outer list under a new empty item, on
 * 4 runs in 10, and the spec reported it as a serializer defect. The cause is
 * above (`openNote` now waits for the column to stop easing open), and this is
 * the tripwire that would have named it — the caret has to be **inside the
 * paragraph that was aimed at**, not merely collapsed.
 */
async function caretAtEndOf(page: Page, paragraph: Locator): Promise<void> {
  const point = await paragraph.evaluate((element) => {
    const rects = element.getClientRects();
    const last = rects[rects.length - 1];
    if (last === undefined) throw new Error("paragraph has no line box");
    return { x: last.right - 2, y: last.top + last.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(
      () =>
        paragraph.evaluate((element) => {
          const selection = window.getSelection();
          if (selection === null || !selection.isCollapsed) return false;
          const at = selection.anchorNode;
          return at !== null && element.contains(at);
        }),
      { message: "the click did not leave a caret inside the paragraph it aimed at" },
    )
    .toBe(true);
}

/** The body the editor autosaved, once a `PUT` has landed. */
async function savedBody(corpus: StubCorpus): Promise<string> {
  await expect
    .poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  return (await corpus.doc("doc_note"))?.body ?? "";
}

test.describe("a list item's own blocks, through the editor and autosave", () => {
  test("typing elsewhere writes the construct back unchanged", async ({ page }) => {
    const corpus = await openNote(page);

    // The edit is in the last paragraph — as far from the construct as the
    // document allows, and concerning no list at all.
    await rewriteClosingParagraph(page, EDITED);

    const saved = await savedBody(corpus);
    expect(saved).toContain(EDITED);

    // The paragraph is still the outer item's, at the outer item's indent.
    expect(saved).toContain(OUTER_ITEM_INDENT);
    expect(saved).not.toContain(NESTED_ITEM_INDENT);
    // The quotation did not swallow the prose after it, and the table did not
    // take it as another row.
    expect(saved).toContain("\n\n  Prose after the quotation, which is not part of it.");
    expect(saved).toContain("\n\n  Prose after the table, which is not another row of it.");
    // The ordered sublist is still a list, with its own first number, and not
    // continuation text of the paragraph above it.
    expect(saved).toContain(ORDERED_SUBLIST);
    expect(saved).not.toContain(ESCAPED_MARKERS);

    // And every byte the edit did not touch is the byte that was on disk: the
    // whole point is that a save nobody asked for changes nothing.
    expect(saved).toBe(NOTE_BODY.replace(CLOSING, EDITED));
  });

  test("a second save changes nothing again — the printer is a fixed point", async ({ page }) => {
    const corpus = await openNote(page);
    await rewriteClosingParagraph(page, EDITED);
    const first = await savedBody(corpus);

    // A second edit re-serialises what the first one saved, which is the pass
    // that used to move the paragraph: the text the editor now holds is its own
    // output, so this is where a non-idempotent printer shows itself.
    await page.keyboard.type(" Twice.");
    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length, { timeout: 10_000 })
      .toBeGreaterThan(1);
    const second = (await corpus.doc("doc_note"))?.body ?? "";

    expect(second).toBe(first.replace(EDITED, `${EDITED} Twice.`));
    expect(second).toContain(OUTER_ITEM_INDENT);
    expect(second).not.toContain(NESTED_ITEM_INDENT);
  });

  /**
   * The other half of the same hole, and the one no file can hold: a sublist
   * whose first item is empty.
   *
   * It is not a shape anyone writes — it is what the editor is *in* between two
   * keystrokes and a pause. `Enter` at the end of an item's text opens the next
   * item, `Tab` sinks it into a sublist, and autosave fires before anything is
   * typed into it. Printed flush, the lone `-` on the line under a paragraph is
   * a **setext underline**: the file comes back holding `## Outer bullet leads
   * in.`, and the user's sentence is a heading.
   */
  test("an empty sublist opened with Enter then Tab does not underline the text above it", async ({
    page,
  }) => {
    const corpus = await openNote(page);

    // The end of the first outer item's trailing paragraph — the last block of
    // an item that already holds a sublist, so `Tab` opens a second one.
    const trailing = page
      .locator(".reader .ProseMirror li p", { hasText: "A trailing paragraph of the outer item." })
      .first();
    await caretAtEndOf(page, trailing);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    const saved = await savedBody(corpus);

    // The lead sentence is still a bullet's paragraph, not an H2 …
    expect(saved).toContain("- Outer bullet leads in.");
    expect(saved).not.toContain("## ");
    // … the trailing paragraph is still the outer item's …
    expect(saved).toContain(OUTER_ITEM_INDENT);
    expect(saved).not.toContain(NESTED_ITEM_INDENT);
    // … and the empty item the gesture opened is separated from it, which is
    // the only spelling that keeps it a list.
    expect(saved).toContain("A trailing paragraph of the outer item.\n\n  -\n");

    // Whatever the editor wrote, reopening on it must write the same bytes: a
    // shape that only survives one printing is the defect, not the spelling.
    await page.keyboard.type("Now it has text.");
    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length, { timeout: 10_000 })
      .toBeGreaterThan(1);
    const second = (await corpus.doc("doc_note"))?.body ?? "";
    expect(second).toContain("- Outer bullet leads in.");
    expect(second).not.toContain("## ");
    expect(second).toContain("Now it has text.");
  });
});
