import type { AgentLane } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **The address card is as large as its place allows** — SPEC.md §11's rider
 * authorized 2026-08-21 (SHARED-061), measured in a real browser (UI-142).
 *
 * ## What was wrong, in numbers
 *
 * The card's containing block is `.composer-address`, which is only as wide as
 * the address pill (~140px), so its shrink-to-fit width always collapsed to
 * `min-width: 240px` and the `max-width: min(330px, 86vw)` beside it was never
 * once reachable. Its height was clamped by `--address-pop-cap: 280px`.
 * Measured before the fix, with an ordinary roster and nothing pathological:
 *
 *     roster  viewport    card w×h   room above   the lane list
 *     ------  ---------   --------   ----------   -------------------------
 *      3      1280×720    240×255       254px     fits
 *      3      1728×1080   240×255       254px     fits
 *      9      1280×720    240×280       422px     142 of 219 — "scroll for the rest"
 *      9      1728×1080   240×280       782px     168 of 219 — "scroll for the rest"
 *
 * A window with 782px of room drew a 280px card, put nine lanes behind a
 * scrollbar, and drew the very same box a 1280×720 window drew. 240px is 43% of
 * the 560px column the card opens over. The user reported it as *"the size of
 * this window is so small I can't even see what's in it"*.
 *
 * ## Why every assertion here is a relationship
 *
 * v0.15.0 lost a CI cycle to a spec that pinned a pixel count, because a number
 * true in one machine's mono is false in another's — and the four numbers this
 * issue deleted were themselves pinned in two of these files as `toBe(240)` and
 * `toBeLessThanOrEqual(280)`, which is a defect written down as a test. So
 * nothing below names a size. Each test states the rule instead: the card is a
 * fraction of the room it opens into, it grows when that room grows, and an
 * ordinary roster is *read* rather than scrolled.
 *
 * ## And it still may not grow for what it holds
 *
 * SHARED-061 refuses a cage and a balloon in one paragraph — *"the room is the
 * input; the content is not"* — so the last test here changes the content at a
 * fixed room and measures that nothing moved. The preview loop UI-127 closed is
 * measured in `address-geometry.spec.ts` and is deliberately not repeated.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  query: { type: "thread" },
  pinned: true,
  order: 1,
};

const HOST: StubRow = {
  id: "th_host",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_host.md",
  body: "## user · 2026-08-17T10:00:00Z\n\nWhere did the forecast land?\n",
};

/**
 * The same conversation, long enough that its composer sits at the **foot** of
 * a full scrollport rather than near its head.
 *
 * The distinction is load-bearing and not a fixture detail: the card grows
 * upward and never flips (UI-130), so the room it has is the space between the
 * composer line and the top of the scrollport. On a one-turn conversation that
 * is small in any window, and honestly so. This is the document that gives the
 * card a large room to be measured against.
 */
const LONG_HOST: StubRow = {
  ...HOST,
  body: Array.from(
    { length: 30 },
    (_unused, index) =>
      `## user · 2026-08-17T10:00:00Z\n\nTurn ${String(index)} of the conversation.\n`,
  ).join("\n"),
};

const NOW = new Date();
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

/**
 * A roster of `count` designated lanes plus the orchestrator's.
 *
 * **Nine rows is the ordinary case and not a stress fixture**, which is the
 * whole of SHARED-061's second question. A workspace that has parked a resident
 * on a handful of its conversations has this roster on its ordinary reading
 * path — §7 makes a lane out of every conversation somebody designated — and it
 * is the roster the reported screenshot was taken with (`2 lanes · scroll for
 * the rest`, in a 240px box).
 */
const laneRoster = (count: number): readonly AgentLane[] =>
  Array.from({ length: count }, (_unused, index) => ({
    lane: `th_lane_${String(index)}`,
    resident: { name: `designated-${String(index)}`, docId: `doc_${String(index)}`, weight: null },
    live: false,
    since: ago(17 * 60_000),
    summary: null,
    origin: { id: `th_lane_${String(index)}`, title: `Conversation ${String(index)}` },
  }));

const POP = '[data-address-pop="th_host"]';
const LINE = 'button[data-address-line="th_host"]';
const LIST = '[data-composer-address="th_host"] .recipient-lanes';
const SAYS = '[data-recipient-statement="th_host"]';

/** Somewhere the popover is not, so no row is previewed. */
const AWAY = { x: 4, y: 4 } as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

