import { DocsQuerySchema } from "@corpus/contract";
import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/** The grammar's own size, so the help panel's count cannot go stale here. */
const FIELD_COUNT = Object.keys(DocsQuerySchema.shape).length;

/**
 * UI-039 in a real browser: a column's query is editable with help, not typed
 * blind into a bare box.
 *
 * A real browser earns its place here for three things jsdom cannot answer.
 * The menu is `position: fixed` and positioned from a measured
 * `getBoundingClientRect()`, so "is it under the field and on screen" is a
 * layout question. Focus moving from the field to the help button — the thing
 * that must *not* commit the edit and close the editor — is real focus
 * traversal, `relatedTarget` and all. And the commit at the end writes through
 * the real client to `PUT /api/docs/{id}`, which is the proof that adding a
 * menu to the field changed nothing about what it stores.
 */

const VIEW_ID = "doc_view_threads";

const VIEW = {
  id: VIEW_ID,
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 1,
  query: { type: "thread", status: "open" },
};

/** A corpus with two document types in it, so `type=` has something real to say. */
const CORPUS = [
  VIEW,
  { id: "doc_note", type: "note", title: "Mortgage options", body: "6.4% this week." },
  { id: "doc_todo", type: "todo", title: "Call the broker", body: "Before Friday." },
];

/**
 * The stub hardcodes an empty tree and untagged rows for every spec that shares
 * it. Rather than edit that shared file, this spec answers the two reads the
 * vocabulary makes — and only those — leaving the rest of the corpus to the
 * stub via `fallback()`.
 *
 * **Registered after `stubCorpus`, deliberately**: Playwright runs route
 * handlers newest-first, so these have to be the later pair to be reached at
 * all. Matching is by pathname predicate rather than a glob, because a glob's
 * `?` is a wildcard and `/api/docs?…` would match paths that are not this one.
 */
async function seedVocabulary(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/tree",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          folders: [
            { path: "finance", name: "finance", count: 2, totalCount: 3, children: [] },
            { path: "inbox", name: "inbox", count: 5, totalCount: 5, children: [] },
          ],
        }),
      });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/docs",
    async (route) => {
      const url = new URL(route.request().url());
      // Only the vocabulary read, which is the one asking for archived documents
      // too. Every other list — the board's own columns included — is the stub's.
      if (url.searchParams.get("includeArchived") !== "true") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: CORPUS.filter((row) => row.id !== VIEW_ID).map((row) => ({
            ...row,
            path: `data/docs/inbox/${row.id}.md`,
            status: "open",
            tags: row.id === "doc_note" ? ["finance", "housing"] : ["urgent"],
            created: "2026-07-01T09:00:00.000Z",
            updated: "2026-07-01T09:00:00.000Z",
            due: null,
            reviewed: null,
            evergreen: false,
            excerpt: "",
            stale: null,
            parent: null,
            parentTitle: null,
            agent: null,
            anchorQuote: null,
            turnCount: null,
            lastAuthor: null,
            lastTurn: null,
            unread: null,
            awaitingAgent: null,
            unreadThreads: 0,
            attention: [],
            snippets: [],
            pinned: false,
            order: null,
            query: null,
            column: null,
            extra: {},
          })),
          page: { total: 2, limit: 200, offset: 0 },
        }),
      });
    },
  );
}

/** Opens the column's ⋯ → Edit query, the way a user reaches the field. */
async function openQueryEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: /List options for Conversations/ }).click();
  await page.getByRole("menuitem", { name: /Edit query/ }).click();
  await expect(field(page)).toBeFocused();
}

function field(page: Page) {
  return page.getByLabel("Edit query for Conversations");
}

function menu(page: Page) {
  return page.getByRole("listbox", { name: /Query completions/ });
}

function optionText(page: Page) {
  return menu(page).getByRole("option");
}

