import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";
import type { Page } from "@playwright/test";

/**
 * **The persistent formatting toolbar** (SPEC.md §10, rider signed 2026-08-12;
 * UI-101).
 *
 * The rider asks for two things a unit test cannot see. The bar must be
 * *present* — "always present, above the document", with no mode and no click to
 * summon it — and it must **report state**: "the heading control names the
 * current block's level, and an active mark shows as active, so the toolbar says
 * what the text already is and not only what could be done to it."
 *
 * So every assertion below either moves a caret and reads the bar, or presses
 * the bar and reads the file that gets saved. A control that wrote correctly and
 * reported nothing would pass a render test and fail the rider.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const THREAD: StubRow = {
  id: "th_talk",
  type: "thread",
  title: "A conversation",
  // In the view's folder so the stub's board shows it; a thread is a document
  // and §5 puts no constraint on where one lives.
  path: "data/docs/inbox/talk.md",
  body: "## user · 2026-08-01T09:00:00Z\n\nHello.\n",
};

const NOTE: StubRow = {
  id: "doc_fmt",
  title: "Formatting",
  path: "data/docs/inbox/fmt.md",
  body: ["## A heading", "", "A plain paragraph.", "", "Another **bold** paragraph.", ""].join(
    "\n",
  ),
};

const BAR = ".focus .fmt-bar";

async function openFocus(page: Page, docId: string): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE, THREAD]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await page.locator(".reader").waitFor();
  await page.keyboard.press("f");
  await page.locator(".focus.open").waitFor();
  return corpus;
}

/**
 * Puts the caret inside the nth top-level block, and waits for the editor to
 * have taken focus.
 *
 * `click()` resolves when the mouse events land, which is not when the target
 * has focus — and a key pressed inside that gap reaches the page instead of the
 * editor, so `Home`/`Shift+End` select nothing and every assertion after it
 * fails for a reason that is not the toolbar's. Waiting on the condition rather
 * than on a duration is `clipboard.spec.ts`'s own remedy for the same gap.
 */
async function caretIn(page: Page, nth: number): Promise<void> {
  await page.locator(`.focus .ProseMirror > *`).nth(nth).click();
  await expect(page.locator(".focus .ProseMirror")).toBeFocused();
}

/**
 * Selects the whole of the nth top-level block.
 *
 * A triple click, not `Home` then `Shift+End`. Those two are what this used to
 * do and they are **wrong on macOS**, where Chromium reads them as document
 * navigation inside a contenteditable rather than line navigation: sometimes
 * they selected two paragraphs, sometimes nothing at all, and the test then
 * failed on a synchronisation point for a reason that had nothing to do with
 * the toolbar. Diagnosed rather than retried (INFRA-020).
 */
async function selectBlock(page: Page, nth: number): Promise<void> {
  await page.locator(`.focus .ProseMirror > *`).nth(nth).click({ clickCount: 3 });
  await expect(page.locator(".focus .ProseMirror")).toBeFocused();
  // The floating toolbar opening is the editor saying it has the selection — a
  // synchronisation point, not an extra assertion.
  await expect(page.locator(".sel-toolbar")).toBeVisible({ timeout: 10_000 });
}

