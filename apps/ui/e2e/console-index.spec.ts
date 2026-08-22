import {
  INDEX_KEY,
  INVALIDATE_EVENT,
  type IndexStatus,
  type InvalidatePayload,
} from "@corpus/contract";
import type { Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { hexToRgb, token } from "./tokens";

/**
 * UI-040's index pill (SPEC.md §10's index-pill rider, signed 2026-08-02),
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

/*
 * The contract's own `IndexStatus`, not a transcription of it. The local
 * interface this replaces had `state: string`, so a spec could seed a state the
 * server has no word for and nothing would say so (UI-102).
 */
type Status = IndexStatus;

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
 * The SSE endpoint itself — `<origin>/events?token=…` and nothing else.
 *
 * A recursive-wildcard glob ending in `events*` is **wrong here**, and
 * expensively so: Playwright matches globs against the whole URL, and the dev
 * server hands the browser its modules
 * by path, including `…/@fs/…/packages/kit/dist/events/sseBridge.js`. That glob
 * therefore captures the bridge's own source file, and a route that refuses or
 * rewrites it takes the application down before it renders — an empty strip and
 * a locator that never resolves, with nothing in the failure to say why. Anchor
 * on the origin and the whole path segment instead.
 */
const EVENT_STREAM = /^https?:\/\/[^/]+\/events(\?|$)/;

/**
 * Refuses `/events` outright, so no stream can ever open.
 *
 * Stated rather than assumed. The suite's standing condition is that no
 * workspace server answers, but a machine running one (a parallel agent's, say)
 * proxies through the dev server and could open a stream mid-test — and an open
 * stream means the bridge's reconnect recovery, which refetches every active
 * query. A spec that counts reads has to own that variable instead of inheriting
 * it from whatever else is running on the box.
 */
async function refuseEvents(page: Page): Promise<void> {
  await page.route(EVENT_STREAM, (route) => route.abort("connectionrefused"));
}

/**
 * Delivers exactly one real `invalidate` frame naming `["index"]`, then refuses
 * every reconnect.
 *
 * Both halves are load-bearing, and the second one is what this spec got wrong
 * the first time round.
 *
 * `route.fulfill` can only send a *complete* body, so the stream ends the moment
 * the frame lands. The bridge treats that as a dropped stream, backs off, and
 * reconnects — and a *reconnect* is precisely when it blanket-refetches active
 * queries, because nothing told it what changed while it was away. That is
 * correct behaviour, not a race: it just means "how many times was the status
 * read" stops being a fact about the frame and becomes a fact about whether the
 * assertion beat the backoff timer. In isolation it did; under a loaded parallel
 * suite it did not, and the read count came back 3 instead of 2.
 *
 * Refusing every retry leaves exactly one successful open in the page's whole
 * life — the one carrying the frame — so there is no reconnect recovery and no
 * second delivery of the same frame. The invalidation stays the only thing that
 * could have moved the counts, which is what the test is about.
 */
async function pushIndexFrame(page: Page): Promise<void> {
  const frame =
    `event: ${INVALIDATE_EVENT}\n` +
    `data: ${JSON.stringify({ keys: [INDEX_KEY] } satisfies InvalidatePayload)}\n\n`;
  let delivered = false;
  await page.route(EVENT_STREAM, async (route) => {
    if (delivered) {
      await route.abort("connectionrefused").catch(() => undefined);
      return;
    }
    delivered = true;
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
   *
   * What is asserted is durable — the end state, the direction of travel, and
   * the page's identity — never a specific intermediate count. Whether the
   * server's own reconnect recovery adds a read on top is timing, and timing is
   * exactly what a loaded four-worker suite does not preserve. The claim "and
   * never more than that" belongs to the poller test below, which is the one
   * that can hold it deterministically.
   */
  test("counts climb on an ['index'] frame, with no reload", async ({ page }) => {
    const stub = await stubIndex(page, [REBUILDING, { ...CAUGHT_UP, indexed: 68 }]);
    // Nothing may open a stream before the frame is pushed — otherwise the
    // "one read so far" below is a fact about the machine, not about the page.
    // `pushIndexFrame` registers later and therefore takes precedence.
    await refuseEvents(page);
    await page.goto("/");

    await expect(pill(page)).toHaveText("index: indexing · 41/68");
    expect(stub.calls()).toBe(1);

    // A mark on the document this page mounted with. It cannot survive a
    // navigation, which is what makes "with no reload" an assertion rather than
    // a hope — the pill updating after a full reload would prove nothing.
    await page.evaluate(() => {
      (globalThis as unknown as Record<string, unknown>)["__ui040Mounted"] = "kept";
    });

    await pushIndexFrame(page);

    await expect(pill(page)).toHaveText("index: current · 68 indexed", { timeout: 20_000 });
    await expect(dot(page)).toHaveCSS("background-color", GOOD);

    // Same document, never reloaded.
    expect(
      await page.evaluate(
        () => (globalThis as unknown as Record<string, unknown>)["__ui040Mounted"],
      ),
    ).toBe("kept");
    // The frame caused a re-read. The counts moved forward and never back.
    expect(stub.calls()).toBeGreaterThanOrEqual(2);
    await expect(pill(page)).toHaveText("index: current · 68 indexed");
  });

  test("never polls: one read, then nothing until the server says otherwise", async ({ page }) => {
    const stub = await stubIndex(page, [REBUILDING]);
    // No stream, by construction: nothing can open one, so neither a frame nor a
    // reconnect recovery can explain a second read. One would only be a timer.
    await refuseEvents(page);
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

    // The agent pill makes no claim either, for the same reason and about a
    // different fact: nothing answered `GET /api/queue/status` here (UI-098).
    await expect(page.locator(".console-strip .agent-pill")).toHaveText("agent: unknown");
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
