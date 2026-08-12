import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-017 in a real browser: an empty untitled document does not survive being
 * left (SPEC.md §11).
 *
 * The UI-observable half of the evidence (sprint-016 Adjudication 19) — the row
 * is gone from the board and the corpus saw a real `DELETE` — against the real
 * application over a stubbed transport. The disk, git and projection half
 * is the issue's real-app drill against a `corpus` server.
 */

const INBOX_VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

test.describe("leaving an empty document", () => {
  test("removes a document created with ＋ and left untouched", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW]);
    await page.goto("/");

    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await expect(column).toBeVisible();
    await column.getByRole("button", { name: /New document in Inbox/ }).click();

    // The new document opens in the column, title selected and ready to type.
    await expect(column.locator(".reader")).toBeVisible();
    await expect(column.getByLabel("Document title")).toHaveValue("Untitled");
    expect(await corpus.ids()).toContain("doc_new1");

    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect.poll(async () => (await corpus.of("DELETE")).length).toBe(1);
    expect(await corpus.doc("doc_new1")).toBeUndefined();
    await expect(column.locator(".row[data-row-doc]")).toHaveCount(0);
    await expect(column.locator(".col-list")).toContainText("Nothing here.");
  });

  test("keeps a document the user gave a title", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW]);
    await page.goto("/");

    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await column.getByRole("button", { name: /New document in Inbox/ }).click();

    const title = column.getByLabel("Document title");
    await expect(title).toHaveValue("Untitled");
    await title.fill("Quarterly planning");
    await title.press("Enter");
    await expect.poll(async () => (await corpus.doc("doc_new1"))?.title).toBe("Quarterly planning");

    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect(column.locator('.row[data-row-doc="doc_new1"]')).toBeVisible();
    expect(await corpus.of("DELETE")).toHaveLength(0);
  });

  /**
   * The evaluator's A/B probe (UI-017 eval FAIL-1), both branches in one test.
   *
   * `Enter` is a keystroke nothing in the UI asks for, and it used to be the
   * only thing standing between "the title persists" and "the document persists
   * as `Untitled` with the template prefill" — the exact artifact this issue
   * deletes.
   */
  test("persists the title whether or not the user pressed Enter", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW]);
    await page.goto("/");
    const column = page.locator('.col[data-col="doc_view_inbox"]');
    const add = column.getByRole("button", { name: /New document in Inbox/ });

    // A) with Enter — the branch the original drill exercised.
    await add.click();
    await expect(column.locator(".reader")).toBeVisible();
    await column.getByLabel("Document title").fill("Via Enter");
    await column.getByLabel("Document title").press("Enter");
    await column.getByRole("button", { name: "‹ Inbox" }).click();
    await expect.poll(async () => (await corpus.doc("doc_new1"))?.title).toBe("Via Enter");

    // B) without it — typed, then left. Nothing asks for the keystroke.
    await add.click();
    await expect(column.locator(".reader")).toBeVisible();
    await column.getByLabel("Document title").fill("Via leaving");
    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect.poll(async () => (await corpus.doc("doc_new2"))?.title).toBe("Via leaving");
    expect(await corpus.of("DELETE")).toHaveLength(0);
    await expect(column.locator('.row[data-row-doc="doc_new2"]')).toContainText("Via leaving");
  });

  test("a typed title erased again does not save the document", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW]);
    await page.goto("/");
    const column = page.locator('.col[data-col="doc_view_inbox"]');

    await column.getByRole("button", { name: /New document in Inbox/ }).click();
    await expect(column.locator(".reader")).toBeVisible();
    const title = column.getByLabel("Document title");
    await title.fill("Changed my mind");
    await title.fill("");
    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect.poll(async () => (await corpus.of("DELETE")).length).toBe(1);
    expect(await corpus.doc("doc_new1")).toBeUndefined();
  });

  test("removes a blank document when it is reopened and left again", async ({ page }) => {
    const corpus = await stubCorpus(page, [
      INBOX_VIEW,
      { id: "doc_stray", title: "Untitled", body: "" },
    ]);
    await page.goto("/");

    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await column.locator('.row[data-row-doc="doc_stray"]').click();
    await expect(column.getByLabel("Document title")).toHaveValue("Untitled");

    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect.poll(async () => (await corpus.of("DELETE")).length).toBe(1);
    await expect(column.locator('.row[data-row-doc="doc_stray"]')).toHaveCount(0);
  });

  test("never asks: the automatic rule shows no confirmation", async ({ page }) => {
    const corpus = await stubCorpus(page, [INBOX_VIEW]);
    let asked = false;
    page.on("dialog", (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await page.goto("/");

    const column = page.locator('.col[data-col="doc_view_inbox"]');
    await column.getByRole("button", { name: /New document in Inbox/ }).click();
    await expect(column.locator(".reader")).toBeVisible();
    await column.getByRole("button", { name: "‹ Inbox" }).click();

    await expect.poll(async () => (await corpus.of("DELETE")).length).toBe(1);
    expect(asked).toBe(false);
  });
});
