import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus } from "./stubCorpus";

/**
 * UI-072: hard-wrapped prose in the document editor, in a real browser.
 *
 * This is the half no component test can make. The newline is in the text node
 * either way — that is the point of the fix, and what keeps the file's bytes
 * intact — so the DOM alone cannot tell the defect from the fix. What separates
 * them is **geometry**: whether the browser draws a paragraph the agent wrapped
 * at 80 columns as one flowing line or as the three it was typed on.
 *
 * The second claim here is the one the obvious fix fails: opening the document
 * and leaving it writes **nothing**. The server is the sole writer (CLAUDE.md
 * architecture decision 2), so no `PUT` means no file change, no auto-commit,
 * and the stored body is asserted byte-for-byte on the way out as well.
 */

const NOTES_VIEW = {
  id: "doc_view_notes",
  type: "view",
  title: "Notes",
  path: "data/docs/views/notes.md",
  order: 1,
  query: { folder: "notes" },
};

/**
 * A note written the way the agent writes them: paragraphs hard-wrapped at a
 * fixed column. Short enough that each joined paragraph fits on one rendered
 * line, which is what makes "one line, not three" a measurable claim.
 *
 * It also carries the three constructs whose whitespace must **not** move: a
 * deliberate hard break, a fenced block, and a construct kept as raw source.
 *
 * Written in the serializer's own canonical shape — trailing newline and all —
 * so "the file is unchanged" is an equality against these exact bytes and not
 * against a normalisation of them.
 */
const BODY = [
  "Tomorrow is a",
  "Wednesday, so the",
  "office opens later.",
  "",
  "A deliberate break\\",
  "stays a break.",
  "",
  "```txt",
  "first",
  "second",
  "```",
  "",
  "<section>",
  "raw",
  "</section>",
  "",
].join("\n");

const NOTE = {
  id: "doc_wrapped",
  type: "note",
  title: "Office hours",
  path: "data/docs/notes/doc_wrapped.md",
  body: BODY,
};

/**
 * Resolves once `target`'s box has read the same for three consecutive frames.
 *
 * The browser's own answer to "has it stopped", with no invented duration in it
 * — two frames would accept an animation that happens to hold still for one.
 * Same routine `anchor-layer.spec.ts` uses, and here for the same reason.
 */
