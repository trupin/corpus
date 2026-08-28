import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * **Styled text, in a real browser** (SPEC.md §5's rider signed 2026-08-12;
 * UI-182, UI-183, UI-184).
 *
 * The unit suites prove the round trip over strings and the roles' contrast over
 * numbers. Neither can answer the two questions a person actually has — *can I
 * see it*, and *does what I typed survive?* — because both are properties of a
 * rendered page and a real save.
 *
 * So every assertion here reads a **computed style** or an **outgoing request
 * body**. A class name being present says only that the markup was written; it
 * says nothing about whether the phrase looks any different from the prose
 * around it, which was the whole point.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const BODY = [
  "A plain sentence to type into.",
  "",
  "Then <u>underlined</u>, then ==highlighted==, then a",
  '[warned phrase]{color="warning"} and a [muted one]{color="muted"}.',
  "",
  '::: {align="center"}',
  "",
  "A centred block.",
  "",
  ":::",
  "",
].join("\n");

const NOTE: StubRow = {
  id: "doc_styled",
  title: "Styled text",
  path: "data/docs/inbox/styled.md",
  body: BODY,
};

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_styled"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  return corpus;
}

/** One computed property of the first element matching `selector`. */
async function computed(page: Page, selector: string, property: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

test.describe("styled text renders", () => {
  test("each form is visibly different from the prose around it", async ({ page }) => {
    await openNote(page);
    const editor = ".reader .ProseMirror";

    // Underline: a line under the words, not merely a `<u>` in the markup.
    await expect(page.locator(`${editor} u`)).toHaveText("underlined");
    expect(await computed(page, `${editor} u`, "text-decoration-line")).toContain("underline");

    // Highlight: a painted band. The body's own background is the page, so a
    // highlight that inherited it would be invisible while passing every
    // class-name assertion ever written.
    await expect(page.locator(`${editor} mark`)).toHaveText("highlighted");
    const bodyBackground = await computed(page, `${editor}`, "background-color");
    const markBackground = await computed(page, `${editor} mark`, "background-color");
    expect(markBackground).not.toBe(bodyBackground);
    expect(markBackground).not.toBe("rgba(0, 0, 0, 0)");

    // Colour roles: two roles, two colours, neither of them the body's ink.
    const ink = await computed(page, editor, "color");
    const warning = await computed(page, `${editor} .md-style-color-warning`, "color");
    const muted = await computed(page, `${editor} .md-style-color-muted`, "color");
    expect(warning).not.toBe(ink);
    expect(muted).not.toBe(ink);
    expect(warning).not.toBe(muted);
  });

  test("a styled block is laid out, and its prose stays prose", async ({ page }) => {
    await openNote(page);
    const block = ".reader .ProseMirror .md-style-block";
    await expect(page.locator(block)).toHaveText("A centred block.");
    expect(await computed(page, block, "text-align")).toBe("center");
    // The paragraph above it is untouched — alignment is the block's, not the
    // document's.
    expect(await computed(page, ".reader .ProseMirror > p", "text-align")).not.toBe("center");
  });

  test("the fence lines are not visible as text", async ({ page }) => {
    await openNote(page);
    const text = await page.locator(".reader .ProseMirror").innerText();
    expect(text).not.toContain(":::");
    expect(text).not.toContain("color=");
    expect(text).not.toContain("==");
    expect(text).toContain("A centred block.");
  });

  test("each role answers the theme", async ({ page }) => {
    await openNote(page);
    const selector = ".reader .ProseMirror .md-style-color-warning";
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const light = await computed(page, selector, "color");
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await computed(page, selector, "color");
    // Two values, not one — a role with a single value is a role that is
    // unreadable in one of the two themes, which is what §5's pair prevents.
    expect(light).not.toBe(dark);
  });
});

test.describe("styled text survives an edit", () => {
  test("typing in one paragraph saves every marker in the others unchanged", async ({ page }) => {
    const corpus = await openNote(page);
    const editor = page.locator(".reader .ProseMirror");

    await editor.click();
    // Into the first paragraph, which carries no styling at all.
    await page.locator(".reader .ProseMirror > p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Typed.");

    // The autosave is what puts the document on the wire; wait for the write
    // rather than for a timeout.
    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_styled")).length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    const saved = await corpus.doc("doc_styled");
    expect(saved?.body).toContain("<u>underlined</u>");
    expect(saved?.body).toContain("==highlighted==");
    expect(saved?.body).toContain('[warned phrase]{color="warning"}');
    expect(saved?.body).toContain('[muted one]{color="muted"}');
    expect(saved?.body).toContain('::: {align="center"}');
    expect(saved?.body).toContain("A centred block.");
    // And the edit itself landed.
    expect(saved?.body).toContain("A plain sentence to type into. Typed.");
  });
});
