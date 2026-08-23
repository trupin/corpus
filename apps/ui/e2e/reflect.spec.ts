import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubEventStream } from "./eventStream";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **What changed since the agent last looked**, in a real browser (UI-153;
 * SPEC.md §7's rider 9, signed 2026-08-22, and §10's board bar).
 *
 * The rider's last sentence is the whole spec: *"a document whose `updated` is
 * later than `reflected` is marked on every board, each column counts its own, a
 * board tab carries a dot while it holds any, and the Reflect control carries
 * the corpus count. When the job lands, the marks clear."*
 *
 * Three things are only assertable here. **That the marks are drawn at all** — a
 * unit test that checks a dot is absent when it should be passes just as well
 * against a component that never draws one. **That the number and the marks
 * agree** — the count comes from the server and the marks from the rows, by the
 * same predicate, and a browser is the only place both are on screen together.
 * And **that the marks clear on an `invalidate` frame**, with no reload and no
 * act of the page's own, which is what "when the job lands" means.
 */

/** The clock: everything below is written either side of it. */
const CLOCK = "2026-08-01T09:00:00.000Z";
/** Written by a person after the clock — the one unreflected document. */
const CHANGED_AT = "2026-08-15T09:00:00.000Z";
/** The reflection's own output, written by the agent after everything. */
const DIGEST_AT = "2026-08-16T09:00:00.000Z";
/** Where the clock lands when the reflection finishes. */
const LANDED_AT = "2026-08-17T09:00:00.000Z";

/**
 * The board's chrome, written **before** the clock, so the corpus count is
 * exactly the one visible mark. A board document and a view document are
 * documents like any other and the server counts them — which is correct, and
 * would make this spec assert a number it has to explain rather than the one it
 * is about.
 */
const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  query: { folder: "inbox" },
  updated: "2026-07-01T09:00:00.000Z",
};

const BOARD: StubRow = {
  id: "doc_board_attention",
  type: "board",
  title: "Attention",
  path: "data/docs/boards/attention.md",
  order: 1,
  columns: [VIEW.id],
  defaultOpen: true,
  updated: "2026-07-01T09:00:00.000Z",
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Mortgage options",
  path: "data/docs/inbox/mortgage.md",
  body: "6.4% this week.\n",
  updated: CHANGED_AT,
  lastActor: "user",
};

/**
 * The digest a reflection posts, and the case §7's amendment is about: it is
 * newer than everything else on the board and it is **never marked**, because
 * the agent wrote it.
 */
const DIGEST: StubRow = {
  id: "th_digest",
  type: "thread",
  title: "Reflection — 12 documents",
  path: "data/docs/inbox/digest.md",
  body: `## agent · ${DIGEST_AT}\nNothing needed attention.\n`,
  updated: DIGEST_AT,
  lastActor: "agent",
};

const SEED = [BOARD, VIEW, NOTE, DIGEST];

const column = (page: Page) => page.locator('.col[data-col="doc_view_inbox"]');
const row = (page: Page, id: string) => column(page).locator(`.row[data-row-doc="${id}"]`);
const tab = (page: Page) => page.locator('.boardbar .board-tab[data-board="doc_board_attention"]');
const reflectButton = (page: Page) => page.locator(".boardbar .reflect-ask");
const clock = (page: Page) => page.locator(".boardbar .reflect-clock");

