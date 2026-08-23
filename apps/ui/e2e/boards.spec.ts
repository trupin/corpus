import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * The board bar, in a real browser (UI-148; SPEC.md §10, rider 2).
 *
 * What these prove is that every act on the bar is a **write to a document**:
 * `＋` creates a `type: board` file, `×` archives one, a drag rewrites `order`
 * on every board that moved. Nothing about the bar is layout state the app
 * holds, which is what lets the agent build a board the way it builds any
 * document.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  query: { folder: "inbox" },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Mortgage options",
  path: "data/docs/inbox/mortgage.md",
  body: "6.4% this week.\n",
};

const BOARDS: readonly StubRow[] = [
  {
    id: "doc_board_attention",
    type: "board",
    title: "Attention",
    path: "data/docs/boards/attention.md",
    order: 1,
    columns: ["doc_view_inbox"],
    defaultOpen: true,
  },
  {
    id: "doc_board_files",
    type: "board",
    title: "Files",
    path: "data/docs/boards/files.md",
    order: 2,
    columns: [],
  },
];

const tabTitles = ".boardbar .board-tab[data-board] .board-tab-title";

test.describe("the board bar", () => {
  test("lists every board in order, and shows the default-open one", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");

    await expect(page.locator(tabTitles)).toHaveText(["Attention", "Files"]);
    await expect(
      page.locator('.boardbar .board-tab[data-board="doc_board_attention"]'),
    ).toHaveClass(/\bon\b/);
    // Its column is the view document it lists, and the column's query ran.
    await expect(page.locator('.col[data-col="doc_view_inbox"] .col-title')).toHaveText("Inbox");
    await expect(page.locator('.row[data-row-doc="doc_note"]')).toBeVisible();
    expect(uncaught).toEqual([]);
  });

  test("switching board is browser-local and survives a reload", async ({ page }) => {
    await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");

    await page.locator('.boardbar .board-tab[data-board="doc_board_files"]').click();
    await expect(page.locator('.boardbar .board-tab[data-board="doc_board_files"]')).toHaveClass(
      /\bon\b/,
    );
    // Files lists no columns, so the board says so rather than going blank.
    await expect(page.locator(".board .board-empty")).toContainText("Files is empty");

    await page.reload();
    await expect(page.locator('.boardbar .board-tab[data-board="doc_board_files"]')).toHaveClass(
      /\bon\b/,
    );
    // Nothing about the choice reached a document: it is browser-local.
    const stored = await page.evaluate(() => window.localStorage.getItem("corpus.board"));
    expect(stored).toContain("doc_board_files");
  });

  /**
   * `⌘1`…`⌘9` (SPEC.md §10's keyboard scheme). Pressed here with Control, which
   * the registry accepts as the same chord (`metaKey || ctrlKey`): Chromium
   * claims `⌘2` for its own tab switching before the page ever sees it.
   */
  test("Ctrl+1 and Ctrl+2 switch boards in bar order", async ({ page }) => {
    await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    // The bar is the authority on how many boards there are, so the key does
    // nothing until it has them.
    await expect(page.locator(tabTitles)).toHaveCount(2);

    await page.keyboard.press("Control+Digit2");
    await expect(page.locator('.boardbar .board-tab[data-board="doc_board_files"]')).toHaveClass(
      /\bon\b/,
    );
    await page.keyboard.press("Control+Digit1");
    await expect(
      page.locator('.boardbar .board-tab[data-board="doc_board_attention"]'),
    ).toHaveClass(/\bon\b/);
  });

  test("＋ creates a board document and switches to it", async ({ page }) => {
    const corpus = await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(tabTitles)).toHaveCount(2);

    /*
     * `＋` offers the two kinds of board there are (UI-152, SPEC.md §10 rider 6):
     * an empty one you add view columns to, and a kanban whose columns are its
     * stages. An empty board is still one click away from the choice.
     */
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByRole("menuitem", { name: /Empty board/ }).click();

    await expect(page.locator(tabTitles)).toHaveCount(3);
    await expect(page.locator(tabTitles).nth(2)).toHaveText("New board");
    await expect(page.locator(".board .board-empty")).toContainText("New board is empty");

    const created = (await corpus.requests()).find(
      (request) => request.method === "POST" && request.path === "/api/docs",
    );
    expect(created?.body).toMatchObject({
      type: "board",
      title: "New board",
      folder: "boards",
      columns: [],
      // Last on the bar.
      order: 3,
    });
  });

  test("× archives a board, and is absent once one board is left", async ({ page }) => {
    const corpus = await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(tabTitles)).toHaveCount(2);

    await page.getByRole("button", { name: "Archive Files" }).click();

    await expect(page.locator(tabTitles)).toHaveText(["Attention"]);
    expect(
      (await corpus.requests()).filter(
        (request) => request.path === "/api/docs/doc_board_files/archive",
      ),
    ).toHaveLength(1);

    // One board left: the affordance is gone, because §10 refuses the act.
    await expect(page.locator(".boardbar .board-tab-close")).toHaveCount(0);
  });

  test("archiving the last board is refused, with the reason", async ({ page }) => {
    const corpus = await stubCorpus(page, [BOARDS[0] as StubRow, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(tabTitles)).toHaveCount(1);

    await page.locator('.boardbar .board-tab[data-board="doc_board_attention"]').click({
      button: "right",
    });
    const archive = page.getByRole("menuitem", { name: /Archive board/ });
    await expect(archive).toBeDisabled();
    await expect(archive).toContainText("one board is always showing");

    await page.keyboard.press("Escape");
    expect(
      (await corpus.requests()).filter((request) => request.path.endsWith("/archive")),
    ).toHaveLength(0);
    await expect(page.locator(tabTitles)).toHaveCount(1);
  });

  test("dragging a tab writes `order` on every board that moved", async ({ page }) => {
    const corpus = await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(tabTitles)).toHaveText(["Attention", "Files"]);

    const first = page.locator('.boardbar .board-tab[data-board="doc_board_attention"]');
    const second = page.locator('.boardbar .board-tab[data-board="doc_board_files"]');
    await second.dragTo(first, { targetPosition: { x: 2, y: 8 } });

    await expect(page.locator(tabTitles)).toHaveText(["Files", "Attention"]);
    const writes = (await corpus.requests()).filter(
      (request) => request.method === "PUT" && request.path.startsWith("/api/docs/doc_board_"),
    );
    expect(writes.map((request) => [request.path, request.body])).toEqual([
      ["/api/docs/doc_board_files", { order: 1 }],
      ["/api/docs/doc_board_attention", { order: 2 }],
    ]);
  });

  test("a column the board lists and the corpus cannot answer for renders an error card", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await stubCorpus(page, [
      {
        id: "doc_board_broken",
        type: "board",
        title: "Broken",
        path: "data/docs/boards/broken.md",
        order: 1,
        columns: ["doc_view_inbox", "doc_view_gone"],
        defaultOpen: true,
      },
      VIEW,
      NOTE,
    ]);
    await page.goto("/");

    // Two columns, because the board lists two — the missing one is a card, not
    // a gap (SPEC.md §10's error-card pattern).
    await expect(page.locator(".col[data-col]")).toHaveCount(2);
    const broken = page.locator('.col[data-col="doc_view_gone"] .col-card-error');
    await expect(broken).toBeVisible();
    await expect(broken).toContainText("doc_view_gone");
    // …and its sibling still renders its rows.
    await expect(page.locator('.row[data-row-doc="doc_note"]')).toBeVisible();
    expect(uncaught).toEqual([]);
  });

  test("removing a column edits the board document and leaves the view alone", async ({ page }) => {
    const corpus = await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator('.col[data-col="doc_view_inbox"]')).toBeVisible();

    await page.getByRole("button", { name: "List options for Inbox" }).click();
    await page.getByRole("menuitem", { name: /Remove from this board/ }).click();

    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    const writes = (await corpus.requests()).filter((request) => request.method === "PUT");
    expect(writes.map((request) => [request.path, request.body])).toEqual([
      ["/api/docs/doc_board_attention", { columns: [] }],
    ]);
    // The view document is still there, untouched.
    expect(await corpus.doc("doc_view_inbox")).not.toBeUndefined();
    expect((await corpus.doc("doc_view_inbox"))?.status).toBe("open");
  });

  /**
   * **The bar is chrome** (SPEC.md §10: "nothing resizes because of what it
   * holds", rider signed 2026-08-20; the bound rule of 2026-08-21).
   *
   * Three claims, each measured rather than declared: the bar is the same height
   * whatever it holds, the board below it starts at the same place, and a title
   * too long for the room is **truncated and revealed** rather than allowed to
   * decide the box. A pixel count appears nowhere — the assertion is that two
   * measurements agree, which is true in any font on any machine.
   */
  test("holds its height and the board's place whatever a board is called", async ({ page }) => {
    const LONG = "Q3 mortgage refinancing, options, dates and everything else we said about it";
    await stubCorpus(page, [...BOARDS, VIEW, NOTE]);
    await page.goto("/");
    await expect(page.locator(tabTitles)).toHaveCount(2);

    const before = await page.evaluate(() => ({
      bar: document.querySelector(".boardbar")?.getBoundingClientRect().height ?? 0,
      board: document.querySelector(".board")?.getBoundingClientRect().top ?? 0,
    }));
    expect(before.bar).toBeGreaterThan(0);

    // Renamed to something no bar has room for, through the tab's own act.
    await page.locator('.boardbar .board-tab[data-board="doc_board_files"]').click({
      button: "right",
    });
    await page.getByRole("menuitem", { name: /^Rename/ }).click();
    const field = page.getByLabel(/^Rename/);
    await field.fill(LONG);
    await field.press("Enter");
    await expect(page.locator(tabTitles).nth(1)).toHaveText(LONG);

    const after = await page.evaluate(() => ({
      bar: document.querySelector(".boardbar")?.getBoundingClientRect().height ?? 0,
      board: document.querySelector(".board")?.getBoundingClientRect().top ?? 0,
    }));
    expect(after.bar).toBe(before.bar);
    expect(after.board).toBe(before.board);

    /*
     * **And the room is what bounds it, not a number** (SHARED-061). At 1280px
     * the bar has room for the whole title and shows the whole title, which is
     * the floor half of the rule. Narrowed until it genuinely does not fit, the
     * title gives — and the whole of it is on the tab's tooltip, which is §10's
     * reveal-rather-than-accommodate rule. The bar's own height is measured
     * again at the narrow width: what gives is the text, never the box.
     */
    const title = page.locator(tabTitles).nth(1);
    expect(
      await title.evaluate((node) => node.scrollWidth > node.clientWidth),
      "the bar had room and truncated anyway",
    ).toBe(false);

    await page.setViewportSize({ width: 420, height: 720 });
    await expect
      .poll(async () => title.evaluate((node) => node.scrollWidth > node.clientWidth))
      .toBe(true);
    expect(
      await page.evaluate(
        () => document.querySelector(".boardbar")?.getBoundingClientRect().height,
      ),
    ).toBe(before.bar);
    await expect(
      page.locator('.boardbar .board-tab[data-board="doc_board_files"] .board-tab-open'),
    ).toHaveAttribute("title", new RegExp(LONG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  /**
   * UI-148's third edge case. A workspace that never ran the migration holds
   * view documents and no board document, so it has no columns at all — and the
   * bar says which command reports the migration rather than inventing a board.
   */
  test("a workspace with no boards names `corpus upgrade` and invents nothing", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    // A seed naming its own board suppresses the stub's synthesised one, so an
    // archived board is how "this workspace has none" is expressed here.
    await stubCorpus(page, [
      {
        id: "doc_board_old",
        type: "board",
        title: "Gone",
        path: "data/docs/boards/gone.md",
        status: "archived",
        order: 1,
        columns: [],
      },
      VIEW,
      NOTE,
    ]);
    await page.goto("/");

    const disabled = page.locator(".boardbar .board-tab[disabled]");
    await expect(disabled).toBeVisible();
    await expect(disabled).toContainText("No boards — run `corpus upgrade`");
    await expect(page.locator(".boardbar .board-tab[data-board]")).toHaveCount(0);
    await expect(page.locator(".col[data-col]")).toHaveCount(0);
    // No ghost column: a new list would have nowhere to go.
    await expect(page.locator(".board .ghost-col")).toHaveCount(0);
    await expect(page.locator(".board .board-empty")).toContainText("corpus upgrade");
    expect(uncaught).toEqual([]);
  });
});
