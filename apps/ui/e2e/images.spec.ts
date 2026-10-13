import type { MarkSeenResult, Thread, UnauthorizedError } from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-049, in a real browser: images that load wherever they appear, and a
 * full-screen viewer over them (SPEC.md §10, rider signed 2026-08-03).
 *
 * **Why the attachment route is guarded here.** `/attachments/*` sits behind
 * the workspace bearer token, and that guard *is* the bug: a browser sends no
 * `Authorization` header on an `<img src>`, so a reference the renderer left as
 * a bare relative source loaded nothing at all while the same reference at the
 * end of a turn — fetched through the kit — rendered fine. The route below
 * answers `401` to a request with no bearer, exactly as `headerAuth` does, so
 * this spec fails on the old rendering rather than passing on a stub that is
 * more forgiving than the server.
 *
 * Like the rest of the suite there is no workspace server behind the page (see
 * `stubCorpus.ts`); the corpus and the bytes are served from inside it, which
 * is what makes the rendering, the pointer events and the layering real while
 * the transport is not.
 */

/**
 * A flat 48×36 PNG. The size is load-bearing twice over: `naturalWidth` is how
 * these tests tell a decoded image from a broken one, and a 1×1 image renders
 * as a 1 px box whose centre rounds onto the paragraph behind it — a click on
 * it lands on the text, which is a fact about the fixture and not about the
 * feature.
 */
const PNG_WIDTH = 48;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAkCAYAAADPRbkKAAAAO0lEQVR42u3PQREAAAQAMOnEEUddMni622MBFlk9n4WAgICAgICAgICAgICAgICAgICAgICAgICAwM0CTI5tokZcjBoAAAAASUVORK5CYII=";

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { folder: "threads" },
};

const SHOT = "attachments/th_img/2026-08-03T09%3A00%3A00.000Z/shot.png";
const PLAN = "attachments/th_img/2026-08-03T09%3A00%3A00.000Z/plan.png";

/** A note whose body references an attachment **mid-prose** — the broken path. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Rate assumptions",
  path: "data/docs/inbox/rates.md",
  body: [
    "The chart below is the one the broker sent.",
    "",
    `Here it is: ![shot.png](${SHOT}) — note the tail.`,
    "",
    "And a remote one: ![remote](https://example.invalid/never.png)",
  ].join("\n"),
};

interface AttachmentTraffic {
  /** One entry per request: `<path> auth=<yes|no>`. */
  readonly seen: string[];
}

/**
 * `GET /attachments/*`, with the server's guard on it.
 *
 * The `**\/attachments/**` glob is anchored on the path segment for the reason
 * `reveal.spec.ts` documents for `/events`: Playwright matches globs against
 * the whole URL, and the dev server serves modules by path.
 */
async function stubAttachments(page: Page): Promise<AttachmentTraffic> {
  const seen: string[] = [];
  await page.route(/^https?:\/\/[^/]+\/attachments\//, async (route: Route) => {
    const request = route.request();
    const authorized = (await request.headerValue("authorization")) !== null;
    seen.push(`${new URL(request.url()).pathname} auth=${authorized ? "yes" : "no"}`);
    if (!authorized) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unauthorized",
          message: "missing bearer",
        } satisfies UnauthorizedError),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(PNG_BASE64, "base64"),
    });
  });
  return { seen };
}

/** A thread whose turn references the same attachment twice: mid-prose, and trailing. */
async function stubThread(page: Page): Promise<void> {
  await page.route("**/api/threads/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/seen")) {
      /*
       * `POST /api/threads/{id}/seen` answers a `MarkSeenResult`, not `{}` — the
       * shape it used to send here is one no server response has (UI-102).
       */
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          threadId: "th_img",
          lastSeenTs: "2026-08-03T09:00:00.000Z",
          unread: false,
        } satisfies MarkSeenResult),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "th_img",
        title: "The broker's chart",
        created: "2026-08-03T09:00:00.000Z",
        updated: "2026-08-03T09:00:00.000Z",
        status: "open",
        tags: [],
        parent: null,
        anchor: null,
        agent: "engaged",
        resident: null,
        // The server's answer to §10's interlock, published rather than derived
        // (CONTRACT-036).
        unread: false,
        digest: null,
        turns: [
          {
            author: "user",
            ts: "2026-08-03T09:00:00.000Z",
            body: [
              `Mid-sentence: ![shot.png](${SHOT}) and then some words.`,
              "",
              `![plan.png](${PLAN})`,
            ].join("\n"),
            model: null,
          },
        ],
      } satisfies Thread),
    });
  });
}

const THREAD_ROW: StubRow = {
  id: "th_img",
  type: "thread",
  title: "The broker's chart",
  path: "data/docs/threads/th_img.md",
};

