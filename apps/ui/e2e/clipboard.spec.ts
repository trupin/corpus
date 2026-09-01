import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarkSeenResult, Thread } from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-042's clipboard rider (SPEC.md §10), in a real browser with a real system
 * clipboard.
 *
 * This one is not a stylesheet suite. Copying is a browser act with an
 * observable result — two flavors on the clipboard, read back through
 * `navigator.clipboard.read()` with `clipboard-read` granted — and pasting is
 * the same act in reverse: real HTML written to the real clipboard, a real ⌘V,
 * and the markdown the editor autosaves read back off the wire. Nothing here is
 * dispatched as a synthetic event.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real ProseMirror, real clipboard. The disk-and-git half stays in the issue's
 * real-app log, as sprint-016 Adjudication 19 requires.
 */

const GOOGLE_DOCS_HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/editor/fixtures/google-docs-paste.html"),
  "utf8",
);

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** The user's repro shape: a heading, emphasis, both list kinds, and a ref. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Quarterly memo",
  body: [
    "# Quarterly memo",
    "",
    "Lead paragraph with **bold** and *italic* and `code`.",
    "",
    "## Findings",
    "",
    "- first bullet",
    "- second **bold** bullet",
    "",
    "1. one",
    "2. two",
    "",
    "- [ ] open task",
    "- [x] done task",
    "",
    "See [the site](https://example.com) and [[doc_other]].",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
  ].join("\n"),
};

const OTHER: StubRow = {
  id: "doc_other",
  title: "Lender spreads",
  path: "data/docs/inbox/doc_other.md",
  body: "Other note.\n",
};

/** A second column, so a thread has a list of its own to be opened from. */
const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 2,
  query: { type: "thread" },
};

/** A rendered — not editable — document body: the menu's fallback path. */
const THREAD: StubRow = {
  id: "th_rates",
  type: "thread",
  title: 'Re: "lender spreads"',
  path: "data/docs/threads/th_rates.md",
  parent: "doc_note",
  body: ["## Which lenders?", "", "The **three** we track:", "", "- Acme", "- Beta", ""].join("\n"),
};

/**
 * `GET /api/threads/{id}` and the seen POST the card fires on open — the one
 * route `stubCorpus` does not serve, as `fences.spec.ts` documents.
 */
async function stubThreadTurns(page: Page): Promise<void> {
  await page.route("**/api/threads/**", async (route: Route) => {
    if (new URL(route.request().url()).pathname.endsWith("/seen")) {
      /*
       * `POST /api/threads/{id}/seen` answers a `MarkSeenResult`, not `{}` — the
       * shape it used to send here is one no server response has (UI-102).
       */
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          threadId: THREAD.id,
          lastSeenTs: "2026-07-01T09:05:00.000Z",
          unread: false,
        } satisfies MarkSeenResult),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: THREAD.id,
        title: THREAD.title ?? "Untitled",
        created: "2026-07-01T09:00:00.000Z",
        updated: "2026-07-01T09:05:00.000Z",
        status: "open",
        tags: [],
        parent: THREAD.parent ?? null,
        anchor: null,
        // `none`, never `null`: `Thread.agent` is the three-state SPEC.md §8
        // vocabulary and has no absent value (UI-102).
        agent: "none",
        resident: null,
        // The server's answer to §10's interlock, published rather than derived
        // (CONTRACT-036).
        unread: false,
        turns: [
          {
            author: "user",
            ts: "2026-07-01T09:05:00.000Z",
            body: THREAD.body ?? "",
            // Required since CONTRACT-043, and `null` is its answer for a turn
            // nobody recorded a model for — not an omitted field.
            model: null,
          },
        ],
      } satisfies Thread),
    });
  });
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE, OTHER]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  // The ref's title comes out of the query cache, so wait for the node view to
  // have shown it — that is the same fact the clipboard reads.
  await expect(page.locator(".reader .ProseMirror .ref")).toHaveText("Lender spreads");
  return corpus;
}

interface Flavors {
  readonly types: readonly string[];
  readonly html: string;
  readonly text: string;
}

/** Selects the whole body, copies it, and reads both flavors back. */
async function copyWholeBody(page: Page): Promise<Flavors> {
  await page.locator(".reader .ProseMirror").click();
  // `click()` resolves when the mouse events land, which is not when the target
  // has taken focus. A key inside that gap reaches the page instead of the
  // editor: an unfocused `Ctrl/Cmd+A` selects the whole document rather than the
  // body, and the copy or paste that follows works on the wrong scope — a
  // plausible-looking wrong result, not an error. Waiting on the condition, not
  // on a duration (UI-080; the pattern is `soft-wrap.spec.ts`'s `caretIn`).
  await expect(page.locator(".reader .ProseMirror")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const types = items.flatMap((item) => item.types);
    const read = async (type: string): Promise<string> => {
      const item = items.find((candidate) => candidate.types.includes(type));
      return item === undefined ? "" : (await item.getType(type)).text();
    };
    return { types, html: await read("text/html"), text: await read("text/plain") };
  });
}

