import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-041's copyable canvases (SPEC.md §11, rider signed 2026-08-02), in a real
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
  pinned: true,
  order: 1,
  query: { folder: "threads" },
};

const THREAD_DOC = {
  id: "th_fence",
  type: "thread",
  title: "Prompt for the drafting agent",
  path: "data/docs/threads/th_fence.md",
};

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

/** `GET /api/threads/{id}`, and the seen POST the card fires on open. */
async function stubThread(page: Page): Promise<void> {
  await page.route("**/api/threads/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/seen")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "th_fence",
        title: THREAD_DOC.title,
        created: "2026-07-01T09:00:00.000Z",
        updated: "2026-07-01T09:05:00.000Z",
        status: "open",
        tags: [],
        parent: null,
        anchor: null,
        agent: "engaged",
        turns: [{ author: "agent", ts: "2026-07-01T09:05:00.000Z", body: TURN_BODY }],
      }),
    });
  });
}

async function openThread(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_fence"]').click();
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
