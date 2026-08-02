import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";
import { LIGHT_ACCENT } from "./tokens";

/**
 * UI-009's overlay, in a real browser.
 *
 * Like the rest of the suite it runs against the Vite dev server with **no**
 * workspace server on `127.0.0.1:8765` (`smoke.spec.ts` asserts the console
 * strip reads exactly "server unreachable", which is only true while that port
 * is unbound — see `board.spec.ts` for the same reasoning). So what is verified
 * here is everything that does not need rows to come back: the panel's geometry
 * against the prototype, focus, the dialog contract, the keyboard, the footer
 * legend, and the create row — which is the *only* row a search with zero
 * results produces, and therefore fully exercisable.
 *
 * `↵`-into-a-column with the flash, and save-as-view writing a view document to
 * disk, are verified against a real `corpus` server and a real browser in the
 * issue's E2E Verification Log. Result grouping, the ranked payload and the
 * `<mark>` highlights get their own stubbed describe at the bottom of this file
 * (UI-026), because those need rows and the suite's default has none.
 */

/**
 * ⌘K is a document listener React attaches on mount, so the shell has to be on
 * screen before the key means anything. Waiting for the top bar rather than
 * sleeping is what keeps this from being the suite's flaky test.
 */
async function openOverlay(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".searchbar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".overlay.open")).toBeVisible();
}

