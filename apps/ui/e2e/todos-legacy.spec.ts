import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * PLUGINS-008 — a todo document whose items are **not** in its body, in a real
 * browser.
 *
 * Items moved from an `items` frontmatter key into body task lines in
 * PLUGINS-005, and PLUGINS-006 dropped the plugin's own `View` so a todo
 * document renders in the core editor. A workspace written before either change
 * therefore opened as a blank editable page — with, depending on which of three
 * states it was in, a healthy-looking stats strip above it, no chrome at all, or
 * a completely normal reader over a document the server refuses every item write
 * to. Nothing on screen named the remedy.
 *
 * Everything asserted below is the plugin's own `DocPanel` (sprint-023 OC1):
 * core contributes the slot and knows nothing about the notice. Deliberately a
 * **separate spec file** from `todos.spec.ts`, which UI-034 holds this sprint
 * (sprint-023 Open Conflict 6).
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence: the file on
 * disk, `corpus todos migrate` actually running, and the notice clearing
 * afterwards come from the issue's real-app drill against a real `corpus`
 * server. Neither half is acceptance on its own.
 */

const VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

/** A body with prose and no task line anywhere — what a legacy document has. */
const EMPTY_BODY = "Chores that landed in the inbox.\n";

/** The items a pre-PLUGINS-005 workspace stored, `ts` and all. */
const LEGACY_ITEMS = [
  { text: "Book the passport appointment", done: false, ts: "2026-07-20T09:00:00.000Z" },
  { text: "Send the signed form", done: true, ts: "2026-07-20T09:00:00.000Z" },
];

/** State 1 — the filed bug: items in frontmatter, nothing in the body. */
const LEGACY: StubRow = {
  id: "doc_legacy",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: EMPTY_BODY,
  extra: { items: LEGACY_ITEMS },
};

/** State 2 — the key hand-edited into something that no longer parses. */
const MALFORMED: StubRow = {
  id: "doc_malformed",
  type: "todo",
  title: "Hand-edited chores",
  path: "data/docs/inbox/hand-edited.md",
  body: EMPTY_BODY,
  extra: { items: "nope" },
};

/** State 3 — items in both places; every item write is refused with 400. */
const DUAL: StubRow = {
  id: "doc_dual",
  type: "todo",
  title: "Half-migrated chores",
  path: "data/docs/inbox/half-migrated.md",
  body: `${EMPTY_BODY}\n- [ ] Call the plumber\n`,
  extra: { items: LEGACY_ITEMS },
};

/** The state a workspace should be in: items are body task lines, no key. */
const MIGRATED: StubRow = {
  id: "doc_migrated",
  type: "todo",
  title: "Migrated chores",
  path: "data/docs/inbox/migrated.md",
  body: `${EMPTY_BODY}\n- [ ] Book the passport appointment\n- [x] Send the signed form\n`,
};

const ALL = [VIEW, LEGACY, MALFORMED, DUAL, MIGRATED];

/**
 * The plugin's aggregate, answered empty.
 *
 * The todo **row** reads its item preview from `GET /api/x/todos/lists/at/…`
 * since PLUGINS-007, and this spec is about the reader rather than the row — but
 * the route has to answer something, and the recorded requests are also what
 * TEST-1058 asserts against: a notice that issued a write would show up here.
 */
async function stubTodosAggregate(page: Page): Promise<{ readonly calls: string[] }> {
  const calls: string[] = [];
  await page.route("**/api/x/todos/**", async (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lists: [] }),
    });
  });
  return { calls };
}

/** Opens one of the fixtures in its column reader. */
async function open(page: Page, row: StubRow): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${row.id}"]`).click();
  await page.locator(`.reader[data-reader-doc="${row.id}"]`).waitFor();
}

/** The plugin's legacy notice, in whichever surface is being read. */
function notice(page: Page, scope = ".reader"): Locator {
  return page.locator(`${scope} [data-todo-legacy]`);
}

