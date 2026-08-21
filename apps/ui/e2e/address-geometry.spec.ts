import type { AgentLane } from "@corpus/contract";
import { DEFAULT_ROW_NOTE, MISSING_PROFILE_NOTE } from "@corpus/kit";
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