test.describe("copying out of the document view", () => {
  test("puts both flavors on the clipboard", async ({ page }) => {
    await openNote(page);
    const flavors = await copyWholeBody(page);
    expect(flavors.types).toContain("text/html");
    expect(flavors.types).toContain("text/plain");
  });

  test("the rich flavor carries the structure an external editor needs", async ({ page }) => {
    await openNote(page);
    const { html } = await copyWholeBody(page);
    expect(html).toContain("<h1");
    expect(html).toContain("<h2>Findings</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("<pre>");
  });

  test("the plain flavor is the document's markdown, not a stripped dump", async ({ page }) => {
    await openNote(page);
    const { text } = await copyWholeBody(page);
    expect(text).toContain("# Quarterly memo");
    expect(text).toContain("## Findings");
    expect(text).toContain("Lead paragraph with **bold** and *italic* and `code`.");
    expect(text).toContain("- first bullet");
    expect(text).toContain("- second **bold** bullet");
    expect(text).toContain("1. one");
    expect(text).toContain("- [ ] open task");
    expect(text).toContain("- [x] done task");
    expect(text).toContain("[the site](https://example.com)");
    expect(text).toContain("```ts");
    // The reproduction's signature — `textBetween`'s runs of blank lines.
    expect(text).not.toMatch(/\n{3}/);
  });

  test("a [[ref]] leaves as its title, with no doc id and no link to nowhere", async ({ page }) => {
    await openNote(page);
    const { html, text } = await copyWholeBody(page);
    expect(html).toContain(">Lender spreads<");
    expect(html).not.toContain("about:blank");
    expect(html).not.toContain(">doc_other<");
    // The bracket form still travels, so a paste back into Corpus is the same
    // reference — but what a reader sees is the title.
    expect(text).toContain("[[doc_other|Lender spreads]]");
  });
});

/**
 * Parked on the clipboard before a menu copy, so the read can tell "the write
 * has not landed yet" from "the write put this there". The menu's Copy is
 * deliberately fire-and-forget — the menu closes in the same tick and the
 * outcome arrives as a notice — so the menu being gone proves nothing about the
 * clipboard.
 */
const SENTINEL = "ui042-clipboard-not-written-yet";

/** Reads both flavors off the real clipboard, whatever put them there. */
async function readClipboard(page: Page): Promise<Flavors> {
  return page.evaluate(async () => {
    const readOnce = async (): Promise<{
      types: string[];
      html: string;
      text: string;
    }> => {
      const items = await navigator.clipboard.read();
      const types = items.flatMap((item) => item.types);
      const read = async (type: string): Promise<string> => {
        const item = items.find((candidate) => candidate.types.includes(type));
        return item === undefined ? "" : (await item.getType(type)).text();
      };
      return { types, html: await read("text/html"), text: await read("text/plain") };
    };
    try {
      return await readOnce();
    } catch {
      // `InvalidStateError: Clipboard data has changed` — a write landed
      // between listing the items and reading one of them. Read the new state.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return readOnce();
    }
  });
}

/**
 * A real DOM selection over an element's contents.
 *
 * `⌘A` is not usable on a rendered (non-editable) surface: it selects the whole
 * page, whose common ancestor is not a document body, and the §10 selection
 * menu correctly declines. This is the range a drag would leave.
 */
async function selectContents(page: Page, selector: string): Promise<void> {
  await page.evaluate((target) => {
    const node = document.querySelector(target);
    if (node === null) throw new Error(`no ${target}`);
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, selector);
}

/** Parks the sentinel, then waits until the app has replaced it. */
async function clipboardAfterCopy(page: Page): Promise<Flavors> {
  const settled = async (): Promise<string> => {
    try {
      return (await readClipboard(page)).text;
    } catch {
      return SENTINEL;
    }
  };
  await expect.poll(settled, { timeout: 10_000 }).not.toBe(SENTINEL);
  return readClipboard(page);
}

async function parkSentinel(page: Page): Promise<void> {
  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
  }, SENTINEL);
}