test.describe("a todo list whose items are still in frontmatter", () => {
  test("names the format, names the verb, and offers no button", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, LEGACY);

    const region = notice(page);
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("data-todo-legacy", "frontmatter");
    await expect(region).toContainText("`items` frontmatter");
    // The verb, verbatim, phrased as something the agent or the CLI runs.
    await expect(region.locator("code")).toHaveText("corpus todos migrate");
    await expect(region).toContainText("Ask the agent to migrate it, or run");
    await expect(region).toContainText("from the CLI");
    // Nothing here is a control — there is no UI migration trigger by design.
    await expect(region.locator("button, input, a")).toHaveCount(0);

    // It sits above the stats strip, in the one v1 slot, above the body.
    const legacyBox = await region.boundingBox();
    const panelBox = await page.locator(`[data-todo-panel="${LEGACY.id}"]`).boundingBox();
    const bodyBox = await page.locator(".reader .ProseMirror").boundingBox();
    expect(legacyBox?.y ?? 0).toBeLessThan(panelBox?.y ?? 0);
    expect(panelBox?.y ?? 0).toBeLessThan(bodyBox?.y ?? 0);
  });

  test("shows the items read-only, collapsed, with no checkbox to press", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, LEGACY);

    const details = notice(page).locator("[data-todo-legacy-items]");
    await expect(details).toHaveAttribute("data-todo-legacy-items", "2");
    // Collapsed by default: a long legacy list must not bury the body.
    await expect(details.locator("[data-todo-legacy-item]").first()).toBeHidden();
    await expect(details.locator("summary")).toHaveText("2 items, stored in frontmatter");

    await details.locator("summary").click();
    const rows = details.locator("[data-todo-legacy-item]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute("data-todo-legacy-item", "open");
    await expect(rows.nth(0)).toContainText("Book the passport appointment");
    await expect(rows.nth(1)).toHaveAttribute("data-todo-legacy-item", "done");
    await expect(rows.nth(1)).toContainText("Send the signed form");

    // Not interactive: no checkbox, nothing focusable, and a click is inert.
    await expect(rows.locator("input, button, [tabindex]")).toHaveCount(0);
    const before = await rows.nth(0).innerHTML();
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute("data-todo-legacy-item", "open");
    expect(await rows.nth(0).innerHTML()).toBe(before);
  });

  test("the stats strip reports the same numbers a migrated list reports", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, LEGACY);

    const legacyPanel = page.locator(`[data-todo-panel="${LEGACY.id}"]`);
    await expect(legacyPanel.locator("[data-stat-open]")).toHaveText("1");
    await expect(legacyPanel.locator("[data-stat-done]")).toHaveText("1");

    // Back to the list and into the migrated document — the reader is sticky, so
    // this is a close and a second open rather than a reload.
    await page.keyboard.press("Escape");
    await expect(page.locator(`.reader[data-reader-doc="${LEGACY.id}"]`)).toHaveCount(0);
    await page.locator(`.row[data-row-doc="${MIGRATED.id}"]`).click();
    await page.locator(`.reader[data-reader-doc="${MIGRATED.id}"]`).waitFor();

    const migratedPanel = page.locator(`[data-todo-panel="${MIGRATED.id}"]`);
    await expect(migratedPanel.locator("[data-stat-open]")).toHaveText("1");
    await expect(migratedPanel.locator("[data-stat-done]")).toHaveText("1");
  });

  test("says the same thing in full-screen focus", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, LEGACY);

    const inColumn = await notice(page).innerText();

    await page.locator(`.reader[data-reader-doc="${LEGACY.id}"] [data-expand]`).click();
    await page.locator(".focus.open .ProseMirror").waitFor();

    const inFocus = notice(page, ".focus.open");
    await expect(inFocus).toBeVisible();
    await expect(inFocus).toHaveAttribute("data-todo-legacy", "frontmatter");
    await expect(inFocus.locator("[data-todo-legacy-items]")).toHaveCount(1);
    expect(await inFocus.innerText()).toBe(inColumn);
  });

  test("issues no plugin write, from the notice or from its items", async ({ page }) => {
    const corpus = await stubCorpus(page, ALL);
    const aggregate = await stubTodosAggregate(page);
    await open(page, LEGACY);

    const details = notice(page).locator("[data-todo-legacy-items]");
    await details.locator("summary").click();
    await details.locator("[data-todo-legacy-item]").first().click();
    await notice(page).locator("code").click();

    // The plugin's routes stay the CLI/agent write path — the aggregate is read
    // and nothing else — and the document itself is never written from here.
    expect(aggregate.calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
    const writes = (await corpus.requests()).filter(
      (entry) => entry.method !== "GET" && entry.path.includes(LEGACY.id),
    );
    expect(writes).toEqual([]);
  });
});