test.describe("the column query editor", () => {
  test("suggests field names, then that field's real values, and completes them", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    // Selecting all and typing is what a user does to a pre-filled field.
    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("ty");

    await expect(menu(page)).toBeVisible();
    await expect(optionText(page).filter({ hasText: "type" })).toHaveCount(1);
    // The menu teaches: each field carries its own one-liner.
    await expect(menu(page)).toContainText("Document type");

    // The menu is under the field and on screen — the reason this is a browser.
    const fieldBox = await field(page).boundingBox();
    const menuBox = await menu(page).boundingBox();
    expect(menuBox?.y ?? 0).toBeGreaterThan(fieldBox?.y ?? 0);
    expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);

    // ⇥ accepts, and a field completion carries its `=`.
    await field(page).press("Tab");
    await expect(field(page)).toHaveValue("type=");

    // Now the *values*, and they are the workspace's own: `todo` exists only
    // because a plugin's document does. No hardcoded list knows that.
    await expect(menu(page)).toBeVisible();
    await expect(optionText(page).filter({ hasText: "todo" })).toHaveCount(1);
    await expect(optionText(page).filter({ hasText: "note" })).toHaveCount(1);

    await field(page).pressSequentially("tod");
    await field(page).press("Tab");
    await expect(field(page)).toHaveValue("type=todo");
  });

  test("offers the contract's own values for a closed field, and folders from the tree", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("status=");
    await expect(optionText(page)).toHaveText([/open/, /resolved/, /archived/]);

    // ↑ ↓ move the highlight and ↵ accepts, as everywhere else in the product.
    await field(page).press("ArrowDown");
    await expect(optionText(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await field(page).press("Enter");
    await expect(field(page)).toHaveValue("status=resolved");

    // A second field, and its values come from `GET /api/tree`.
    await field(page).pressSequentially("&folder=");
    await expect(optionText(page).filter({ hasText: "finance" })).toHaveCount(1);
    await expect(optionText(page).filter({ hasText: "inbox" })).toHaveCount(1);

    // Tags come off the rows, counted.
    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("tag=");
    await expect(optionText(page).filter({ hasText: "finance" })).toHaveCount(1);
    await expect(optionText(page).filter({ hasText: "housing" })).toHaveCount(1);
  });

  test("esc closes the menu first and abandons the edit second", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("stat");
    await expect(menu(page)).toBeVisible();

    await field(page).press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(field(page)).toBeVisible();

    await field(page).press("Escape");
    await expect(field(page)).toBeHidden();
    // Abandoned means abandoned: the stored query is still on the chips.
    await expect(page.locator(".col .chips")).toContainText("type: thread");
  });

  test("opens a syntax reference from the field, dismissable by esc", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    const help = page.getByRole("button", { name: /Query syntax for Conversations/ });
    await expect(help).toBeVisible();
    await help.click();

    const panel = page.getByRole("dialog", { name: "Query syntax" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("AND, between fields");
    await expect(panel).toContainText("OR, within one field");
    await expect(panel).toContainText("needs=me&folder=finance");
    // Every field the server publishes is listed, sourced from the same module
    // the autocomplete reads — help and grammar cannot drift apart.
    await expect(panel.locator("[data-query-field]")).toHaveCount(FIELD_COUNT);
    await expect(panel.locator("[data-query-field='type']")).toBeVisible();

    // Reaching for the help did NOT commit the edit and close the field.
    await expect(field(page)).toBeVisible();

    await panel.press("Escape");
    await expect(panel).toBeHidden();
    await expect(help).toBeFocused();
    // ...and the edit is still open, so esc dismissed the reference only.
    await expect(field(page)).toBeVisible();
  });

  test("writes the edited query to the view document, unchanged by the menu", async ({ page }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("type=");
    await expect(menu(page)).toBeVisible();
    await field(page).pressSequentially("not");
    await field(page).press("Tab");
    await expect(field(page)).toHaveValue("type=note");

    await field(page).press("Enter");
    await expect(field(page)).toBeHidden();

    // One `PUT` to the view document carrying the completed query verbatim.
    // The point of the issue is that assistance changed what is *typed*, not
    // what is stored, and this is the byte that proves it.
    //
    // Asserted on the request rather than on the stub's stored copy: the shared
    // stub's `PUT` handler applies `title`, `status`, `body` and `extra` and
    // never merges `query`, so its copy would answer a question about the stub.
    // The board's chips are not asserted either — the stub pushes no
    // `invalidate` over SSE (its own docstring says so), which is what a column
    // refreshes on.
    await expect.poll(async () => (await corpus.of("PUT", `/api/docs/${VIEW_ID}`)).length).toBe(1);
    expect((await corpus.of("PUT", `/api/docs/${VIEW_ID}`))[0]?.body).toEqual({
      query: { type: "note" },
    });
  });

  test("names a field the server would silently ignore, without blocking the edit", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await seedVocabulary(page);
    await page.goto("/");
    await openQueryEditor(page);

    await field(page).press("ControlOrMeta+a");
    await field(page).pressSequentially("typ=todo");

    // Scoped to the column: the console strip is a `role="status"` too.
    const notice = page.locator(".col").getByRole("status");
    await expect(notice).toContainText("Unknown field");
    await expect(notice).toContainText("typ");

    // Advisory, not a gate: the query commits exactly as typed. `typ` is not a
    // field, so no menu is open to take the ↵ either.
    await field(page).press("Enter");
    await expect(field(page)).toBeHidden();
    await expect.poll(async () => (await corpus.of("PUT", `/api/docs/${VIEW_ID}`)).length).toBe(1);
    expect((await corpus.of("PUT", `/api/docs/${VIEW_ID}`))[0]?.body).toEqual({
      query: { typ: "todo" },
    });
  });
});
