import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus } from "./stubCorpus";

/**
 * UI-107, in a real browser: **a refusal arriving mid-sentence does not discard
 * the sentence** (SPEC.md §7 "A key, not a lock", §10 "the board is never
 * read-only").
 *
 * This is the half no component test can make. The board's autosave, the
 * document cache, the editor's external-change rule and the retry are four
 * separate mechanisms that have to line up around one keystroke, and what has to
 * be true at the end of it is a claim about the **screen** — the words the person
 * typed are still where they typed them, with the caret still in them — and
 * about the **corpus**, which must end up holding those words. Both are asserted
 * here, against a real ProseMirror surface driven by real key events.
 *
 * The conflict is produced the way it happens in practice: the agent writes the
 * open document (`writeAsAgent`), so the key the page read at open names a
 * version that no longer exists. That is the case the lock banner used to make
 * loud, and the spec now makes quiet.
 */

const NOTES_VIEW = {
  id: "doc_view_notes",
  type: "view",
  title: "Notes",
  path: "data/docs/views/notes.md",
  order: 1,
  query: { folder: "notes" },
};

const NOTE = {
  id: "doc_shared",
  type: "note",
  title: "Rates",
  path: "data/docs/notes/doc_shared.md",
  body: "The rate held.\n",
};

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [NOTES_VIEW, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_shared"]').click();
  await expect(page.locator(".reader .doc-editor .ProseMirror p").first()).toBeVisible();
  return corpus;
}

/** Puts the caret at the start of the body and waits until it is actually there. */
async function caretAtStart(page: Page): Promise<void> {
  const paragraph = page.locator(".reader .doc-editor .ProseMirror p").first();
  await paragraph.click();
  await expect(page.locator(".reader .doc-editor .ProseMirror")).toBeFocused();
  await page.keyboard.press("Home");
}

/** Every `PUT` this page sent to the document, in order, with its parsed body. */
async function writes(
  corpus: StubCorpus,
): Promise<readonly { readonly body: string; readonly key: string }[]> {
  const calls = await corpus.of("PUT", "/api/docs/doc_shared");
  return calls.map((call) => call.body as { body: string; key: string });
}

test.describe("the agent writes the document you have open (SPEC.md §7)", () => {
  test("the sentence survives the refusal, and lands", async ({ page }) => {
    const corpus = await openNote(page);

    await caretAtStart(page);
    await page.keyboard.type("Half a sen");
    await expect(page.locator(".reader .doc-editor .ProseMirror")).toContainText("Half a sen");

    /*
     * The other writer lands **while the debounce is still open**, which is what
     * makes the refusal arrive mid-sentence rather than between two of them. The
     * page is told nothing: no mutation of its own ran, so nothing invalidates.
     */
    const freshKey = await corpus.writeAsAgent("doc_shared", "The agent rewrote this line.\n");

    // Two writes: the one that was refused, and the one presenting the key the
    // refusal carried. Identical bodies — the buffer was kept, not rebuilt.
    await expect
      .poll(async () => (await writes(corpus)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2);
    const sent = await writes(corpus);
    const [refused, retried] = sent as [
      { body: string; key: string },
      { body: string; key: string },
    ];
    expect(refused.body).toContain("Half a sen");
    expect(retried.body).toBe(refused.body);
    expect(retried.key).toBe(freshKey);
    expect(retried.key).not.toBe(refused.key);

    /*
     * **The criterion.** The words are still on screen, the agent's paragraph
     * did not replace them, and the caret is still in the body — nothing was
     * torn down and rebuilt under the person's hands.
     */
    const surface = page.locator(".reader .doc-editor .ProseMirror");
    await expect(surface).toContainText("Half a sen");
    await expect(surface).not.toContainText("The agent rewrote this line.");
    await expect(surface).toBeFocused();

    // Typing continues from where it was, in the same document, with no second
    // conflict: the editor kept the key its retry earned.
    await page.keyboard.type("tence.");
    await expect(surface).toContainText("Half a sentence.");

    // And the corpus holds it. Nothing was lost between the refusal and here.
    await expect
      .poll(async () => (await corpus.doc("doc_shared"))?.body ?? "", { timeout: 5_000 })
      .toContain("Half a sentence.");

    // The refusal was resolved, not reported: no failure chip, because a
    // conflict the mechanism settles in one exchange is not the person's problem.
    await expect(page.locator(".save-chip.failed")).toHaveCount(0);
  });

  test("the document never renders read-only, and nothing asks about locks", async ({ page }) => {
    const corpus = await openNote(page);
    await corpus.writeAsAgent("doc_shared", "The agent is writing right now.\n");

    // §10, amended: the board is never read-only. No banner, no Force unlock, no
    // frozen title — on a document another writer is actively rewriting.
    await expect(page.locator(".lock-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Force unlock" })).toHaveCount(0);
    await expect(page.locator(".reader .doc-editor .ProseMirror")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    await expect(page.getByLabel("Document title")).not.toHaveAttribute("readonly", "");

    // Nothing polls or subscribes to lock state — there is none to read.
    expect(await corpus.of("GET", "/api/locks")).toHaveLength(0);
    const everything = await corpus.requests();
    expect(everything.filter((call) => call.path.includes("/locks"))).toHaveLength(0);
  });

  test("a frontmatter change takes no key, and does not refuse the next sentence", async ({
    page,
  }) => {
    const corpus = await openNote(page);

    // A named delta (SPEC.md §7): the title write carries no key at all.
    const title = page.getByLabel("Document title");
    await title.click();
    await title.fill("Rates, revised");
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => (await corpus.of("PUT", "/api/docs/doc_shared")).length)
      .toBeGreaterThanOrEqual(1);
    const first = (await corpus.of("PUT", "/api/docs/doc_shared"))[0]?.body as Record<
      string,
      unknown
    >;
    expect(first["title"]).toBe("Rates, revised");
    expect(first).not.toHaveProperty("key");

    // …and the body write that follows it still lands, because the editor took
    // the fresh key that arrived with a body it already held.
    await caretAtStart(page);
    await page.keyboard.type("Now revised. ");
    await expect
      .poll(async () => (await corpus.doc("doc_shared"))?.body ?? "", { timeout: 5_000 })
      .toContain("Now revised.");
    await expect(page.locator(".reader .doc-editor .ProseMirror")).toContainText("Now revised.");
  });
});
