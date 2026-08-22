import type { AgentLane } from "@corpus/contract";
import { DEFAULT_ROW_NOTE, lanesCappedNote, MISSING_PROFILE_NOTE } from "@corpus/kit";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **Nothing in the address popover resizes because of what it holds** — SPEC.md
 * §11's rider signed 2026-08-20, measured in a real browser (UI-127).
 *
 * ## Why this spec is geometry and not words
 *
 * The popover is `position: absolute; bottom: calc(100% + 6px)`: anchored by its
 * bottom edge, growing upward. Previewing a lane rewrites the statement under
 * the rows, and while that statement was sized by its own text a longer one
 * added lines and pushed **every row above it up**. The row under the cursor
 * left the cursor, `onMouseLeave` fired, the statement went back, the row came
 * back, `onMouseEnter` fired. A closed loop, at frame rate, on the control a
 * person uses to choose who answers. The user reported it as *"blinking up and
 * down which makes it impossible to use"*.
 *
 * Nothing about the words was wrong, so no assertion about the words could have
 * caught it, and jsdom implements no layout — which is why this lives here and
 * not beside the component.
 *
 * ## The two independent measurements
 *
 * 1. **Fixed coordinates.** The pointer is parked at centres captured *before*
 *    anything can move, so the pointer never chases the row it is previewing.
 *    Every row's box and the popover's own box are then compared across a
 *    preview of each lane in turn. This is the amplitude: it was 51px.
 * 2. **Playwright's own stability engine.** `locator.hover()` waits for a
 *    bounding box unchanged across two consecutive animation frames before it
 *    will act. Under the defect it never got one — 58 retries, then a 30s
 *    timeout. So `hover()` merely *succeeding* is a regression test, and it is
 *    the one that speaks in the user's terms: the row could not be pressed.
 *
 * ## The fixture is the whole trick
 *
 * The defect needs two lanes whose statements are **different heights**. A
 * roster whose lanes happen to read alike moves nothing, which is why every
 * spec that already drove this control passed through the whole of v0.14.0 —
 * and why the first attempt at reproducing it passed too. The three rows here
 * are 2, 4 and 6 lines, and each is a state SPEC.md §7 produces.
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

const GONE: StubRow = {
  id: "th_gone",
  type: "thread",
  title: "The claims conversation",
  path: "data/docs/threads/th_gone.md",
  body: "## user · 2026-08-17T09:00:00Z\n\nWhat is our exposure here?\n",
};

/** Fresh, never a literal: a `live: true` older than the grace window lapses. */
const NOW = new Date();
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

/**
 * Two designated lanes which, with the orchestrator's, give three statements of
 * three different lengths — the line counts as measured in the popover's own
 * 218px measure, which is what it had while its width was the constant UI-142
 * removed:
 *
 *     agent will answer — last seen 4m ago — nobody is listening        2 lines
 *     release-researcher will answer — last seen 17m ago —
 *       the orchestrator will answer until it returns                   4 lines
 *     claims-review will answer — its profile is gone — renamed,
 *       deleted, or moved out of .claude/agents/ since — last seen
 *       17m ago — the orchestrator will answer until it returns         6 lines
 *
 * A lapsed lane is ordinary: every agent that is not parked right now reads
 * that way.
 *
 * **The counts are smaller now and the fixture still works**, which is worth
 * saying rather than leaving to be rediscovered. The card takes its measure from
 * the room since UI-142, so a reply composer wraps these in ~378px and the six
 * fits in four. What this spec needs is only that the three statements are
 * *different heights from each other* — that is what made a bottom-anchored card
 * oscillate — and they still are. The one assertion that depended on the six
 * overflowing the reserve is marked where it changed.
 */
const LANES: readonly AgentLane[] = [
  {
    lane: "th_host",
    resident: { name: "release-researcher", docId: "doc_release_agent", weight: null },
    live: false,
    since: ago(17 * 60_000),
    summary: null,
    origin: { id: "th_host", title: "Q3 planning" },
  },
  {
    lane: "th_gone",
    resident: { name: "claims-review", docId: null, weight: null },
    live: false,
    since: ago(17 * 60_000),
    summary: null,
    origin: { id: "th_gone", title: "The claims conversation" },
  },
];

/**
 * The control names itself by its host surface, and there is one of it per
 * composer — so every selector here takes the surface rather than naming one.
 * `th_host` is the reply composer in the reader, `compose` the global one.
 */
const picker = (surface: string): string => `[data-composer-address="${surface}"]`;
const popOf = (surface: string): string => `[data-address-pop="${surface}"]`;
const saysOf = (surface: string): string => `[data-recipient-statement="${surface}"]`;
const rowsOf = (surface: string): string => `${picker(surface)} [data-recipient-lane]`;

const PICKER = picker("th_host");
const POP = popOf("th_host");
const SAYS = saysOf("th_host");
const ROWS = rowsOf("th_host");

/** Somewhere the popover is not, so no row is previewed. */
const AWAY = { x: 4, y: 4 } as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Every box a preview could move, rounded to the pixel a person could see. */
interface Geometry {
  readonly pop: Box;
  readonly says: Box;
  readonly rows: readonly Box[];
}

const round = (box: Box): Box => ({
  x: Math.round(box.x),
  y: Math.round(box.y),
  width: Math.round(box.width),
  height: Math.round(box.height),
});

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element has no box");
  return round(box);
}

async function geometry(page: Page, surface = "th_host"): Promise<Geometry> {
  // Two frames, so a layout a preview asked for has certainly happened by the
  // time it is measured. This rules out a false pass and nothing else: a defect
  // that took longer than two frames to move something would still be read by
  // the next iteration.
  await page.evaluate(
    () => new Promise((settle) => requestAnimationFrame(() => requestAnimationFrame(settle))),
  );
  const rows = page.locator(rowsOf(surface));
  const count = await rows.count();
  const boxes: Box[] = [];
  for (let index = 0; index < count; index += 1) boxes.push(await boxOf(rows.nth(index)));
  return {
    pop: await boxOf(page.locator(popOf(surface))),
    says: await boxOf(page.locator(saysOf(surface))),
    rows: boxes,
  };
}

/**
 * Resolves once `locator`'s box has read the same three times running, 100ms
 * apart.
 *
 * A fixture concern and never an assertion. The roster lands after the first
 * paint, so the address line re-words itself — and re-sizes — a moment after
 * the composer appears. A press inside that window puts its `pointerdown` on
 * the line and its `pointerup` on the composer behind it, which is no press at
 * all: the popover never opens, and the failure reads as if the control were
 * broken.
 */
async function settled(page: Page, locator: Locator): Promise<void> {
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await locator.boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(100);
  }
  throw new Error("the address line never stopped moving");
}

