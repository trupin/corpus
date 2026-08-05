import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * The todos plugin in a real browser (PLUGINS-006) — the first e2e spec this
 * plugin has ever had.
 *
 * The thing under test is a **subtraction**: the plugin stopped registering a
 * `View` for `todo`, so a todo document now renders in the core editor. Every
 * assertion below is about something the plugin does *not* do — the checkbox
 * list is the editor's GFM task-list support, the toggle is core autosave, and
 * a comment on an item is the ordinary comment-from-selection affordance
 * producing an ordinary §6 text-quote anchor. If any of it needed plugin code,
 * the design would be wrong.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence:
 * `playwright.config.ts` starts no workspace server, so the file on disk, the
 * auto-commit, the projection row and `orphaned: false` after a round trip come
 * from PLUGINS-006's real-app drill against a real `corpus` server. Neither
 * half is acceptance on its own.
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

const TODO_BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [ ] Book the passport appointment (due: 2026-08-01)",
  "- [ ] Call the plumber",
  "- [x] Send the signed form",
  "",
].join("\n");

const TODO = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: TODO_BODY,
};

/**
 * A second todo document, whose first item is long enough to wrap inside a
 * column.
 *
 * UI-034 is a *layout* defect and the wrapped line is where half of it shows,
 * so it needs an item that wraps and an ordinary bullet list beside it to prove
 * the fix stayed scoped. `TODO_BODY` above is deliberately left untouched: the
 * toggle tests assert an exact saved body, and growing their fixture to serve
 * this one would make a styling change able to break them.
 */
const WRAPPING_ITEM =
  "Book the passport appointment at the consulate, and bring the old passport, two photographs and the completed form";

const WRAPPING_TODO = {
  id: "doc_todo_wrap",
  type: "todo",
  title: "Long chores",
  path: "data/docs/inbox/long-chores.md",
  body: [
    `- [ ] ${WRAPPING_ITEM}`,
    "- [x] Send the signed form",
    "",
    // A paragraph closes the list; without it CommonMark keeps the bullets
    // below in the *same* list, and the parser would make them task items.
    "Not a task list:",
    "",
    "- an ordinary bullet",
    "",
  ].join("\n"),
};

/**
 * The plugin's own aggregate (`GET /api/x/todos/lists/at/<fingerprint>`), served
 * from the stubbed store.
 *
 * The board's todo **row** reads its item preview from this route since
 * PLUGINS-007 — bodies do not ride list rows — so the suite has to answer it or
 * every todo row renders degraded. It is answered by parsing the stub's own
 * stored body, so a toggle made in the editor is reflected here exactly as the
 * real route would reflect it, and the fingerprint in the path is whatever the
 * plugin computed. Registered **after** `stubCorpus`, whose `**\/api\/**`
 * handler would otherwise swallow it: Playwright matches the most recently
 * added route first.
 */
async function stubTodosAggregate(
  page: Page,
  bodyOf: () => Promise<string>,
  doc: { readonly id: string; readonly title: string; readonly path: string } = TODO,
): Promise<{ readonly paths: string[] }> {
  const paths: string[] = [];
  await page.route("**/api/x/todos/**", async (route) => {
    const url = new URL(route.request().url());
    paths.push(url.pathname);
    const items = [...(await bodyOf()).matchAll(/^[ \t]*- \[([ xX])\][ \t]+(\S[^\n]*)$/gm)].map(
      (match) => ({ text: String(match[2]).trim(), done: match[1] !== " " }),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [
          {
            docId: doc.id,
            title: doc.title,
            path: doc.path,
            status: "open",
            open: items.filter((item) => !item.done).length,
            done: items.filter((item) => item.done).length,
            items,
          },
        ],
      }),
    });
  });
  return { paths };
}

/** Every checkbox the editor drew for the task list, in body order. */
function boxes(page: Page): Locator {
  return page.locator('.reader .ProseMirror li input[type="checkbox"]');
}

/** Opens a todo document in its column reader. */
async function openTodo(page: Page, docId: string = TODO.id): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await page.locator(".reader .ProseMirror").waitFor();
}

