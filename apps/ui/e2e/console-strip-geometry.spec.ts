import type { IndexStatus, QueueStatus } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-133 in a real browser: **the console strip's height is a property of the
 * strip, never of what it says** (SPEC.md §10's rider, signed 2026-08-20 —
 * "Nothing resizes because of what it holds").
 *
 * ## Why the board is what gets measured
 *
 * `.console { flex: none }` sits against `.board { flex: 1 }` in `.app`'s
 * column, so every pixel the console takes is a pixel the board gives up. The
 * strip growing is not a strip problem — it shortens every column and every open
 * reader on the surface, with no gesture from the person, on a line that always
 * renders. Asserting on the strip alone would pass a fix that merely moved the
 * growth into a sibling, so every assertion below is about `.board`'s box.
 *
 * The audit's numbers, reproduced here before the fix, at a 1000px viewport:
 *
 * ```
 * rest                  strip 39.94  board 622.50  board bottom 679.06
 * a wrapped strip child strip 45.88  board 616.56  board bottom 673.13
 * drawer, short detail    row 28.94  board 348.63
 * drawer, long detail     row 44.88  board 332.69
 * ```
 *
 * ## Why a browser
 *
 * jsdom implements no layout, so `Console.test.tsx` passes against every one of
 * these states and always did. Wrapping is a fact about a font, a box and a
 * viewport, and only a real engine has all three.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

const NOTE: StubRow = {
  id: "doc_note",
  type: "note",
  title: "A note",
  path: "data/docs/inbox/a-note.md",
  body: "Prose.",
};

/**
 * A width where the strip is tight enough that its free-text child wrapped
 * before the fix — the audit's own condition ("a narrow window, where the strip
 * is tightest"), pinned so the reproduction does not depend on the runner's
 * default viewport.
 */
const VIEWPORT = { width: 1000, height: 720 };

const CAUGHT_UP: IndexStatus = {
  indexed: 273,
  pending: 0,
  failed: 0,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: false,
  state: "current",
};

/** A real progress sentence: the server's wording, at the server's length. */
/**
 * A version string longer than `.c-status`'s 24ch bound — the server writes it,
 * so the strip may not be sized by it (rider clause 2).
 */
const LONG_VERSION = "1.0.0-rc.20260822.nightly.build.7f3a19c";

const LONG_DETAIL =
  "the configured embedding endpoint at http://127.0.0.1:11434 did not answer, " +
  "and the model nomic-embed-text is 46% downloaded — indexing resumes on its " +
  "own once the download finishes";

const BUSY_QUEUE: QueueStatus = {
  agent: { live: true, since: "2026-08-20T09:00:00Z" },
  halted: false,
  pending: 8,
  inProgress: 12,
  deferred: 3,
  processed: 1042,
  failed: 147,
  abandoned: 0,
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return box;
}

/** `scrollHeight` still reports clipped content, so this catches a silent cut. */
async function clips(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.scrollHeight > element.clientHeight);
}

/**
 * What the page is allowed to know, mutable between reloads.
 *
 * The states below are not five fixtures — they are one page walking through
 * five things a server can say to it, which is how a person meets them.
 */
interface Server {
  /** `null` refuses `GET /api/index/status` outright, so no pill mounts. */
  index: IndexStatus | null;
  /** `null` leaves the stub's own answer in place. */
  queue: QueueStatus | null;
  /** Whether `GET /api/health` answers at all. */
  health: boolean;
}

/**
 * Routes registered **after** `stubCorpus`, which is what puts them first —
 * Playwright tries handlers in reverse registration order — so each one either
 * answers or hands the request back with `route.fallback()`.
 */
async function serve(page: Page, server: Server): Promise<void> {
  await stubCorpus(page, [VIEW, NOTE]);
  await page.route("**/api/index/status", async (route) => {
    if (server.index === null) return route.abort("connectionrefused");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(server.index),
    });
  });
  await page.route("**/api/queue/status", async (route) => {
    if (server.queue === null) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(server.queue),
    });
  });
  await page.route("**/api/health", async (route) => {
    if (!server.health) return route.abort("connectionrefused");
    return route.fallback();
  });
}