/** Every rendered image, once its bytes have actually been decoded. */
async function loadedWidths(page: Page, selector: string): Promise<number[]> {
  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => (node instanceof HTMLImageElement ? node.naturalWidth : -1)),
  );
}

test.describe("an attachment referenced mid-prose", () => {
  /**
   * The regression this issue exists to pin. Before UI-049 the trailing
   * reference rendered and the mid-prose one — the *same file*, one line
   * earlier — was a silent blank.
   */
  test("loads in a turn, through the same authenticated path as the trailing one", async ({
    page,
  }) => {
    const traffic = await stubAttachments(page);
    await stubCorpus(page, [THREADS_VIEW, THREAD_ROW]);
    await stubThread(page);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_img"]').click();
    await expect(page.locator(".reader .thread-conversation .turn")).toBeVisible();

    // Deliberately every `<img>` in the turn, not only the ones this issue's
    // component draws: the pre-fix rendering also produced two elements — one
    // that loaded and one that did not — and the assertion has to be able to
    // see that.
    const images = page.locator(".reader .turn img");
    await expect(images).toHaveCount(2);
    await expect
      .poll(async () => loadedWidths(page, ".reader .turn img"))
      .toEqual([PNG_WIDTH, PNG_WIDTH]);

    // Both went through the kit's authenticated fetch, and neither was ever a
    // bare `<img src>` — a request with no bearer would show up here as `no`.
    // The *count* is deliberately not pinned: StrictMode mounts every effect
    // twice in dev, and how many times a cached blob is downloaded is not what
    // this issue is about.
    expect(traffic.seen.filter((entry) => entry.endsWith("auth=no"))).toEqual([]);
    expect(new Set(traffic.seen.map((entry) => entry.split(" ")[0]))).toEqual(
      new Set([`/${SHOT}`, `/${PLAN}`]),
    );
  });

  test("loads in a document body, and leaves a remote image alone", async ({ page }) => {
    const traffic = await stubAttachments(page);
    await stubCorpus(page, [VIEW, NOTE]);

    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    const attachment = page.locator('.reader img[alt="shot.png"]');
    await expect(attachment).toHaveCount(1);
    await expect
      .poll(async () => attachment.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(PNG_WIDTH);
    await expect(attachment).toHaveAttribute("src", /^blob:/);

    // Untouched: the source the author wrote, and no attachment fetch of its own.
    const remote = page.locator('.reader img[src="https://example.invalid/never.png"]');
    await expect(remote).toHaveCount(1);
    expect(new Set(traffic.seen.map((entry) => entry.split(" ")[0]))).toEqual(
      new Set([`/${SHOT}`]),
    );

    /*
     * The one unauthenticated request the editor still makes, asserted rather
     * than wished away. TipTap builds the ProseMirror DOM once before
     * `<EditorContent>` has published its portal host, and skips every React
     * node view on that pass (`ReactNodeViewRenderer` returns `{}` while
     * `editor.contentComponent` is null) — so the schema's own `renderHTML`
     * briefly puts the raw reference in the document. The same wart already
     * shows a `[[ref]]` as its bare anchor for a frame. What this issue is
     * about is where it *lands*: no raw-source image survives in the settled
     * document, and the picture on screen came through the bearer token.
     */
    await expect(page.locator('.reader img[src^="attachments/"]')).toHaveCount(0);
    expect(traffic.seen.filter((entry) => entry.endsWith("auth=yes"))).not.toEqual([]);
  });
});

test.describe("the full-screen viewer", () => {
  async function openThreadImage(page: Page): Promise<void> {
    await stubAttachments(page);
    await stubCorpus(page, [THREADS_VIEW, THREAD_ROW]);
    await stubThread(page);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_img"]').click();
    await expect(page.locator(".reader .thread-conversation .turn")).toBeVisible();
    await expect
      .poll(async () => loadedWidths(page, ".reader .turn img"))
      .toEqual([PNG_WIDTH, PNG_WIDTH]);
  }

  test("opens on click, above every other layer, and closes on esc back to the image", async ({
    page,
  }) => {
    await openThreadImage(page);
    const image = page.locator(`.reader .turn img.md-img[data-att-target="${SHOT}"]`);
    await image.click();

    const viewer = page.locator(".overlay.image-viewer");
    await expect(viewer).toBeVisible();
    // The picture in the viewer is the same bytes, uncapped by the thread's
    // 240×180 preview box.
    const shown = viewer.locator(".image-viewer-img");
    await expect(shown).toHaveAttribute("src", /^blob:/);
    expect(await viewer.evaluate((node) => Number(getComputedStyle(node).zIndex))).toBeGreaterThan(
      60,
    );

    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(image).toBeFocused();
  });

  /** SPEC.md §10: the image is keyboard-reachable and `↵` opens it. */
  test("opens from the keyboard", async ({ page }) => {
    await openThreadImage(page);
    const image = page.locator(`.reader .turn img.md-img[data-att-target="${SHOT}"]`);
    await image.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".overlay.image-viewer")).toBeVisible();
  });

  /**
   * The layering criterion: focus mode stays mounted behind the viewer, and
   * the first `esc` belongs to the picture.
   */
  test("takes escape precedence over focus mode", async ({ page }) => {
    await stubAttachments(page);
    await stubCorpus(page, [VIEW, NOTE]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    const focus = page.locator(".focus.open");
    await expect(focus).toBeVisible();

    const image = page.locator(`.focus img.md-img[data-att-target="${SHOT}"]`);
    await expect
      .poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(PNG_WIDTH);
    await image.click();
    await expect(page.locator(".overlay.image-viewer")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".overlay.image-viewer")).toHaveCount(0);
    // Focus mode is still there — one press closed one layer.
    await expect(focus).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(focus).toHaveCount(0);
  });
});

