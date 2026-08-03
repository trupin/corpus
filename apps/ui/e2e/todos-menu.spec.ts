import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * PLUGINS-009 in a real browser: the quick actions on a **todo item row** in
 * the todos plugin column.
 *
 * This is the surface SPEC.md §11's 2026-08-02 amendment opened. Everything
 * under test is the plugin's own — core deliberately leaves a
 * `[data-plugin-surface]` alone — so what is asserted here is that the plugin's
 * menu behaves like every other menu in the app (`esc`, arrows, `↵`, focus
 * restore), that its writes go through the plugin's own item route, and that
 * its comment produces the ordinary §6 thread rather than a shape of its own.
 *
 * **Its own spec file, not `reveal.spec.ts`.** UI-037's report asks consumers to
 * extend that spec rather than fork the reveal machinery, and this file honours
 * the *reason* for that rule while avoiding a worse one: PLUGINS-010 was
 * rewriting `reveal.spec.ts` in the same working tree, and two agents editing
 * one Playwright spec is precisely the hazard sprint-023 OC6 ruled on for
 * `todos.spec.ts`. The reveal machinery is not forked here — the last test
 * below asserts exactly what `reveal.spec.ts` asserts for a thread reveal
 * (`.thread-slot.expanded` + `.thread-card.flash`), with this menu as the
 * producer instead of a seeded navigation entry.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence: no workspace
 * server runs under `playwright.config.ts`, so the file on disk, the commit and
 * the projection come from the issue's real-app drill. Real React, real
 * ProseMirror, real layout — only `fetch` is answered from inside the page.
 */

/** The SSE endpoint and nothing else — never a `**\/events*` glob (e875705). */
const EVENT_STREAM = /^https?:\/\/[^/]+\/events(\?|$)/;

const TODOS_VIEW: StubRow = {
  id: "doc_view_todos_menu",
  type: "view",
  title: "Todos",
  path: "data/docs/views/todos.md",
  pinned: true,
  order: 1,
  column: "todos/todos",
};

const LIST_ID = "doc_menu_chores";

/**
 * The list. A **checked** item sits first, so the index the plugin sends is
 * provably the item's position in the document rather than its position in the
 * column — the column never shows that line.
 */
const ITEMS: readonly { readonly text: string; readonly done: boolean }[] = [
  { text: "Send the signed form", done: true },
  { text: "Book the passport appointment", done: false },
  { text: "Call the plumber", done: false },
];

const bodyOf = (items: readonly { text: string; done: boolean }[]): string =>
  `Chores that landed in the inbox.\n\n${items
    .map((item) => `- [${item.done ? "x" : " "}] ${item.text}`)
    .join("\n")}\n`;

/** A thread already anchored to "Call the plumber", for the third action. */
const EXISTING_THREAD: StubRow = {
  id: "th_plumber",
  type: "thread",
  title: 'Re: "Call the plumber"',
  path: "data/docs/threads/th_plumber.md",
  body: "Which plumber was it?",
  parent: LIST_ID,
};

interface TodosStub {
  /** Every `PUT /api/x/todos/**\/items/*` the page made, in order. */
  readonly writes: { readonly path: string; readonly body: unknown }[];
  /** The list body as this stub currently holds it. */
  body: () => string;
}

interface StubOptions {
  /** Answer the item route with this status; anything but 200 writes nothing. */
  readonly itemStatus?: number;
  /** Seed the anchor that makes "Open existing thread" appear. */
  readonly anchored?: boolean;
}

/**
 * A board whose one column is the real todos plugin column, over a **stateful**
 * item route.
 *
 * The plugin's own routes are not part of the generated contract, so
 * `stubCorpus` knows nothing about them; they are answered here, after it, so
 * Playwright's most-recent-first matching lets them win. `GET /api/docs/{list}`
 * is answered here too, from the same body the aggregate is computed from —
 * that is what keeps the document the menu reads and the rows the column paints
 * from ever disagreeing, which is exactly what production guarantees by having
 * one file behind both.
 */