test.describe("the strip's height is not its text", () => {
  test("the board's box is identical in every strip state", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    const server: Server = { index: CAUGHT_UP, queue: null, health: true };
    await serve(page, server);

    const board = page.locator(".board");
    const strip = page.locator(".console-strip");

    /** Navigates into the current server state and measures once it settles. */
    const state = async (name: string, settled: () => Promise<unknown>): Promise<Box> => {
      await page.goto("/");
      await strip.waitFor();
      await settled();
      const measured = await boxOf(board);
      expect(await clips(strip), `${name}: the strip clipped its own content`).toBe(false);
      return measured;
    };

    server.index = null;
    const noIndex = await state("no index status", async () => {
      await expect(page.locator(".index-pill")).toHaveCount(0);
    });

    server.index = { ...CAUGHT_UP, state: "disabled", detail: LONG_DETAIL };
    const longDetail = await state("a long index detail", async () => {
      await expect(page.locator(".index-pill")).toHaveText("index: disabled");
    });

    server.index = CAUGHT_UP;
    server.queue = BUSY_QUEUE;
    const failing = await state("147 failed", async () => {
      await expect(page.locator(".c-failed-jobs")).toHaveText("147 failed");
    });

    server.health = false;
    const unreachable = await state("a server that never answers", async () => {
      await expect(page.locator(".console-strip .c-failed")).toHaveText("server unreachable");
    });

    /*
     * Every box, against the first. Before the fix a wrapped strip child scored
     * 616.56 against `noIndex`'s 622.50 — the −5.94px it took out of the board —
     * and the drawer test below carries the larger −15.94px.
     */
    for (const [name, measured] of [
      ["a long index detail", longDetail],
      ["147 failed", failing],
      ["a server that never answers", unreachable],
    ] as const) {
      expect(measured, `${name} moved the board`).toEqual(noIndex);
    }
  });

  test("the strip is one line, and it is the height it was measured for", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await serve(page, {
      index: { ...CAUGHT_UP, state: "disabled", detail: LONG_DETAIL },
      queue: BUSY_QUEUE,
      health: true,
    });
    await page.goto("/");

    const strip = page.locator(".console-strip");
    await expect(page.locator(".index-pill")).toHaveText("index: disabled");
    await expect(strip).toHaveCSS("height", "40px");
    // The prototype's padding, unchanged — the height is added to it, not
    // instead of it (`design/index.html` is authoritative for look & feel).
    await expect(strip).toHaveCSS("padding", "7px 18px");
    expect(await clips(strip)).toBe(false);
  });

  /**
   * Clause 2: a value the strip cannot fit is **revealed, not accommodated**.
   *
   * The subject was `.c-plugin-warn` — a skipped plugin's load reason, the one
   * genuinely unbounded string the strip carried — until Phase 41 deleted the
   * warning with the plugin system (SHARED-064). The rule outlives it, and
   * `.c-status` is the string that tests it now: the version is the server's,
   * `console.css` bounds the span at 24ch, and a long pre-release tag has to be
   * reachable in place rather than allowed to widen the strip.
   */
  test("a truncated value keeps the whole of itself in reach", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 720 });
    await serve(page, { index: CAUGHT_UP, queue: null, health: true });
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          version: LONG_VERSION,
          uptimeSeconds: 1,
          workspace: "/tmp/stub-workspace",
        }),
      }),
    );
    await page.goto("/");

    const status = page.locator(".c-status");
    // Whole in `title`…
    await expect(status).toHaveAttribute("title", `corpus ${LONG_VERSION}`);
    // …cut on screen, and the strip is still one unclipped line.
    expect(
      await status.evaluate((element) => element.scrollWidth > element.clientWidth),
      "the version was not truncated — the fixture is no longer long enough",
    ).toBe(true);
    expect(await clips(page.locator(".console-strip"))).toBe(false);
  });
});

test.describe("the index pill arriving late", () => {
  test("does not push the counts when it materialises", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held = 0;

    await stubCorpus(page, [VIEW, NOTE]);
    await page.route("**/api/index/status", async (route) => {
      held += 1;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CAUGHT_UP),
      });
    });

    await page.goto("/");
    const counts = page.locator(".c-counts");
    const halt = page.locator(".halt-btn");
    await expect(counts).toHaveText("0 running · 0 done · 0 failed");
    const before = { counts: await boxOf(counts), halt: await boxOf(halt) };

    open();
    await expect(page.locator(".index-pill")).toHaveText("index: current · 273 indexed");
    const after = { counts: await boxOf(counts), halt: await boxOf(halt) };

    expect(held, "no index-status request was intercepted — nothing was held").toBeGreaterThan(0);
    // ~210px of pill arrived on the frame after the answer. Nothing it is
    // aligned against may have paid for it.
    expect(after.counts, "the counts moved when the index pill arrived").toEqual(before.counts);
    expect(after.halt, "the HALT button moved when the index pill arrived").toEqual(before.halt);
  });
});

test.describe("the drawer's index row", () => {
  test("takes no line from the board however long the server's sentence is", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    const server: Server = {
      index: { ...CAUGHT_UP, state: "disabled", detail: "no model" },
      queue: null,
      health: true,
    };
    await serve(page, server);

    await page.goto("/");
    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    const board = page.locator(".board");
    const row = page.locator(".index-status");
    await expect(row.locator(".index-detail")).toHaveText("no model");
    const short = { board: await boxOf(board), row: await boxOf(row) };

    server.index = { ...CAUGHT_UP, state: "disabled", detail: LONG_DETAIL };
    await page.reload();
    await page.locator(".console-body").waitFor();
    await expect(row.locator(".index-detail")).toHaveAttribute("title", LONG_DETAIL);
    const long = { board: await boxOf(board), row: await boxOf(row) };

    expect(long.row, "the row grew to fit the sentence").toEqual(short.row);
    expect(long.board, "the board paid for the sentence").toEqual(short.board);
    expect(await clips(row)).toBe(false);
  });

  test("still counts what does not drain, beside the sentence it cut", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await serve(page, {
      index: { ...CAUGHT_UP, state: "stale", pending: 12, failed: 9, detail: LONG_DETAIL },
      queue: null,
      health: true,
    });

    await page.goto("/");
    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    const row = page.locator(".index-status");
    await expect(row.locator(".index-failed")).toHaveText("9 failed");
    await expect(row.locator(".index-detail")).toHaveAttribute("title", LONG_DETAIL);
    expect(await clips(row)).toBe(false);
  });
});

test.describe("the strip stays honest inside its fixed box", () => {
  test("says unknown before the queue answers, and zeroes it can stand behind", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await stubCorpus(page, [VIEW, NOTE]);
    // A queue status that never answers — UI-098's own condition. A fixed
    // height reserves a box, and a reserved box must not become a claim.
    await page.route("**/api/queue/status", (route) => route.abort("connectionrefused"));
    await page.goto("/");

    await expect(page.locator(".agent-pill")).toHaveText("agent: unknown");
    await expect(page.locator(".c-counts")).toHaveText("0 running · 0 done · 0 failed");
    await expect(page.locator(".halt-btn")).toBeDisabled();
    expect(await clips(page.locator(".console-strip"))).toBe(false);
  });
});
