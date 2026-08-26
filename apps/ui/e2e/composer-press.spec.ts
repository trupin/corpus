import type { AgentLane } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **A composer does not move inside the press that reaches it** (UI-157), and
 * **its foot yields in the stated order at every width a column can take**
 * (UI-136 finding 3).
 *
 * ## The press
 *
 * `thread.css` pins a composer in use — `.composer:focus-within { position:
 * sticky }` — and the browser gives focus on `mousedown`. So when the composer's
 * foot sat below the fold of its reading surface, pressing a control in it moved
 * the whole box up to the bottom of the surface **between the press and its
 * release**, and the `mouseup` landed on whatever was now there. No `click` was
 * dispatched at all. Measured in this browser before `composerPin.ts`, with the
 * address line 4px clear of the reading surface's bottom edge:
 *
 *     column   the composer jumped   the popover opened
 *     336px    43px                  no
 *     440px    16px                  no
 *     560px    16px                  no
 *
 * and at 440px `◉ ask agent` took focus, moved 19px, and stayed
 * `aria-pressed="true"`. The **second** press always worked — the composer was
 * pinned and steady by then — which is exactly why no existing spec caught it:
 * they all press these controls where the composer is fully in view.
 *
 * **So every press below is a real pointer sequence**, `mouse.down` and
 * `mouse.up` at coordinates read off the layout, never `locator.click()`.
 * Playwright's click re-resolves the element and scrolls it into view first,
 * which is precisely the repair the product has to make for itself: a spec built
 * on it would have gone green against the defect.
 *
 * **It is not about width.** UI-157 filed it as a path column's 440px because
 * that is the width its reporter was porting suites to. Width only decides how
 * far the box jumps — a narrower column wraps the foot onto more rows, so there
 * is more of the composer below the fold to lift. Every claim here is therefore
 * made across the range a column can take — {@link WIDTHS} — and stated as a
 * relation, never as a pixel count.
 *
 * ## The foot
 *
 * UI-136 finding 3 reported `Reply ⌘↵` clipping at the then-default 336px. It no
 * longer does at any width between `MIN_COLUMN_WIDTH` and `MAX_COLUMN_WIDTH` —
 * UI-137 gave the controls `flex: none` and made the hint the item that gives —
 * and the tests here are what keeps that true. The rule `thread.css` states, and
 * the one asserted: **the controls keep their natural size, the address line
 * keeps its reserved slot, and the hint is what truncates** (SHARED-057 clause
 * 2), revealing the whole sentence on its `title` rather than losing it.
 */

/*
 * Each test here opens a board, opens a reader in a column, waits for the reader
 * to settle and then for the address line to settle — the roster lands a moment
 * after the composer paints, and a press inside that window is no press at all.
 * That is ~8s of honest fixture, and it exceeded Playwright's 30s default once
 * on a loaded machine running the whole suite in one worker. The claims are
 * unchanged; only the room to make them is.
 */
test.describe.configure({ timeout: 60_000 });

const HOST: StubRow = {
  id: "th_host",
  type: "thread",
  title: "Q3 planning",
  path: "data/docs/threads/th_host.md",
  /** Long enough that the composer sits at the foot of a full scrollport. */
  body: Array.from(
    { length: 30 },
    (_unused, index) =>
      `## user · 2026-08-17T10:00:00Z\n\nTurn ${String(index)} of the conversation.\n`,
  ).join("\n"),
};

const LANES: readonly AgentLane[] = [0, 1].map((index) => ({
  lane: `th_lane_${String(index)}`,
  resident: {
    name: `designated-${String(index)}`,
    docId: `doc_${String(index)}`,
    weight: null,
    designationId: null,
  },
  live: false,
  since: "2026-08-17T10:00:00.000Z",
  pending: 0,
  working: false,
  summary: null,
  origin: { id: `th_lane_${String(index)}`, title: `Conversation ${String(index)}` },
}));