/**
 * Resolves once `selector`'s box has read the same three times running.
 *
 * A fixture concern and never an assertion — the roster lands after the first
 * paint, so the address line re-words itself a moment after the composer
 * appears, and a press inside that window is no press at all.
 */
async function settled(page: Page, selector: string): Promise<void> {
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await page.locator(selector).boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(100);
  }
  throw new Error("the address line never stopped moving");
}

/**
 * A reply composer on `th_host` in a column of `width`, its card open.
 *
 * The board remembers an open reader in `localStorage`, so a second call inside
 * one test would land in the reader rather than on the list and the fixture
 * would stop being the fixture. Clearing it on every navigation is what lets a
 * test measure two rooms without a second browser context — which would be
 * outside `./coverage`'s instrumented `page` fixture.
 */
async function openReply(
  page: Page,
  options: {
    readonly lanes: readonly AgentLane[];
    readonly width?: number;
    readonly doc?: StubRow;
    /** Puts the composer at the foot of its scrollport, where the room is. */
    readonly scrollToFoot?: boolean;
  },
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  const view =
    options.width === undefined
      ? THREADS_VIEW
      : { ...THREADS_VIEW, extra: { width: options.width } };
  await stubCorpus(page, [view, options.doc ?? HOST], {
    lanes: options.lanes,
    agent: { live: false, since: ago(4 * 60_000) },
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_host"]').click();
  await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
  if (options.scrollToFoot === true)
    await page.locator(".reader-scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
  await page.mouse.move(AWAY.x, AWAY.y);
  await settled(page, LINE);
  await page.locator(LINE).click();
  await expect(page.locator(POP)).toBeVisible();
  await page.mouse.move(AWAY.x, AWAY.y);
}

/**
 * The row the address line sits in — the card's *place*, in §11's sense, and
 * the element `ComposerAddress` measures its width against.
 *
 * Written as "the foot that contains this control" rather than as a path from
 * the composer, because that is what the implementation reads: the control's
 * own `parentElement`. A locator that named a different box would be testing a
 * relationship the code does not have.
 */
const hostRow = (page: Page): Locator =>
  page.locator('.reader .composer-foot:has([data-composer-address="th_host"])');

test.describe("the card takes the room its place offers", () => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ] as const) {
    test(`at ${String(size.width)}×${String(size.height)} it fills the row it sits in`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openReply(page, { lanes: laneRoster(2) });

      const card = await boxOf(page.locator(POP));
      const row = await boxOf(hostRow(page));

      // A fraction and not a figure. Three quarters is well under what the fix
      // actually achieves (400 of 434, 92%) and well over what the defect did
      // (240 of 434, 55%), so it fails loudly if the constant comes back and
      // survives a machine whose glyphs shift the row's own width.
      expect(
        card.width / row.width,
        `the card is ${String(card.width)}px inside a ${String(row.width)}px row`,
      ).toBeGreaterThan(0.75);

      // …and it does not spill out of the room in the other direction — UI-136
      // is the same rule read from the other side, and a fix for one must not
      // be a defect of the other.
      const scroll = await boxOf(page.locator(".reader-scroll"));
      expect(card.x + card.width).toBeLessThanOrEqual(scroll.x + scroll.width);
    });
  }

  test("a wider host row gets a wider card — the bound reads the room", async ({ page }) => {
    // Two surfaces, two rows, one rule. The reply composer's foot is bounded by
    // the conversation card's reading measure and the global panel's action bar
    // by `min(640px, 100vw - 48px)`, so the two rows are honestly different
    // widths in the same window — and the card has to be different with them.
    //
    // **Not the column's width**, which was tried and is the wrong claim: a
    // reply composer lives inside `.thread-card`, whose measure is `--doc-measure`
    // and not the column, so a column dragged from 420 to 820 leaves the foot at
    // 434px in both. The card follows its row; the row follows its own measure.
    // A test that asserted otherwise would be asserting a bug.
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    await openReply(page, { lanes: laneRoster(2) });
    const reply = await boxOf(page.locator(POP));
    const replyRow = await boxOf(hostRow(page));

    await stubCorpus(page, [THREADS_VIEW, HOST], {
      lanes: laneRoster(2),
      agent: { live: false, since: ago(4 * 60_000) },
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();
    await settled(page, '[data-address-line="compose"]');
    await page.locator('button[data-address-line="compose"]').click();
    await expect(page.locator('[data-address-pop="compose"]')).toBeVisible();
    const global = await boxOf(page.locator('[data-address-pop="compose"]'));
    const globalRow = await boxOf(page.locator(".compose-actions"));

    expect(globalRow.width, "the fixture's two rows are the same width").toBeGreaterThan(
      replyRow.width,
    );
    expect(
      global.width,
      `${String(reply.width)}px in a ${String(replyRow.width)}px foot, ` +
        `${String(global.width)}px in a ${String(globalRow.width)}px bar`,
    ).toBeGreaterThan(reply.width);
  });

  test("a narrower window narrows the global composer's card with it", async ({ page }) => {
    test.setTimeout(60_000);
    const openCompose = async (width: number): Promise<Box> => {
      await page.setViewportSize({ width, height: 720 });
      await stubCorpus(page, [THREADS_VIEW, HOST], {
        lanes: laneRoster(2),
        agent: { live: false, since: ago(4 * 60_000) },
      });
      await page.goto("/");
      await page.locator(".board").waitFor();
      await page.keyboard.press("c");
      await expect(page.locator(".compose-panel")).toBeVisible();
      await settled(page, '[data-address-line="compose"]');
      await page.locator('button[data-address-line="compose"]').click();
      await expect(page.locator('[data-address-pop="compose"]')).toBeVisible();
      await page.mouse.move(AWAY.x, AWAY.y);
      return boxOf(page.locator('[data-address-pop="compose"]'));
    };

    // The panel is `min(640px, 100vw - 48px)`, so below ~688px of viewport its
    // width *is* the window's. This is the one host where the viewport itself
    // is the room, and it is where the rider's own sentence is measurable.
    const roomy = await openCompose(1280);
    const cramped = await openCompose(560);

    expect(
      cramped.width,
      `${String(roomy.width)}px at 1280, ${String(cramped.width)}px at 560`,
    ).toBeLessThan(roomy.width);
    // And never below its floor, which is the only pixel left in this file: a
    // room narrower than the floor is a surface that cannot be given what it
    // needs, and SHARED-061 says it overflows honestly rather than hiding rows.
    expect(cramped.width).toBeGreaterThan(0);
  });
});

test.describe("scrolling is for content that cannot fit", () => {
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1728, height: 1080 },
  ] as const) {
    test(`an ordinary roster is read, not scrolled, at ${String(size.width)}×${String(size.height)}`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await openReply(page, { lanes: laneRoster(8) });
      await expect(page.locator(`${LIST} [data-recipient-lane]`)).toHaveCount(9);

      const list = await page
        .locator(LIST)
        .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));

      // The reported symptom, inverted. Before the fix this list showed 142 of
      // 219px at 1280×720 and 168 of 219px at 1728×1080, and said `9 lanes ·
      // scroll for the rest` at both.
      expect(
        list.scroll,
        `${String(list.scroll)}px of lanes in a ${String(list.client)}px list`,
      ).toBeLessThanOrEqual(list.client + 1);
      await expect(page.locator('[data-address-more="th_host"]')).toHaveCount(0);
    });
  }

  test("a taller window shows more of the same roster", async ({ page }) => {
    // The rider's own sentence, measured: *"a larger window makes it larger"*.
    // Same roster, same column, two window heights — so the only thing that
    // differs is the room above the composer, and what the list can show has to
    // follow it or the bound is not the room.
    test.setTimeout(60_000);
    const shown = async (height: number): Promise<number> => {
      await page.setViewportSize({ width: 1280, height });
      await openReply(page, { lanes: laneRoster(29) });
      return page.locator(LIST).evaluate((element) => element.clientHeight);
    };

    const cramped = await shown(400);
    const roomy = await shown(1000);
    expect(
      roomy,
      `${String(cramped)}px of list at 1280x400, ${String(roomy)}px at 1280x1000`,
    ).toBeGreaterThan(cramped);
  });

  test("the ceiling is the room and not a number — a big roster in a big window is whole", async ({
    page,
  }) => {
    // The test the *height* half of this fix needs, and the one the
    // ordinary-roster tests above cannot give it: at the card's room-derived
    // width nine lanes fit inside even the old 280px ceiling, so only a roster
    // needing **more than that ceiling and less than the room** can tell a
    // room-derived bound from a constant one.
    //
    // **The conversation has to be long, and scrolled.** The card grows upward
    // out of its composer and never flips (UI-130's deliberate clamp), so its
    // room is the space between the composer line and the top of the
    // scrollport — which is small on a one-turn conversation however tall the
    // window is, because the composer is sitting near the top of the scrollport.
    // The room is genuinely small there. It is at the *foot* of a long
    // conversation that the room is large, and that is where a ceiling below it
    // is visible as a defect: measured 782px of room under a 280px card.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openReply(page, { lanes: laneRoster(20), doc: LONG_HOST, scrollToFoot: true });
    await expect(page.locator(`${LIST} [data-recipient-lane]`)).toHaveCount(21);

    const list = await page
      .locator(LIST)
      .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    const card = await boxOf(page.locator(POP));
    const scroll = await boxOf(page.locator(".reader-scroll"));
    const room = card.y + card.height - scroll.y;

    // The room above the line is real and far larger than any ceiling this file
    // ever carried…
    expect(room, `only ${String(room)}px of room — the fixture is not scrolled`).toBeGreaterThan(
      400,
    );
    // …so the roster is read rather than scrolled.
    expect(
      list.scroll,
      `${String(list.scroll)}px of lanes in a ${String(list.client)}px list, ` +
        `with ${String(room)}px of room above the line`,
    ).toBeLessThanOrEqual(list.client + 1);
    await expect(page.locator('[data-address-more="th_host"]')).toHaveCount(0);
  });

  test("a roster that outruns even the room says so", async ({ page }) => {
    // The honest end of the rule (SHARED-061's last sentence): where a surface
    // cannot be given the room its content needs, it states the bound rather
    // than ending quietly. Thirty lanes at 1280×400 is that case.
    await page.setViewportSize({ width: 1280, height: 400 });
    await openReply(page, { lanes: laneRoster(29) });

    const list = await page
      .locator(LIST)
      .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    expect(list.scroll).toBeGreaterThan(list.client);
    await expect(page.locator('[data-address-more="th_host"]')).toHaveText(/30 lanes/);
  });
});

