import type { AgentLane } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **A lane's liveness word does not re-cut the name beside it** — SPEC.md §10's
 * rider signed 2026-08-20 (*"Nothing resizes because of what it holds"*),
 * measured in a real browser (UI-138).
 *
 * ## What was wrong, and why it is the sharpest case of the rule
 *
 * `.lane-meta` renders a **word** — `live`, `lapsed`, `waiting`, `unknown` — and
 * carries `margin-left: auto`, so its width decides where `.lane-name` beside it
 * is cut. The words are 4 to 7 characters, and the value changes on a
 * **fifteen-second clock**: `Residents` re-evaluates presence on `useNowTick`
 * because `isAgentPresent` expires a `live: true` whose evidence has aged past
 * `AGENT_PRESENCE_WINDOW_SECONDS` (960 s). So a conversation's title re-cut
 * itself while somebody was reading the roster, with nobody touching anything.
 *
 * It is UI-134's defect one axis over, and `tabular-nums` cannot reach it: the
 * variation is in letters rather than digits.
 *
 * ## Two shapes of evidence, and the second is the one that matters
 *
 * 1. **Three words in one frame.** A roster holding a live lane, a lapsed one
 *    and a never-parked one shows `live`, `lapsed` and `waiting` side by side,
 *    so their boxes can be compared with nothing else able to have settled
 *    between the measurements.
 * 2. **A transition on the real clock.** `page.clock` advances past the grace
 *    window and the tick flips a lane from `live` to `lapsed` — the actual
 *    defect, driven the actual way, with no gesture involved.
 *
 * ## The fourth word
 *
 * `unknown` is not reachable in this tab: `laneLiveness` maps every roster row
 * onto the other three, and `unknown` is what `unknownLaneRow` answers for a
 * lane the roster does not list at all. The reservation is still sized for it,
 * and the last test measures all four words against the box directly rather than
 * pretending a fixture can produce the fourth.
 *
 * jsdom implements no layout, so none of this can be asserted in the unit suite.
 */

const VIEWPORT = { width: 1180, height: 760 } as const;

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

/**
 * Long enough that the row has no slack left for a word to eat.
 *
 * `.lane-name` is the item that gives (`flex: 1 1 auto`, ellipsized), so on a
 * short title the liveness word simply grows into the empty middle of the row
 * and nothing is re-cut — the defect is real and not reachable there. A person
 * with real conversation titles is exactly who meets it.
 */
const LONG_TITLE = "Everything the household has to deal with before the end of the month";

/**
 * Fresh against the wall clock, never a literal: presence is a park held **now**
 * (SPEC.md §7), so a fixed date is a lane that lapsed before the page loaded.
 * The first attempt at this fixture pinned one, and its `live` lane read
 * `lapsed` on the first frame.
 */
const NOW = new Date();
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

/** The grace window `isAgentPresent` expires a `live: true` against. */
const GRACE_MS = 960_000;

function lane(id: string, over: Partial<AgentLane>): AgentLane {
  return {
    lane: id,
    resident: { name: null, docId: null, weight: null, designationId: null },
    live: false,
    since: null,
    pending: 0,
    summary: null,
    origin: { id, title: LONG_TITLE },
    ...over,
  };
}

/** One live lane, one lapsed, one never parked — three of the four words. */
const THREE_STATES: readonly AgentLane[] = [
  lane("th_live", { live: true, since: NOW.toISOString() }),
  lane("th_lapsed", { live: false, since: ago(17 * 60_000) }),
  lane("th_wait", { live: false, since: null }),
];

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

/**
 * Two widths are the same width.
 *
 * A twentieth of a pixel, `digit-geometry.spec.ts`'s own tolerance and for its
 * reason: a `ch`-sized reservation and the text it was sized for land on
 * different sixty-fourths. The defect here is 12px between `live` and `waiting`,
 * so nothing this tolerance hides could be one.
 */
function expectSameWidth(actual: number, expected: number, because: string): void {
  expect(
    Math.abs(actual - expected),
    `${because} (${String(actual)} vs ${String(expected)})`,
  ).toBeLessThan(0.05);
}

/** The board, the console open, and the Residents tab showing `lanes`. */
async function openResidents(page: Page, lanes: readonly AgentLane[]): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await stubCorpus(page, [THREADS_VIEW], { lanes });
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(".console-strip").click();
  await page.locator(".console-body").waitFor();
  await page.getByRole("tab", { name: "Residents" }).click();
  await expect(page.locator("[data-lane]")).toHaveCount(lanes.length + 1);
}