/**
 * UI-202: a note whose picture sits on a paragraph of its own, between two of
 * prose — the shape the data loss was found on.
 */
const FRAMED: StubRow = {
  id: "doc_framed",
  title: "Framed picture",
  path: "data/docs/inbox/framed.md",
  body: ["Before", "", `![shot.png](${SHOT})`, "", "After"].join("\n"),
};

/**
 * UI-202, a P0 data loss. Clicking a picture in a document body opened the
 * viewer **and** let ProseMirror put a `NodeSelection` on the image. Closing the
 * viewer left that selection behind, invisible, and the next keystroke replaced
 * the image. These tests pin the person's text, not the mechanism: whatever is
 * typed after the viewer closes, the picture is still in the document.
 */
test.describe("closing the viewer from a document body (UI-202)", () => {
  /** Opens the note, opens its picture full screen, and closes it with esc. */
  async function openAndCloseTheViewer(page: Page): Promise<void> {
    await stubAttachments(page);
    await stubCorpus(page, [VIEW, FRAMED]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_framed"]').click();
    const editor = page.locator(".reader .ProseMirror");
    await expect(editor).toBeVisible();
    // `img.md-img`, never a bare `img`: prosemirror-view draws hidden
    // `img.ProseMirror-separator` hack nodes around an inline atom (UI-201).
    const image = editor.locator("img.md-img");
    await expect
      .poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(PNG_WIDTH);

    await image.click();
    await expect(page.locator(".overlay.image-viewer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".overlay.image-viewer")).toHaveCount(0);
    // SPEC.md §10: focus goes back to the image. That part was never wrong.
    await expect(image).toBeFocused();
    // Nothing selected the picture behind the person's back. Before the fix the
    // press that opened the viewer had also made the image the editor's
    // selection, and it was still selected here.
    await expect(editor.locator(".ProseMirror-selectednode")).toHaveCount(0);
  }

  /** The editor's paragraphs as text, with the picture spelled out where it sits. */
  async function paragraphs(page: Page): Promise<string[]> {
    return page.$$eval(".reader .ProseMirror p", (nodes) =>
      nodes.map(
        (node) => (node.querySelector("img.md-img") === null ? "" : "[image]") + node.textContent,
      ),
    );
  }

  test("a click in another paragraph takes the caret, and the next keystroke lands there", async ({
    page,
  }) => {
    await openAndCloseTheViewer(page);
    const editor = page.locator(".reader .ProseMirror");
    // No pause between the click and the key, on purpose. Before the fix the
    // editor learnt of the click only from the browser's asynchronous
    // `selectionchange`, and a key pressed inside that window replaced the
    // picture although the caret was already drawn in "After".
    await editor.locator("p", { hasText: "After" }).click();
    await page.keyboard.type("Z");

    await expect.poll(async () => paragraphs(page)).toEqual(["Before", "[image]", "AfterZ"]);
    await expect(editor.locator("img.md-img")).toHaveCount(1);
  });

  /**
   * The same loss without the click: focus is on the picture after esc, and a
   * key typed there went to the selection the viewer had left on it.
   */
  test("a keystroke straight after esc does not replace the picture", async ({ page }) => {
    await openAndCloseTheViewer(page);
    await page.keyboard.type("Z");

    await expect(page.locator(".reader .ProseMirror img.md-img")).toHaveCount(1);
    // Where a key typed on a focused picture goes is not this issue's to
    // decide; that it does not go *over* the picture is.
    const after = await paragraphs(page);
    expect(after.map((text) => text.replace("Z", ""))).toEqual(["Before", "[image]", "After"]);
  });
});
