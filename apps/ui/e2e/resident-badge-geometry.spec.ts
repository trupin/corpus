import type { AgentLane } from "@corpus/contract";
import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE } from "@corpus/kit";
import type { Locator, Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **The board badge's resident note does not clip, and the name beside it does
 * not break** — UI-124, SPEC.md §10's rider signed 2026-08-20 and SHARED-057's
 * reveal clause.
 *
 * ## The measurement this spec exists to repeat
 *
 * Taken in a real browser during PR #50's third review, on `.t-resident`:
 *
 *     the note before SHARED-053's correction   scrollWidth 310   clientWidth 227
 *     after                                     scrollWidth 499   clientWidth 263
 *
 * Pre-existing rather than introduced: the old string overflowed by 83px and the
 * resident's name already wrapped mid-word. Correcting the note's wording made
 * an existing overflow larger.
 *
 * ## What changed, and what deliberately did not
 *
 * The badge is one line inside a conversation's head — a **row** — so it carries
 * `LaneRow.mark` (§7's report at row width) where it used to carry
 * `LaneRow.note` (the sentence). That is not a second wording of the claim,
 * which SHARED-053 exists to prevent and this issue's criteria forbid inventing:
 * both come from `LaneRow.kind` through `laneNote`/`laneMark`, the recipient
 * picker's rows already take the mark, and the composer's statement — the
 * surface the sentence is written for — still carries it whole. The sentence is
 * on the badge's own `title`, which is SHARED-057's reveal and was already true.
 *
 * jsdom implements no layout, so the overflow can only be measured here.
 */

const VIEWPORT = { width: 1180, height: 760 } as const;

/** `columnWidth.ts`'s own two, so a change there fails here rather than drifts. */
const MIN_COLUMN_WIDTH = 240;
const DEFAULT_COLUMN_WIDTH = 336;

const view = (width: number): StubRow => ({
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
  extra: { width },
});

const SOLO: StubRow = {
  id: "th_solo",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_solo.md",
  body: "## user · 2026-08-17T10:00:00Z\n\nWhere did the forecast land?\n",
};

const NOW = new Date();
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

/**
 * A designation whose profile has gone — the one kind that produces a note at
 * all (`laneNote`), lapsed so the liveness line beside it is the long one too.
 *
 * Two names, and both are real. `release-researcher` is the reported shape: 18
 * characters, hyphenated, which is what broke mid-word. `researcher` is the
 * stem every other fixture in this repo uses and what an ordinary agent-def is
 * called. The head at a given column width has a fixed amount to give, so which
 * of the two is designated decides whether anything has to truncate — see the
 * two tests below, which say which case each is measuring.
 */
const profileGone = (name: string): readonly AgentLane[] => [
  {
    lane: "th_solo",
    resident: { name, docId: null, weight: null, designationId: null },
    live: false,
    since: ago(17 * 60_000),
    pending: 0,
    working: false,
    summary: null,
    origin: { id: "th_solo", title: "Q3 planning" },
  },
];

const LONG_NAME = "release-researcher";
const ORDINARY_NAME = "researcher";

const BADGE = '[data-thread-panel="th_solo"] .t-resident';

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

/** The board, with `th_solo` open in the column's own reader at `width`. */
async function openSolo(page: Page, width: number, name = LONG_NAME): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await stubCorpus(page, [view(width), SOLO], { lanes: profileGone(name) });
  await page.goto("/");
  await page.locator(".board").waitFor();
  // "Open here": the head this measures is the column's own, at the width the
  // column carries; a plain click opens a 440px path column (UI-149, rider 3).
  await page.locator('.row[data-row-doc="th_solo"]').click({ button: "right" });
  await page.locator('[role="menuitem"][data-act="open-here"]').click();
  await expect(page.locator(BADGE)).toBeVisible();
}

/** Each run of the badge, and whether its own box holds what is in it. */
async function partsOf(
  page: Page,
): Promise<Record<string, { scroll: number; client: number; text: string }>> {
  return page.locator(BADGE).evaluate((element) => {
    const parts: Record<string, { scroll: number; client: number; text: string }> = {};
    for (const [name, selector] of [
      ["badge", ""],
      ["name", ".t-resident-name"],
      ["note", ".t-resident-note"],
      ["line", ".t-resident-line"],
    ] as const) {
      const part = selector === "" ? element : element.querySelector(selector);
      if (part === null) throw new Error(`no ${name}`);
      parts[name] = {
        scroll: part.scrollWidth,
        client: part.clientWidth,
        text: part.textContent ?? "",
      };
    }
    return parts;
  });
}

const WHOLE_NOTE = new RegExp(MISSING_PROFILE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test.describe("the board badge on a conversation whose profile has gone", () => {
  /**
   * **The badge's own box holds what is in it**, at the board's narrowest
   * column. This is the measurement PR #50 took: 522 against 178, at a head that
   * had 178px to give.
   */
  test("no longer overflows the head it sits in", async ({ page }) => {
    await openSolo(page, MIN_COLUMN_WIDTH);
    const parts = await partsOf(page);

    expect(
      parts["badge"]?.scroll ?? 0,
      `the badge still overflows (${JSON.stringify(parts["badge"])})`,
    ).toBeLessThanOrEqual(parts["badge"]?.client ?? 0);

    // What it shows is the row-width form, taken from the kit rather than typed
    // — one fact off `LaneRow.kind`, not a second wording of the claim.
    expect(parts["note"]?.text).toContain(MISSING_PROFILE_MARK);

    /*
     * **And at this width the runs beside the name truncate**, which is stated
     * rather than asserted away. 240px is a head with room for the name and
     * little else, and SHARED-061's own last clause is what to do about a box
     * that cannot be given the room its content needs: say so. The ellipsis is
     * the saying, and the whole sentence is on the title below — SHARED-057's
     * reveal, which is the half that makes truncating honest.
     */
    await expect(page.locator(BADGE)).toHaveAttribute("title", WHOLE_NOTE);
  });

  /**
   * **And on the ordinary reading path nothing truncates at all** — SHARED-057
   * clause 3: the box is sized for the text people actually have, so revealing
   * is the uncommon case and not the reading path. The default column is what a
   * person gets without dragging anything.
   *
   * **Both names**, because the difference between them is what
   * `.t-resident-line`'s `flex: 1 1 0` is for. While the liveness line's own
   * 370px counted towards what the badge asked for, `release-researcher` left
   * the mark **89px of content in an 85px box** at this very width — four pixels
   * short, ellipsized, revealed on the title. Taking the line out of the ask (it
   * takes leftover room and asks for none) is what makes the mark whole here for
   * an ordinary name and a long one alike.
   */
  for (const name of [ORDINARY_NAME, LONG_NAME]) {
    test(`reads whole at the column width nobody had to choose, as ${name}`, async ({ page }) => {
      await openSolo(page, DEFAULT_COLUMN_WIDTH, name);
      const parts = await partsOf(page);

      for (const run of ["badge", "name", "note"]) {
        const measure = parts[run];
        expect(
          measure?.scroll ?? 0,
          `${run} truncates at the default column (${JSON.stringify(measure)})`,
        ).toBeLessThanOrEqual(measure?.client ?? 0);
      }
      expect(parts["name"]?.text).toBe(name);
      expect(parts["note"]?.text).toContain(MISSING_PROFILE_MARK);
      await expect(page.locator(BADGE)).toHaveAttribute("title", WHOLE_NOTE);
    });
  }

  test("does not break the resident's name across two lines", async ({ page }) => {
    await openSolo(page, MIN_COLUMN_WIDTH);

    const name = page.locator(`${BADGE} .t-resident-name`);
    await expect(name).toHaveText(LONG_NAME);

    // One line: a wrapped name is taller than one line box, and mid-word is what
    // it did — `release-` above `researcher`. Measured against the element's own
    // line height rather than a pixel count, so a machine with a different font
    // cannot make this pass or fail for the wrong reason.
    const shape = await name.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      line: Number.parseFloat(window.getComputedStyle(element).lineHeight),
      // `getClientRects()` gives one rect per line box for an inline run.
      lines: element.getClientRects().length,
    }));
    expect(shape.lines, "the name was laid out on more than one line").toBeLessThanOrEqual(1);
    expect(shape.height, "the name is taller than one line").toBeLessThan(shape.line * 1.6);

    // The name is also not the thing that yields: the liveness line beside it is
    // (`.t-resident-line`, ellipsized and revealed on the title).
    const nameBox = await boxOf(name);
    const badge = await boxOf(page.locator(BADGE));
    expect(nameBox.width).toBeLessThanOrEqual(badge.width);
  });
});
