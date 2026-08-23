import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **A document whose `type:` this build does not recognise is an ordinary
 * document** — SPEC.md §12's M6, and the promise that protects a workspace's
 * existing files.
 *
 * `type` is an open string on the wire (SPEC.md §5), because the set of types on
 * the wire is not the set any one build knows: an older workspace's documents, a
 * hand-written file, or a server newer than this client can each name a type
 * this client has never heard of. This build defines six, and the seventh it
 * will meet first is `type: todo` — real workspaces already hold them.
 *
 * **This spec is where that promise is asserted**, because every assertion of it
 * is here and nowhere else. The four claims are pinned against the shipped
 * board, in a real browser:
 *
 * 1. it **opens**, in the ordinary document view, with the editor on it;
 * 2. its markdown **renders**, and its checkboxes are real controls whose ticks
 *    reach the wire;
 * 3. it is **searchable**;
 * 4. it is **commentable**.
 *
 * Nothing here is special-cased for `todo`, and that is the point: every
 * assertion is one a note would satisfy identically. The fixture uses `todo`
 * because it is the type real workspaces already hold.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence:
 * `playwright.config.ts` starts no workspace server, so the disk, git and
 * projection half comes from the issue's real-app drill. Real React, real
 * ProseMirror, real layout — only `fetch` is answered from inside the page.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/**
 * The M6 document. `todo` on purpose, and everything about it is ordinary: a
 * title, a paragraph, two task-list items and a deadline in its frontmatter.
 */
const TODO: StubRow = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  due: "2026-08-04",
  body: [
    "Things that keep coming back around, kept in one place.",
    "",
    "- [ ] Call the plumber about the boiler",
    "- [ ] Book the passport appointment",
    "",
  ].join("\n"),
};

/** A note beside it, so every claim can be read as "the same as this one". */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Mortgage options",
  path: "data/docs/inbox/mortgage.md",
  body: "Compare against the lender spreads before Friday.",
};

const EDITOR = ".reader .doc-body[contenteditable]";

async function openTodo(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_todo"]').click();
  await page.locator(EDITOR).waitFor();
}

test.describe("a document whose type this build does not recognise", () => {
  test("opens in the ordinary document view, editable", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO, NOTE]);
    await openTodo(page);

    // The editor, not a static render and not a placeholder — the same surface
    // the note beside it gets.
    await expect(page.locator(`[data-doc-editor="${TODO.id}"]`)).toHaveCount(1);
    await expect(page.locator(EDITOR)).toHaveAttribute("contenteditable", "true");
    await expect(page.locator(".reader .doc-title")).toHaveValue("Inbox chores");
    // And no "this type is not supported" surface of any kind.
    await expect(page.locator(".reader .reader-gone")).toHaveCount(0);
  });

  test("renders its markdown, with checkboxes that are real controls", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO, NOTE]);
    await openTodo(page);

    // Rendered, not printed: two task items, each with a checkbox.
    const items = page.locator(`${EDITOR} ul[data-type="taskList"] > li`);
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Call the plumber about the boiler");
    await expect(items.first().locator('input[type="checkbox"]')).toHaveCount(1);
    // The paragraph above them is prose, not a list item.
    await expect(page.locator(`${EDITOR} > p`).first()).toContainText("keep coming back around");
  });

  test("a tick on one of those boxes reaches the file", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO, NOTE]);
    await openTodo(page);

    const first = page.locator(`${EDITOR} ul[data-type="taskList"] > li`).first();
    await first.locator('input[type="checkbox"]').click();

    // The editor's autosave carries the whole body, and the item is checked in
    // it — the markdown the file holds, not a class on a node.
    await expect
      .poll(async () => (await corpus.doc(TODO.id))?.body ?? "")
      .toContain("- [x] Call the plumber about the boiler");
    // The item beside it is untouched: one tick is one change.
    expect(await corpus.doc(TODO.id)).toBeDefined();
    expect((await corpus.doc(TODO.id))?.body).toContain("- [ ] Book the passport appointment");
  });

  test("is found by search, exactly as the note beside it is", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.locator(".searchbar").click();
    await page.locator(".search-input-row input").fill("plumber");

    await expect(page.locator(`.sr[data-sr="${TODO.id}"]`)).toBeVisible();
    await expect(page.locator(`.sr[data-sr="${TODO.id}"] .sr-title`)).toContainText("Inbox chores");
    // …and its hit opens the same reader a note's hit opens.
    await page.locator(`.sr[data-sr="${TODO.id}"]`).click();
    await expect(page.locator(`[data-doc-editor="${TODO.id}"]`)).toHaveCount(1);
  });

  test("takes a comment on a selection in its body", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO, NOTE]);
    await openTodo(page);

    const paragraph = page.locator(`${EDITOR} > p`).first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await composer.getByLabel("Comment").fill("Which of these is actually mine?");
    await composer.locator("[data-comment-send]").click();

    // A thread on this document, anchored to the words that were selected —
    // the same `POST /api/threads` a comment on a note produces.
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      readonly parent: string;
      readonly selector: { readonly exact: string };
    };
    expect(posted.parent).toBe(TODO.id);
    expect(posted.selector.exact).toContain("keep coming back around");

    // And it comes back attached: the anchor is drawn on the body.
    await expect(page.locator(".reader [data-thread-chip], .reader .anchor-hl")).not.toHaveCount(0);
  });

  test("its status and its deadline are its own to set", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO, NOTE]);
    await openTodo(page);

    // Live chips, not statements of a value computed from the items: nothing
    // in this build reads a status or a deadline off a document's own content.
    // The chips ARE the controls since UI-162 — no labelled form stands beside
    // the strip.
    const status = page.locator(".reader [data-chip='status']");
    const due = page.locator(".reader [data-chip='due']");
    await expect(status).toBeEnabled();
    await expect(due).toBeEnabled();
    await expect(page.locator(".reader .fm-form")).toHaveCount(0);

    await status.click();
    await page.locator('[data-ctx-menu] [data-act="status:resolved"]').click();
    await expect.poll(async () => (await corpus.doc(TODO.id))?.status).toBe("resolved");
  });

  test("its row carries the whole core action set", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    const acts = async (docId: string): Promise<readonly (string | undefined)[]> => {
      await page.locator(`.row[data-row-doc="${docId}"]`).click({ button: "right" });
      const listed = await page
        .getByRole("menu")
        .getByRole("menuitem")
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"]));
      await page.keyboard.press("Escape");
      return listed;
    };

    // Item for item the note's set — resolve included.
    expect(await acts(TODO.id)).toEqual(await acts(NOTE.id));
    expect(await acts(TODO.id)).toContain("resolve");
  });
});