/** Runs the §10 right-click menu's Copy over a whole editable body. */
async function copyViaContextMenu(page: Page, within: string): Promise<Flavors> {
  // On prose, never on the task list's checkbox, for either click: clicking a
  // form control inside the body toggles it and moves the selection, and
  // right-clicking one collapses the selection before the menu is asked.
  const prose = page.locator(`${within} .doc-body h1`).first();
  await prose.click();
  // The click target and the focus target differ — the `h1` is inside the
  // editor, and focus lands on the editor root — so the wait is on the root, as
  // `soft-wrap.spec.ts`'s `caretIn` does it (UI-080).
  await expect(page.locator(`${within} .ProseMirror`)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await parkSentinel(page);
  await prose.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions for the selection" });
  await menu.waitFor();
  await menu.locator('[data-act="copy"]').click();
  await expect(menu).toHaveCount(0);
  return clipboardAfterCopy(page);
}

/**
 * The user's reported path (UI-042 follow-up): right-click → Copy. It used to
 * put a single `text/plain` flavor on the clipboard — no `text/html` at all —
 * which is what "Google Docs loses ALL formatting" actually was.
 */
test.describe("copying through the right-click menu", () => {
  test("puts the same two flavors on the clipboard that ⌘C does", async ({ page }) => {
    await openNote(page);
    const keyboard = await copyWholeBody(page);
    // A fresh load rather than a second gesture on the same page: ⌘C leaves the
    // floating selection toolbar over the words the right-click has to land on.
    // The document is the same document, which is what the comparison is about.
    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator(".reader .ProseMirror .ref")).toHaveText("Lender spreads");
    const menu = await copyViaContextMenu(page, ".reader");

    expect(menu.types).toContain("text/html");
    expect(menu.types).toContain("text/plain");
    expect(menu.html).toBe(keyboard.html);
    expect(menu.text).toBe(keyboard.text);
  });

  test("carries the structure and the markdown, not a stripped dump", async ({ page }) => {
    await openNote(page);
    const { html, text } = await copyViaContextMenu(page, ".reader");

    expect(html).toContain("<h2>Findings</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain(">Lender spreads<");
    expect(text).toContain("# Quarterly memo");
    expect(text).toContain("- second **bold** bullet");
    expect(text).toContain("[[doc_other|Lender spreads]]");
  });

  /**
   * A thread's conversation is rendered markdown, not a ProseMirror document —
   * there is no slice to serialize, so the rich flavor is the rendered markup
   * itself and the plain one stays the selection's text.
   */
  test("still carries rich text where the body is rendered, not editable", async ({ page }) => {
    await stubCorpus(page, [VIEW, THREADS_VIEW, NOTE, OTHER, THREAD]);
    await stubThreadTurns(page);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_rates"]').click();
    await expect(page.locator(".reader .thread-conversation .turn")).toBeVisible();

    const turn = page.locator(".reader .turn-body .doc-body").first();
    await turn.waitFor();
    await selectContents(page, ".reader .turn-body .doc-body");
    await parkSentinel(page);
    await turn.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for the selection" });
    await menu.waitFor();
    // No editor here, so no Cut and no Paste — that is what "rendered, not
    // editable" costs the menu. Comment is offered beside Copy because this
    // selection now anchors: it spans a heading, a paragraph and a list, and
    // until UI-060 the trace and the renderer disagreed about the whitespace
    // between them, so `captureTurnAnchor` declined and the count here was 1.
    expect(
      await menu
        .getByRole("menuitem")
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"])),
    ).toEqual(["comment", "copy"]);
    await menu.locator('[data-act="copy"]').click();
    await expect(menu).toHaveCount(0);

    const { types, html, text } = await clipboardAfterCopy(page);
    expect(types).toContain("text/html");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>three</strong>");
    expect(html).toContain("<li");
    expect(text).toContain("Which lenders?");
  });
});

/** Writes real HTML to the real clipboard, then pastes it with the keyboard. */
async function pasteHtml(page: Page, html: string, plain: string): Promise<void> {
  await page.evaluate(
    async ([richText, plainText]) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([richText], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    },
    [html, plain] as const,
  );
  await page.locator(".reader .ProseMirror").click();
  // `click()` resolves when the mouse events land, which is not when the target
  // has taken focus. A key inside that gap reaches the page instead of the
  // editor: an unfocused `Ctrl/Cmd+A` selects the whole document rather than the
  // body, and the copy or paste that follows works on the wrong scope — a
  // plausible-looking wrong result, not an error. Waiting on the condition, not
  // on a duration (UI-080; the pattern is `soft-wrap.spec.ts`'s `caretIn`).
  await expect(page.locator(".reader .ProseMirror")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
}

/** The body the editor autosaved, once a `PUT` has landed. */
async function savedBody(corpus: StubCorpus): Promise<string> {
  await expect
    .poll(async () => (await corpus.of("PUT", "/api/docs/doc_note")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  return (await corpus.doc("doc_note"))?.body ?? "";
}

test.describe("pasting rich text into the document view", () => {
  test("a Google Docs selection becomes clean markdown", async ({ page }) => {
    const corpus = await openNote(page);
    await pasteHtml(page, GOOGLE_DOCS_HTML, "Quarterly memo Findings first bullet");

    const body = await savedBody(corpus);
    expect(body).toContain("# Quarterly memo");
    expect(body).toContain("## Findings");
    expect(body).toContain("**bold**");
    expect(body).toContain("*italic*");
    expect(body).toContain("- first bullet");
    expect(body).toContain("1. step one");
    expect(body).toContain("[the rates page](https://example.com/rates)");
  });

  test("no HTML and no Google redirect reaches the saved file", async ({ page }) => {
    const corpus = await openNote(page);
    await pasteHtml(page, GOOGLE_DOCS_HTML, "Quarterly memo");

    const body = await savedBody(corpus);
    // The paste landed — without this the exclusions below pass on any body.
    expect(body).toContain("1. step one");
    expect(body).not.toContain("<span");
    expect(body).not.toContain("style=");
    expect(body).not.toContain("docs-internal-guid");
    expect(body).not.toContain("google.com/url");
    // The stray block-level `<br>`s Docs emits, which used to land as `\` lines.
    expect(body).not.toMatch(/^\\$/m);
  });

  /**
   * The shape every mail client and chat app writes (PR #19 review, MAJOR): a
   * `<div>` with `<br>` between its lines. The Docs repair used to strip any
   * `<br>` whose nearest ancestor was not one of a hand-listed set of block
   * hosts — `div` was not among them — so this paste saved as `line oneline
   * two`, one word-run, with the separator silently gone.
   */
  test("a Gmail-shaped div-and-br paste keeps its lines apart", async ({ page }) => {
    const corpus = await openNote(page);
    await pasteHtml(
      page,
      "<div>Lender called back<br>Rate held at 6.1%</div>",
      "Lender called back\nRate held at 6.1%",
    );

    const body = await savedBody(corpus);
    expect(body).toContain("Lender called back");
    expect(body).toContain("Rate held at 6.1%");
    expect(body).not.toContain("Lender called backRate held at 6.1%");
  });

  test("a plain-markdown paste still parses as markdown", async ({ page }) => {
    const corpus = await openNote(page);
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("## Pasted heading\n\n- pasted bullet\n");
    });
    await page.locator(".reader .ProseMirror").click();
    // The caret has to be in the body before `Ctrl/Cmd+A` (UI-080).
    await expect(page.locator(".reader .ProseMirror")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+v");

    const body = await savedBody(corpus);
    expect(body).toContain("## Pasted heading");
    expect(body).toContain("- pasted bullet");
  });
});

/**
 * The other half of the same gesture (PR #19 review). The menu's Paste was
 * `readText`, which carries one flavor, while ⌘V two keystrokes away pastes the
 * rich one through the schema — UI-042's Copy defect pointing inwards.
 */
test.describe("pasting through the right-click menu", () => {
  test("brings the clipboard's rich flavor in, the way ⌘V does", async ({ page }) => {
    const corpus = await openNote(page);
    await page.evaluate(async () => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob(["<h2>Pasted findings</h2><ul><li>first pasted bullet</li></ul>"], {
            type: "text/html",
          }),
          "text/plain": new Blob(["Pasted findings first pasted bullet"], { type: "text/plain" }),
        }),
      ]);
    });

    const prose = page.locator(".reader .doc-body h1").first();
    await prose.click();
    // Clicked on the `h1`, focused on the editor root (UI-080).
    await expect(page.locator(".reader .ProseMirror")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await prose.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Actions for the selection" });
    await menu.waitFor();
    await menu.locator('[data-act="paste"]').click();
    await expect(menu).toHaveCount(0);

    const body = await savedBody(corpus);
    // Structure, not the flattened sentence the plain flavor holds.
    expect(body).toContain("## Pasted findings");
    expect(body).toContain("- first pasted bullet");
    expect(body).not.toContain("Pasted findings first pasted bullet");
  });
});

test.describe("round-tripping through the clipboard", () => {
  test("copying a Corpus body and pasting it back keeps the reference", async ({ page }) => {
    const corpus = await openNote(page);
    const { html, text } = await copyWholeBody(page);
    await pasteHtml(page, html, text);

    const body = await savedBody(corpus);
    // The title travelled as the visible text; the id travelled in the markup,
    // so the reference is still a reference.
    expect(body).toContain("[[doc_other");
    expect(body).toContain("# Quarterly memo");
    expect(body).toContain("- [x] done task");
  });
});
