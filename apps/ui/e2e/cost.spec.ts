import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, stubCost, stubCostBucket, type StubRow } from "./stubCorpus";

/**
 * SPEC.md §9.4's measurements panel, in a real browser (UI-190).
 *
 * **This is half of the evidence, and it is the rendering half.** Like the rest
 * of the suite this runs against the Vite dev server with no workspace server
 * behind it, so the corpus — the cost series included — is served from inside
 * the page (`stubCorpus.ts`). What a browser is good for is here: that the panel
 * is on the document and nowhere near the console, that one call site serves an
 * ordinary document and a conversation in both hosts, that the empty state says
 * measurement has not started rather than drawing a flat line at zero, and that
 * a windowed series says it is a window.
 *
 * The other half — that a bucket's figures are what a real ledger holds and
 * what `wc -c` reports — is a real workspace, a real server and a hand check,
 * recorded in UI-190's E2E Verification Log. A stub proves nothing about a
 * measurement.
 */

const INBOX_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** A conversation lives under `data/docs/threads/`, so it needs its own column. */
const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 2,
  query: { type: "thread" },
};

/**
 * The shape the panel exists to show (sprint-025 TEST-1221): a document of
 * 40,000 bytes — 10,000 tokens — whose daily reads sit flat around 300. Flat
 * cost against a document an order of magnitude larger is Phase 57's bounded
 * reads working, and it must be legible at a glance rather than derived.
 */
const BOUNDED: StubRow = {
  id: "doc_bounded",
  title: "A long document, cheaply read",
  body: "Bounded reads keep this cheap however long it gets.",
  cost: stubCost({
    sizeBytes: 40_000,
    measuringSince: "2026-08-28T00:00:00.000Z",
    buckets: [
      stubCostBucket({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-02T00:00:00.000Z",
        readTokens: 280,
        wroteTokens: 20,
        invocations: 4,
        byCommand: { "doc show": 240, search: 60 },
      }),
      stubCostBucket({
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-03T00:00:00.000Z",
        readTokens: 300,
        wroteTokens: 24,
        invocations: 5,
        byCommand: { "doc show": 300, search: 24 },
      }),
      stubCostBucket({
        from: "2026-09-03T00:00:00.000Z",
        to: "2026-09-04T00:00:00.000Z",
        readTokens: 290,
        wroteTokens: 18,
        invocations: 4,
        byCommand: { "doc show": 268, search: 40 },
      }),
    ],
  }),
};