test.describe("the toolbar is there, and it says what the text is", () => {
  test("is present without a mode or a click, and only in focus mode", async ({ page }) => {
    await stubCorpus(page, [VIEW, NOTE, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_fmt"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    // A column reader gets none: a persistent bar costs vertical space a column
    // cannot spare (SHARED-034's sign-off).
    await expect(page.locator(".reader .fmt-bar")).toHaveCount(0);

    await page.keyboard.press("f");
    await page.locator(".focus.open").waitFor();
    await expect(page.locator(BAR)).toBeVisible();
  });

  test("the heading control names the block the caret is in", async ({ page }) => {
    await openFocus(page, "doc_fmt");
    const block = page.locator(`${BAR} select[data-fmt="block"]`);

    await caretIn(page, 0); // "## A heading"
    await expect(block).toHaveValue("2");

    await caretIn(page, 1); // "A plain paragraph."
    await expect(block).toHaveValue("0");
  });

  test("an active mark shows as active, and the caret moving is enough", async ({ page }) => {
    await openFocus(page, "doc_fmt");
    const bold = page.locator(`${BAR} button[data-fmt="bold"]`);

    await caretIn(page, 1); // a paragraph with no marks at all
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    // Into the bold word, by keyboard only — no selection is made, so nothing
    // but the caret's position has changed.
    await page.locator(".focus .ProseMirror strong").click();
    await expect(page.locator(".focus .ProseMirror")).toBeFocused();
    await expect(bold).toHaveAttribute("aria-pressed", "true");
  });

  test("a thread gets no toolbar, because no editor is mounted for one", async ({ page }) => {
    // The gate is `DocView` mounting an editor at all — it does so only for a
    // body it edits, never for a `thread` and never for a `view`. Nothing here
    // re-derives that; a surface with no editor publishes none.
    await openFocus(page, "th_talk");
    await expect(page.locator(".focus.open")).toBeVisible();
    await expect(page.locator(".focus .ProseMirror")).toHaveCount(0);
    await expect(page.locator(BAR)).toHaveCount(0);
  });
});

test.describe("the toolbar writes what the file can hold", () => {
  test("a mark applied from the bar reaches the saved markdown", async ({ page }) => {
    const corpus = await openFocus(page, "doc_fmt");

    // Select the words of the plain paragraph, then underline them.
    await selectBlock(page, 1);
    await page.locator(`${BAR} button[data-fmt="underline"]`).click();
    await expect(page.locator(`${BAR} button[data-fmt="underline"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_fmt")).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const saved = await corpus.doc("doc_fmt");
    expect(saved?.body).toContain("<u>A plain paragraph.</u>");
  });

  test("a colour role reaches the file as a named role, never a colour", async ({ page }) => {
    const corpus = await openFocus(page, "doc_fmt");
    await selectBlock(page, 1);
    await page.locator(`${BAR} select[data-fmt="color"]`).selectOption("warning");

    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_fmt")).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const saved = await corpus.doc("doc_fmt");
    expect(saved?.body).toContain('{color="warning"}');
    // A named role, never a colour: §5 says "never raw hex in the body", which
    // is what makes a document re-themable without editing it.
    expect(saved?.body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(saved?.body).not.toContain("rgb");
  });

  test("alignment wraps the block, and clearing it removes the wrapper", async ({ page }) => {
    const corpus = await openFocus(page, "doc_fmt");
    const align = page.locator(`${BAR} select[data-fmt="align"]`);

    await caretIn(page, 1);
    await expect(align).toHaveValue("");
    await align.selectOption("center");
    await expect(align).toHaveValue("center");

    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_fmt")).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    expect((await corpus.doc("doc_fmt"))?.body).toContain('::: {align="center"}');

    // Clearing the last property must remove the block, not leave `::: {}` —
    // which is not something the file can even spell.
    await align.selectOption("");
    await expect(align).toHaveValue("");
    // The wrapper is gone from the document too, not merely from the file: a
    // node the file cannot express has no business staying in the editor, where
    // the next layout change would silently re-use it.
    await expect(page.locator(".focus .ProseMirror .md-style-block")).toHaveCount(0);
    const writes = (await corpus.of("PUT", "/api/docs/doc_fmt")).length;
    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_fmt")).length, { timeout: 10_000 })
      .toBeGreaterThan(writes);
    const cleared = (await corpus.doc("doc_fmt"))?.body ?? "";
    expect(cleared).not.toContain(":::");
    // Nor may it have become something else on the way out. A wrapper that
    // printed as a blockquote would satisfy the line above and would have
    // turned the paragraph into a quotation.
    expect(cleared).not.toContain("> A plain paragraph.");
    expect(cleared).toContain("A plain paragraph.");
  });

  test("the caret stays where it was when a button is pressed", async ({ page }) => {
    await openFocus(page, "doc_fmt");
    await caretIn(page, 1);
    await page.keyboard.press("End");
    await page.locator(`${BAR} button[data-fmt="italic"]`).click();
    // Typing right afterwards must land in the document, not nowhere.
    await page.keyboard.type("X");
    await expect(page.locator(".focus .ProseMirror > p").first()).toContainText("X");
    await expect(page.locator(".focus .ProseMirror")).toBeFocused();
  });

  test("the selection toolbar is unchanged and still carries Comment", async ({ page }) => {
    await openFocus(page, "doc_fmt");
    await selectBlock(page, 1);
    await expect(page.locator(".sel-toolbar [data-sel-comment]")).toBeVisible();
    await expect(page.locator(".sel-toolbar [data-sel-comment]")).toContainText("Comment");
  });
});