/** A sub-pixel box, as the layout reports it — what a mouse drag has to aim at. */
interface TextBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where a text node reading exactly `text` sits right now, or `null`. */
async function boxOfText(page: Page, text: string): Promise<TextBox | null> {
  return page.evaluate((needle) => {
    const root = document.querySelector(".reader .ProseMirror");
    if (root === null) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      if (node.textContent === needle) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      node = walker.nextNode();
    }
    return null;
  }, text);
}

/** How many attempts a drag gets before a mis-landed one is a failure. */
const SELECT_ATTEMPTS = 3;

/**
 * Drags across exactly one item's own text node — a real selection over real
 * glyphs, which is what `selectorFromSelection` maps through the serializer's
 * emission trace. Selecting with the keyboard would run past the list item.
 *
 * **The drag is checked against what it actually selected** (UI-071). A rect
 * measured in one layout and dragged in another puts the pointer on a different
 * line, and the drag then selects whatever moved under it — silently, because
 * the browser has no idea which words were meant. The document surface *does*
 * move after the editor first paints: plugin discovery is a dynamic `import()`
 * that settles late, and the `DocPanel` it registers renders **above** the body,
 * pushing it down 78px in this fixture. Measure "Call the plumber" before that
 * and release the mouse after it and the same x-span lands three lines up, on
 * `ores that landed ` — 17 characters out of "Chores that landed in the inbox."
 * That is the state the v0.3.0 pre-push gate caught, four assertions later, as a
 * highlight over the wrong sentence.
 *
 * Re-measuring is what makes a shifted attempt recoverable; the equality check
 * is what makes it *safe*, and it is the half that matters. A spec may fail to
 * select — it may never go on to comment on words nobody chose.
 */
async function selectItemText(page: Page, text: string): Promise<void> {
  let selected = "";
  for (let attempt = 0; attempt < SELECT_ATTEMPTS; attempt += 1) {
    const found = await boxOfText(page, text);
    expect(found, `no text node reads exactly “${text}”`).not.toBeNull();
    if (found === null) return;
    const y = found.y + found.height / 2;
    await page.mouse.move(found.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(found.x + found.width / 2, y);
    await page.mouse.move(found.x + found.width - 1, y);
    await page.mouse.up();
    selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    if (selected === text) return;
  }
  expect(selected, `the drag meant for “${text}” landed on other words`).toBe(text);
}

/** An integer-rounded box; sub-pixel layout is noise every assertion tolerates. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What UI-034 is about, measured off the live layout rather than described. */
interface TaskItemGeometry {
  /** `list-style-type` on the task list — the marker, or its absence. */
  readonly taskListStyle: string;
  /** The same, on an ordinary list in the same body: the scoping control. */
  readonly plainListStyle: string;
  /** The checkbox's border box. */
  readonly box: Rect;
  /** One rect per *rendered line* of the item's own text. */
  readonly lines: readonly Rect[];
}

/**
 * Where to look, and for what: the two renderers emit two shapes for one
 * markdown construct (`packages/kit/src/markdown/markdown.css` documents both),
 * so the selectors are arguments rather than constants.
 */
interface GeometryQuery {
  readonly scope: string;
  readonly list: string;
  readonly plainList: string;
  readonly item: string;
  /** A prefix of the item's own text node. */
  readonly text: string;
}

/**
 * The item's geometry, taken from a `Range` over its **text node** and not from
 * its container.
 *
 * The container would prove nothing: the editor wraps item content in a `div`
 * whose box includes the paragraph's margins, so it overlaps the checkbox
 * whether or not the two share a line. Client rects of the text are one per
 * rendered line, which is exactly the two questions this issue asks — is the
 * box on the first line, and where does the second line start.
 */
async function taskItemGeometry(page: Page, query: GeometryQuery): Promise<TaskItemGeometry> {
  return page.evaluate((q) => {
    const scope = document.querySelector(q.scope);
    if (scope === null) throw new Error(`nothing matches ${q.scope}`);
    const list = scope.querySelector(q.list);
    const plainList = scope.querySelector(q.plainList);
    if (list === null || plainList === null) throw new Error(`no ${q.list} / ${q.plainList}`);

    const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null && !(node.textContent ?? "").startsWith(q.text)) {
      node = walker.nextNode();
    }
    if (node === null) throw new Error(`no text node starts “${q.text}”`);
    const item = node.parentElement?.closest(q.item) ?? null;
    const input = item?.querySelector('input[type="checkbox"]') ?? null;
    if (input === null) throw new Error(`no checkbox in the item holding “${q.text}”`);

    const range = document.createRange();
    range.selectNodeContents(node);
    const round = (r: DOMRect): Rect => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });

    /*
     * One rect per line, not per box. `getClientRects()` hands back a separate
     * rect for the collapsed space that ends each wrapped line — observed live:
     * a three-line item produced five rects, alternating text and a 4px stub —
     * so reading `rects[1]` as "the second line" reads a trailing space sitting
     * at the *right* edge of the first one. Rects on the same line are merged
     * by their top instead.
     */
    const lines: DOMRect[] = [];
    for (const rect of range.getClientRects()) {
      const line = lines.at(-1);
      if (line !== undefined && Math.abs(line.top - rect.top) < 2) {
        lines[lines.length - 1] = new DOMRect(
          Math.min(line.x, rect.x),
          Math.min(line.y, rect.y),
          Math.max(line.right, rect.right) - Math.min(line.x, rect.x),
          Math.max(line.bottom, rect.bottom) - Math.min(line.y, rect.y),
        );
        continue;
      }
      lines.push(rect);
    }

    return {
      taskListStyle: getComputedStyle(list).listStyleType,
      plainListStyle: getComputedStyle(plainList).listStyleType,
      box: round(input.getBoundingClientRect()),
      lines: lines.map(round),
    };
  }, query);
}

