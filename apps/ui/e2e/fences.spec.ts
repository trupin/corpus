import type { MarkSeenResult, Thread } from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-041's copyable canvases (SPEC.md §10, rider signed 2026-08-02), in a real
 * browser with a real clipboard.
 *
 * The whole point of the feature is the **bytes on the clipboard**, and that is
 * a fact only a browser holds: jsdom's clipboard is whatever the test stubbed.
 * So this spec reads the copied text back out of `navigator.clipboard` after a
 * real click on a real button, over a real agent turn rendered by the real
 * `MarkdownView`.
 *
 * Like the rest of the suite there is no workspace server behind the page (see
 * `stubCorpus.ts`); the thread's turns are served from inside the page, which is
 * what makes the *rendering* real while the transport is not.
 */

const THREADS_VIEW = {
  id: "doc_view_threads",
  type: "view",
  title: "Threads",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { folder: "threads" },
};

const THREAD_DOC = {
  id: "th_fence",
  type: "thread",
  title: "Prompt for the drafting agent",
  path: "data/docs/threads/th_fence.md",
};

const TALL_DOC = {
  id: "th_tall",
  type: "thread",
  title: "A prompt too long to read at once",
  path: "data/docs/threads/th_tall.md",
};

/**
 * The block UI-050 is about: 60 lines, one of them 400 columns of unbroken
 * text — a pasted quote with nowhere to break — inside a canvas measured at
 * 62ch. Before the change that line was a horizontal scroller; after it, the
 * block is too tall to show at once, which is why the two halves of the issue
 * were designed together.
 */
const UNBREAKABLE = "x".repeat(400);
const TALL_FENCE = [
  "Rewrite the following, keeping the reference id intact:",
  UNBREAKABLE,
  ...Array.from({ length: 57 }, (_, index) => `  line ${index + 3} of the prompt`),
].join("\n");
const TALL_TURN = ["Here is the prompt:", "", "```prompt", TALL_FENCE, "```"].join("\n");

/**
 * The turn: a labelled fence with the shape a prompt actually has — a blank
 * line inside it, indentation, a `[[ref]]` that must stay literal — plus an
 * unlabelled fence after it.
 */
const PROMPT = 'You are a drafting agent.\n\n  Rewrite [[doc_x]] as:\n    - one "line"\n    - two';
const SHELL = "corpus doc list --type note";
const TURN_BODY = [
  "Here is the prompt:",
  "",
  "```prompt",
  PROMPT,
  "```",
  "",
  "```",
  SHELL,
  "```",
].join("\n");

const TURN_BODIES: Readonly<Record<string, string>> = {
  th_fence: TURN_BODY,
  th_tall: TALL_TURN,
};

/** `GET /api/threads/{id}`, and the seen POST the card fires on open. */
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
          threadId: url.pathname.split("/").at(-2) ?? "th_fence",
          lastSeenTs: "2026-07-01T09:05:00.000Z",
          unread: false,
        } satisfies MarkSeenResult),
      });
    }
    const id = url.pathname.split("/").pop() ?? "th_fence";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id,
        title: id === "th_tall" ? TALL_DOC.title : THREAD_DOC.title,
        created: "2026-07-01T09:00:00.000Z",
        updated: "2026-07-01T09:05:00.000Z",
        status: "open",
        tags: [],
        parent: null,
        anchor: null,
        agent: "engaged",
        resident: null,
        // The server's answer to §10's interlock, published rather than derived
        // (CONTRACT-036).
        unread: false,
        turns: [
          {
            author: "agent",
            ts: "2026-07-01T09:05:00.000Z",
            body: TURN_BODIES[id] ?? TURN_BODY,
            model: null,
          },
        ],
      } satisfies Thread),
    });
  });
}

async function openThread(page: Page, id = "th_fence"): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${id}"]`).click();
  await expect(page.locator(".reader .thread-conversation .turn")).toBeVisible();
}

