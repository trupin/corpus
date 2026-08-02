import type { Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { hexToRgb, token } from "./tokens";

/**
 * UI-040's index pill (SPEC.md §11's index-pill rider, signed 2026-08-02),
 * against the real Vite dev server.
 *
 * What needs a browser here — and what jsdom cannot answer — is the *live* half:
 * a real `EventSource` holding a real `text/event-stream`, one `invalidate`
 * frame naming `["index"]`, and a pill whose counts climb without a reload and
 * without a poller. Everything above the transport is the shipped application:
 * real React, the real TanStack cache, the real SSE bridge. Only
 * `GET /api/index/status` and `/events` are answered from here, which is also
 * how four index states get rendered in one run — a real worker only ever passes
 * through the state it is actually in.
 *
 * The rest of the API is deliberately left alone, and nothing here asserts on
 * it: the suite's standing condition is that no workspace server answers
 * (`smoke.spec.ts` pins that), and these specs must not start failing on a
 * machine where one happens to be running. Every assertion below is about the
 * two endpoints this file owns.
 *
 * The other half of the evidence — a real server, the real embed worker, a real
 * `corpus index rebuild` draining a real backlog — is the issue's E2E
 * Verification Log, and neither half is acceptance on its own.
 */

const LIGHT = ':root\\[data-theme="light"\\]';
const GOOD = hexToRgb(token(LIGHT, "--good"));
const ACCENT = hexToRgb(token(LIGHT, "--accent"));
const SEPIA = hexToRgb(token(LIGHT, "--sepia"));
const INK_3 = hexToRgb(token(LIGHT, "--ink-3"));
const SIGNAL = hexToRgb(token(LIGHT, "--signal"));

interface Status {
  readonly indexed: number;
  readonly pending: number;
  readonly failed: number;
  readonly identity: string | null;
  readonly rebuilding: boolean;
  readonly state: string;
  readonly detail?: string;
}

const CAUGHT_UP: Status = {
  indexed: 273,
  pending: 0,
  failed: 0,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: false,
  state: "current",
};

const REBUILDING: Status = {
  ...CAUGHT_UP,
  indexed: 41,
  pending: 27,
  rebuilding: true,
  state: "indexing",
};

/** How many times the page has asked for the index status. */
interface IndexStub {
  readonly calls: () => number;
}

/**
 * Answers `GET /api/index/status` with each body in turn, repeating the last —
 * a worker draining a backlog, as the page would see it across invalidations.
 *
 * Registered **after** nothing else touches the path, and before `goto`: the
 * console queries on first render.
 */
async function stubIndex(page: Page, bodies: readonly Status[]): Promise<IndexStub> {
  let calls = 0;
  await page.route("**/api/index/status", async (route) => {
    const body = bodies[Math.min(calls, bodies.length - 1)] ?? CAUGHT_UP;
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return { calls: () => calls };
}

/**
 * Starts answering `/events` with one real `invalidate` frame naming `["index"]`.
 *
 * **Registered after the initial render, never before it.** With no workspace
 * server the stream cannot connect at all, so the bridge sits in its retry
 * backoff and the page renders the status it fetched once — which is the state
 * this spec asserts before pushing anything. Installing the route then lets the
 * *next* retry succeed, and because that is the first connection ever to open,
 * the bridge's reconnect recovery (a blanket refetch of active queries, which it
 * does when it has no idea what it missed) does not fire. The frame is therefore
 * the only thing that could have moved the counts.
 */
async function pushIndexFrame(page: Page): Promise<void> {
  const frame = `event: invalidate\ndata: ${JSON.stringify({ keys: [["index"]] })}\n\n`;
  await page.route("**/events*", async (route) => {
    await route
      .fulfill({ status: 200, contentType: "text/event-stream", body: frame })
      // The page can be gone by the time a retry lands; nothing left to serve.
      .catch(() => undefined);
  });
}

const pill = (page: Page) => page.locator(".console-strip .index-pill");
const dot = (page: Page) => page.locator(".console-strip .index-pill .dot");

test.describe("the collapsed strip's index pill", () => {
  test("says how much is searchable, beside the agent pill", async ({ page }) => {
    await stubIndex(page, [CAUGHT_UP]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: current · 273 indexed");
    await expect(dot(page)).toHaveCSS("background-color", GOOD);
    await expect(pill(page)).toHaveAttribute("data-index-state", "current");

    // The rider's placement: beside the agent pill, on the one collapsed line.
    await expect(page.locator(".console-strip .agent-pill")).toHaveCount(1);
    const [agentBox, indexBox] = await Promise.all([
      page.locator(".console-strip .agent-pill").boundingBox(),
      pill(page).boundingBox(),
    ]);
    expect(agentBox?.y).toBe(indexBox?.y);
    expect(indexBox?.x ?? 0).toBeGreaterThan(agentBox?.x ?? 0);
    // The twin's geometry, measured rather than assumed: same height, same pill.
    expect(indexBox?.height).toBe(agentBox?.height);
    await expect(pill(page)).toHaveCSS("border-radius", "99px");
  });

  test("shows the fraction, and the only pulse in the strip, while indexing", async ({ page }) => {
    await stubIndex(page, [REBUILDING]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: indexing · 41/68");
    await expect(dot(page)).toHaveCSS("background-color", ACCENT);
    await expect(dot(page)).toHaveCSS("animation-name", "pulse");
  });

  test("wears the waiting colour, not the alarm colour, when stale", async ({ page }) => {
    await stubIndex(page, [{ ...REBUILDING, rebuilding: false, state: "stale" }]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: stale · 41/68");
    await expect(dot(page)).toHaveCSS("background-color", SEPIA);
    // A backlog is waiting, not broken: red in this strip means needs-you.
    await expect(dot(page)).not.toHaveCSS("background-color", SIGNAL);
    await expect(dot(page)).toHaveCSS("animation-name", "none");
  });

  test("carries no count at all when there is no index", async ({ page }) => {
    await stubIndex(page, [{ ...CAUGHT_UP, indexed: 0, identity: null, state: "disabled" }]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: disabled");
    await expect(dot(page)).toHaveCSS("background-color", INK_3);
  });

  /*
   * The acceptance criterion, through the real stack: a real EventSource, a real
   * `invalidate` frame naming `["index"]`, and counts that climb with no reload.
   */
  test("counts climb on an ['index'] frame, with no reload", async ({ page }) => {
    const stub = await stubIndex(page, [REBUILDING, { ...CAUGHT_UP, indexed: 68 }]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: indexing · 41/68");
    expect(stub.calls()).toBe(1);

    await pushIndexFrame(page);

    await expect(pill(page)).toHaveText("index: current · 68 indexed", { timeout: 20_000 });
    await expect(dot(page)).toHaveCSS("background-color", GOOD);
    // Two reads in total, and no reload: the frame is what moved the counts.
    expect(stub.calls()).toBe(2);
  });

  test("never polls: one read, then nothing until the server says otherwise", async ({ page }) => {
    const stub = await stubIndex(page, [REBUILDING]);
    // `/events` is left unanswered on purpose: the stream never opens, so no
    // frame and no reconnect recovery can explain a second read. One would only
    // be a timer.
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: indexing · 41/68");
    await page.waitForTimeout(4_000);
    expect(stub.calls()).toBe(1);
  });

  /*
   * A server that does not answer knows nothing about a workspace's vectors, so
   * the pill makes no claim at all: `index: disabled` would assert there is no
   * semantic index here, which nobody knows. The rest of the strip carries on —
   * a failed read of one endpoint is not a reason to stop rendering the shell.
   */
  test("is absent rather than guessing when the read fails", async ({ page }) => {
    await page.route("**/api/index/status", (route) => route.abort("connectionrefused"));
    await page.goto("/");

    await expect(page.locator(".console-strip .agent-pill")).toHaveText("agent: idle · queue 0");
    await expect(pill(page)).toHaveCount(0);
    await expect(page.locator(".index-status")).toHaveCount(0);
  });
});

test.describe("the expanded drawer's index row", () => {
  const DOWNLOADING: Status = {
    indexed: 0,
    pending: 0,
    failed: 0,
    identity: null,
    rebuilding: false,
    state: "disabled",
    detail:
      "downloading the all-MiniLM-L6-v2 embedding model (10.4 MiB of 22.6 MiB, 46%) — " +
      "semantic ranking starts once it is cached",
  };

  test("renders the server's sentence verbatim, and the failed count", async ({ page }) => {
    await stubIndex(page, [{ ...DOWNLOADING, failed: 4 }]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: disabled");
    // Collapsed, the drawer's chrome is not mounted and neither is the row.
    await expect(page.locator(".index-status")).toHaveCount(0);

    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    // Character for character: the wording is the server's, and nothing between
    // the wire and this element may parse, shorten or reword it.
    await expect(page.locator(".index-detail")).toHaveText(DOWNLOADING.detail ?? "");
    await expect(page.locator(".index-failed")).toHaveText("4 failed");
    await expect(page.locator(".index-failed")).toHaveCSS("color", SIGNAL);

    // It pushes, like everything else in the drawer: the row sits above the
    // master-detail body, and the body keeps the height the layout gave it.
    const [rowBox, bodyBox] = await Promise.all([
      page.locator(".index-status").boundingBox(),
      page.locator(".console-body").boundingBox(),
    ]);
    expect(rowBox?.y ?? 0).toBeLessThan(bodyBox?.y ?? 0);
    expect(
      await page.locator(".index-status").evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThan(0);
  });

  test("says nothing at all when there is nothing to add", async ({ page }) => {
    await stubIndex(page, [CAUGHT_UP]);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: current · 273 indexed");
    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    await expect(page.locator(".index-status")).toHaveCount(0);
    await expect(page.locator(".index-failed")).toHaveCount(0);
  });
});
