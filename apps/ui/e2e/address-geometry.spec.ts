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
 * three different lengths — measured in the popover's own 218px measure:
 *
 *     agent will answer — last seen 4m ago — nobody is listening        2 lines
 *     release-researcher will answer — last seen 17m ago —
 *       the orchestrator will answer until it returns                   4 lines
 *     claims-review will answer — its profile is gone — renamed,
 *       deleted, or moved out of .claude/agents/ since — last seen
 *       17m ago — the orchestrator will answer until it returns         6 lines
 *
 * A lapsed lane is ordinary: every agent that is not parked right now reads
 * that way. §7's missing-profile report is the one statement that overflows the
 * reserve, and §7 itself calls that news rather than the reading path.
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

  test("a statement longer than its box truncates in place, and the whole of it is still reachable", async ({
    page,
  }) => {
    await open(page);
    const says = page.locator(SAYS);
    const gone = page.locator(`${PICKER} [data-recipient-lane="th_gone"]`);
    await gone.focus();

    // Truncated in place, not accommodated: the text overflows a box that did
    // not grow to take it.
    const clipped = await says.evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }));
    expect(clipped.scroll).toBeGreaterThan(clipped.client);

    // …and revealed: the whole sentence is on the statement's own title, and
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

        // The measurement this issue exists for. Before the bound, twenty lanes
        // put the card's top at y=-248 against a head ending at y=159.
        expect(
          card.y,
          `the card rose into the head (${JSON.stringify(card)})`,
        ).toBeGreaterThanOrEqual(head.y + head.height);
        // …and it is bounded, rather than merely happening to fit today.
        expect(card.height).toBeLessThanOrEqual(280);
        // The bound did not come out of the card's width, which is what UI-127's
        // four-line statement reserve is measured against.
        expect(card.width).toBe(240);
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
    expect(card.height).toBeLessThanOrEqual(280);
    // Never off the top of the window: with no scrollport above it, the window
    // is the ceiling, and a walk that answered `null` where it should not would
    // show up here as a card starting at a negative y.
    expect(card.y).toBeGreaterThanOrEqual(0);
    await expect(page.locator('[data-address-more="compose"]')).toBeVisible();
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
    expect(card.height).toBeLessThanOrEqual(280);
    expect(card.y).toBeGreaterThanOrEqual(0);
    await expect(page.locator('[data-address-more="comment"]')).toBeVisible();

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