/**
 * The editor's shape (TipTap `TaskList`/`TaskItem`), under some root.
 *
 * The item is addressed through its list because that is what the live node
 * view gives: it puts `data-checked` on the `li` and no `data-type`, so
 * `li[data-type="taskItem"]` — what the extension's `renderHTML` would
 * serialise — matches nothing on screen. Measuring the real DOM is the only
 * reason this is known, and it is exactly the mistake the original defect made.
 */
function editorQuery(scope: string): GeometryQuery {
  return {
    scope,
    list: 'ul[data-type="taskList"]',
    plainList: "ul:not([data-type])",
    item: 'ul[data-type="taskList"] > li',
    text: WRAPPING_ITEM.slice(0, 24),
  };
}

/**
 * The three assertions the acceptance criteria spell out, made against one
 * measured item so a regression names itself.
 */
function expectTaskItemLayout(geometry: TaskItemGeometry): void {
  // (1) No marker — and an ordinary list in the same body still has one, which
  // is what makes this a scoped fix rather than a blanket `list-style: none`.
  expect(geometry.taskListStyle).toBe("none");
  expect(geometry.plainListStyle).toBe("disc");

  // The item has to be long enough to wrap, or the third assertion below would
  // pass vacuously.
  const [first, second] = geometry.lines;
  if (first === undefined || second === undefined) {
    throw new Error(`the item rendered on ${geometry.lines.length} line(s); it must wrap`);
  }

  // (2) The checkbox shares the first line's line box — the two vertical spans
  // overlap — and sits to its left, which is precisely what "stacked above the
  // text" is not.
  expect(geometry.box.y).toBeLessThan(first.y + first.height);
  expect(first.y).toBeLessThan(geometry.box.y + geometry.box.height);
  expect(geometry.box.x + geometry.box.width).toBeLessThanOrEqual(first.x);

  // (3) The wrapped line indents under the text, not under the checkbox.
  expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(1);
  expect(second.x).toBeGreaterThan(geometry.box.x + geometry.box.width);
}

/**
 * UI-034: the shipped stylesheet for a GFM task list, measured in a real
 * browser.
 *
 * The dogfood build rendered every task item with its `ul` marker still showing
 * and the checkbox on a line of its own above the text, because
 * `@corpus/kit/markdown.css` said nothing about the task-list node structure at
 * all and the browser laid the raw markup out with its defaults. Nothing here
 * is pixel-perfect: each assertion is a structural relation (no marker, shared
 * line box, wrapped-line indent) that holds at any font size or column width
 * and fails the moment the rules go missing again.
 */