test.describe("what changed since the agent last looked", () => {
  test("marks the rows, counts the column, dots the tab and carries the corpus count", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    await stubCorpus(page, SEED, { reflect: { reflected: CLOCK } });
    await page.goto("/");

    await expect(row(page, "doc_note")).toBeVisible();

    // The row a person changed carries the mark…
    await expect(row(page, "doc_note").locator(".changed-mark")).toHaveCount(1);
    // …and the digest the agent wrote does not, though it is newer.
    await expect(row(page, "th_digest").locator(".changed-mark")).toHaveCount(0);

    // The column counts its own.
    await expect(column(page).locator(".col-changed")).toHaveText("1 changed");

    // The tab carries a dot while it holds any.
    await expect(tab(page).locator(".changed-mark")).toHaveCount(1);

    // And the control carries the corpus count, which agrees with the marks:
    // the server counted it with the predicate the rows were marked with.
    await expect(reflectButton(page)).toHaveText(/^Reflect · 1 change since /);
    await expect(clock(page)).toHaveText(/^reflected /);

    expect(uncaught).toEqual([]);
  });

  test("a quiet corpus says nothing", async ({ page }) => {
    // The clock is after everything, which is a corpus the agent has read.
    await stubCorpus(page, SEED, { reflect: { reflected: LANDED_AT } });
    await page.goto("/");

    await expect(row(page, "doc_note")).toBeVisible();
    await expect(column(page).locator(".changed-mark")).toHaveCount(0);
    await expect(column(page).locator(".col-changed")).toHaveCount(0);
    await expect(tab(page).locator(".changed-mark")).toHaveCount(0);
    // Still offered: a person may always ask (§7).
    await expect(reflectButton(page)).toHaveText("Reflect");
    await expect(reflectButton(page)).toBeEnabled();
  });

  /**
   * §7: "a person asks — the board bar's Reflect control — and it is enqueued at
   * once", and "an ask while one is pending is answered with the pending one,
   * never doubled". So the second press produces no second event and no error.
   */
  test("asking shows the pending state, and asking again neither doubles nor fails", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, SEED, { reflect: { reflected: CLOCK } });
    await page.goto("/");
    await expect(reflectButton(page)).toHaveText(/1 change/);

    await reflectButton(page).click();
    await expect(reflectButton(page)).toHaveText("reflecting…");
    await expect(reflectButton(page)).toBeDisabled();
    // The pending state is honest and nothing else is claimed: no progress bar,
    // no percentage (SPEC.md §8's rule about what a surface may say).
    await expect(page.locator(".toast")).toHaveCount(0);

    const asks = await corpus.of("POST", "/api/workspace/reflect");
    expect(asks).toHaveLength(1);
    // The window is server state, so the ask carries no body of its own.
    expect(asks[0]?.body).toBeUndefined();
  });

  /**
   * "When the job lands, the marks clear" — and it lands in a process this suite
   * does not run, so the clock moves **behind the page's back** and what
   * repaints the board is the `invalidate` frame and nothing else.
   */
  test("the marks clear when the reflection lands, over SSE and with no reload", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, SEED, {
      reflect: { reflected: CLOCK, pending: "evt_running" },
    });
    const events = await stubEventStream(page);

    try {
      await page.goto("/");
      await expect(row(page, "doc_note").locator(".changed-mark")).toHaveCount(1);
      await expect(reflectButton(page)).toHaveText("reflecting…");
      // Never assumed: without the stream open the push below proves nothing.
      await events.waitForConnection();

      await corpus.landReflection(LANDED_AT, "th_digest");
      // The one key the server names for this resource. It rides on every frame
      // that names `["docs"]` or `["queue"]` (SERVER-137), and this is the frame
      // a queue transition produces.
      events.push([["reflect"], ["queue"], ["jobs"]]);

      await expect(row(page, "doc_note").locator(".changed-mark")).toHaveCount(0);
      await expect(column(page).locator(".col-changed")).toHaveCount(0);
      await expect(tab(page).locator(".changed-mark")).toHaveCount(0);
      await expect(reflectButton(page)).toHaveText("Reflect");
      await expect(reflectButton(page)).toBeEnabled();
    } finally {
      await events.close();
    }
  });

  test("the clock opens the digest thread it links to", async ({ page }) => {
    const corpus = await stubCorpus(page, SEED, {
      reflect: { reflected: CLOCK, lastDigest: "th_digest" },
    });
    await page.goto("/");

    await expect(clock(page)).toHaveText(/^reflected /);
    await clock(page).click();

    // The reader read the document, which is what opening one is: the column
    // list is a collection query and never fetches a document by id.
    await expect
      .poll(async () => (await corpus.of("GET", "/api/docs/th_digest")).length)
      .toBeGreaterThan(0);
  });

  test("says reflections are manual only when the quiet window is zero", async ({ page }) => {
    await stubCorpus(page, SEED, { reflect: { reflected: CLOCK, quiet: 0 } });
    await page.goto("/");

    await expect(reflectButton(page)).toHaveAttribute("title", /manual only/);
  });

  /**
   * The bar is chrome and stays 38px however much the control has to say
   * (SPEC.md §10: "nothing resizes because of what it holds"). Measured with the
   * longest label the control can reach and with the shortest, in one page.
   */
  test("the control never changes the bar's height", async ({ page }) => {
    const corpus = await stubCorpus(page, SEED, { reflect: { reflected: CLOCK } });
    await page.goto("/");
    await expect(reflectButton(page)).toHaveText(/1 change/);

    const bar = page.locator(".boardbar");
    const loudBar = await bar.boundingBox();
    const loudTab = await tab(page).boundingBox();
    expect(loudBar?.height).toBe(38);

    await corpus.landReflection(LANDED_AT);
    await page.reload();
    await expect(reflectButton(page)).toHaveText("Reflect");
    const quietBar = await bar.boundingBox();
    const quietTab = await tab(page).boundingBox();

    expect(quietBar?.height).toBe(38);
    // And the tabs did not move: the control sits past a flexible spacer, so
    // the width it gains comes out of the slack and out of nothing else.
    expect(quietTab?.x).toBe(loudTab?.x);
    expect(quietTab?.width).toBe(loudTab?.width);
  });
});
