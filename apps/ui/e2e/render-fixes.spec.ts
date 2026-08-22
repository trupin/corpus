import type { MarkSeenResult, Thread } from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * The browser half of UI-064, UI-059 and UI-065.
 *
 * All three are claims a component test cannot make, because all three are about
 * what the browser **draws**: whether a `<br>` token became an element or four
 * characters, whether a URL stayed inside its card, and whether a title occupies
 * the lines it needs. The DOM is the same either way; the boxes are not.
 *
 * Both rendered surfaces are exercised, because they are two different renderers
 * over one file: a document body is TipTap (`apps/ui/src/editor`) and a thread
 * turn is `MarkdownView` (`@corpus/kit`). UI-064's `<br>` reached the user
 * through the first and would have survived a fix to only the second.
 */

const LONG_URL =
  "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij/edit?usp=sharing&pli=1";

const LONG_TITLE =
  "Catch-Up Report — mortgage, insurance and the quarterly portfolio review — 2026-08-04";

const BODY = [
  "| Term    | Meaning                                           |",
  "| ------- | ------------------------------------------------- |",
  "| escrow  | held by a third party<br>until both sides perform |",
  "",
  `Source: ${LONG_URL}`,
  "",
  "Not markup: <script>alert(1)</script> and <img src=x onerror=alert(1)>.",
].join("\n");

const FOLDER_VIEW = {
  id: "doc_view_notes",
  type: "view",
  title: "Notes",
  path: "data/docs/views/notes.md",
  pinned: true,
  order: 1,
  query: { folder: "notes" },
};

const NOTE = {
  id: "doc_render",
  type: "note",
  title: LONG_TITLE,
  path: "data/docs/notes/doc_render.md",
  body: BODY,
};

const THREAD_ROW = {
  id: "th_render",
  type: "thread",
  title: "Rendering",
  path: "data/docs/notes/th_render.md",
};

/** `GET /api/threads/{id}`: one agent turn carrying the same body. */
async function stubThread(page: Page): Promise<void> {
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
          threadId: "th_render",
          lastSeenTs: "2026-07-01T09:05:00.000Z",
          unread: false,
        } satisfies MarkSeenResult),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "th_render",
        title: THREAD_ROW.title,
        created: "2026-07-01T09:00:00.000Z",
        updated: "2026-07-01T09:05:00.000Z",
        status: "open",
        tags: [],
        parent: null,
        anchor: null,
        agent: "engaged",
        resident: null,
        turns: [{ author: "agent", ts: "2026-07-01T09:05:00.000Z", body: BODY, model: null }],
      } satisfies Thread),
    });
  });
}

async function openRow(page: Page, id: string): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${id}"]`).click();
}

