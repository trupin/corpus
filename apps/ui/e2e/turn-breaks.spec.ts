import type { AppendTurnResponse, MarkSeenResult, Thread, Turn } from "@corpus/contract";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-054: a newline typed into a reply is a line break, in a real browser.
 *
 * This is the half of the defect a component test cannot reach. CommonMark's
 * "a single newline is a space" is not a fact about the DOM — the newline is
 * still in the text node either way — it is a fact about how the browser lays
 * the paragraph out. So the assertion here is **geometry**: the reply the user
 * typed on two lines occupies two lines, and the agent's hard-wrapped paragraph
 * beside it still occupies one.
 *
 * The reply is typed into the real composer with real keystrokes, because the
 * key that produces the newline is the whole reason the defect became
 * reachable: `↵` inserts and never submits (SPEC.md §11's composer key
 * contract, SHARED-009 Amendment 1), and `⌘↵` sends.
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
  id: "th_breaks",
  type: "thread",
  title: "Rate assumption",
  path: "data/docs/threads/th_breaks.md",
};

/**
 * The agent's turn, hard-wrapped the way agent prose actually is — measured on
 * a real workspace: 10 of its 11 agent turns wrap their paragraphs at ~80
 * columns. Short enough here that the joined sentence fits one rendered line,
 * which is what makes "one line, not two" a measurable claim.
 */
const AGENT_TURN = "the rate\nlooks stale";
const REPLY_FIRST = "check 6.1%";
const REPLY_SECOND = "then rerun";

/** `GET /api/threads/{id}`, the seen POST, and the reply the composer sends. */
async function stubThread(page: Page): Promise<void> {
  const appended: Turn[] = [];
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
          threadId: "th_breaks",
          lastSeenTs: "2026-07-01T09:05:00.000Z",
          unread: false,
        } satisfies MarkSeenResult),
      });
    }
    if (url.pathname.endsWith("/turns")) {
      const sent: unknown = route.request().postDataJSON();
      const body =
        typeof sent === "object" && sent !== null ? String(Reflect.get(sent, "body")) : "";
      const turn: Turn = {
        author: "user",
        ts: "2026-07-01T09:10:00.000Z",
        body,
        model: null,
      };
      appended.push(turn);
      /*
       * `AppendTurnResponse` is four fields, not two: the thread summary and the
       * enqueue signal used to be missing here entirely (UI-102). The composer
       * reads neither today, which is exactly why nothing complained.
       */
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          thread: {
            id: "th_breaks",
            title: THREAD_DOC.title,
            status: "open",
            parent: null,
            anchor: null,
            agent: "engaged",
            resident: null,
            created: "2026-07-01T09:00:00.000Z",
            updated: turn.ts,
            turnCount: appended.length + 1,
            lastAuthor: "user",
            lastTs: turn.ts,
          },
          turn,
          eventId: null,
          warnings: [],
        } satisfies AppendTurnResponse),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "th_breaks",
        title: THREAD_DOC.title,
        created: "2026-07-01T09:00:00.000Z",
        updated: "2026-07-01T09:05:00.000Z",
        status: "open",
        tags: [],
        parent: null,
        anchor: null,
        agent: "engaged",
        resident: null,
        turns: [
          { author: "agent", ts: "2026-07-01T09:05:00.000Z", body: AGENT_TURN, model: null },
          ...appended,
        ],
      } satisfies Thread),
    });
  });
}

async function openThread(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_breaks"]').click();
  await expect(page.locator(".reader .thread-conversation .turn")).toBeVisible();
}

/** The height of one rendered line of the turn's own type. */
async function lineHeightOf(page: Page): Promise<number> {
  return page
    .locator(".reader .turn-markdown p")
    .first()
    .evaluate((element) => {
      const parsed = Number.parseFloat(globalThis.getComputedStyle(element).lineHeight);
      return Number.isNaN(parsed) ? 20 : parsed;
    });
}

test.describe("a newline in a turn", () => {
  test("renders the reply on the two lines it was typed on", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const composer = page.locator('[data-composer="th_breaks"]');
    await composer.click();
    await page.keyboard.type(REPLY_FIRST);
    await page.keyboard.press("Enter");
    await page.keyboard.type(REPLY_SECOND);
    // `↵` inserted rather than sent: the text is still in the box, on two lines.
    await expect(composer).toHaveValue(`${REPLY_FIRST}\n${REPLY_SECOND}`);

    await page.keyboard.press("ControlOrMeta+Enter");

    const reply = page.locator(".reader .turn").last().locator(".turn-markdown p");
    // The break is a `<br>` and not a new paragraph…
    await expect(reply.locator("br")).toHaveCount(1);
    // …and `innerText` is the browser's own account of what it drew: two lines.
    await expect
      .poll(() => reply.evaluate((element) => (element as HTMLElement).innerText))
      .toBe(`${REPLY_FIRST}\n${REPLY_SECOND}`);

    // …and it is drawn: two lines' worth of box for a sentence that would fit
    // on one. This is the assertion the defect would fail.
    const line = await lineHeightOf(page);
    const height = await reply.evaluate((element) => element.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(line * 1.5);
  });

  test("leaves the agent's hard-wrapped paragraph on one line", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD_DOC]);
    await stubThread(page);
    await openThread(page);

    const agent = page.locator(".reader .turn").first().locator(".turn-markdown p");
    await expect(agent.locator("br")).toHaveCount(0);
    // The newline the agent wrote is drawn as the space CommonMark says it is.
    expect(await agent.evaluate((element) => (element as HTMLElement).innerText)).toBe(
      "the rate looks stale",
    );

    const line = await lineHeightOf(page);
    const height = await agent.evaluate((element) => element.getBoundingClientRect().height);
    // One line: the newline the agent wrote is the space CommonMark says it is.
    expect(height).toBeLessThan(line * 1.5);
  });
});