test.describe("a todo list whose legacy key no longer parses", () => {
  test("says what is wrong instead of rendering a blank page", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, MALFORMED);

    const region = notice(page);
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("data-todo-legacy", "malformed");
    // The plugin's own diagnostic, quoted rather than paraphrased.
    await expect(region).toContainText("items: must be a list of items; found string");
    await expect(region.locator("code")).toHaveText("corpus todos migrate");
  });

  test("publishes no counts it cannot stand behind", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, MALFORMED);

    await expect(notice(page)).toBeVisible();
    // The `return null` rule survives: the notice replaces the blank, it does
    // not restore the stats.
    await expect(page.locator(`[data-todo-panel="${MALFORMED.id}"]`)).toHaveCount(0);
    await expect(page.locator(".reader .doc-panel")).toHaveCount(0);
    await expect(page.locator(".reader [role='progressbar']")).toHaveCount(0);
    await expect(notice(page).locator("[data-todo-legacy-items]")).toHaveCount(0);
  });
});

test.describe("a todo list storing items in the body and in frontmatter", () => {
  test("warns that nothing can be written until one list is removed", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, DUAL);

    const region = notice(page);
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("data-todo-legacy", "dual");
    await expect(region).toContainText("It needs migrating");
    await expect(region).toContainText("the agent and the CLI refuse every item write");
    // The same sentence `itemProblems` produces and `planWrite` refuses with.
    await expect(region).toContainText(
      "carries items in its body *and* in its `items` frontmatter — remove whichever list is " +
        "stale; until then nothing can be written to it",
    );
    await expect(region.locator("code")).toHaveText("corpus todos migrate");
  });

  test("keeps the stats strip, computed from the body that wins", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, DUAL);

    const panel = page.locator(`[data-todo-panel="${DUAL.id}"]`);
    await expect(panel.locator("[data-stat-open]")).toHaveText("1");
    await expect(panel.locator("[data-stat-done]")).toHaveText("0");
  });
});

test.describe("a migrated todo list", () => {
  test("renders exactly as it did before, with no notice anywhere", async ({ page }) => {
    await stubCorpus(page, ALL);
    await stubTodosAggregate(page);
    await open(page, MIGRATED);

    await expect(page.locator("[data-todo-legacy]")).toHaveCount(0);

    const panel = page.locator(`[data-todo-panel="${MIGRATED.id}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-stat-open]")).toHaveText("1");
    await expect(panel.locator("[data-stat-done]")).toHaveText("1");
    await expect(panel).toContainText("plugin: todos");

    // And the body is the editable checkbox list, as it always was.
    const boxes = page.locator('.reader .ProseMirror li input[type="checkbox"]');
    await expect(boxes).toHaveCount(2);
    expect(
      await boxes.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).checked)),
    ).toEqual([false, true]);

    await page.locator(`.reader[data-reader-doc="${MIGRATED.id}"] [data-expand]`).click();
    await page.locator(".focus.open .ProseMirror").waitFor();
    await expect(page.locator("[data-todo-legacy]")).toHaveCount(0);
  });
});