test.describe("a task list's layout", () => {
  test("drops the bullet and puts the checkbox on the item's first line", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, WRAPPING_TODO]);
    await stubTodosAggregate(
      page,
      async () => (await corpus.doc(WRAPPING_TODO.id))?.body ?? "",
      WRAPPING_TODO,
    );
    await openTodo(page, WRAPPING_TODO.id);

    expectTaskItemLayout(await taskItemGeometry(page, editorQuery(".reader .ProseMirror")));
  });

  test("lays the same item out identically in full-screen focus", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, WRAPPING_TODO]);
    await stubTodosAggregate(
      page,
      async () => (await corpus.doc(WRAPPING_TODO.id))?.body ?? "",
      WRAPPING_TODO,
    );
    await openTodo(page, WRAPPING_TODO.id);

    await page.locator(`.reader[data-reader-doc="${WRAPPING_TODO.id}"] [data-expand]`).click();
    await page.locator(".focus.open .ProseMirror").waitFor();

    // Focus mode is the same class on a wider measure (`.focus .doc-body`), so
    // the item wraps at a different word and every relation still holds.
    expectTaskItemLayout(await taskItemGeometry(page, editorQuery(".focus.open .ProseMirror")));
  });

  /**
   * The other renderer. `MarkdownView` (react-markdown + remark-gfm) emits a
   * different shape for the same markdown — `li.task-list-item` with a bare
   * checkbox and a text node — and it is what thread turns and non-editable
   * bodies render through, so it has to obey the same rules.
   *
   * Reached with a probe rather than a fixture document, the way
   * `thread.spec.ts` pins its card: the markup below is the renderer's real
   * output, mounted into the real page, measured against the real stylesheet.
   */
  test("gives react-markdown's task-list shape the same treatment", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.evaluate((text) => {
      const host = document.createElement("div");
      host.id = "ui034-probe";
      // Narrow enough to force the item onto two lines.
      host.style.width = "260px";
      host.innerHTML =
        '<div class="doc-body"><ul class="contains-task-list">' +
        `<li class="task-list-item"><input disabled="" type="checkbox"> ${text}</li>` +
        "</ul><ul><li>an ordinary bullet</li></ul></div>";
      document.body.append(host);
    }, WRAPPING_ITEM);

    const geometry = await taskItemGeometry(page, {
      scope: "#ui034-probe",
      list: "ul.contains-task-list",
      plainList: "ul:not([class])",
      item: "li.task-list-item",
      // The renderer puts a space between the checkbox and the text.
      text: ` ${WRAPPING_ITEM.slice(0, 24)}`,
    });
    await page.evaluate(() => document.querySelector("#ui034-probe")?.remove());

    expectTaskItemLayout(geometry);
  });
});