test.describe("the residents roster's liveness word", () => {
  test("holds one box for `live`, `lapsed` and `waiting`, in one frame", async ({ page }) => {
    await openResidents(page, THREE_STATES);

    const meta = (id: string): Locator => page.locator(`[data-lane="${id}"] .lane-meta`);
    const name = (id: string): Locator => page.locator(`[data-lane="${id}"] .lane-name`);
    await expect(meta("th_live")).toHaveText("live");
    await expect(meta("th_lapsed")).toHaveText("lapsed");
    await expect(meta("th_wait")).toHaveText("waiting");

    const live = await boxOf(meta("th_live"));
    const lapsed = await boxOf(meta("th_lapsed"));
    const waiting = await boxOf(meta("th_wait"));
    expectSameWidth(lapsed.width, live.width, "`lapsed` is not `live`'s box");
    expectSameWidth(waiting.width, live.width, "`waiting` is not `live`'s box");

    // The consequence, which is where the harm lands: the three rows carry the
    // same title, so if the word's box is stable the three names are one width.
    const names = [
      await boxOf(name("th_live")),
      await boxOf(name("th_lapsed")),
      await boxOf(name("th_wait")),
    ];
    expectSameWidth(names[1]?.width ?? 0, names[0]?.width ?? 0, "the name paid for `lapsed`");
    expectSameWidth(names[2]?.width ?? 0, names[0]?.width ?? 0, "the name paid for `waiting`");
  });

  /**
   * The defect as a person meets it: nothing is touched, the fifteen-second tick
   * fires, `isAgentPresent` expires the evidence, and the row re-words itself.
   * Before the reservation the name lost 12.4px on that tick.
   */
  test("does not re-cut the name when a lane lapses on its own clock", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await openResidents(page, [lane("th_live", { live: true, since: NOW.toISOString() })]);

    const meta = page.locator('[data-lane="th_live"] .lane-meta');
    const name = page.locator('[data-lane="th_live"] .lane-name');
    await expect(meta).toHaveText("live");
    const before = { meta: await boxOf(meta), name: await boxOf(name) };

    // Past the grace window, then a tick to notice it.
    await page.clock.fastForward(GRACE_MS + 30_000);
    await expect(meta).toHaveText("lapsed");
    const after = { meta: await boxOf(meta), name: await boxOf(name) };

    expectSameWidth(after.meta.width, before.meta.width, "the word's box grew with its letters");
    expect(after.name, "the name was re-cut on a tick nobody asked for").toEqual(before.name);
  });

  /**
   * **The reservation is sized against the four real words** (SHARED-057 clause
   * 3: measured against real content, so revealing is the uncommon case).
   *
   * Measured directly rather than through a fixture, because `unknown` is not a
   * state this tab can be driven into — `laneLiveness` never answers it. Each
   * word is written into the live element and the box read back, which is the
   * same question it would be asked if a fifth word ever arrived.
   *
   * **Two assertions, and the first is the one the reservation earns.** That
   * every word fits is trivially true of a box with no reservation at all — it
   * shrink-wraps whatever it holds — so the box must first be shown to be *one*
   * box across the four. Then that one box has to hold each of them.
   */
  test("holds every word `LaneLiveness` has, in one box, without truncating one", async ({
    page,
  }) => {
    await openResidents(page, THREE_STATES);

    const fits = await page.locator('[data-lane="th_live"] .lane-meta').evaluate((element) => {
      const original = element.textContent ?? "";
      const out: Record<string, { scroll: number; client: number }> = {};
      for (const word of ["live", "lapsed", "waiting", "unknown"]) {
        element.textContent = word;
        out[word] = { scroll: element.scrollWidth, client: element.clientWidth };
      }
      element.textContent = original;
      return out;
    });

    const widths = new Set(Object.values(fits).map((measure) => measure.client));
    expect(widths.size, `the box is sized by the word it holds (${JSON.stringify(fits)})`).toBe(1);

    for (const [word, measure] of Object.entries(fits)) {
      expect(
        measure.scroll,
        `${word} does not fit its reserved box (${JSON.stringify(measure)})`,
      ).toBeLessThanOrEqual(measure.client);
    }
  });
});
