import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-073 — what a reader does while plugin discovery is still in flight.
 *
 * Discovery is a dynamic `import()` kicked off at bootstrap (`main.tsx`), and
 * the `DocPanel` it can register renders **above** the document body. Before
 * this issue the body painted first and the panel dropped everything below it
 * by its own height — 77.9px in the todos fixture — which is a defect and not
 * only a test hazard: the reader is where text is selected to comment, and a
 * body that moves between mousedown and mouseup silently produces a *valid*
 * selection over words nobody chose (UI-071 drove exactly that, and the wrong
 * words travelled into a comment quote and a highlight).
 *
 * **The race is not raced.** Every test below holds the plugin manifest modules
 * at the route level until it chooses to release them, so "discovery settles
 * late" is a fact of the run rather than a hope. `hits()` counts the requests
 * it intercepted and every test asserts the count, because a route pattern that
 * silently matched nothing would turn each of these into a false pass.
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

/** The word span every drag below aims at — UI-071's own target. */
const TARGET = "Call the plumber";

const TODO = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: [
    "Chores that landed in the inbox.",
    "",
    "- [ ] Book the passport appointment (due: 2026-08-01)",
    `- [ ] ${TARGET}`,
    "- [x] Send the signed form",
    "",
  ].join("\n"),
};

/** A document type the `_fixture` plugin owns with a `View` — the body-swap case. */
const FIXTURE_DOC = {
  id: "doc_fixture",
  type: "fixture-note",
  title: "A fixture note",
  path: "data/docs/inbox/a-fixture-note.md",
  body: "Prose the fixture plugin renders.",
};

/** A core note: nothing registers anything for it, and nothing may cost it space. */
const NOTE = {
  id: "doc_note",
  type: "note",
  title: "An ordinary note",
  path: "data/docs/inbox/an-ordinary-note.md",
  body: "A paragraph no plugin has an opinion about.",
};

interface HeldDiscovery {
  /** Lets every held manifest request through; safe to call more than once. */
  readonly release: () => void;
  /** How many manifest module requests were actually intercepted. */
  readonly hits: () => number;
}

/**
 * Holds every plugin manifest module in flight until released.
 *
 * The glob in `plugins/registry.ts` imports `plugins/<dir>/manifest.ts`, which
 * Vite serves from outside the UI's root — so the browser asks for it under
 * `/@fs/…/plugins/<dir>/manifest.ts`, sometimes with a `?v=`/`?t=` suffix. The
 * pattern below is written to survive either form; `hits` is what proves it did.
 * Holding the manifest holds everything it imports, which is the whole plugin.
 */
async function holdDiscovery(page: Page): Promise<HeldDiscovery> {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let hits = 0;
  await page.route("**/plugins/**/manifest.ts*", async (route) => {
    hits += 1;
    await gate;
    await route.continue();
  });
  return {
    release: () => {
      open();
    },
    hits: () => hits,
  };
}

/** The todos plugin's own aggregate, answered so a todo row never renders degraded. */
async function stubTodosAggregate(page: Page): Promise<void> {
  await page.route("**/api/x/todos/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lists: [] }),
    });
  });
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
    const root = document.querySelector(".reader .doc-main");
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

/** Opens a document in its column reader and waits only for the reader shell. */
async function openDoc(page: Page, docId: string): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await page.locator(`.reader[data-reader-doc="${docId}"]`).waitFor();
}