async function openTodosBoard(page: Page, options: StubOptions = {}): Promise<TodosStub> {
  const rows: StubRow[] = [
    TODOS_VIEW,
    {
      id: LIST_ID,
      type: "todo",
      title: "Chores",
      path: "data/docs/inbox/chores.md",
      body: bodyOf(ITEMS),
    },
    EXISTING_THREAD,
  ];
  await stubCorpus(page, rows);
  await page.route(EVENT_STREAM, (route) => route.abort("connectionrefused"));

  let items = ITEMS.map((item) => ({ ...item }));
  const writes: { path: string; body: unknown }[] = [];

  const anchors =
    options.anchored === true
      ? [
          {
            anchorId: "anc_plumber",
            threadId: EXISTING_THREAD.id,
            threadStatus: "open",
            selector: { exact: "Call the plumber", prefix: "", suffix: "" },
            range: {
              start: bodyOf(ITEMS).indexOf("Call the plumber"),
              end: bodyOf(ITEMS).indexOf("Call the plumber") + "Call the plumber".length,
            },
            orphaned: false,
          },
        ]
      : [];

  await page.route(`**/api/docs/${LIST_ID}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        frontmatter: {
          id: LIST_ID,
          type: "todo",
          title: "Chores",
          created: "2026-07-01T09:00:00.000Z",
          updated: "2026-07-01T09:00:00.000Z",
          tags: [],
          status: "open",
          anchors: {},
          due: null,
          reviewed: null,
          evergreen: false,
          pinned: false,
          order: null,
          query: null,
          column: null,
          extra: {},
        },
        body: bodyOf(items),
        path: "data/docs/inbox/chores.md",
        anchors,
      }),
    });
  });

  await page.route("**/api/x/todos/**", (route) => {
    const url = new URL(route.request().url());
    const write = /\/api\/x\/todos\/[^/]+\/items\/(\d+)$/.exec(url.pathname);
    if (write !== null && route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { done?: boolean };
      writes.push({ path: url.pathname, body: payload });
      const status = options.itemStatus ?? 200;
      if (status !== 200) {
        return route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({
            code: "conflict",
            message: "it changed under you; nothing was written",
          }),
        });
      }
      const at = Number(write[1]);
      items = items.map((item, index) =>
        index === at ? { ...item, done: payload.done ?? item.done } : item,
      );
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docId: LIST_ID, index: at }),
      });
    }
    const open = items.filter((item) => !item.done);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [
          {
            docId: LIST_ID,
            title: "Chores",
            path: "data/docs/inbox/chores.md",
            status: "open",
            open: open.length,
            done: items.length - open.length,
            items,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.locator(".todos-column .check").first().waitFor();
  return { writes, body: () => bodyOf(items) };
}

const itemRow = (page: Page, at: number): Locator =>
  page.locator(`.todos-column .check[data-todos-item="${String(at)}"]`);

const menu = (page: Page): Locator => page.locator("[data-todo-menu]");
const act = (page: Page, id: string): Locator => menu(page).locator(`[data-act="${id}"]`);

test.describe("right-clicking a todo item row", () => {
  test("opens a Corpus menu and refuses the browser's own", async ({ page }) => {
    await openTodosBoard(page);
    // Recorded from inside the page: the only honest way to show the native
    // menu was suppressed, since Playwright cannot see the browser's own.
    await page.evaluate(() => {
      const held = window as unknown as { prevented: boolean | null };
      held.prevented = null;
      document.addEventListener("contextmenu", (event) => {
        held.prevented = event.defaultPrevented;
      });
    });

    await itemRow(page, 2).click({ button: "right" });
    await expect(menu(page)).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { prevented: boolean | null }).prevented),
    ).toBe(true);
    await expect(menu(page)).toHaveAttribute("aria-label", "Actions for Call the plumber");
    // A right-click is not an open.
    await expect(page.locator(".reader")).toHaveCount(0);
  });

  test("lists exactly the item's own actions, and no disabled third", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 2).click({ button: "right" });
    await expect(act(page, "comment")).toBeEnabled();
    await expect(menu(page).locator('[role="menuitem"]')).toHaveCount(2);
    await expect(act(page, "toggle")).toContainText("Mark as done");
    await expect(act(page, "open-thread")).toHaveCount(0);
  });

  test("offers the thread only when the item already has one", async ({ page }) => {
    await openTodosBoard(page, { anchored: true });
    await itemRow(page, 1).click({ button: "right" });
    await expect(act(page, "comment")).toBeEnabled();
    await expect(act(page, "open-thread")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await itemRow(page, 2).click({ button: "right" });
    await expect(act(page, "open-thread")).toHaveCount(1);
  });

  test("behaves like every other menu: ⇧F10, arrows, ↵ and esc", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 2).focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toHaveCount(1);
    // Key-opened means the first item is focused, as ⇧F10 does everywhere.
    await expect(act(page, "toggle")).toBeFocused();
    // The comment item is disabled until the document read lands, and the
    // arrows deliberately skip a disabled item — so wait for the menu to be
    // whole before asserting where they go.
    await expect(act(page, "comment")).toBeEnabled();
    await page.keyboard.press("ArrowDown");
    await expect(act(page, "comment")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(act(page, "toggle")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    // Focus goes back to the row, and the board is untouched.
    await expect(itemRow(page, 2)).toBeFocused();
    await expect(page.locator(".reader")).toHaveCount(0);

    // `↵` activates — the board's own `rows.open` must not claim it first.
    await page.keyboard.press("Shift+F10");
    await expect(act(page, "comment")).toBeEnabled();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-todo-comment]")).toHaveCount(1);
  });
});

test.describe("the toggle action", () => {
  test("checks the box through the plugin's own item route, and the row leaves", async ({
    page,
  }) => {
    const stub = await openTodosBoard(page);
    await expect(page.locator(".todos-column .check")).toHaveCount(2);

    await itemRow(page, 2).click({ button: "right" });
    await act(page, "toggle").click();

    // No reload: the column re-read its aggregate and the item is gone.
    await expect(page.locator(".todos-column .check")).toHaveCount(1);
    await expect(page.getByText("Call the plumber")).toHaveCount(0);
    expect(stub.writes).toEqual([
      {
        path: `/api/x/todos/${LIST_ID}/items/2`,
        body: { done: true, expectedText: "Call the plumber" },
      },
    ]);
    // Index 2, not 1: the checked item the column never showed still counts.
    expect(stub.body()).toBe(
      bodyOf([
        { text: "Send the signed form", done: true },
        { text: "Book the passport appointment", done: false },
        { text: "Call the plumber", done: true },
      ]),
    );
  });

  test("tells the user when the write is refused, and writes nothing", async ({ page }) => {
    const stub = await openTodosBoard(page, { itemStatus: 409 });
    await itemRow(page, 2).click({ button: "right" });
    await act(page, "toggle").click();

    await expect(page.locator(".todos-column [role='alert']")).toContainText(
      "it changed under you",
    );
    await expect(page.locator(".todos-column .check")).toHaveCount(2);
    expect(stub.body()).toBe(bodyOf(ITEMS));
    await page.getByText("Dismiss").click();
    await expect(page.locator(".todos-column [role='alert']")).toHaveCount(0);
  });
});

test.describe("the comment action", () => {
  test("opens a composer on the item's words and posts an ordinary §6 thread", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 2).click({ button: "right" });
    await expect(act(page, "comment")).toBeEnabled();
    await act(page, "comment").click();

    const composer = page.locator("[data-todo-comment]");
    await expect(composer).toHaveCount(1);
    await expect(menu(page)).toHaveCount(0);
    await expect(composer).toContainText("Call the plumber");

    const posted = page.waitForRequest(
      (request) => request.url().endsWith("/api/threads") && request.method() === "POST",
    );
    await page.locator("[data-todo-comment] textarea").fill("which plumber was it?");
    await page.getByText("Comment ⌘↵").click();

    const request = await posted;
    const sent = request.postDataJSON() as {
      parent: string;
      body: string;
      selector: { exact: string; prefix: string; suffix: string };
    };
    expect(sent.parent).toBe(LIST_ID);
    expect(sent.body).toBe("which plumber was it?");
    // sprint-023 OC4: the quote is the item's words, framed by the document's
    // real text — not `{exact}` alone.
    expect(sent.selector.exact).toBe("Call the plumber");
    // 32 characters of the real body — the same window a selection in the
    // reader captures, ending in the line the item is written on.
    expect(sent.selector.prefix).toHaveLength(32);
    expect(sent.selector.prefix.endsWith("passport appointment\n- [ ] ")).toBe(true);
    expect(sent.selector.suffix).toBe("\n");

    // And the reader lands on the document the comment was made on. Where
    // *inside* it — the thread, expanded and flashed — is UI-037's half, and it
    // is the one described in DEV-STRICTMODE below.
    await expect(page.locator(`.reader[data-reader-doc="${LIST_ID}"]`)).toHaveCount(1);
    await expect(composer).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------------- *
 * DEV-STRICTMODE — why nothing below asserts the thread *expanded*.
 *
 * The reveal reaches the reader and is honoured; a defect in `useReaderSurface`
 * (UI-037) then throws the result away, but **only under React StrictMode**,
 * which `main.tsx` enables in development and a production build drops. It is
 * an effect-ordering fragility, and this menu is the first caller to trip it
 * because it is the first one whose document is already in the cache when the
 * reader mounts (the menu reads the document to decide whether the item has a
 * thread at all):
 *
 *   1. `hasContent` is therefore true on the reader's very first commit, so the
 *      reveal effect runs in the same pass as the `[reader.docId]` effect that
 *      resets `expanded` / `flash`. Order is fine — reset first, then the jump.
 *   2. StrictMode then replays both effects. The reset runs again and clears
 *      the expansion; the reveal's identity guard (`revealed.current === reveal`)
 *      correctly refuses to fire twice, so nothing puts it back.
 *
 * Verified by running this file's last test with `<StrictMode>` removed from
 * `main.tsx`: `.thread-slot.expanded[data-slot-thread="th_plumber"]` and
 * `.thread-card.flash` both appear and the assertion passes; restored
 * immediately. Reported to the orchestrator for a UI issue — the fix is in
 * `apps/ui/src/reader/useReaderSurface.ts` and belongs to the ui domain.
 *
 * What is asserted instead is everything this issue owns: that the action opens
 * the parent document, and that the payload it produces is exactly
 * `{docId, reveal: {kind: "thread", threadId}}` (pinned in
 * `plugins/todos/ui/TodosColumnMenu.test.tsx`). The honouring half is
 * `reveal.spec.ts`'s, seeded, and passes there.
 * ------------------------------------------------------------------------- */

test.describe("the open-thread action", () => {
  test("opens the document the item's thread lives on", async ({ page }) => {
    await openTodosBoard(page, { anchored: true });
    await itemRow(page, 2).click({ button: "right" });
    await expect(act(page, "open-thread")).toHaveCount(1);
    await act(page, "open-thread").click();

    await expect(page.locator(`.reader[data-reader-doc="${LIST_ID}"]`)).toHaveCount(1);
    // The thread is there to be revealed, at its anchor on the item's words.
    await expect(
      page.locator(`.thread-slot[data-slot-thread="${EXISTING_THREAD.id}"]`),
    ).toHaveCount(1);
    // A thread destination draws no item box: one mechanism, two destinations.
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0);
  });
});