test.describe("a todo document in the core editor", () => {
  test("renders its items as task-list checkboxes, not as a plugin surface", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    // The standard editor, with the standard body class the renderer uses.
    await expect(page.locator(".reader .ProseMirror.doc-body")).toHaveCount(1);
    // The plugin's `View` is gone, so nothing of it can be on screen.
    await expect(page.locator(".todo-view")).toHaveCount(0);

    await expect(boxes(page)).toHaveCount(3);
    expect(
      await boxes(page).evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement).checked),
      ),
    ).toEqual([false, false, true]);
    // The inline due marker is item text, exactly as SPEC.md §12 describes it —
    // the editor has no idea it means anything.
    await expect(
      page.locator(".reader .ProseMirror li", { hasText: "Book the passport appointment" }),
    ).toContainText("(due: 2026-08-01)");
  });

  test("keeps the plugin's DocPanel above the body", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    // Dropping the renderer must not take the panel with it: `docTypes` is
    // still proved by `ListItem` + `DocPanel` + `validate` (SHARED-005 A3).
    const panel = page.locator(`[data-todo-panel="${TODO.id}"]`);
    await expect(panel).toHaveCount(1);
    await expect(panel.locator("[data-stat-open]")).toHaveText("2");
    await expect(panel.locator("[data-stat-done]")).toHaveText("1");
    await expect(panel).toContainText("plugin: todos");
  });

  test("toggles a checkbox as an ordinary body edit, through no plugin write", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    await boxes(page).first().click();
    await expect
      .poll(async () => (await corpus.of("PUT", `/api/docs/${TODO.id}`)).length)
      .toBeGreaterThan(0);

    const writes = await corpus.of("PUT", `/api/docs/${TODO.id}`);
    const saved = (writes.at(-1)?.body as { body?: string } | undefined)?.body ?? "";
    // One character changed; everything the editor did not touch came back.
    expect(saved).toBe(TODO_BODY.replace("- [ ] Book", "- [x] Book"));

    /*
     * The signed clause (SPEC.md §12): in the UI a toggle is a core body edit
     * saved like any other, and the plugin's routes stay the CLI/agent write
     * path. So what must be absent is a plugin **write** — not every plugin
     * request: since PLUGINS-007 the todo row *reads* its item preview from the
     * plugin's aggregate, and asserting "no `/api/x/todos` request at all"
     * would forbid that read as a side effect of testing the toggle.
     */
    const pluginWrites = (await corpus.requests()).filter(
      (entry) => entry.path.startsWith("/api/x/todos") && entry.method !== "GET",
    );
    expect(pluginWrites).toEqual([]);
  });

  /**
   * PLUGINS-007's mechanism, pinned in the suite rather than only in a drill.
   *
   * Items are body text and bodies do not ride list rows, so the row's preview
   * comes from the plugin's aggregate — and a **core** body edit broadcasts
   * `["docs"]` and nothing under `x/todos`. The join is the `(id, updated)`
   * fingerprint in the aggregate's path: a toggle in the editor stamps
   * `updated`, so the path changes and the preview refetches. Without it the
   * row would keep showing the pre-toggle state until a reload, which is
   * exactly the defect this test exists to catch.
   */
  test("refreshes the row's preview after a core-path toggle, with no reload", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    const aggregate = await stubTodosAggregate(
      page,
      async () => (await corpus.doc(TODO.id))?.body ?? "",
    );
    await openTodo(page);

    const preview = page.locator(`.row[data-row-doc="${TODO.id}"] .todo-items .t`).first();
    await expect(preview).toHaveText(/Book the passport appointment/);
    await expect(preview).not.toHaveClass(/done/);
    const before = [...aggregate.paths];
    expect(before).toHaveLength(1);

    await boxes(page).first().click();

    // The row repaints itself — nothing reloaded, nothing was told to refetch
    // by the plugin, because no plugin write happened.
    await expect(preview).toHaveClass(/done/);
    expect(aggregate.paths.length).toBeGreaterThan(before.length);
    expect(aggregate.paths.at(-1)).not.toBe(before[0]);
    expect(aggregate.paths.at(-1)).toMatch(/^\/api\/x\/todos\/lists\/at\/[a-z0-9]+$/);
  });
});

