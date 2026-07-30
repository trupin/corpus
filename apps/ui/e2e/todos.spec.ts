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

/** Every checkbox the editor drew for the task list, in body order. */
function boxes(page: Page): Locator {
  return page.locator('.reader .ProseMirror li input[type="checkbox"]');
}

/** Opens the todo document in its column reader. */
async function openTodo(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${TODO.id}"]`).click();
  await page.locator(".reader .ProseMirror").waitFor();
}

/**
 * Drags across exactly one item's own text node — a real selection over real
 * glyphs, which is what `selectorFromSelection` maps through the serializer's
 * emission trace. Selecting with the keyboard would run past the list item.
 */
async function selectItemText(page: Page, text: string): Promise<void> {
  const rect = await page.evaluate((needle) => {
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
  expect(rect, `no text node reads exactly “${text}”`).not.toBeNull();
  const found = rect as { x: number; y: number; width: number; height: number };
  const y = found.y + found.height / 2;
  await page.mouse.move(found.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(found.x + found.width / 2, y);
  await page.mouse.move(found.x + found.width - 1, y);
  await page.mouse.up();
}

test.describe("a todo document in the core editor", () => {
  test("renders its items as task-list checkboxes, not as a plugin surface", async ({ page }) => {
    await stubCorpus(page, [VIEW, TODO]);
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
    await stubCorpus(page, [VIEW, TODO]);
    await openTodo(page);

    // Dropping the renderer must not take the panel with it: `docTypes` is
    // still proved by `ListItem` + `DocPanel` + `validate` (SHARED-005 A3).
    const panel = page.locator(`[data-todo-panel="${TODO.id}"]`);
    await expect(panel).toHaveCount(1);
    await expect(panel.locator("[data-stat-open]")).toHaveText("2");
    await expect(panel.locator("[data-stat-done]")).toHaveText("1");
    await expect(panel).toContainText("plugin: todos");
  });

  test("toggles a checkbox as an ordinary body edit, through no plugin route", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await openTodo(page);

    await boxes(page).first().click();
    await expect
      .poll(async () => (await corpus.of("PUT", `/api/docs/${TODO.id}`)).length)
      .toBeGreaterThan(0);

    const writes = await corpus.of("PUT", `/api/docs/${TODO.id}`);
    const saved = (writes.at(-1)?.body as { body?: string } | undefined)?.body ?? "";
    // One character changed; everything the editor did not touch came back.
    expect(saved).toBe(TODO_BODY.replace("- [ ] Book", "- [x] Book"));

    // The signed clause (SPEC.md §12): in the UI a toggle is a core body edit
    // saved like any other. The plugin's routes stay the CLI/agent path.
    const plugin = (await corpus.requests()).filter((entry) =>
      entry.path.startsWith("/api/x/todos"),
    );
    expect(plugin).toEqual([]);
  });
});

test.describe("commenting on one item", () => {
  /** The shape `POST /api/threads` answers with, so the page can settle. */
  async function stubThreads(page: Page): Promise<{ readonly sent: unknown[] }> {
    const sent: unknown[] = [];
    await page.route("**/api/threads", async (route) => {
      const raw = route.request().postData();
      sent.push(raw === null ? null : (JSON.parse(raw) as unknown));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          thread: {
            id: "th_new",
            title: 'Re: "Call the plumber"',
            created: "2026-07-01T09:00:00.000Z",
            updated: "2026-07-01T09:00:00.000Z",
            status: "open",
            tags: [],
            parent: TODO.id,
            anchor: "anc_new",
            agent: "requested",
            turns: [
              { author: "user", ts: "2026-07-01T09:00:00.000Z", body: "Which office is this?" },
            ],
          },
          anchorId: "anc_new",
          warnings: [],
        }),
      });
    });
    return { sent };
  }

  test("quotes exactly the item's text, and sends an ordinary text-quote selector", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW, TODO]);
    const threads = await stubThreads(page);
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

    await expect.poll(() => threads.sent.length).toBe(1);
    const sent = threads.sent[0] as {
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
    await stubCorpus(page, [VIEW, TODO]);
    await stubThreads(page);
    await openTodo(page);

    await selectItemText(page, "Call the plumber");
    await page.locator("[data-sel-comment]").click();
    await page.locator("[data-comment-pop] .cm-input").fill("Which office is this?");
    await page.locator("[data-comment-send]").click();

    // `anchorsHost` is true for `todo` the moment no plugin View is registered,
    // so the decoration lands with no new machinery anywhere.
    const highlight = page.locator(".reader .anchor-hl");
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("Call the plumber");
  });
});
