import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubOptions, type StubRow } from "./stubCorpus";

/**
 * UI-131 in a real browser: **a label that arrives late must not reflow the row
 * it lands in** (SPEC.md §10's rider, signed 2026-08-20 — "Nothing resizes
 * because of what it holds", and "a value that arrives later than the box
 * holding it" is named in it).
 *
 * ## The delay is the whole test
 *
 * The roster names the level **key** (`heavy`). The words come from the
 * workspace's own orchestrate skill, which `useWeightLevels` reaches in two
 * sequential round trips — an exhaustive `?type=skill` scan, then a `useDoc`
 * for the body. Between the two, `weightLabel` renders its documented fallback:
 * the bare key. A spec that let both settle before it looked would see the
 * finished row and reproduce nothing, so this one **holds the body request
 * open**, measures every child of the row, releases it, and measures again.
 *
 * jsdom cannot do this at all — it implements no layout — which is why
 * `Residents.test.tsx` passed against the defect it documents in prose.
 *
 * ## What is asserted
 *
 * Every box, not only the one that grew. The audit measured +119px on
 * `.lane-weight` and −119px on `.lane-name` of a 380px row **that is a
 * `<button>`**, so the thing that matters is that the name did not move out
 * from under a pointer aimed at it. The scope head is asserted the same way,
 * where `.lane-name` is `flex: none` and only `.lane-statement` can pay.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

const THREAD: StubRow = {
  id: "th_solo",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_solo.md",
  body: "## user · 2026-08-19T10:00:00Z\n\nWhere did the forecast land?\n",
};

/** In scope by `parent`, so the pane has a member and a count to settle on. */
const CHILD: StubRow = {
  id: "th_child",
  type: "thread",
  title: "Re: the forecast",
  path: "data/docs/threads/th_child.md",
  parent: "th_solo",
  body: "## user · 2026-08-19T11:00:00Z\n\nA follow-up.\n",
};

/** The declaration in the shape the shipped orchestrate skill states it. */
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
const SHIPPED = declaring([
  ["Small and mechanical", "light"],
  ["Standard", "standard"],
  ["Heavy or judgment-laden", "heavy"],
]);

/** A workspace that reworded the heaviest level past any reservation. */
const OVERLONG = declaring([
  ["Small and mechanical", "light"],
  ["Standard", "standard"],
  ["Heavy, judgment-laden, and not to be handed to a machine unattended", "heavy"],
]);

const ORCHESTRATE = "doc_orchestrate";

function skill(body: string): StubRow {
  return {
    id: ORCHESTRATE,
    type: "skill",
    title: "orchestrate",
    path: ".claude/skills/orchestrate/SKILL.md",
    body,
  };
}

interface HeldBody {
  /** Lets the held skill body through; safe to call more than once. */
  readonly release: () => void;
  /** How many body requests were actually intercepted. */
  readonly hits: () => number;
}

/**
 * Holds `GET /api/docs/doc_orchestrate` — and only it — until released.
 *
 * The `?type=skill` **scan** is deliberately let through: the row must reach the
 * state this issue is about, which is "the skill is located and its words are
 * not here yet". Registering after `stubCorpus` is what puts this handler first
 * — Playwright tries handlers in reverse registration order — and
 * `route.fallback()` hands the request back to the stub once the gate opens.
 */