test.describe("the room is the input and the content is not", () => {
  test("two rosters of the same length draw the same box, whatever they say", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const terse = laneRoster(4);
    // The same four lanes, each saying as much as §7 lets a lane say: a live
    // resident writing its own summary, at `LANE_SUMMARY_MAX_LENGTH`.
    const verbose: readonly AgentLane[] = terse.map((lane) => ({
      ...lane,
      live: true,
      summary:
        "reading the quarter's filings and reconciling the reported exposure against the ledger, then drafting the note that the release researcher asked for on Tuesday afternoon",
    }));

    const measure = async (lanes: readonly AgentLane[]): Promise<Box> => {
      await openReply(page, { lanes });
      return boxOf(page.locator(POP));
    };

    const quiet = await measure(terse);
    const loud = await measure(verbose);

    // SHARED-057, still true after SHARED-061 widened the box: a card that grew
    // as its lanes filled would re-introduce the oscillation v0.15.0 was named
    // for. Only the width is asserted — the height legitimately follows how
    // many rows there are, which is what a popover list is.
    expect(loud.width, "the card resized for what it holds").toBe(quiet.width);
  });

  test("the statement's box is a reserve, and the longest sentence §7 allows does not move it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // `LANE_SUMMARY_MAX_LENGTH` is 200 characters, so this is the longest
    // statement the product can produce — a live resident writing its own
    // summary, at the contract's own ceiling.
    const summary = `reading the quarter's filings and reconciling the reported exposure against the ledger, ${"then drafting the note the release researcher asked for".padEnd(112, ".")}`;
    await openReply(page, {
      lanes: laneRoster(3).map((lane, index) =>
        index === 0 ? { ...lane, live: true, since: ago(20_000), summary } : lane,
      ),
    });

    const says = page.locator(SAYS);
    const at = await boxOf(says);
    await page.locator(`${LIST} [data-recipient-lane="th_lane_0"]`).focus();
    const loud = await boxOf(says);
    await page.locator(`${LIST} [data-recipient-lane="th_lane_1"]`).focus();
    const quiet = await boxOf(says);

    // The reserve is what SHARED-057 asks for and SHARED-061 does not repeal:
    // the box is a property of its place, so previewing the wordiest lane in
    // the roster and then the tersest changes the sentence and nothing else.
    expect(loud.height, "the statement's box grew for its sentence").toBe(at.height);
    expect(quiet.height, "the statement's box shrank for its sentence").toBe(at.height);

    // …and whatever the box does with it, the whole of it is reachable
    // (SHARED-057 clause 2).
    await page.locator(`${LIST} [data-recipient-lane="th_lane_0"]`).focus();
    await expect(says).toHaveAttribute("title", new RegExp(summary.slice(0, 40)));
  });
});