/** Whether an element paints anything outside its own box. */
async function overflowOf(
  page: Page,
  selector: string,
): Promise<{ scroll: number; client: number }> {
  return page.locator(selector).evaluate((element) => ({
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
}

test.describe("UI-064 — `<br>` in a table cell", () => {
  test("is a line break in the document body, and markup beside it is still text", async ({
    page,
  }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");

    const body = page.locator(".reader .doc-editor .ProseMirror");
    await expect(body.locator("table")).toBeVisible();

    // The break is an element, not the four characters `<br>`.
    await expect(body.locator("td br")).toHaveCount(1);
    expect(await body.locator("td").first().innerText()).not.toContain("<br>");

    // …and nothing else became an element. This is the property UI-064
    // qualified, so it is asserted on the surface the fix touched.
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body.locator("iframe")).toHaveCount(0);
    await expect(body.locator("img")).toHaveCount(0);
    expect(await body.innerText()).toContain("<script>alert(1)</script>");
    expect(await body.innerText()).toContain("<img src=x onerror=alert(1)>");
  });

  test("is a line break in a thread turn too", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await stubThread(page);
    await openRow(page, "th_render");

    const turn = page.locator(".reader .turn-markdown").first();
    await expect(turn.locator("table")).toBeVisible();
    await expect(turn.locator("td br")).toHaveCount(1);
    await expect(turn.locator("img")).toHaveCount(0);
    expect(await turn.innerText()).toContain("<script>alert(1)</script>");
  });
});

test.describe("UI-059 — links in a rendered body", () => {
  test("a URL longer than the measure wraps inside its card", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await stubThread(page);
    await openRow(page, "th_render");

    const turn = page.locator(".reader .turn-markdown").first();
    await expect(turn.locator("a", { hasText: "docs.google.com" })).toBeVisible();

    // Nothing is scrolled away…
    const box = await overflowOf(page, ".reader .turn-markdown");
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);

    // …and nothing is painted past the card that holds it.
    const card = page.locator(".reader .thread-card").first();
    const [linkRight, cardRight] = await Promise.all([
      turn
        .locator("a")
        .first()
        .evaluate((element) => element.getBoundingClientRect().right),
      card.evaluate((element) => element.getBoundingClientRect().right),
    ]);
    expect(linkRight).toBeLessThanOrEqual(cardRight + 1);

    // It wrapped rather than merely being clipped: more than one line of it.
    const [height, line] = await turn
      .locator("a")
      .first()
      .evaluate((element) => [
        element.getBoundingClientRect().height,
        Number.parseFloat(getComputedStyle(element).lineHeight),
      ]);
    expect(height).toBeGreaterThan(line * 1.5);
  });

  test("carries the app's link treatment, not the user agent's", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await stubThread(page);
    await openRow(page, "th_render");

    const link = page.locator(".reader .turn-markdown a").first();
    const style = await link.evaluate((element) => {
      const computed = getComputedStyle(element);
      // The token, resolved through a throwaway element so the comparison is
      // colour-space-for-colour-space rather than string-for-string.
      const probe = document.createElement("span");
      probe.style.color = "var(--accent-ink)";
      element.append(probe);
      const accentInk = getComputedStyle(probe).color;
      probe.remove();
      return { color: computed.color, decoration: computed.textDecorationLine, accentInk };
    });
    expect(style.decoration).toBe("underline");
    // The app's ink, not the user agent's `#0000EE`.
    expect(style.color).toBe(style.accentInk);
    expect(style.color).not.toBe("rgb(0, 0, 238)");
  });

  test("treats a link in the editable body exactly as in the read view", async ({ page }) => {
    // `DocEditor` puts `doc-body` on its contenteditable, so the rule reaches
    // TipTap from the same declaration. "There is no edit mode" (SPEC.md §10) is
    // a visual promise about links too, and the long URL must not overflow here
    // either.
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");

    const body = page.locator(".reader .doc-editor .ProseMirror");
    await expect(body.locator("a").first()).toBeVisible();

    const measured = await body
      .locator("a")
      .first()
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        const probe = document.createElement("span");
        probe.style.color = "var(--accent-ink)";
        element.append(probe);
        const accentInk = getComputedStyle(probe).color;
        probe.remove();
        return {
          color: computed.color,
          decoration: computed.textDecorationLine,
          accentInk,
          right: element.getBoundingClientRect().right,
        };
      });
    expect(measured.decoration).toBe("underline");
    expect(measured.color).toBe(measured.accentInk);

    const box = await overflowOf(page, ".reader .doc-editor .ProseMirror");
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    const editorRight = await body.evaluate((element) => element.getBoundingClientRect().right);
    expect(measured.right).toBeLessThanOrEqual(editorRight + 1);
  });

  test("leaves a `[[ref]]` on its own treatment", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");

    // `.ref` is excluded from the link rule by selector, and the exclusion is
    // what keeps the two kinds of link distinguishable (UI-059).
    const decoration = await page.evaluate(() => {
      const host = document.createElement("div");
      host.className = "doc-body";
      host.innerHTML = `<a class="ref" href="#doc_x">ref</a>`;
      document.body.append(host);
      const value = getComputedStyle(host.querySelector("a") as Element).textDecorationLine;
      host.remove();
      return value;
    });
    expect(decoration).toBe("none");
  });
});