const view = (width: number): StubRow => ({
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  query: { type: "thread" },
  order: 1,
  extra: { width },
});

/**
 * `MIN_COLUMN_WIDTH`, the two defaults a reader is opened at today
 * (`DEFAULT_COLUMN_WIDTH` 336 and `PATH_COLUMN_WIDTH` 440) and a wide one.
 * Stated as the range a column can take rather than as the width one issue
 * happened to measure.
 */
const WIDTHS = [240, 336, 440, 560, 960] as const;

const LINE = 'button[data-address-line="th_host"]';

/**
 * Resolves once `selector`'s box has read the same three times running.
 *
 * A fixture concern and never an assertion: the roster lands after the first
 * paint, so the address line re-words itself a moment after the composer
 * appears, and a press inside that window is no press at all.
 */
async function settledLine(page: Page, selector: string): Promise<void> {
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

/** A reply composer on `th_host`, in a column of `width`, settled. */
async function openReply(page: Page, width: number): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await stubCorpus(page, [view(width), HOST], {
    lanes: LANES,
    agent: { live: false, since: "2026-08-17T10:00:00.000Z" },
  });
  await page.goto("/");
  await page.locator(".board").waitFor();
  // "Open here": the reader whose foot this measures is the column's own, so the
  // column carries the width being tested (UI-149, rider 3).
  await page.locator('.row[data-row-doc="th_host"]').click({ button: "right" });
  await page.locator('[role="menuitem"][data-act="open-here"]').click();
  await expect(page.locator('.reader [data-composer="th_host"]')).toBeVisible();
  await settledReader(page);
  await settledLine(page, LINE);
}

/**
 * Scrolls the reader so `target`'s own box ends 4px above the reading surface's
 * bottom edge — visible and pressable, with the composer's foot below it clipped.
 *
 * This is the state, and the only state, in which the defect happened. A press
 * anywhere else in a composer never had a jump to survive.
 */
async function putAtTheFold(page: Page, target: Locator): Promise<void> {
  const handle = await target.elementHandle();
  if (handle === null) throw new Error("no element to place at the fold");
  await page.locator(".reader .reader-scroll").evaluate((port, element) => {
    if (!(element instanceof Element)) throw new Error("no element");
    port.scrollTop += element.getBoundingClientRect().bottom - port.getBoundingClientRect().bottom;
    port.scrollTop -= 4;
  }, handle);
  await page.waitForTimeout(150);
}

interface Press {
  /** Where the pressed control's box was when the pointer went down. */
  readonly atDown: number;
  /** …and where it was after the pointer came up. */
  readonly atUp: number;
  /** Whether it moved while the pointer was down on it. */
  readonly movedUnderThePointer: boolean;
}

/** A real press: down and up at one point, read off the running layout. */
async function press(page: Page, target: Locator): Promise<Press> {
  const before = await target.boundingBox();
  if (before === null) throw new Error("the control has no box");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  const during = await target.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await target.boundingBox();
  return {
    atDown: during?.y ?? Number.NaN,
    atUp: after?.y ?? Number.NaN,
    movedUnderThePointer: Math.abs((during?.y ?? 0) - before.y) > 1,
  };
}