/** A series the server cut: three shown, one hundred and eighty held. */
const WINDOWED: StubRow = {
  id: "doc_windowed",
  title: "A long history, windowed",
  body: "Older buckets exist and are not on the wire.",
  cost: stubCost({
    sizeBytes: 8000,
    total: 180,
    truncated: true,
    buckets: [
      stubCostBucket({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" }),
      stubCostBucket({ from: "2026-09-02T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" }),
    ],
  }),
};

/** Nothing seeded: the empty ledger a fresh — or rebuilt — workspace has. */
const UNTOUCHED: StubRow = {
  id: "doc_untouched",
  title: "Never run against",
  body: "No corpus invocation has ever named this.",
};

/** A conversation with its own series. Threads are documents (SPEC.md §6). */
const CONVERSATION: StubRow = {
  id: "th_priced",
  type: "thread",
  title: "A priced conversation",
  path: "data/docs/threads/th_priced.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhat did this cost?\n",
  parent: "doc_bounded",
  cost: stubCost({ sizeBytes: 1200 }),
};

const CORPUS = [INBOX_VIEW, THREADS_VIEW, BOUNDED, WINDOWED, UNTOUCHED, CONVERSATION];

async function openReader(page: Page, docId: string): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await expect(page.locator(`.reader[data-reader-doc="${docId}"] .doc-title`)).toBeVisible();
}

test.describe("the measurements panel", () => {
  test("draws both series against the size line, and calls the line today's size", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_bounded");

    const panel = page.locator(".reader .cost");
    await expect(panel).toBeVisible();
    await expect(panel.locator("h3")).toHaveText("Measurements");

    const chart = panel.locator(".cost-chart");
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute("data-buckets", "3");
    await expect(chart.locator(".cost-read")).toHaveCount(3);
    await expect(chart.locator(".cost-wrote")).toHaveCount(3);

    // 40,000 bytes ÷ 4, rounded up — one reference line, never a second series.
    await expect(chart.locator(".cost-size")).toHaveCount(1);
    await expect(chart.locator(".cost-size")).toHaveAttribute("data-size-tokens", "10000");
    await expect(panel.locator(".cost-key.size")).toContainText("current size");
    await expect(panel.locator(".cost-key.size")).toContainText("10,000");

    // read 870 + wrote 62.
    const note = panel.locator('.cost-note[data-state="series"]');
    await expect(note).toContainText("932 tokens");
    await expect(note).toContainText("3 daily buckets");
    await expect(note).toContainText("bytes ÷ 4, rounded up");
    await expect(note).toContainText("the document’s size today");
    await expect(note).toContainText("Measuring since 2026-08-28");
  });

  /**
   * Sprint-025 TEST-1221, asserted rather than eyeballed: the whole reason the
   * panel exists is that a flat series under a far higher size line is *visible*.
   * Both facts have to hold at once — the bars must be drawn well below the line,
   * and none of them may have collapsed into the baseline.
   */
  test("makes flat cost against a much larger document legible", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_bounded");

    const geometry = await page.locator(".reader .cost-chart").evaluate((svg) => {
      const line = svg.querySelector(".cost-size");
      const bars = [...svg.querySelectorAll(".cost-read")];
      return {
        lineY: Number(line?.getAttribute("y1") ?? "0"),
        tops: bars.map((bar) => Number(bar.getAttribute("y"))),
        heights: bars.map((bar) => Number(bar.getAttribute("height"))),
      };
    });

    // Every bar's top sits below the size line — a larger `y` is further down.
    for (const top of geometry.tops) expect(top).toBeGreaterThan(geometry.lineY);
    // …and no measured day was drawn as nothing. 1.5 viewBox units is one whole
    // CSS pixel at the narrowest reading measure the panel is given.
    for (const height of geometry.heights) expect(height).toBeGreaterThanOrEqual(1.5);
    // Flat: the three days are within a few tokens of each other, and the
    // drawing has to keep them that way rather than exaggerating the difference.
    const spread = Math.max(...geometry.heights) - Math.min(...geometry.heights);
    expect(spread).toBeLessThan(Math.min(...geometry.heights));
  });

  test("says measurement has not started, instead of drawing an empty chart", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_untouched");

    const panel = page.locator(".reader .cost");
    await expect(panel).toBeVisible();
    await expect(panel.locator('.cost-note[data-state="unmeasured"]')).toContainText(
      "Measurement has not started in this workspace",
    );
    // Never a zero series, and never a flat line at zero.
    await expect(panel.locator(".cost-chart")).toHaveCount(0);
    await expect(panel.locator(".cost-size")).toHaveCount(0);
  });

  test("states a truncated series in the server's own numbers", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_windowed");

    const note = page.locator('.reader .cost .cost-note[data-state="truncated"]');
    await expect(note).toContainText("Older buckets are not shown");
    await expect(note).toContainText("2 of 180 daily buckets");

    // A whole history says nothing of the kind.
    await openReader(page, "doc_bounded");
    await expect(page.locator('.reader .cost .cost-note[data-state="truncated"]')).toHaveCount(0);
  });

  test("names the verb that paid, on demand, with rows that add up", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_bounded");

    const details = page.locator(".reader .cost .cost-commands");
    await expect(details.locator("summary")).toHaveText("By command (2)");
    await details.locator("summary").click();

    await expect(details.locator('tr[data-command="doc show"] td')).toHaveAttribute(
      "data-tokens",
      "808",
    );
    await expect(details.locator('tr[data-command="search"] td')).toHaveAttribute(
      "data-tokens",
      "124",
    );
    // The breakdown sums to the window total the panel prints above it.
    await expect(details.locator(".cost-commands-total td")).toHaveAttribute("data-tokens", "932");
  });

  /**
   * SHARED-079's recorded placement, asserted as a negative. The panel belongs
   * to the document, and a build that also dropped one into the console would
   * pass every test above.
   */
  test("lives with the document and appears nowhere in the console", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_bounded");
    await expect(page.locator(".reader .cost")).toHaveCount(1);

    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();
    for (const tab of await page.locator('.console-tabs [role="tab"]').all()) {
      await tab.click();
      await expect(page.locator(".console-body .cost")).toHaveCount(0);
      await expect(page.locator(".console-body .cost-chart")).toHaveCount(0);
    }
    // …and the document's own panel is still exactly where it was.
    await expect(page.locator(".reader .cost")).toHaveCount(1);
  });

  /**
   * One insertion, four placements (sprint-025 TEST-1214). A conversation is a
   * document, so it gets the panel from the same call site — and both hosts
   * render the same `DocView`.
   */
  test("renders on a document and on a conversation, in the column and in full screen", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);

    /*
     * Scoped per reader, because an open path column survives a reload: after
     * the conversation is opened, `doc_bounded`'s reader is still on the board
     * beside it — which is itself evidence for the claim, and which an
     * unscoped `.reader .cost` would report as a duplicate panel.
     */
    await openReader(page, "doc_bounded");
    await expect(
      page.locator('.reader[data-reader-doc="doc_bounded"] .cost .cost-chart'),
    ).toHaveCount(1);
    await page.locator('.reader[data-reader-doc="doc_bounded"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await expect(page.locator(".focus .cost .cost-chart")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);

    await openReader(page, "th_priced");
    await expect(
      page.locator('.reader[data-reader-doc="th_priced"] .cost .cost-chart'),
    ).toHaveCount(1);
    await page.locator('.reader[data-reader-doc="th_priced"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await expect(page.locator(".focus .cost .cost-chart")).toHaveCount(1);
  });

  /**
   * The panel renders below the body and arrives on its own request, so it must
   * never move the body under a reader's cursor — the hazard `DocView.tsx`
   * records at 77.86px, on the surface where text is selected in order to
   * comment on it.
   */
  test("does not move the body when the series arrives", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();

    // Hold the series until after the editor has painted, then release it.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/docs/doc_bounded/cost", async (route) => {
      await held;
      await route.fallback();
    });

    await page.locator('.row[data-row-doc="doc_bounded"]').click();

    /*
     * The **editor**, which is literally the body, measured through its own
     * rect: `boundingBox()` answers `null` for anything it considers unstable,
     * and a null on either side of the release would make this pass by
     * accident. A number cannot.
     */
    const editor = page.locator('.reader[data-reader-doc="doc_bounded"] [data-doc-editor]');
    await expect(editor).toBeVisible();
    const topOf = (): Promise<number> =>
      editor.evaluate((node) => node.getBoundingClientRect().top);
    const before = await topOf();

    // The panel is still absent: this is the frame the hazard lives in.
    await expect(page.locator('.reader[data-reader-doc="doc_bounded"] .cost-chart')).toHaveCount(0);

    release();
    await expect(page.locator('.reader[data-reader-doc="doc_bounded"] .cost-chart')).toHaveCount(1);

    expect(await topOf()).toBeCloseTo(before, 1);
  });
});