test.describe("a fenced block in a rendered turn", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies the fence's raw text, exactly", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const fences = page.locator(".reader .turn-body .fence");
    await expect(fences).toHaveCount(2);

    // The info string is the block's label; the bare fence has none.
    await expect(fences.nth(0).locator(".fence-label")).toHaveText("prompt");
    await expect(fences.nth(1).locator(".fence-label")).toHaveCount(0);

    // Located by its hook, never by its accessible name: the name carries the
    // button's state, so a name-based locator stops resolving the moment the
    // state it is watching for arrives.
    const copy = fences.nth(0).locator("[data-fence-copy]");
    await expect(copy).toHaveAttribute("aria-label", "Copy the prompt block");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    await expect(copy).toHaveAttribute("aria-label", "Copied the prompt block to the clipboard");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(PROMPT);
    // No fence markers, no info string, no trailing newline — asserted as the
    // bytes rather than as a shape, because "close enough" is what a pasted
    // prompt cannot be.
    expect(copied).toBe(
      'You are a drafting agent.\n\n  Rewrite [[doc_x]] as:\n    - one "line"\n    - two',
    );
    expect(copied.endsWith("\n")).toBe(false);
    expect(copied).not.toContain("```");

    // …and the confirmation is brief: the button goes back to offering the act.
    await expect(copy).toHaveText("Copy", { timeout: 4000 });
  });

  test("is reachable and activatable from the keyboard alone", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const fences = page.locator(".reader .turn-body .fence");
    const first = fences.nth(0).locator("[data-fence-copy]");
    const second = fences.nth(1).locator("[data-fence-copy]");

    // Tab lands on the next block's button: the affordance is in the tab order,
    // reached without a pointer, and revealed by the keyboard's own focus.
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await expect(second).toHaveCSS("opacity", "1");

    /*
     * `↵` activates it. This is the assertion that caught a real defect: the
     * board binds `↵` globally and cancels the keydown, which used to eat the
     * button's activation whole (see `CodeFence.tsx`).
     */
    await page.keyboard.press("Enter");
    await expect(second).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SHELL);
  });

  /**
   * The refusal path. A browser's clipboard cannot be denied on demand here, so
   * the denial is injected at the API the button calls — which is the same
   * failure the user meets when the permission is refused, and the assertion is
   * that it is *reported* rather than swallowed.
   */
  test("reports a refused clipboard on the button instead of doing nothing", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        value: () => Promise.reject(new Error("Write permission denied.")),
        configurable: true,
      });
    });
    await openThread(page);

    const copy = page.locator(".reader .turn-body .fence").first().locator("[data-fence-copy]");
    await copy.click();

    await expect(copy).toHaveText("Copy failed");
    await expect(copy).toHaveAttribute(
      "aria-label",
      "Could not copy the prompt block — Write permission denied",
    );
    await expect(copy).toHaveAttribute("title", "Could not copy — Write permission denied");
  });

  /**
   * ── Wrapping and collapsing (UI-050) ────────────────────────────────
   *
   * Geometry, not classes. "It wraps" is a claim about the box a browser laid
   * out, and the only honest assertion is that nothing sticks out of it.
   */
  test("wraps a 400-column line instead of scrolling it sideways", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC, TALL_DOC]);
    await stubThread(page);
    await openThread(page, "th_tall");

    const pre = page.locator(".reader .turn-body .fence pre");
    await expect(pre).toHaveCSS("white-space", "pre-wrap");

    const box = await pre.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    // No second axis of navigation: the block's content is as wide as its box.
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.clientWidth).toBeGreaterThan(0);

    // …and the wrap is presentation only — the rendered text still carries the
    // line's 400 characters and the indentation of the lines under it.
    const text = await pre.evaluate((element) => element.textContent ?? "");
    expect(text).toContain(UNBREAKABLE);
    expect(text).toContain("\n  line 3 of the prompt");
  });

  /**
   * **The invariant.** A copy that yielded only the visible portion would be a
   * paste that looks complete and is truncated — worse than having no collapse
   * at all. Asserted here against the real clipboard, collapsed first.
   */
  test("copies the whole block while it is collapsed, and again expanded", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC, TALL_DOC]);
    await stubThread(page);
    await openThread(page, "th_tall");

    const fence = page.locator(".reader .turn-body .fence");
    await expect(fence).toHaveAttribute("data-fence-collapsed", "");

    const clipped = await fence.locator("pre").evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    // Clipped to the threshold, with a great deal more behind it.
    expect(clipped.client).toBeLessThanOrEqual(425);
    expect(clipped.scroll).toBeGreaterThan(clipped.client * 2);

    const copy = fence.locator("[data-fence-copy]");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TALL_FENCE);

    const more = fence.locator("[data-fence-more]");
    await expect(more).toHaveText("Show all 59 lines");
    await expect(more).toHaveAttribute("aria-label", "Show all 59 lines of the prompt block");
    await more.click();

    await expect(fence).not.toHaveAttribute("data-fence-collapsed", "");
    await expect(more).toHaveText("Show less");
    const opened = await fence.locator("pre").evaluate((element) => element.clientHeight);
    expect(opened).toBeGreaterThan(clipped.client);

    // The same bytes, from the same button, in the other state.
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TALL_FENCE);

    // Reversible, and back to the box it started in.
    await more.click();
    await expect(fence).toHaveAttribute("data-fence-collapsed", "");
    expect(await fence.locator("pre").evaluate((element) => element.clientHeight)).toBe(
      clipped.client,
    );
  });

  test("expands from the keyboard alone", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC, TALL_DOC]);
    await stubThread(page);
    await openThread(page, "th_tall");

    const fence = page.locator(".reader .turn-body .fence");
    const more = fence.locator("[data-fence-more]");
    await more.focus();
    await expect(more).toBeFocused();
    // `↵` again: the board cancels it globally, and the control has to claim it.
    await page.keyboard.press("Enter");

    await expect(more).toHaveText("Show less");
    await expect(more).toHaveAttribute("aria-expanded", "true");
  });

  /** A block under the threshold is what it always was: no clip, no control. */
  test("leaves a block that fits exactly as it was", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const fences = page.locator(".reader .turn-body .fence");
    await expect(fences.locator("[data-fence-more]")).toHaveCount(0);
    await expect(page.locator(".reader [data-fence-collapsed]")).toHaveCount(0);

    const box = await fences
      .first()
      .locator("pre")
      .evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(box.scroll).toBeLessThanOrEqual(box.client + 4);
  });

  /** The affordance convention: hidden until the block is hovered. */
  test("stays out of the way until the block is hovered", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const fence = page.locator(".reader .turn-body .fence").first();
    const copy = fence.locator("[data-fence-copy]");
    await expect(copy).toHaveCSS("opacity", "0");

    await fence.hover();
    await expect(copy).toHaveCSS("opacity", "1");
  });
});