test.describe("a plugin arriving after the reader opened", () => {
  /**
   * The measurement UI-073 was filed on, turned into an assertion.
   *
   * The failure message carries the shift in pixels, so a regression reports
   * the defect's own magnitude rather than "expected 1 to be 0".
   */
  test("never paints the document body before discovery settles", async ({ page }) => {
    const held = await holdDiscovery(page);
    await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page);
    await openDoc(page, TODO.id);

    // The reader is open and its document has arrived; only discovery has not.
    // Both observations are taken before anything is asserted, so a failure
    // reports the shift in pixels rather than the first tripwire it hit.
    const waiting = await page.locator(".reader .reader-note").count();
    const early = await boxOfText(page, TARGET);

    held.release();
    await page.locator("[data-todo-panel]").waitFor();
    const settled = await boxOfText(page, TARGET);

    expect(
      held.hits(),
      "no manifest request was intercepted — the race was never held",
    ).toBeGreaterThan(0);
    expect(settled, "the panel never arrived, so nothing was proven").not.toBeNull();
    expect(
      early === null || settled === null
        ? null
        : { earlyY: early.y, settledY: settled.y, shiftPx: settled.y - early.y },
      "the body painted before discovery settled, so the panel that arrived moved it",
    ).toBeNull();
    expect(waiting, "the reader said nothing while it waited").toBe(1);
  });

  /**
   * The panel and the body land in the same commit — the positive half of the
   * test above, which on its own would also pass if the panel never rendered.
   */
  test("shows the panel in the first frame that has a body", async ({ page }) => {
    const held = await holdDiscovery(page);
    await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page);
    await openDoc(page, TODO.id);
    held.release();

    await page.locator(".reader .ProseMirror").waitFor();
    expect(await page.locator("[data-todo-panel]").count()).toBe(1);
    expect(held.hits()).toBeGreaterThan(0);
  });

  /**
   * UI-071's drag, driven straight through the arrival.
   *
   * The mousedown happens at the **earliest** moment the target is addressable
   * at all, discovery is released while the button is down, and the mouseup
   * follows. After the fix the earliest such moment is already past discovery,
   * so the release is a no-op and the drag selects what it aimed at; before it,
   * the same script pressed at y=306.7, released at y=317.2 and selected
   * `ores that landed ` — seventeen characters of the first paragraph.
   *
   * There is exactly one attempt on purpose. Re-measuring after a shift is what
   * makes a drag *recoverable*; it is not what makes it correct.
   */
  test("selects the words a drag aimed at, across the arrival", async ({ page }) => {
    const held = await holdDiscovery(page);
    await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page);
    await openDoc(page, TODO.id);

    let target = await boxOfText(page, TARGET);
    if (target === null) {
      // The fixed behaviour: nothing is on screen to aim at yet.
      held.release();
      await page.locator("[data-todo-panel]").waitFor();
      target = await boxOfText(page, TARGET);
    }
    expect(target, `no text node reads exactly “${TARGET}”`).not.toBeNull();
    if (target === null) return;

    const y = target.y + target.height / 2;
    await page.mouse.move(target.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, y);
    held.release();
    await page.locator("[data-todo-panel]").waitFor();
    await page.mouse.move(target.x + target.width - 1, y);
    await page.mouse.up();

    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selected, `the drag meant for “${TARGET}” landed on other words`).toBe(TARGET);
    expect(held.hits()).toBeGreaterThan(0);
  });

  /**
   * A plugin `View` is the same defect with a bigger jump: it replaces the body
   * wholesale, so a late arrival swaps the core editor out for a differently
   * sized surface. Nothing may paint in the meantime — not the editor it is
   * about to replace, and not the view itself.
   */
  test("does not paint the core editor under a document a plugin View owns", async ({ page }) => {
    const held = await holdDiscovery(page);
    await stubCorpus(page, [VIEW, FIXTURE_DOC]);
    await openDoc(page, FIXTURE_DOC.id);

    await expect(page.locator(".reader .reader-note")).toHaveText("Loading…");
    expect(await page.locator(".reader [data-doc-editor]").count()).toBe(0);
    expect(await page.locator("[data-fixture-view]").count()).toBe(0);

    held.release();
    await page.locator(`[data-fixture-view="${FIXTURE_DOC.id}"]`).waitFor();
    expect(await page.locator(".reader [data-doc-editor]").count()).toBe(0);
    expect(held.hits()).toBeGreaterThan(0);
  });

  /**
   * The non-negotiable: a document no plugin claims must look exactly as it did.
   * Reserving the slot's height would have satisfied every test above and failed
   * this one, on every reader in the workspace, forever.
   */
  test("costs a document with no panel nothing at all", async ({ page }) => {
    await stubCorpus(page, [VIEW, NOTE]);
    await openDoc(page, NOTE.id);
    await page.locator(".reader .ProseMirror").waitFor();

    const shape = await page.evaluate(() => {
      const main = document.querySelector(".reader .doc-main");
      if (main === null) return null;
      const editor = main.querySelector("[data-doc-editor]");
      const previous = editor?.previousElementSibling ?? null;
      return {
        panels: main.querySelectorAll(".doc-panel, [data-doc-panel-slot]").length,
        // The editor's own previous sibling: the frontmatter form's title, and
        // nothing wedged between the two holding a place for a panel.
        precededBy: previous === null ? null : previous.className,
      };
    });

    expect(shape).not.toBeNull();
    expect(shape?.panels).toBe(0);
    expect(shape?.precededBy).toContain("title-grow");
  });
});