test.describe("the search overlay", () => {
  test("⌘K and the search bar open the same panel, with focus in the input", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");

    await expect(page.locator(".overlay")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".overlay.open")).toBeVisible();
    await expect(page.locator(".search-panel")).toHaveAttribute("role", "dialog");
    await expect(page.locator(".search-panel")).toHaveAttribute("aria-label", "Search");
    await expect(page.locator(".search-input-row input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator(".overlay.open")).toHaveCount(0);

    await page.locator(".searchbar").click();
    await expect(page.locator(".overlay.open")).toBeVisible();
    await expect(page.locator(".search-input-row input")).toBeFocused();
    expect(uncaught).toEqual([]);
  });

  test("the panel is the prototype's, measured", async ({ page }) => {
    await openOverlay(page);

    const overlay = page.locator(".overlay.open");
    await expect(overlay).toHaveCSS("position", "fixed");
    await expect(overlay).toHaveCSS("z-index", "40");
    await expect(overlay).toHaveCSS("backdrop-filter", "blur(3px)");

    const panel = page.locator(".search-panel");
    const viewport = page.viewportSize();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(Math.round(box.width)).toBe(Math.min(760, viewport.width - 48));
    expect(Math.round(box.y)).toBe(Math.round(viewport.height * 0.07));

    const input = page.locator(".search-input-row input");
    await expect(input).toHaveCSS("font-size", "19px");
    await expect(input).toHaveCSS("font-family", /Iowan Old Style|Palatino|Georgia|serif/);
    await expect(input).toHaveCSS("border-top-width", "0px");
    await expect(page.locator(".search-input-row .chip.ghost")).toHaveText("save as view");
    await expect(page.locator(".search-input-row .chip.ghost")).toHaveCSS(
      "border-top-style",
      "dashed",
    );
  });

  test("the query input lives in the overlay, never in the top bar", async ({ page }) => {
    await openOverlay(page);
    await expect(page.locator(".search-panel input")).toHaveCount(1);
    // The shipped smoke assertion, restated where it could break.
    await expect(page.locator(".searchbar input")).toHaveCount(0);
    expect(await page.locator(".searchbar").evaluate((element) => element.tagName)).toBe("BUTTON");
  });

  test("the footer legend is the prototype's, verbatim", async ({ page }) => {
    await openOverlay(page);

    const foot = page.locator(".search-foot");
    await expect(foot.locator(".hint").nth(0)).toHaveText("↑↓ navigate");
    await expect(foot.locator(".hint").nth(1)).toHaveText("↵ open in its list");
    await expect(foot.locator(".hint").nth(2)).toHaveText("⇧↵ new list from search");
    await expect(foot.locator(".right")).toHaveText("@ agents · / skills · [[ refs");
    await expect(foot).toHaveCSS("font-size", "10.5px");
    await expect(foot).toHaveCSS("font-family", /mono|Menlo|Consolas/i);
    await expect(foot.locator(".right")).toHaveCSS("margin-left", /auto|\d/);
  });

  test("the scrim closes it, the panel does not, and focus goes back to the search bar", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".searchbar")).toBeVisible();
    await page.locator(".searchbar").click();
    await expect(page.locator(".overlay.open")).toBeVisible();

    await page.locator(".search-panel").click({ position: { x: 300, y: 5 } });
    await expect(page.locator(".overlay.open")).toBeVisible();

    // Top-left of the scrim, well clear of the centred panel.
    await page.locator(".overlay.open").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".overlay.open")).toHaveCount(0);
    await expect(page.locator(".searchbar")).toBeFocused();
  });

  test("Tab stays inside the panel", async ({ page }) => {
    await openOverlay(page);
    await expect(page.locator(".search-input-row input")).toBeFocused();

    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.querySelector(".search-panel")?.contains(document.activeElement) ?? false,
      );
      expect(inside).toBe(true);
    }
  });

  test("the chip row toggles, and the archived chip carries the prototype's warn wash", async ({
    page,
  }) => {
    await openOverlay(page);

    const unread = page.locator(".search-filters .chip", { hasText: "unread" });
    await expect(unread).not.toHaveClass(/\bon\b/);
    await unread.click();
    await expect(unread).toHaveClass(/\bon\b/);
    await expect(unread).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");

    const archived = page.locator(".search-filters .chip.warn");
    await expect(archived).toHaveText("include archived");

    const status = page.locator(".search-filters .chip", { hasText: "status:" });
    await expect(status).toHaveText("status: any");
    await status.click();
    await expect(status).toHaveText("status: open");
  });

  /**
   * UI-026 eval FAIL-1. A ranked hit carries no tags, so the chip has no
   * vocabulary to offer until CONTRACT-026 supplies one — and until then it must
   * look as unusable as it is. Disabled, dimmed, refusing the pointer, with a
   * `title` that explains itself; a real mouse press over it changes nothing,
   * which is now what it promises rather than what it hides.
   */
  test("the tag chip is visibly disabled and explains itself", async ({ page }) => {
    await openOverlay(page);

    const tag = page.locator(".search-filters .chip", { hasText: "tag:" });
    await expect(tag).toHaveText("tag: any");
    await expect(tag).toBeDisabled();
    await expect(tag).toHaveAttribute(
      "title",
      "Search results do not carry tags yet, so there is nothing to filter by.",
    );
    await expect(tag).toHaveCSS("opacity", "0.5");
    await expect(tag).toHaveCSS("cursor", "not-allowed");

    // The pointer really does land on it; the browser fires nothing, so the
    // chip stays exactly as it was.
    await tag.click({ force: true });
    await expect(tag).toHaveText("tag: any");
    await expect(tag).not.toHaveClass(/\bon\b/);
    await expect(tag).toHaveAttribute("aria-pressed", "false");

    // …and the focus trap never parks on it, because a keyboard user pressing a
    // control that cannot act is the same defect by another route.
    const visited: boolean[] = [];
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      visited.push(
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute("title")?.startsWith("Search results") ?? false,
        ),
      );
    }
    expect(visited.some(Boolean)).toBe(false);
  });

  test("the create row appears at two characters and reads as the prototype writes it", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openOverlay(page);

    const input = page.locator(".search-input-row input");
    await input.fill("m");
    await expect(page.locator(".sr-create")).toHaveCount(0);

    await input.fill("a new thought");
    // No server, so nothing matches and the create row is the only row.
    await expect(page.locator(".sr-create")).toHaveText(
      '＋ Create "a new thought" — opens ready to edit, in inbox/',
    );
    await expect(page.locator(".sr-create b")).toHaveText("a new thought");
    await expect(page.locator(".sr")).toHaveCount(1);
    expect(uncaught).toEqual([]);
  });

  test("↓ lights exactly one row with the accent outline", async ({ page }) => {
    await openOverlay(page);
    await page.locator(".search-input-row input").fill("a new thought");
    await expect(page.locator(".sr-create")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".sr.kbd")).toHaveCount(1);
    await expect(page.locator(".sr.kbd")).toHaveCSS("outline", `${LIGHT_ACCENT} solid 2px`);
    await expect(page.locator(".sr.kbd")).toHaveCSS("outline-offset", "-2px");

    // Clamped: ↑ at the top stays put rather than wrapping.
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".sr.kbd")).toHaveCount(1);
  });

  test("`[[`, `@` and `/` are literal text, opening no autocomplete", async ({ page }) => {
    await openOverlay(page);

    const input = page.locator(".search-input-row input");
    await input.pressSequentially("[[ref]] @agent /skill");
    await expect(input).toHaveValue("[[ref]] @agent /skill");
    await expect(page.locator(".ac-menu")).toHaveCount(0);
  });

  test("the board's own shortcuts do not fire while the overlay owns the keyboard", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await openOverlay(page);

    // `⇧←`/`⇧→` is the board's keyboard drag; inside the input it must not move
    // a column, and `⇧↵` is the overlay's, not the board's full-screen open.
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.locator(".overlay.open")).toBeVisible();
    expect(uncaught).toEqual([]);
  });
});

/**
 * UI-026: the ranked result list, against the hermetic stub.
 *
 * The describe above deliberately runs with nothing answering `/api`, which is
 * why it verifies only what needs no rows. Ranked retrieval is precisely the
 * part that needs them, so this block seeds a corpus and asserts the payload
 * that reaches the DOM: the request goes to `GET /api/search` and carries no
 * `sort`, each row wears the passage's heading path, and "save as view" still
 * writes the `GET /api/docs` query it always did — `sort: relevance` included.
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

/*
 * The stub addresses a hit by the body's first heading and snippets its first
 * non-blank line, so the heading is what both are cut from — which is why the
 * word under test lives in it.
 */