async function holdSkillBody(page: Page): Promise<HeldBody> {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let hits = 0;
  await page.route(`**/api/docs/${ORCHESTRATE}`, async (route) => {
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

/** A box as the layout reports it — what a pointer aimed at the row has to hit. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Every named box in one pass, so a snapshot is internally consistent. */
async function boxes(page: Page, selectors: Record<string, string>): Promise<Record<string, Box>> {
  return page.evaluate((map) => {
    const out: Record<string, Box> = {};
    for (const [name, selector] of Object.entries(map)) {
      const element = document.querySelector(selector);
      if (element === null) continue;
      const rect = element.getBoundingClientRect();
      out[name] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return out;
  }, selectors);
}

const ROW = {
  row: '[data-lane="th_solo"]',
  dot: '[data-lane="th_solo"] .lane-dot',
  name: '[data-lane="th_solo"] .lane-name',
  weight: '[data-lane="th_solo"] .lane-weight',
  meta: '[data-lane="th_solo"] .lane-meta',
};

/**
 * The second designated lane, which carries §7's missing-profile mark.
 *
 * `.lane-mark` only exists on a row whose profile has gone, and it is a fifth
 * `flex: none` child competing for the same 380px — so the row that has one is
 * where a reservation is tightest, and it is measured rather than assumed.
 */
const MARKED = {
  row: '[data-lane="th_gone"]',
  dot: '[data-lane="th_gone"] .lane-dot',
  name: '[data-lane="th_gone"] .lane-name',
  mark: '[data-lane="th_gone"] .lane-mark',
  weight: '[data-lane="th_gone"] .lane-weight',
  meta: '[data-lane="th_gone"] .lane-meta',
};

/** The roster both measured rows come from: one profiled, one profile-gone. */
function lanes(): NonNullable<StubOptions["lanes"]> {
  const since = new Date().toISOString();
  return [
    {
      lane: "th_solo",
      resident: { name: "researcher", docId: "doc_researcher", weight: "heavy" },
      live: true,
      since,
      summary: null,
      origin: { id: "th_solo", title: "Q3 planning" },
    },
    {
      lane: "th_gone",
      resident: { name: "researcher", docId: null, weight: "heavy" },
      live: true,
      since,
      summary: null,
      origin: { id: "th_gone", title: "Rent planning" },
    },
  ];
}

const HEAD = {
  head: ".lane-scope-head",
  dot: ".lane-scope-head .lane-dot",
  name: ".lane-scope-head .lane-name",
  weight: ".lane-scope-head .lane-weight",
  statement: ".lane-scope-head .lane-statement",
  count: ".lane-scope-head .scope-count",
};

async function openResidents(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(".console-strip").click();
  await page.locator(".console-body").waitFor();
  await page.getByRole("tab", { name: "Residents" }).click();
}

test.describe("a weight label that arrives after the row", () => {
  test("moves nothing in the lane row or the scope head when it lands", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD, CHILD, skill(SHIPPED)], { lanes: lanes() });
    const held = await holdSkillBody(page);
    await openResidents(page);

    // The row, with the key standing in for words that have not arrived.
    const row = page.locator(ROW.row);
    await expect(row).toContainText("researcher");
    await expect(page.locator(ROW.weight)).toHaveText("heavy");

    // Select it, and let the scope settle: the count is a second late arrival
    // and measuring across it would confound this one.
    await row.click();
    await expect(page.locator('[data-lane-scope="th_solo"]')).toBeVisible();
    await expect(page.locator(HEAD.count)).toBeVisible();
    await expect(page.locator(HEAD.weight)).toHaveText("heavy");

    const rowBefore = await boxes(page, ROW);
    const markedBefore = await boxes(page, MARKED);
    const headBefore = await boxes(page, HEAD);
    expect(Object.keys(markedBefore)).toContain("mark");

    held.release();

    await expect(page.locator(ROW.weight)).toHaveText("Heavy or judgment-laden");
    await expect(page.locator(MARKED.weight)).toHaveText("Heavy or judgment-laden");
    await expect(page.locator(HEAD.weight)).toHaveText("Heavy or judgment-laden");

    expect(held.hits()).toBeGreaterThan(0);
    expect(await boxes(page, ROW)).toEqual(rowBefore);
    expect(await boxes(page, MARKED)).toEqual(markedBefore);
    expect(await boxes(page, HEAD)).toEqual(headBefore);

    // …and the reservation is sized against the words a workspace actually has
    // (SHARED-057 clause 3): the longest label the shipped skill declares fits
    // whole, so revealing is the uncommon case rather than the reading path.
    const clipped = await page
      .locator(ROW.weight)
      .evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(clipped).toBe(false);
  });

  test("holds the same geometry for a label longer than the reservation, and reveals it", async ({
    page,
  }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD, CHILD, skill(OVERLONG)], { lanes: lanes() });
    const held = await holdSkillBody(page);
    await openResidents(page);

    const row = page.locator(ROW.row);
    await expect(page.locator(ROW.weight)).toHaveText("heavy");
    await row.click();
    await expect(page.locator(HEAD.count)).toBeVisible();

    const rowBefore = await boxes(page, ROW);
    const markedBefore = await boxes(page, MARKED);
    const headBefore = await boxes(page, HEAD);

    held.release();

    const overlong = "Heavy, judgment-laden, and not to be handed to a machine unattended";
    await expect(page.locator(ROW.weight)).toHaveText(overlong);
    await expect(page.locator(HEAD.weight)).toHaveText(overlong);

    expect(await boxes(page, ROW)).toEqual(rowBefore);
    expect(await boxes(page, MARKED)).toEqual(markedBefore);
    expect(await boxes(page, HEAD)).toEqual(headBefore);

    // Truncated in place, and the whole of it reachable (SHARED-057 clause 2):
    // on the element's own title — the pattern the next reserved box copies —
    // and in the row's one sentence, which a person reads for everything else.
    for (const weight of [ROW.weight, HEAD.weight]) {
      const clipped = await page.locator(weight).evaluate((element) => ({
        overflows: element.scrollWidth > element.clientWidth,
        title: element.getAttribute("title"),
      }));
      expect(clipped.overflows).toBe(true);
      expect(clipped.title).toBe(overlong);
    }
    expect(await row.getAttribute("title")).toContain(overlong);
  });

  test("keeps showing the key when the workspace declares no levels", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD, CHILD, skill("No table here.\n")], {
      lanes: lanes(),
    });
    await openResidents(page);

    // The fallback is a real state, not a loading state (UI-098): a workspace
    // that declares nothing has the key as its only true answer, and the
    // reserved box must not turn that into silence.
    await expect(page.locator(ROW.weight)).toHaveText("heavy");
    await page.locator(ROW.row).click();
    await expect(page.locator(HEAD.weight)).toHaveText("heavy");
  });
});