test.describe("a press on a composer at the fold", () => {
  for (const width of WIDTHS) {
    test(`opens the address card in a ${String(width)}px column`, async ({ page }) => {
      await openReply(page, width);
      const line = page.locator(LINE);
      await putAtTheFold(page, line);

      const moved = await press(page, line);
      expect(
        moved.movedUnderThePointer,
        "the composer re-positioned itself between the press and its release",
      ).toBe(false);
      // The claim the movement was costing: the press reaches the control.
      await expect(page.locator('[data-address-pop="th_host"]')).toBeVisible();
    });

    test(`flips the agent toggle in a ${String(width)}px column`, async ({ page }) => {
      await openReply(page, width);
      const toggle = page.locator(".reader .composer-foot .toggle");
      const was = await toggle.getAttribute("aria-pressed");
      await putAtTheFold(page, toggle);

      const moved = await press(page, toggle);
      expect(moved.movedUnderThePointer).toBe(false);
      // `aria-pressed` and not the label, because the label is the state's
      // wording and this is a claim about the state.
      await expect(toggle).not.toHaveAttribute("aria-pressed", was ?? "true");
    });
  }

  /**
   * The other half of the same rule, and the reason the fix is not simply "do
   * not pin": once the press is over the composer still arrives, which is UI-110
   * working. What changed is when.
   */
  test("and the composer still arrives once the press is over", async ({ page }) => {
    await openReply(page, 336);
    const line = page.locator(LINE);
    await putAtTheFold(page, line);

    const port = await page.locator(".reader .reader-scroll").boundingBox();
    const composer = page.locator('.reader .composer:has([data-composer="th_host"])');
    const below = await composer.boundingBox();
    if (port === null || below === null) throw new Error("no boxes");
    // The fixture really is the fixture: the composer's foot is off the surface.
    expect(below.y + below.height).toBeGreaterThan(port.y + port.height);

    const moved = await press(page, line);
    expect(moved.movedUnderThePointer).toBe(false);
    // It came up after the press, not during it.
    expect(moved.atUp).toBeLessThan(moved.atDown);

    const settled = await composer.boundingBox();
    if (settled === null) throw new Error("no box");
    expect(
      settled.y + settled.height,
      "the composer never arrived at the foot of the reading surface",
    ).toBeLessThanOrEqual(port.y + port.height + 2);
  });
});

test.describe("the composer's foot yields in the stated order", () => {
  for (const width of WIDTHS) {
    test(`at ${String(width)}px the controls keep their size and the hint gives`, async ({
      page,
    }) => {
      await openReply(page, width);

      const measured = await page.locator(".reader .composer-foot").evaluate((foot) => {
        const of = (selector: string): { w: number; scrollW: number; clientW: number } | null => {
          const element = foot.querySelector(selector);
          if (element === null) return null;
          return {
            w: Math.round(element.getBoundingClientRect().width * 10) / 10,
            scrollW: element.scrollWidth,
            clientW: element.clientWidth,
          };
        };
        return {
          send: of(".send"),
          toggle: of(".toggle"),
          address: of(".composer-address"),
          hint: of(".composer-hint"),
          hintTitle: foot.querySelector(".composer-hint")?.getAttribute("title") ?? null,
          hintText: foot.querySelector(".composer-hint")?.textContent ?? null,
          /** Anything painted outside the foot's own box is the foot overflowing. */
          overflows: foot.scrollWidth > foot.clientWidth + 1,
        };
      });

      const { send, toggle, address, hint } = measured;
      if (send === null || toggle === null || address === null || hint === null) {
        throw new Error("the foot is missing a part");
      }

      // 1. The controls are whole. `Reply ⌘↵` clipping at the default width is
      //    the finding this half of the file is here for.
      expect(send.scrollW, "the send control is clipped").toBeLessThanOrEqual(send.clientW + 1);
      expect(toggle.scrollW, "the agent toggle is clipped").toBeLessThanOrEqual(toggle.clientW + 1);
      // 2. The address line keeps its reserved slot — the ordinary live
      //    statement is read, never revealed (`address.css`, `--address-slot`).
      expect(address.scrollW, "the address line is clipped").toBeLessThanOrEqual(
        address.clientW + 1,
      );
      // 3. Nothing is painted outside the foot at any width: what does not fit
      //    wraps or truncates, and never spills.
      expect(measured.overflows, "the foot overflows its own box").toBe(false);
      // 4. And when something does have to give, it is the hint — which reveals
      //    the whole sentence rather than losing it (SHARED-057 clause 2).
      if (hint.scrollW > hint.clientW + 1) {
        expect(measured.hintTitle).toBe(measured.hintText);
      }
    });
  }
});