/** The board, a reply composer on `th_host`, and its address popover open. */
async function open(page: Page): Promise<void> {
  await stubCorpus(page, [THREADS_VIEW, HOST, GONE], {
    lanes: LANES,
    agent: { live: false, since: ago(4 * 60_000) },
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_host"]').click();
  await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
  await page.mouse.move(AWAY.x, AWAY.y);

  const line = page.locator('button[data-address-line="th_host"]');
  await expect(line).toContainText("release-researcher");
  await settled(page, line);
  await line.click();
  await expect(page.locator(POP)).toBeVisible();
  await expect(page.locator(ROWS)).toHaveCount(LANES.length + 1);
  // The press left the pointer on the line. Park it before anything is measured.
  await page.mouse.move(AWAY.x, AWAY.y);
}

test.describe("the address popover holds still while you read it", () => {
  test("previewing a lane with the pointer changes the words and no geometry", async ({ page }) => {
    await open(page);
    const rows = page.locator(ROWS);
    const count = await rows.count();

    // Captured once, with the pointer away, so a moving row cannot drag the
    // measurement with it: every hover below aims at where the row is at rest.
    const at = await geometry(page);
    const centres = at.rows.map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
    const said: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const centre = centres[index];
      if (centre === undefined) throw new Error("no centre for that row");
      const lane = await rows.nth(index).getAttribute("data-recipient-lane");

      await page.mouse.move(centre.x, centre.y);
      expect(await geometry(page), `previewing ${String(lane)} moved something`).toEqual(at);
      said.push((await page.locator(SAYS).textContent()) ?? "");

      await page.mouse.move(AWAY.x, AWAY.y);
      expect(await geometry(page), `leaving ${String(lane)} moved something`).toEqual(at);
    }

    // The control is alive: it really did say something different about every
    // lane, so the geometry held across real changes and not across none.
    expect(new Set(said).size).toBe(count);
  });

  test("every row is stable enough to hover — the user's complaint, in the tool's terms", async ({
    page,
  }) => {
    await open(page);
    const rows = page.locator(ROWS);
    const count = await rows.count();
    // `hover()` waits for a bounding box unchanged across two consecutive
    // animation frames. Under the defect it never got one and gave up at 30s,
    // so a short timeout here is a fast regression rather than a flake risk.
    for (let index = 0; index < count; index += 1) {
      await rows.nth(index).hover({ timeout: 5_000 });
      await expect(page.locator(POP)).toBeVisible();
    }
    // …and the choice a hover exists to serve still lands.
    await rows.nth(2).click({ timeout: 5_000 });
    await expect(rows.nth(2)).toHaveAttribute("data-recipient-chosen", "true");
  });

  test("the keyboard preview holds the same geometry — it drives the identical state", async ({
    page,
  }) => {
    await open(page);
    const rows = page.locator(ROWS);
    const count = await rows.count();
    const at = await geometry(page);
    const said: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const lane = await rows.nth(index).getAttribute("data-recipient-lane");
      await rows.nth(index).focus();
      expect(await geometry(page), `focusing ${String(lane)} moved something`).toEqual(at);
      said.push((await page.locator(SAYS).textContent()) ?? "");
      await rows.nth(index).blur();
      expect(await geometry(page), `blurring ${String(lane)} moved something`).toEqual(at);
    }
    expect(new Set(said).size).toBe(count);
  });

  test("a statement is revealed whole however the box treats it", async ({ page }) => {
    await open(page);
    const says = page.locator(SAYS);
    const gone = page.locator(`${PICKER} [data-recipient-lane="th_gone"]`);
    await gone.focus();

    // **This assertion used to be `scroll > client`, and UI-142 is why it is
    // not any more.** §7's missing-profile report is six lines in the 218px
    // measure the card had while its width was a constant, and it was the one
    // ordinary statement that overflowed the four-line reserve. The card takes
    // its measure from the room now, so at a reply composer the same sentence
    // fits — which is the rider of 2026-08-21 working, not a test going soft:
    // *"scrolling is for content that cannot fit, never for content that was
    // not given room."* What still has to hold, and what this test is for, is
    // that the reserve is a reserve: the box does not grow to take the
    // sentence, whichever way the sentence falls. The geometry tests above
    // measure that directly, across every lane.
    //
    // The clipped case has moved to its own fixture below, where the sentence
    // is a lane's free-text summary and is therefore long by construction.

    // Revealed: the whole sentence is on the statement's own title, and
    // the row's has carried `name — note — line` since UI-126.
    const whole = `claims-review will answer — ${MISSING_PROFILE_NOTE} — last seen 17m ago — the orchestrator will answer until it returns`;
    await expect(says).toHaveAttribute("title", whole);
    await expect(gone).toHaveAttribute("title", new RegExp(MISSING_PROFILE_NOTE.slice(0, 24)));

    // The ordinary statements are *not* truncated — including the lapsed one,
    // which is four lines and is what the reserve is sized for. The box is
    // sized for the text people actually have, so revealing is the uncommon
    // case and not the reading path (SPEC.md §11's rider).
    for (const lane of ["orchestrator", "th_host"]) {
      await page.locator(`${PICKER} [data-recipient-lane="${lane}"]`).focus();
      const fits = await says.evaluate((element) => ({
        client: element.clientHeight,
        scroll: element.scrollHeight,
      }));
      expect(fits.scroll, `${lane}'s statement did not fit its box`).toBeLessThanOrEqual(
        fits.client,
      );
    }

    // The default marker is a clause of the sentence the title reveals, not one
    // the box has and the title does not.
    await page.locator(`${PICKER} [data-recipient-lane="th_host"]`).focus();
    await expect(says).toHaveAttribute("title", new RegExp(`\\(${DEFAULT_ROW_NOTE}\\)$`));
  });

  /**
   * The same control, a different host. `ComposerAddress` ships from
   * `@corpus/kit` and every composer mounts the one component, so the reserve
   * is not a property of the reader — but the popover's *place* is, and a host
   * that gave the statement a different measure would reserve a different
   * number of lines for the same words. Measured rather than reasoned about.
   *
   * Driven by focus alone: the global composer opens over the board, the same
   * `previewed` state answers to `onFocus`, and a keyboard preview needs no
   * hit-testing against a modal that is still arriving.
   */
  test("the global composer's address is the same control, and holds just as still", async ({
    page,
  }) => {
    await stubCorpus(page, [THREADS_VIEW, HOST, GONE], {
      lanes: LANES,
      agent: { live: false, since: ago(4 * 60_000) },
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();

    const line = page.locator('button[data-address-line="compose"]');
    await expect(line).toBeVisible();
    await settled(page, line);
    await line.click();
    await expect(page.locator(popOf("compose"))).toBeVisible();

    const rows = page.locator(rowsOf("compose"));
    await expect(rows).toHaveCount(LANES.length + 1);
    const count = await rows.count();
    const at = await geometry(page, "compose");
    const said: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const lane = await rows.nth(index).getAttribute("data-recipient-lane");
      await rows.nth(index).focus();
      expect(await geometry(page, "compose"), `focusing ${String(lane)} moved something`).toEqual(
        at,
      );
      said.push((await page.locator(saysOf("compose")).textContent()) ?? "");
      await rows.nth(index).blur();
      expect(await geometry(page, "compose"), `blurring ${String(lane)} moved something`).toEqual(
        at,
      );
    }
    expect(new Set(said).size).toBe(count);
  });
});

/**
 * **The card has a ceiling, and reaching it is visible** — UI-130, measured in
 * the same browser and at the same 1280×720 as everything above.
 *
 * ## What was wrong, in numbers
 *
 * The popover is bottom-anchored and grows upward out of a composer that sits
 * **inside `.reader-scroll`** — a scrollport, not the window. With no ceiling it
 * simply kept growing. Measured before the fix, twenty lanes at 1280×720:
 *
 *     .reader-head   115.9 → 159.2
 *     .reader-scroll 159.2 → 666.1        (the scrollport)
 *     .address-pop  -248.1 → 419.1        667px tall
 *
 * Twelve of the twenty rows were off-screen entirely, and `elementFromPoint` at
 * the centre of five more answered `HEADER.topbar`, `DIV.col-title-row` and
 * `DIV.reader-head` — the chrome above the scrollport took the pointer events
 * aimed at them. Only the bottom row could be pressed. At 1280×400 it was
 * eighteen of nineteen.
 *
 * ## What these tests measure
 *
 * The card's top against the head's bottom, and then whether the rows can
 * actually be *used*: a click whose effect is asserted, not a click that merely
 * did not throw. And they are run at both viewports, because the room above a
 * composer is a property of the window and the bound has to follow it.
 */

/**
 * A roster of `count` designated lanes, each with a plain profile name, plus the
 * orchestrator's — so `manyLanes(19)` is twenty rows.
 *
 * Deliberately uniform: this spec is about a list too long for its card, and a
 * roster whose rows read alike keeps every other variable still. The mixed
 * roster above is the one that tests the words.
 */
const manyLanes = (count: number): readonly AgentLane[] =>
  Array.from({ length: count }, (_unused, index) => ({
    lane: `th_lane_${String(index)}`,
    resident: { name: `researcher-${String(index).padStart(2, "0")}`, docId: null, weight: null },
    live: false,
    since: ago(17 * 60_000),
    summary: null,
    origin: { id: `th_lane_${String(index)}`, title: `Conversation ${String(index)}` },
  }));

/**
 * Five lanes: the two above, a second lapsed resident, and a conversation nobody
 * has parked on — §7's states, and the roster UI-127 measured this defect with.
 * The effective recipient is a resident, so the card also carries the weight
 * *sentence*, which is the tallest thing that cannot shrink.
 */
const FIVE_LANES: readonly AgentLane[] = [
  ...LANES,
  {
    lane: "th_lapsed",
    resident: { name: "release-researcher", docId: "doc_release_agent", weight: null },
    live: false,
    since: ago(17 * 60_000),
    summary: null,
    origin: { id: "th_lapsed", title: "The lapsed conversation" },
  },
  {
    lane: "th_wait",
    resident: { name: null, docId: null, weight: null },
    live: false,
    since: null,
    summary: null,
    origin: { id: "th_wait", title: "A conversation nobody has parked on" },
  },
];

const MORE = '[data-address-more="th_host"]';
const LIST = `${PICKER} .recipient-lanes`;

/** The board, a reply composer on `th_host`, and its address popover open. */
async function openWith(page: Page, lanes: readonly AgentLane[], height: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height });
  await stubCorpus(page, [THREADS_VIEW, HOST, GONE], {
    lanes,
    agent: { live: false, since: ago(4 * 60_000) },
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_host"]').click();
  await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
  await page.mouse.move(AWAY.x, AWAY.y);
  const line = page.locator('button[data-address-line="th_host"]');
  await settled(page, line);
  await line.click();
  await expect(page.locator(POP)).toBeVisible();
  await page.mouse.move(AWAY.x, AWAY.y);
}

test.describe("the address popover has a ceiling", () => {
  for (const [label, lanes, count] of [
    ["five", FIVE_LANES, 5],
    ["twenty", manyLanes(19), 20],
  ] as const) {
    for (const height of [720, 400] as const) {
      test(`with ${label} lanes at 1280×${String(height)} the card clears the reader's head`, async ({
        page,
      }) => {
        await openWith(page, lanes, height);
        await expect(page.locator(ROWS)).toHaveCount(count);

        const head = await boxOf(page.locator(".reader-head"));
        const card = await boxOf(page.locator(POP));
        const scroll = await boxOf(page.locator(".reader-scroll"));

        // The measurement this issue exists for. Before the bound, twenty lanes
        // put the card's top at y=-248 against a head ending at y=159.
        expect(
          card.y,
          `the card rose into the head (${JSON.stringify(card)})`,
        ).toBeGreaterThanOrEqual(head.y + head.height);

        // …and it is bounded **by the room**, rather than by a number (UI-142,
        // SPEC.md §11's rider of 2026-08-21). The claim is a relationship and
        // not a pixel count: `<= 280` used to stand here, and it was the defect
        // written down as an assertion — the card drew 240×280 at 1728×1080
        // with 782px of room above it.
        //
        // The one case where the card is allowed past the room is the floor
        // `ComposerAddress` documents: a room that will not take the fixed parts
        // and **one** row leaves a card that would otherwise offer nothing, so
        // it keeps one row and comes down instead. 1280×400, whose reader
        // scrollport is 187px, is that case — and the test says which case it is
        // in rather than widening the bound until both pass.
        const list = await page.locator(LIST).evaluate((element) => ({
          client: element.clientHeight,
          // The row's border box: `clientHeight` would drop its 1px border
          // either side and make a list showing exactly one row look like a
          // list showing more than one.
          row: element.children[0]?.getBoundingClientRect().height ?? 0,
        }));
        if (card.height > scroll.height)
          expect(
            list.client,
            `the card outgrew its room without being at its floor (${JSON.stringify(card)})`,
          ).toBeLessThanOrEqual(list.row + 1);
        else expect(card.height).toBeLessThanOrEqual(scroll.height);
      });
    }
  }

  test("the topmost row can still be pressed, and pressing it does something", async ({ page }) => {
    await openWith(page, manyLanes(19), 720);
    const rows = page.locator(ROWS);
    const first = rows.first();

    // Reachable in the tool's own terms — `click()` refuses an element another
    // element covers, which is precisely what `.reader-head` was doing.
    await first.click({ timeout: 5_000 });
    // …and the press landed: the effect, not the absence of an exception.
    await expect(first).toHaveAttribute("data-recipient-chosen", "true");
    await expect(first).toHaveAttribute("aria-pressed", "true");
  });

  test("the last row is reachable too — the list scrolls to it", async ({ page }) => {
    await openWith(page, manyLanes(19), 720);
    const rows = page.locator(ROWS);
    const last = rows.last();
    const lane = await last.getAttribute("data-recipient-lane");
    expect(lane).toBe("th_lane_18");

    // It starts outside the list's box: this is a bounded list, not a short one.
    const hidden = await page.locator(LIST).evaluate((list, selector: string) => {
      const row = list.querySelector(selector);
      return row === null
        ? null
        : row.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom;
    }, '[data-recipient-lane="th_lane_18"]');
    expect(hidden).toBe(true);

    await last.click({ timeout: 5_000 });
    await expect(last).toHaveAttribute("data-recipient-chosen", "true");
  });

  test("a list that reached its bound says so, rather than looking complete", async ({ page }) => {
    await openWith(page, manyLanes(19), 720);
    const more = page.locator(MORE);
    await expect(more).toBeVisible();
    await expect(more).toHaveText(lanesCappedNote(20));

    // The note is the honest half of a real cap: the list really does hold more
    // than it shows, and it really does scroll.
    const list = await page.locator(LIST).evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(list.scroll).toBeGreaterThan(list.client);
  });

  test("a roster that fits says nothing — the note is a cap, not a decoration", async ({
    page,
  }) => {
    await openWith(page, LANES, 720);
    await expect(page.locator(ROWS)).toHaveCount(3);
    await expect(page.locator(MORE)).toHaveCount(0);
    const list = await page.locator(LIST).evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(list.scroll).toBeLessThanOrEqual(list.client);
  });

  test("tabbing through the lanes scrolls each row into view, and none of them under the head", async ({
    page,
  }) => {
    await openWith(page, manyLanes(19), 720);
    const rows = page.locator(ROWS);
    const count = await rows.count();
    const head = await boxOf(page.locator(".reader-head"));

    // From the line, one Tab reaches the first row: the popover binds no keys,
    // so the keyboard path through it is the browser's (SPEC.md §11).
    await page.locator('button[data-address-line="th_host"]').focus();
    await page.keyboard.press("Tab");

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const lane = await row.getAttribute("data-recipient-lane");
      await expect(row, `Tab ${String(index)} did not reach ${String(lane)}`).toBeFocused();

      const box = await boxOf(row);
      const list = await boxOf(page.locator(LIST));
      // Scrolled into the list rather than merely focused somewhere off it.
      expect(box.y, `${String(lane)} is above its list`).toBeGreaterThanOrEqual(list.y - 1);
      expect(box.y + box.height, `${String(lane)} is below its list`).toBeLessThanOrEqual(
        list.y + list.height + 1,
      );
      // …and never behind the head, which is the whole complaint.
      expect(box.y, `${String(lane)} sits under the head`).toBeGreaterThanOrEqual(
        head.y + head.height,
      );
      await page.keyboard.press("Tab");
    }
  });

  test("the bound did not reintroduce content-driven sizing — twenty lanes hold as still as three", async ({
    page,
  }) => {
    await openWith(page, manyLanes(19), 720);
    const rows = page.locator(ROWS);
    const at = await geometry(page);
    const said: string[] = [];

    // The first four rows, previewed by keyboard: the fifth is outside the list,
    // and focusing it would scroll the list, which is a movement this test would
    // rightly read as the defect. UI-127's rule is about what a *preview* moves.
    for (let index = 0; index < 4; index += 1) {
      const lane = await rows.nth(index).getAttribute("data-recipient-lane");
      await rows.nth(index).focus();
      expect(await geometry(page), `focusing ${String(lane)} moved something`).toEqual(at);
      said.push((await page.locator(SAYS).textContent()) ?? "");
      await rows.nth(index).blur();
      expect(await geometry(page), `blurring ${String(lane)} moved something`).toEqual(at);
    }
    expect(new Set(said).size).toBe(4);
  });
});