test.describe("commenting on one item", () => {
  test("quotes exactly the item's text, and sends an ordinary text-quote selector", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    await selectItemText(page, "Call the plumber");

    // The core selection toolbar — the plugin contributes nothing here.
    const comment = page.locator("[data-sel-comment]");
    await expect(comment).toBeEnabled();
    await comment.click();

    const popover = page.locator("[data-comment-pop]");
    await expect(popover).toBeVisible();
    // The quote is the item's text and not the `- [ ] ` marker: the checkbox is
    // list syntax, so the serializer's trace never puts it inside the range.
    await expect(popover.locator(".cm-quote")).toHaveText("“Call the plumber”");

    await popover.locator(".cm-input").fill("Which office is this?");
    await popover.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      parent: string;
      body: string;
      selector: { exact: string; prefix: string; suffix: string };
    };
    expect(sent.parent).toBe(TODO.id);
    expect(sent.body).toBe("Which office is this?");
    // The quote is the item's text alone — the checkbox marker is *context*,
    // which is the whole point: an item is not special, it is body text with a
    // list marker in front of it.
    expect(sent.selector.exact).toBe("Call the plumber");
    expect(sent.selector.prefix).toMatch(/\n- \[ \] $/);
    expect(sent.selector.suffix).toBe("\n- [x] Send the signed form\n");
  });

  test("draws the anchor layer's highlight on the commented item", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    await selectItemText(page, "Call the plumber");
    await page.locator("[data-sel-comment]").click();
    await page.locator("[data-comment-pop] .cm-input").fill("Which office is this?");
    await page.locator("[data-comment-send]").click();

    /*
     * `anchorsHost` is true for `todo` the moment no plugin View is registered,
     * so the decoration lands with no new machinery anywhere.
     *
     * The assertion waits for the **resolved** anchor, not the optimistic one:
     * the stub now stores the selector on the parent and resolves it on every
     * read, so this highlight survives the refetch that follows the creation.
     * Asserting before that refetch is asserting a race, and it is why this
     * test failed under the parallel suite and passed alone.
     */
    await expect
      .poll(async () => (await corpus.doc(TODO.id))?.anchors.length ?? 0)
      .toBeGreaterThan(0);
    const highlight = page.locator(".reader .anchor-hl");
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("Call the plumber");
  });

  /**
   * The other half of the same guarantee, and the one that makes the highlight
   * worth having: the anchor is an ordinary §6 text-quote selector over body
   * text, so **checking the box does not disturb it**. Only the line's `- [ ]`
   * prefix changed, and `exact` never contained it.
   */
  test("keeps the highlight on the item after the checkbox is toggled", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    await selectItemText(page, "Call the plumber");
    await page.locator("[data-sel-comment]").click();
    await page.locator("[data-comment-pop] .cm-input").fill("Which office is this?");
    await page.locator("[data-comment-send]").click();
    await expect
      .poll(async () => (await corpus.doc(TODO.id))?.anchors.length ?? 0)
      .toBeGreaterThan(0);

    // Collapse the selection first: the floating toolbar is still open over it
    // and would swallow the click on the checkbox beneath.
    await page.locator(".reader .ProseMirror p").first().click();
    await expect(page.locator("[data-sel-comment]")).toHaveCount(0);

    await boxes(page).nth(1).click();
    await expect
      .poll(async () => (await corpus.doc(TODO.id))?.body ?? "")
      .toContain("- [x] Call the plumber");

    await expect(page.locator(".reader .anchor-hl")).toHaveText("Call the plumber");
  });

  /**
   * UI-071, and the reason the two tests above are worth trusting.
   *
   * The v0.3.0 pre-push gate failed the toggle test with a highlight reading
   * `ores that landed ` where `Call the plumber` was asked for. It was not a
   * misplaced highlight: the anchor layer drew exactly the 17 characters its
   * anchor covered. The **anchor** was made over the wrong words, because the
   * document moved between the moment the spec measured the item's position and
   * the moment it dragged over it — plugin discovery settled, the todos
   * `DocPanel` appeared above the body, and everything below it dropped 78px, so
   * the same x-span landed on the first paragraph three lines up.
   *
   * Driven here instead of waited for. A one-shot `mousemove` listener inserts a
   * spacer of the panel's own height at the instant the drag begins, which puts
   * the shift in exactly the window the gate lost the race in — every run,
   * on an idle machine. Against a helper that measures once and trusts the
   * result, this comments on `ores that landed `.
   */
  test("comments on the item the pointer chose, not on text that moved under it", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openTodo(page);

    // Measured off the live layout: the panel is what shifts the body in the
    // field, and its height is what the spacer has to reproduce.
    const shift = await page.evaluate(() => {
      const panel = document.querySelector(".doc-main > .doc-panel");
      return panel === null ? 0 : Math.round(panel.getBoundingClientRect().height);
    });
    expect(shift, "no plugin panel above the body — nothing shifts it").toBeGreaterThan(0);

    await page.evaluate((height: number) => {
      const shiftOnce = (): void => {
        window.removeEventListener("mousemove", shiftOnce, true);
        const spacer = document.createElement("div");
        spacer.style.height = `${String(height)}px`;
        document.querySelector(".doc-main")?.prepend(spacer);
      };
      window.addEventListener("mousemove", shiftOnce, true);
    }, shift);

    await selectItemText(page, "Call the plumber");

    await page.locator("[data-sel-comment]").click();
    await expect(page.locator("[data-comment-pop] .cm-quote")).toHaveText("“Call the plumber”");

    await page.locator("[data-comment-pop] .cm-input").fill("Which office is this?");
    await page.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const sent = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      selector: { exact: string };
    };
    expect(sent.selector.exact).toBe("Call the plumber");
  });
});