test.describe("UI-065 — a long document title", () => {
  test("wraps to the lines it needs, with nothing scrolled out of view", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");

    const title = page.locator(".reader .doc-title");
    await expect(title).toHaveValue(LONG_TITLE);

    const measured = await title.evaluate((element) => {
      const field = element as HTMLTextAreaElement;
      return {
        height: field.getBoundingClientRect().height,
        line: Number.parseFloat(getComputedStyle(field).lineHeight),
        scroll: field.scrollHeight,
        client: field.clientHeight,
      };
    });
    // More than one line…
    expect(measured.height).toBeGreaterThan(measured.line * 1.5);
    // …and the box holds all of them: nothing is cut.
    expect(measured.scroll).toBeLessThanOrEqual(measured.client + 1);
  });

  /**
   * The column assertion above passes in the *slack* direction — if the mirror
   * and the field disagree such that the mirror is taller, the row is merely too
   * big and nothing is cut. Focus mode is the direction that clips: it sets a
   * larger type, and when only the field was resized the mirror kept sizing the
   * grid row for the smaller one. PR #21 review, MAJOR 1.
   */
  test("wraps in focus mode too, where the type is larger", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");
    await page.keyboard.press("f");
    await page.locator(".focus").waitFor();

    const title = page.locator(".focus .doc-title");
    await expect(title).toHaveValue(LONG_TITLE);

    const measured = await title.evaluate((element) => {
      const field = element as HTMLTextAreaElement;
      const mirror = field.parentElement as HTMLElement;
      return {
        fieldFont: Number.parseFloat(getComputedStyle(field).fontSize),
        mirrorFont: Number.parseFloat(getComputedStyle(mirror, "::after").fontSize),
        scroll: field.scrollHeight,
        client: field.clientHeight,
        line: Number.parseFloat(getComputedStyle(field).lineHeight),
        height: field.getBoundingClientRect().height,
      };
    });
    // The two must agree about type, or the mirror measures a different string.
    expect(measured.mirrorFont).toBe(measured.fieldFont);
    // Still wrapping at the larger size.
    expect(measured.height).toBeGreaterThan(measured.line * 1.5);
    // Nothing cut, bounded by a **measured** constant rather than a fraction of
    // a line. An earlier version allowed half a line — 18px here, which is most
    // of a cut line, so it would have passed while showing the user exactly the
    // defect UI-065 exists to prevent (PR #21 re-review, MINOR 2).
    //
    // The floor is 2, not the 0–1 that integer rounding alone predicts: a
    // textarea's intrinsic content height and a pseudo-element's block box do
    // not agree to the pixel even on identical type. Measured at 2 on Chromium
    // with focus mode's 30px/1.25. A hidden line would be 37.5px, so this
    // catches one an order of magnitude before it appears — and any drift past
    // 2 is a real change worth looking at rather than noise to widen for.
    expect(measured.scroll - measured.client).toBeLessThanOrEqual(2);
  });

  test("does not collide with the body below it", async ({ page }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await openRow(page, "doc_render");

    const title = page.locator(".reader .doc-title");
    const editor = page.locator(".reader .doc-editor");
    await expect(editor).toBeVisible();

    const [titleBottom, bodyTop] = await Promise.all([
      title.evaluate((element) => element.getBoundingClientRect().bottom),
      editor.evaluate((element) => element.getBoundingClientRect().top),
    ]);
    expect(bodyTop).toBeGreaterThanOrEqual(titleBottom - 1);
  });

  test("leaves the board row truncating, which is the other answer on purpose", async ({
    page,
  }) => {
    await stubCorpus(page, [FOLDER_VIEW, NOTE, THREAD_ROW]);
    await page.goto("/");
    await page.locator(".board").waitFor();

    const row = page.locator('.row[data-row-doc="doc_render"] .row-title');
    const style = await row.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        whiteSpace: computed.whiteSpace,
        overflow: computed.overflow,
        height: element.getBoundingClientRect().height,
        line: Number.parseFloat(computed.lineHeight),
      };
    });
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).not.toBe("visible");
    // One line, however long the title is.
    expect(style.height).toBeLessThan(style.line * 1.5);
  });
});