async function stoppedMoving(target: Locator): Promise<void> {
  await target.evaluate(
    async (element) =>
      new Promise<void>((resolve) => {
        let previous = "";
        let repeats = 0;
        const tick = (): void => {
          const box = element.getBoundingClientRect();
          const current = `${String(box.x)},${String(box.y)},${String(box.width)},${String(box.height)}`;
          repeats = current === previous ? repeats + 1 : 0;
          previous = current;
          if (repeats >= 2) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Opens the note and waits for the reading surface to stop moving.
 *
 * **Every claim in this file is geometric, and geometry is only a claim once
 * the layout has settled.** Since UI-149 (SPEC.md §10, rider 3) a row click
 * opens the reader in a **path column** at its own fixed 440px — the query
 * column no longer widens — so the settling this waits for is the board's
 * snap-scroll to the new column, not a width animation. The sentence this
 * suite draws is 51 characters, about 367px of the shipped serif, and a 440px
 * path column offers ~410px of measure: still one line box, exactly as the
 * pre-rider 560px reader drew it.
 */
async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [NOTES_VIEW, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_wrapped"]').click();
  await expect(page.locator(".reader .doc-editor .ProseMirror p").first()).toBeVisible();
  await stoppedMoving(page.locator(".pcol"));
  return corpus;
}

/**
 * Puts the caret at the **end of a paragraph**, and proves it is there
 * (UI-105).
 *
 * **The failure that actually happened was the race, and it is already fixed.**
 * `click()` resolves when the mouse events have been delivered, which is not
 * when the editor has taken focus: ProseMirror sets its selection from the
 * mousedown, but the surface becomes `document.activeElement` a beat later. A
 * caret-movement key that arrives inside that beat goes to a page with no
 * editable focus, where Chrome treats it as "scroll", and the *next* keystroke
 * — by then focused — inserts at wherever the mousedown left the caret. That is
 * the whole of the `offic!e` failure this suite produced under the pre-push
 * gate: the caret was mid-word because the key never ran, not because anything
 * moved under it. `paragraph.click()` lands in the middle of the box, and the
 * middle of this paragraph is inside "office". Reproduced exactly by blurring
 * the surface between the click and the key, which writes `offic!e opens
 * later.` byte for byte. So the wait below is on the condition — this element
 * has the caret — and never on a duration.
 *
 * **`End` was not the cause, and the measurement says so.** UI-105 read the
 * symptom as `End` reaching the end of a *visual* line, which would make this
 * spec depend on where the browser happened to wrap. Probed in Chromium against
 * this exact document at a measure narrow enough to wrap it — 234px, one
 * paragraph over two line boxes — with the caret placed after the first
 * character of the first line: `End` left **nothing** between the caret and the
 * end of the paragraph. It is a text-block command here, not a visual-line one.
 *
 * **What is removed is the unstated dependency, not a defect.** That `End`
 * crosses a wrap is a fact about ProseMirror's keymap that this spec never
 * stated and cannot see change. So no key is pressed at all: the click is aimed
 * at the last character's own box, which the browser is *asked* for rather than
 * assumed, and lands just past it — the end of whatever line that character
 * ended up on, which is the end of the paragraph however the text wrapped. It
 * matters more now than it did, because the reading measure is a person's to
 * change (UI-066).
 *
 * **Aimed at a paragraph that has stopped moving.** A cold open is still laying
 * out after the body appears — the board snap-scrolls the new path column into
 * view, moving the paragraph (`reveal.ts` records the same class of
 * measurement). A point measured before that and clicked after it lands under
 * the paragraph rather than in it, and the caret goes to whatever is there
 * instead — observed, as `outside the paragraph`. {@link openNote} settles the
 * column and this settles the paragraph itself, because the two move at
 * different times.
 *
 * **And it is checked, not trusted.** A caret one character out writes a
 * plausible-looking body that fails an assertion pages later, which is how this
 * suite ate three full runs. The range from the selection to the end of the
 * paragraph has to be empty before anything is typed, and the failure says how
 * many characters short it was.
 */
async function caretAtEndOf(page: Page, target: Locator): Promise<void> {
  await stoppedMoving(target);
  const point = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode() !== null) last = walker.currentNode as Text;
    if (last === null || last.length === 0) return null;
    const glyph = document.createRange();
    glyph.setStart(last, last.length - 1);
    glyph.setEnd(last, last.length);
    const tail = glyph.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    // Just past the last character, and never outside the paragraph's own box:
    // a click one pixel beyond it is a click on something else.
    return {
      x: Math.min(tail.right + 2, box.right - 1),
      y: Math.min(Math.max(tail.top + tail.height / 2, box.top + 1), box.bottom - 1),
    };
  });
  if (point === null) throw new Error("the paragraph has no text to aim the caret at");

  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".reader .doc-editor .ProseMirror")).toBeFocused();
  await expect
    .poll(async () =>
      target.evaluate((element) => {
        const selection = globalThis.getSelection();
        if (selection === null || selection.anchorNode === null) return "no selection";
        if (!selection.isCollapsed) return "a selection, not a caret";
        if (!element.contains(selection.anchorNode)) return "outside the paragraph";
        const rest = document.createRange();
        rest.setStart(selection.anchorNode, selection.anchorOffset);
        rest.setEnd(element, element.childNodes.length);
        return rest.toString() === "" ? "at the end" : `${String(rest.toString().length)} short`;
      }),
    )
    .toBe("at the end");
}

/** The height of one rendered line of the body's own type. */
async function lineHeight(page: Page): Promise<number> {
  return page
    .locator(".reader .doc-editor .ProseMirror p")
    .first()
    .evaluate((element) => {
      const parsed = Number.parseFloat(globalThis.getComputedStyle(element).lineHeight);
      return Number.isNaN(parsed) ? 20 : parsed;
    });
}