const MORTGAGE = {
  id: "doc_mortgage",
  title: "Mortgage options",
  path: "data/docs/finance/housing/mortgage.md",
  body: "## Mortgage rate assumptions\n\nthe base case assumes a 30-year fixed",
};

const THREAD = {
  id: "th_rate",
  type: "thread",
  title: "Rate assumption",
  path: "data/threads/th_rate.md",
  body: "## user\n\nis 6.1% the right base case for a mortgage?",
};

test.describe("the ranked result list", () => {
  test("comes from `GET /api/search`, grouped, with heading-path subtitles", async ({ page }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    const corpus = await stubCorpus(page, [VIEW, MORTGAGE, THREAD]);

    await openOverlay(page);
    await page.locator(".search-input-row input").fill("mortgage");

    await expect(page.locator(".sr[data-sr]")).toHaveCount(2);
    await expect(page.locator(".sr-group")).toHaveText(["Documents · 1", "Threads · 1"]);

    const row = page.locator(".sr[data-sr='doc_mortgage']");
    await expect(row.locator(".sr-path")).toHaveText("Mortgage rate assumptions");
    await expect(row.locator(".sr-snippet mark").first()).toHaveText("Mortgage");
    await expect(row.locator(".type-glyph")).toHaveText("doc");
    await expect(page.locator(".sr[data-sr='th_rate'] .type-glyph")).toHaveText("thread");

    // One ranked request, on the ranked endpoint, with no list grammar on it.
    const searches = await corpus.of("GET", "/api/search");
    expect(searches.length).toBeGreaterThan(0);
    for (const call of searches) {
      const params = new URLSearchParams(call.search);
      expect(params.has("sort")).toBe(false);
      expect(params.has("offset")).toBe(false);
      expect(params.has("pinned")).toBe(false);
    }
    // …and nothing asked `GET /api/docs` for the results.
    const lists = await corpus.of("GET", "/api/docs");
    for (const call of lists) expect(new URLSearchParams(call.search).has("q")).toBe(false);
    expect(uncaught).toEqual([]);
  });

  test("no ranked request is issued before anything is typed", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, MORTGAGE]);
    await openOverlay(page);
    await expect(page.locator(".sr-empty")).toHaveText(
      "Type to search — documents, threads and turns, ranked.",
    );
    expect(await corpus.of("GET", "/api/search")).toEqual([]);
  });

  test("the archived chip sends `includeArchived`, never a status", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, MORTGAGE]);
    await openOverlay(page);
    await page.locator(".search-input-row input").fill("mortgage");
    await expect(page.locator(".sr[data-sr]")).toHaveCount(1);

    await page.locator(".search-filters .chip.warn").click();
    await expect(page.locator(".search-filters .chip.warn.on")).toHaveCount(1);

    await expect
      .poll(async () => {
        const calls = await corpus.of("GET", "/api/search");
        return calls.some((call) => call.search.includes("includeArchived=true"));
      })
      .toBe(true);
    for (const call of await corpus.of("GET", "/api/search")) {
      expect(new URLSearchParams(call.search).has("status")).toBe(false);
    }
  });

  test("save as view still writes the `GET /api/docs` query, `sort: relevance` included", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, MORTGAGE]);
    await openOverlay(page);
    await page.locator(".search-input-row input").fill("mortgage");
    await expect(page.locator(".sr[data-sr]")).toHaveCount(1);

    await page.locator(".search-input-row .chip.ghost").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/docs")).length).toBe(1);
    const [write] = await corpus.of("POST", "/api/docs");
    expect(write?.body).toMatchObject({
      type: "view",
      pinned: true,
      title: "mortgage",
      query: { q: "mortgage", sort: "relevance" },
    });
  });

  test("↵ opens the hit in its home column, resolved from the document it names", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [
      { ...VIEW, title: "Housing", query: { folder: "finance" } },
      MORTGAGE,
    ]);
    await openOverlay(page);
    // The document's exact title, so the create row is not offered and the
    // first cursor stop is the hit itself.
    await page.locator(".search-input-row input").fill("mortgage options");
    await expect(page.locator(".sr[data-sr]")).toHaveCount(1);
    await expect(page.locator(".sr-create")).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.locator(".overlay.open")).toHaveCount(0);
    // The hit carries no placement, so the overlay reads the document for one —
    // the same `["docs", id]` entry the reader it is opening will read.
    await expect
      .poll(async () => (await corpus.of("GET", "/api/docs/doc_mortgage")).length)
      .toBeGreaterThan(0);
    await expect(page.locator(".reader")).toBeVisible();
  });
});