/**
 * The other two hosts, whose ceiling is **not** a scrollport.
 *
 * `clipperOf` walks for the nearest scrolling ancestor and finds none at either:
 * the global composer's panel and the comment popover are both `overflow:
 * hidden` boxes over a `body` that does not scroll, so the window itself is the
 * ceiling. That path is worth a measurement of its own, because a walk that
 * answered the wrong box would bound these cards to nothing.
 *
 * **A residual, stated rather than implied.** `.search-panel` clips with
 * `overflow: hidden`, and the compose card has always been drawn taller than the
 * panel has room for above the line — 157px against 132px, measured — so its top
 * padding and lead are cropped there. That is a different defect from this one
 * and is left alone deliberately: bounding to a clip rather than a scrollport
 * would squeeze a three-lane list to one visible row, and what leaves a clip is
 * cropped where what leaves a scrollport is *unreachable*. UI-127's own compose
 * test is what measures the change in that card's behaviour, and it is green.
 */
test.describe("a host the window bounds", () => {
  test("the global composer's card is capped, and the cap is the only thing bounding it", async ({
    page,
  }) => {
    await stubCorpus(page, [THREADS_VIEW, HOST, GONE], {
      lanes: manyLanes(19),
      agent: { live: false, since: ago(4 * 60_000) },
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();

    const line = page.locator('button[data-address-line="compose"]');
    await settled(page, line);
    await line.click();
    await expect(page.locator(popOf("compose"))).toBeVisible();

    const card = await boxOf(page.locator(popOf("compose")));
    // Bounded by the window and by nothing smaller (UI-142): the assertion is
    // the relationship, because the number it replaced — `<= 280` — was true of
    // a card that had 502px of room it was not allowed to use.
    expect(card.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
    // Never off the top of the window: with no scrollport above it, the window
    // is the ceiling, and a walk that answered `null` where it should not would
    // show up here as a card starting at a negative y.
    expect(card.y).toBeGreaterThanOrEqual(0);

    // The cap note is honest either way: it appears exactly when the list
    // really did run out of room, and never as decoration (UI-130, UI-142).
    const list = await page
      .locator(`${picker("compose")} .recipient-lanes`)
      .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    const note = page.locator('[data-address-more="compose"]');
    if (list.scroll > list.client + 1) await expect(note).toBeVisible();
    else await expect(note).toHaveCount(0);
  });

  /**
   * The comment composer, which SPEC.md §6 opens **on the words it is about** —
   * so it is portaled out of the reader to `document.body` and positioned
   * `fixed` against the selection. Measured chain, with the card open:
   *
   *     DIV.composer-address  overflowY=visible
   *     DIV.composer-foot     overflowY=visible
   *     DIV.comment-pop open  overflowY=visible
   *     BODY                  overflowY=hidden
   *     HTML                  overflowY=visible
   *
   * No scrollport, so the window is the ceiling — and the card legitimately
   * rises **above** `.reader-scroll`'s top edge, because it is not inside it.
   * A walk that bound this card to the reader's scrollport would be wrong in the
   * direction that costs rows, which is what the last assertion here pins.
   */
  test("the comment composer's card is bounded by the window, not by the reader under it", async ({
    page,
  }) => {
    const NOTE: StubRow = {
      id: "doc_note",
      type: "note",
      title: "The policy",
      path: "data/docs/notes/policy.md",
      body: "Reimbursement is capped at the published rate for the quarter.\n",
    };
    await stubCorpus(page, [{ ...THREADS_VIEW, query: {} }, NOTE, HOST, GONE], {
      lanes: manyLanes(19),
      agent: { live: false, since: ago(4 * 60_000) },
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    await expect(page.getByRole("dialog", { name: "New comment" })).toBeVisible();

    const line = page.locator('button[data-address-line="comment"]');
    await settled(page, line);
    await line.click();
    await expect(page.locator(popOf("comment"))).toBeVisible();

    const card = await boxOf(page.locator(popOf("comment")));
    // The window is the bound, and the whole of it is available (UI-142). The
    // `<= 280` this replaced was a constant that fitted no room in particular.
    expect(card.height).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
    expect(card.y).toBeGreaterThanOrEqual(0);

    const list = await page
      .locator(`${picker("comment")} .recipient-lanes`)
      .evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    const note = page.locator('[data-address-more="comment"]');
    if (list.scroll > list.client + 1) await expect(note).toBeVisible();
    else await expect(note).toHaveCount(0);

    // Its top row is pressable where it is, which is the whole claim.
    const first = page.locator(rowsOf("comment")).first();
    await first.click({ timeout: 5_000 });
    await expect(first).toHaveAttribute("data-recipient-chosen", "true");

    // …and it is above the reader's scrollport, which is correct: it is not in
    // it. The window bounds this card, and nothing nearer does.
    const scrollport = await boxOf(page.locator(".reader-scroll"));
    expect(card.y).toBeLessThan(scrollport.y);
  });
});

/**
 * **The line's width is a property of its slot in the footer, never of the
 * sentence in it** — UI-137, SPEC.md §11's rider signed 2026-08-20, measured in
 * the same browser at the same 1280×720.
 *
 * ## What was wrong, and why it is the release's own headline
 *
 * The line reads `<who> · <weight>`. The weight clause arrives on a **second**
 * request: the roster names a level key (`heavy`) and the workspace's own
 * orchestrate skill turns it into words (`Heavy or judgment-laden`). While the
 * slot took its width from that string, the arrival pushed the footer sideways
 * and moved the **Send button** — a control, under the pointer, on the one
 * control a composer exists to press. UI-131 measured it one surface over and
 * handed it here rather than filing it: `address line w=124.83 → 170.97`,
 * `send x=350.5 → 386.80`.
 *
 * ## The delay is the whole test
 *
 * `useWeightLevels` reaches the skill in two sequential round trips — a
 * `?type=skill` scan, then a `useDoc` for the body — and between them
 * `weightLabel` renders its documented fallback, the bare key. A spec that let
 * both settle before it looked would see the finished line and reproduce
 * nothing, so these hold the **body** open, let the scan through, measure,
 * release, and measure again.
 *
 * ## Why the fixture also changes the name
 *
 * Reserving the weight clause alone was considered and rejected: *who* is a
 * profile name of no bounded length, so a line that reserved only the weight
 * would still resize when the name arrived or the recipient changed. These
 * tests therefore swing the name between two characters and forty-five, and
 * drop the composer to its floor, and assert the same two boxes each time.
 */

/** The level declaration in the shape the shipped orchestrate skill states it. */
function declaring(rows: readonly (readonly [string, string])[]): string {
  return [
    "## Delegation",
    "",
    "| Weight | Key | Model | What falls here |",
    "| ----------------------- | -------- | ---------- | ---------------- |",
    ...rows.map(([label, key]) => `| ${label} | ${key} | **A model** | Guidance. |`),
    "",
    "Nothing outside this table declares a level.",
  ].join("\n");
}

/** The three levels `assets/workspace/` ships, verbatim. */
const SKILL: StubRow = {
  id: "doc_orchestrate",
  type: "skill",
  title: "orchestrate",
  path: ".claude/skills/orchestrate/SKILL.md",
  body: declaring([
    ["Small and mechanical", "light"],
    ["Standard", "standard"],
    ["Heavy or judgment-laden", "heavy"],
  ]),
};

const HEAVY_KEY = "heavy";
const HEAVY_LABEL = "Heavy or judgment-laden";

/** Two characters, and forty-five: the same slot has to serve both. */
const SHORT_NAME = "ui";
const LONG_NAME = "release-researcher-for-the-quarterly-forecast";

/**
 * A roster whose two designated lanes are the same in every way but the length
 * of the name, so a difference in geometry can only be the name.
 */
const NAMED_LANES: readonly AgentLane[] = [
  {
    lane: "th_host",
    resident: { name: SHORT_NAME, docId: "doc_short_agent", weight: HEAVY_KEY },
    live: true,
    since: NOW.toISOString(),
    summary: null,
    origin: { id: "th_host", title: "Q3 planning" },
  },
  {
    lane: "th_gone",
    resident: { name: LONG_NAME, docId: "doc_long_agent", weight: HEAVY_KEY },
    live: true,
    since: NOW.toISOString(),
    summary: null,
    origin: { id: "th_gone", title: "The claims conversation" },
  },
];

interface HeldBody {
  /** Lets the held skill body through; safe to call more than once. */
  readonly release: () => void;
  /** How many body requests were actually intercepted. */
  readonly hits: () => number;
}

/**
 * Holds `GET /api/docs/doc_orchestrate` — and only it — until released.
 *
 * The `?type=skill` **scan** is deliberately let through: the line must reach
 * the state this issue is about, which is "the level is known and its words are
 * not here yet". Registering after `stubCorpus` is what puts this handler first
 * (Playwright tries handlers in reverse registration order), and
 * `route.fallback()` hands the request back to the stub once the gate opens.
 */
async function holdSkillBody(page: Page): Promise<HeldBody> {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let hits = 0;
  await page.route("**/api/docs/doc_orchestrate", async (route) => {
    hits += 1;
    await gate;
    await route.fallback();
  });
  return {
    release: () => {
      open();
    },
    hits: () => hits,
  };
}

/**
 * The two boxes this issue is about, unrounded.
 *
 * The send button is the acceptance test and the line is the cause, so both are
 * read in one pass — a snapshot taken across two layouts could agree by
 * accident. Sub-pixel values are kept: a control that moves by half a pixel has
 * still moved, and the reserve makes them identical rather than close.
 */
async function slotBoxes(page: Page, surface: string, send: string): Promise<Record<string, Box>> {
  return page.evaluate(
    ([lineSelector, sendSelector]: readonly string[]) => {
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (const [name, selector] of [
        ["line", lineSelector ?? ""],
        ["send", sendSelector ?? ""],
      ] as const) {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`no ${name} at ${selector}`);
        const rect = element.getBoundingClientRect();
        out[name] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return out;
    },
    [`[data-address-line="${surface}"]`, send] as const,
  );
}

/**
 * The slot the layout gave the line, resolved by the browser rather than
 * written down here.
 *
 * `--address-slot` is `calc(17ch + 33px)`, and a spec that turned that into a
 * pixel count would pin the machine that ran it — which is exactly how this
 * spec failed CI twice. The probe inherits the line's font, so `ch` resolves
 * the way the line's own `ch` resolves, whatever mono the machine has.
 */
async function slotWidth(page: Page, surface: string): Promise<number> {
  return page.locator(`[data-address-line="${surface}"]`).evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--address-slot)";
    el.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
}

/**
 * How many flex lines a composer foot is laid out on.
 *
 * `.composer-foot` is `align-items: center`, so every item on one line shares a
 * vertical centre whatever its own height is — which makes the count of
 * distinct centres the count of rows, and makes it independent of the mono the
 * machine happens to have. Comparing tops instead would count the 📎 button and
 * the address pill as two rows, because they are two heights.
 *
 * Zero-sized children are skipped: `AttachButton` renders a hidden `<input
 * type="file">` that has no box at all.
 */
async function footRows(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => {
    const centres = [...el.children]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 0 || rect.height > 0)
      .map((rect) => Math.round(rect.top + rect.height / 2));
    return new Set(centres).size;
  });
}

/** Whether the line's own text is clipped, and what it reveals if it is. */
async function revealOf(
  page: Page,
  surface: string,
): Promise<{
  readonly clipped: boolean;
  readonly title: string | null;
  readonly text: string;
}> {
  return page.evaluate((selector: string) => {
    const line = document.querySelector(selector);
    const text = line?.querySelector(".address-line-text");
    if (line === null || text === null || text === undefined) throw new Error("no line");
    return {
      clipped: text.scrollWidth > text.clientWidth,
      title: line.getAttribute("title"),
      text: text.textContent ?? "",
    };
  }, `[data-address-line="${surface}"]`);
}

/** The board, and a reply composer on `th_host` whose lane has a resident. */
async function openReply(page: Page, lanes: readonly AgentLane[]): Promise<HeldBody> {
  await stubCorpus(page, [THREADS_VIEW, HOST, GONE, SKILL], {
    lanes,
    agent: { live: true, since: NOW.toISOString() },
  });
  const held = await holdSkillBody(page);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_host"]').click();
  await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
  await page.mouse.move(AWAY.x, AWAY.y);
  return held;
}

const REPLY_SEND = ".reader .composer-foot .send";

test.describe("the address line has a slot, and Send stays where it is", () => {
  test("the weight clause arriving late moves neither the line nor Send", async ({ page }) => {
    const held = await openReply(page, NAMED_LANES);

    const line = page.locator('[data-address-line="th_host"]');
    await expect(line).toContainText(`· ${HEAVY_KEY}`);
    // The column grows to its reading floor on open. That growth is now one
    // commit rather than a 250ms ramp (UI-146), but the reply surface has late
    // arrivals of its own, so settle it — `settled` is UI-127's, and it exists
    // for exactly this reason.
    await settled(page, page.locator(REPLY_SEND));
    const before = await slotBoxes(page, "th_host", REPLY_SEND);

    held.release();
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(REPLY_SEND));

    expect(held.hits()).toBeGreaterThan(0);
    // The whole issue, in two boxes.
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(before);

    // …and the words really did change under a box that did not, so this held
    // across a real arrival and not across none.
    const reveal = await revealOf(page, "th_host");
    expect(reveal.text).toBe(`${SHORT_NAME} will answer · ${HEAVY_LABEL}`);
    // Truncated in place and revealed, never accommodated (SHARED-057 clause 2).
    expect(reveal.clipped).toBe(true);
    expect(reveal.title).toContain(`${SHORT_NAME} will answer · ${HEAVY_LABEL}`);
  });

  test("changing the recipient between a long name and a short one moves nothing", async ({
    page,
  }) => {
    const held = await openReply(page, NAMED_LANES);
    held.release();

    const line = page.locator('[data-address-line="th_host"]');
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(REPLY_SEND));
    const at = await slotBoxes(page, "th_host", REPLY_SEND);

    await page.locator('button[data-address-line="th_host"]').click();
    await expect(page.locator(POP)).toBeVisible();
    // The line moves nothing when the popover opens over it, either.
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(at);

    const said: string[] = [];
    const clipped: boolean[] = [];
    for (const lane of ["th_gone", "orchestrator", "th_host", "th_gone"]) {
      await page.locator(`${PICKER} [data-recipient-lane="${lane}"]`).click();
      await expect(page.locator(POP)).toBeVisible();
      const reveal = await revealOf(page, "th_host");
      said.push(reveal.text);
      clipped.push(reveal.clipped);
      expect(
        await slotBoxes(page, "th_host", REPLY_SEND),
        `picking ${lane} moved something`,
      ).toEqual(at);
    }

    // Three genuinely different statements, one of them 45 characters of name.
    expect(said[0]).toContain(`${LONG_NAME} will answer`);
    expect(said[1]).toContain("agent will answer");
    expect(said[2]).toContain(`${SHORT_NAME} will answer`);
    expect(new Set(said).size).toBe(3);

    // The line never grows past its declared slot — and **the slot is read
    // from the declaration, never written down as a pixel count**.
    //
    // A hard-coded `139.08` failed CI twice, because `139.08` is what this
    // repo's mono resolves `22ch` to on macOS and CI's Linux resolves the same
    // declaration to `131.61`. Reading `--address-slot` out of the running page
    // asks the question in the unit the answer is in.
    //
    // The rule's other half is asserted above: three recipients produce three
    // different sentences, and `toEqual(at)` proves none of them moved
    // anything. This adds the ceiling — content can never push the pill *wider*
    // than the slot the layout gave it.
    const slot = await slotWidth(page, "th_host");
    expect(at["line"]?.width).toBeLessThanOrEqual(slot + 0.5);
    // And it is sized for the text people actually have (SHARED-057 clause 3):
    // the ordinary live line with no weight stated is read, not revealed. The
    // two weighted ones are the uncommon case, and both carry the whole
    // sentence on the title.
    expect(clipped[1], "`agent will answer` did not fit its slot").toBe(false);
    expect(clipped[0]).toBe(true);
    expect(clipped[2]).toBe(true);
    const whole = await revealOf(page, "th_host");
    expect(whole.title).toContain(whole.text);
  });

  test("the floor is the short end, and it moves nothing either", async ({ page }) => {
    const held = await openReply(page, NAMED_LANES);
    held.release();

    const line = page.locator('[data-address-line="th_host"]');
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(REPLY_SEND));
    const at = await slotBoxes(page, "th_host", REPLY_SEND);

    // A composer that will not reach the agent says the shortest thing this
    // control ever says. `◉ ask agent` and `○ note only` are the same length,
    // so the toggle beside it cannot be what moves anything.
    await page.locator(".reader .composer-foot .toggle").click();
    await expect(line).toContainText("Nobody is asked");
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(at);

    // The floor fits its slot whole: the box is sized for the text people
    // actually have, so the short end is read and not revealed (clause 3).
    const floor = await revealOf(page, "th_host");
    expect(floor.clipped).toBe(false);

    await page.locator(".reader .composer-foot .toggle").click();
    await expect(line).toContainText(HEAVY_LABEL);
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(at);
  });

  test("the global composer's line has the same slot, and its submits hold", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, HOST, GONE, SKILL], {
      lanes: NAMED_LANES,
      agent: { live: true, since: NOW.toISOString() },
    });
    const held = await holdSkillBody(page);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();

    const line = page.locator('button[data-address-line="compose"]');
    await settled(page, line);

    // **This bar is where the floor is load-bearing** (UI-137's third finding),
    // and the state it opens in is the one that shows it: the global composer
    // answers to the orchestrator by default, so the line reads the ordinary
    // live statement with nothing picked yet.
    //
    // This action row does not wrap, and its hint asks for the whole 232px of
    // `@ agents · / skills · [[ refs · ↵ newline`, so the address is the item
    // flexbox takes from — measured at 119.84px against the 140.45 the slot
    // declares, with `agent will answer` clipped, the moment `min-width` comes
    // off `.composer-address`. The reply composer cannot show this: its foot
    // wraps, and a wrapping flex line never shrinks the items on it.
    const ordinary = await revealOf(page, "compose");
    expect(ordinary.text).toBe("agent will answer");
    expect(ordinary.clipped, "`agent will answer` did not fit its slot").toBe(false);
    expect(
      (await slotBoxes(page, "compose", ".compose-actions .btn-ask"))["line"]?.width,
    ).toBeCloseTo(await slotWidth(page, "compose"), 1);

    // The weight clause needs a recipient that carries one: pick the long-named
    // resident.
    await line.click();
    await page.locator(`${picker("compose")} [data-recipient-lane="th_gone"]`).click();
    await expect(line).toContainText(`· ${HEAVY_KEY}`);
    // A second press on the line, never Escape: the app's escape chain owns
    // that key at the surface grain and would close the whole panel.
    await line.click();

    const ASK = ".compose-actions .btn-ask";
    await settled(page, page.locator(ASK));
    const before = await slotBoxes(page, "compose", ASK);
    const capture = await boxOf(page.locator(".compose-actions .btn-capture"));

    held.release();
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(ASK));

    expect(await slotBoxes(page, "compose", ASK)).toEqual(before);
    expect(await boxOf(page.locator(".compose-actions .btn-capture"))).toEqual(capture);
  });

  /**
   * **What the floor cost the global composer's bar, and what pays for it now.**
   *
   * `compose.css` used to override the slot with `min-width: 0`, and the stated
   * reason was that the hint "must not push the two submits off it at the panel's
   * minimum width" — a shrinking address was the bar's protection at the small
   * end. UI-137 took the override away, because a shrinking address was also
   * `agent will answer` clipped to 89px of the 107 it needs.
   *
   * Measured on this machine after that, at the panel's own widths (the panel is
   * `min(640px, 100vw - 48px)`, so viewport and panel move together):
   *
   *     viewport 480   bar 430   content needs 417   fits
   *     viewport 440   bar 390   content needs 417   overflows by 27px
   *
   * So the claim "nothing had to be taken from anything" held above a viewport
   * near 467px and not below it. `flex-wrap` under a `max-width: 560px` query is
   * the valve — whole controls stack, the sentence is untouched — and this test
   * is what says the valve is there. It asserts no overflow and not an
   * arrangement: how the rows fall is a property of the machine's glyphs, and
   * pinning that is the mistake `22ch` already made twice.
   */
  test("the global composer's bar stays whole in a window too narrow for one row", async ({
    page,
  }) => {
    await stubCorpus(page, [THREADS_VIEW, HOST, GONE, SKILL], {
      lanes: NAMED_LANES,
      agent: { live: true, since: NOW.toISOString() },
    });
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.keyboard.press("c");
    await expect(page.locator(".compose-panel")).toBeVisible();

    const ASK = ".compose-actions .btn-ask";
    await settled(page, page.locator(ASK));
    await page.setViewportSize({ width: 400, height: 720 });
    await settled(page, page.locator(ASK));

    const bar = await page.locator(".compose-actions").evaluate((el) => {
      const panel = el.closest(".compose-panel")?.getBoundingClientRect();
      const submits = [...el.querySelectorAll(".btn-ask, .btn-capture")].map((b) =>
        b.getBoundingClientRect(),
      );
      return {
        overflows: el.scrollWidth > el.clientWidth,
        escapes: submits.some(
          (r) => panel === undefined || r.right > panel.right + 0.5 || r.left < panel.left - 0.5,
        ),
        submits: submits.length,
      };
    });
    expect(bar.submits).toBe(2);
    expect(bar.overflows, "the action bar overflowed its card").toBe(false);
    expect(bar.escapes, "a submit was pushed off the card").toBe(false);

    // And the sentence did not pay for it: the address holds its slot, and the
    // ordinary live statement is read rather than revealed, at this width too.
    const reveal = await revealOf(page, "compose");
    expect(reveal.text).toBe("agent will answer");
    expect(reveal.clipped, "`agent will answer` did not fit its slot").toBe(false);
    const slot = await slotWidth(page, "compose");
    expect((await slotBoxes(page, "compose", ASK))["line"]?.width).toBeCloseTo(slot, 1);
  });

  test("the comment composer's line has the same slot, and Comment holds", async ({ page }) => {
    const NOTE: StubRow = {
      id: "doc_note",
      type: "note",
      title: "The policy",
      path: "data/docs/notes/policy.md",
      body: "Reimbursement is capped at the published rate for the quarter.\n",
    };
    await stubCorpus(page, [{ ...THREADS_VIEW, query: {} }, NOTE, HOST, GONE, SKILL], {
      lanes: NAMED_LANES,
      agent: { live: true, since: NOW.toISOString() },
    });
    const held = await holdSkillBody(page);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    await expect(page.getByRole("dialog", { name: "New comment" })).toBeVisible();

    // The **short** name here, deliberately. This footer was 294px wide when
    // the test was written, and a 45-character name saturated the old
    // content-driven width in both states — measured 164.13px before and after
    // — so the long name would have made this test pass against the defect. The
    // short one moves it: 134.38 → 157.09, and `Comment ⌘↵` with it. (The card
    // is 356px since UI-137's third finding, and the foot 330px: the address
    // slot no longer fits inside 294 and this foot has no hint to take it from.
    // The reasoning is in `anchors.css`, beside the width.)
    const line = page.locator('button[data-address-line="comment"]');
    await settled(page, line);
    await line.click();
    await page.locator(`${picker("comment")} [data-recipient-lane="th_host"]`).click();
    await expect(line).toContainText(`· ${HEAVY_KEY}`);
    await line.click();

    const SEND = "[data-comment-send]";
    await settled(page, page.locator(SEND));
    const before = await slotBoxes(page, "comment", SEND);

    held.release();
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(SEND));

    expect(held.hits()).toBeGreaterThan(0);
    expect(await slotBoxes(page, "comment", SEND)).toEqual(before);

    // **What the card's extra 36px bought, pinned by the behaviour and not by
    // the number** (`anchors.css`, `.comment-pop`). At 320 this foot had 294px
    // for four items that need more, and there is no hint here to take it from
    // — every item is either the sentence or a control. Two things went wrong
    // at that width and each is asserted below: `agent will answer` was clipped
    // on the ordinary reading path (measured 93px of the 107 it needs), and
    // once the address was floored the shortfall came out of the arrangement
    // instead, wrapping `Comment ⌘↵` onto a second row.
    //
    // Neither assertion names 356, so a re-measure that moves the card is free
    // to move it — what it may not do is put the statement or the submit back
    // where they were.
    await line.click();
    await page.locator(`${picker("comment")} [data-recipient-lane="orchestrator"]`).click();
    await line.click();
    await expect(page.locator(popOf("comment"))).toBeHidden();

    const ordinary = await revealOf(page, "comment");
    expect(ordinary.text).toBe("agent will answer");
    expect(ordinary.clipped, "`agent will answer` did not fit the popover's slot").toBe(false);
    expect(await footRows(page, ".comment-pop.open .composer-foot"), "the foot wrapped").toBe(1);
  });

  /**
   * **The footer under a machine wider than this one** — UI-137's third
   * finding, and the first one that was the product's rather than the test's.
   *
   * ## What CI kept saying
   *
   * Three runs in a row: ``Error: `agent will answer` did not fit its slot``.
   * The first `--address-slot` was `22ch`, a number reached by measuring this
   * laptop's footer and taking the widest whole-`ch` reserve that fitted in it.
   * On CI's Linux mono the footer's other items are wider, the pill shrank
   * below its basis to 131.61px against 139.08 here, and at that width the
   * **ordinary live statement** no longer fitted. SHARED-057 clause 3 sizes
   * this box "for the text people actually have… so revealing is the uncommon
   * case and not the ordinary reading path" — a slot that clips
   * `agent will answer` is that clause violated, on CI, on a user's machine
   * with a different mono, and in any column narrower than the reading width.
   *
   * ## The pressure, constructed rather than waited for
   *
   * Two things at once, and neither of them is a font this machine happens not
   * to have:
   *
   * 1. **A narrower column.** The view document carries `width: 264`, so the
   *    reading column is 440px rather than 560 (`readerWidth`,
   *    `apps/ui/src/board/columnWidth.ts`) and the foot 356px rather than
   *    434 — 78px less room than the number the old reserve was fitted to.
   * 2. **Wider siblings.** `letter-spacing` on everything in the foot *except*
   *    the address, which is what "CI's mono renders the other items wider"
   *    does to the layout, without touching the sentence the address has to
   *    hold. The address's own font is untouched: a test that widened that too
   *    would be asking the slot to hold more than 17 characters, which it
   *    never promised.
   *
   * Under both, the assertions that matter are the same three the tests above
   * make at the reading width — the statement fits, the pill is the slot, the
   * send button does not move — plus the one this fix is answerable for: the
   * hint is what gave.
   */
  test("a narrower column and wider siblings still leave the statement whole", async ({ page }) => {
    await stubCorpus(page, [{ ...THREADS_VIEW, extra: { width: 264 } }, HOST, GONE, SKILL], {
      lanes: NAMED_LANES,
      agent: { live: true, since: NOW.toISOString() },
    });
    const held = await holdSkillBody(page);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.addStyleTag({
      content: `.composer-foot > *:not(.composer-address) { letter-spacing: 0.12em }`,
    });
    await page.locator('.row[data-row-doc="th_host"]').click();
    await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
    await page.mouse.move(AWAY.x, AWAY.y);

    const line = page.locator('[data-address-line="th_host"]');
    await expect(line).toContainText(`· ${HEAVY_KEY}`);
    await settled(page, page.locator(REPLY_SEND));
    const under = await slotBoxes(page, "th_host", REPLY_SEND);
    expect(await boxOf(page.locator(".reader .composer-foot"))).toEqual(
      expect.objectContaining({ width: 356 }),
    );

    // The pressure is real: the hint is clipped, which is the whole of what
    // this fix decided. If it is not, the footer was never short of room and
    // nothing below is being tested.
    const hint = await page.locator(".reader .composer-foot .composer-hint").evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth,
      title: el.getAttribute("title"),
      text: el.textContent ?? "",
    }));
    expect(hint.clipped, "the footer was not under pressure").toBe(true);

    // **And the clip reveals** — SHARED-057 clause 2, at the width where the
    // clip actually happens. `thread stays open` is said in exactly one place
    // in the product, so a hint chosen to be the item that yields must hand its
    // whole sentence back on a `title` or the choice loses the sentence.
    expect(hint.text).toBe("thread stays open");
    expect(hint.title, "the clipped hint reveals nothing").toBe(hint.text);

    // The weight clause arrives into a footer that is already out of room.
    held.release();
    await expect(line).toContainText(HEAVY_LABEL);
    await settled(page, page.locator(REPLY_SEND));
    expect(held.hits()).toBeGreaterThan(0);
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(under);

    // And the ordinary live statement is read rather than revealed, at this
    // width, with the siblings demanding more than the footer has.
    await page.locator('button[data-address-line="th_host"]').click();
    await expect(page.locator(POP)).toBeVisible();
    await page.locator(`${PICKER} [data-recipient-lane="orchestrator"]`).click();
    const reveal = await revealOf(page, "th_host");
    expect(reveal.text).toBe("agent will answer");
    expect(reveal.clipped, "`agent will answer` did not fit its slot").toBe(false);

    // The floor held: the pill is the slot the layout declared, not what was
    // left over after the siblings had taken theirs.
    const slot = await slotWidth(page, "th_host");
    expect(under["line"]?.width).toBeCloseTo(slot, 1);
    expect(await slotBoxes(page, "th_host", REPLY_SEND)).toEqual(under);
  });
});