test.describe("a hard-wrapped paragraph in the document editor", () => {
  test("is drawn as flowing prose, exactly as every read surface draws it", async ({ page }) => {
    await openNote(page);
    const paragraph = page.locator(".reader .doc-editor .ProseMirror p").first();

    // `innerText` is the browser's own account of what it painted: the soft
    // newlines came out as the spaces CommonMark says they are.
    expect(await paragraph.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      "Tomorrow is a Wednesday, so the office opens later.",
    );
    await expect(paragraph.locator("br")).toHaveCount(0);

    // …and it is *drawn* that way: one line's worth of box for a sentence the
    // file spreads over three. This is the assertion the defect fails.
    const line = await lineHeight(page);
    const height = await paragraph.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeLessThan(line * 1.5);
  });

  test("still holds the file's newline — the text the model and the DOM carry", async ({
    page,
  }) => {
    await openNote(page);
    // `textContent`, not `innerText`: the un-painted truth. A comment anchor is
    // matched against the body's characters (SPEC.md §6), so the newline has to
    // still be there for a selection spanning a wrap to find itself.
    const text = await page
      .locator(".reader .doc-editor .ProseMirror p")
      .first()
      .evaluate((element) => element.textContent);
    expect(text).toBe("Tomorrow is a\nWednesday, so the\noffice opens later.");
  });

  test("keeps the whitespace rules of everything around it", async ({ page }) => {
    await openNote(page);
    const body = page.locator(".reader .doc-editor .ProseMirror");

    // A deliberate hard break is a `<br>` and takes the two lines it asks for.
    const broken = body.locator("p").nth(1);
    await expect(broken.locator("br")).toHaveCount(1);
    const line = await lineHeight(page);
    expect(
      await broken.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThan(line * 1.5);

    // A fence keeps its own line endings, and the surface keeps `pre-wrap`.
    const fence = body.locator("pre code").first();
    expect(await fence.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      "first\nsecond",
    );
    await expect(body).toHaveCSS("white-space", "pre-wrap");

    // A construct kept as raw source keeps `white-space: pre` (UI-006) — on the
    // element the editor actually mounts, which is a node view and therefore
    // `contenteditable="false"`. `editor.spec.ts` pins the same rule on a probe
    // that is neither, and that is why this one is worth making twice.
    const raw = body.locator("pre.md-raw");
    await expect(raw).toHaveCSS("white-space", "pre");
    expect(await raw.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      "<section>\nraw\n</section>",
    );
  });
});

test.describe("merely reading the document", () => {
  test("writes nothing — the file is byte-identical after opening and closing it", async ({
    page,
  }) => {
    const corpus = await openNote(page);
    expect((await corpus.doc("doc_wrapped"))?.body).toBe(BODY);

    // Leave the document the way a reader does. Unmounting the editor is the
    // moment autosave flushes its buffer, so this is the step that would turn a
    // parse-time normalisation into a whole-file diff nobody asked for.
    await page.locator(".reader .back").click();
    await expect(page.locator(".reader .doc-editor")).toHaveCount(0);

    expect(await corpus.of("PUT")).toHaveLength(0);
    expect((await corpus.doc("doc_wrapped"))?.body).toBe(BODY);
  });

  test("still saves once the user actually types, wrapping and all", async ({ page }) => {
    // The other side of the same claim: silence on open is the document being
    // unchanged, not the editor being broken. One keystroke and it is written —
    // with the agent's wrapping, and everything the user did not touch, exactly
    // as they were.
    const corpus = await openNote(page);
    await caretAtEndOf(page, page.locator(".reader .doc-editor .ProseMirror p").first());
    await page.keyboard.type("!");

    await expect.poll(async () => (await corpus.of("PUT")).length).toBeGreaterThan(0);
    expect((await corpus.doc("doc_wrapped"))?.body).toBe(
      BODY.replace("office opens later.", "office opens later.!"),
    );
  });

  /**
   * The larger half of UI-072, and the one only a browser can catch.
   *
   * ProseMirror reads a typed change back by re-parsing the DOM around it, and
   * prosemirror-model's default reading of a paragraph turns every newline it
   * finds into a **hard break** node (TipTap's `hardBreak` declares
   * `linebreakReplacement`). Measured here before the fix: typing one character
   * into the first line rewrote the paragraph's soft wraps as `\` hard breaks —
   * lines the user never touched, changed in meaning, and auto-committed.
   */
  test("editing one line leaves the paragraph's other wraps untouched", async ({ page }) => {
    const corpus = await openNote(page);
    const paragraph = page.locator(".reader .doc-editor .ProseMirror p").first();

    // Double-click selects "Tomorrow", on the paragraph's *first* source line;
    // the wraps that must survive are the two below it.
    await paragraph.dblclick({ position: { x: 5, y: 5 } });
    // Same wait as `caretIn`, for the same reason — a double click selects the
    // word from the mousedown, and focus lands after it.
    await expect(page.locator(".reader .doc-editor .ProseMirror")).toBeFocused();
    await page.keyboard.type("Today");

    await expect.poll(async () => (await corpus.of("PUT")).length).toBeGreaterThan(0);
    expect((await corpus.doc("doc_wrapped"))?.body).toBe(BODY.replace("Tomorrow", "Today"));
    // No break was invented — not in the file, and not on the screen.
    await expect(paragraph.locator("br")).toHaveCount(0);
  });
});
