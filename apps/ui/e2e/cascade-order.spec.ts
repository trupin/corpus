import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **The app's rules win their ties with the kit's** (UI-156).
 *
 * `packages/kit` is the base layer and `apps/ui` specializes it: `.turn-markdown`
 * and `.thread-conversation` exist only to override `markdown.css`'s `.doc-body`.
 * All three selectors weigh one class, so **which stylesheet loads first decides
 * which one wins**, and `main.tsx` used to import `./app/App` above its kit
 * stylesheets. Every rule in `apps/ui` was therefore injected before every rule
 * in `packages/kit`, and the specialization lost to the thing it specializes.
 *
 * Measured in this browser before the fix, on a turn in a column reader:
 *
 *     {"fontFamily": "Iowan Old Style", "fontSize": "15px",
 *      "lineHeight": "24.3px", "maxWidth": "100%"}
 *
 * where `Reader.css` asks for `var(--sans)`, `12.5px`, `1.5` and `max-width:
 * none`. A conversation was drawn in the document's serif at the document's
 * size, inside a card whose own furniture is sans — and it changed size again
 * on the way into full screen, where `FocusMode.css`'s two-class rule wins.
 *
 * **Why this file exists rather than a unit test.** A cascade tie leaves the DOM
 * untouched: the same elements carry the same classes and every rule is present
 * in every stylesheet. Only a computed style says who won. jsdom implements no
 * cascade of this kind, so nothing in the vitest suites can see this flip, and
 * nothing else in the Playwright suite reads `getComputedStyle` on a turn.
 * Flipping the two import blocks in `main.tsx` back makes this file red and
 * makes nothing else red.
 *
 * **No font stack is written down here.** The expected typeface is read out of
 * the running page by resolving `var(--sans)` and `var(--serif)` on a probe, so
 * the claim survives a machine whose Chromium normalizes the stack differently —
 * and a token edit moves the assertion with the product rather than against it.
 *
 * **And what full screen does to a turn** (UI-166, user decision 2026-08-23:
 * *"A conversation reads the same in a column and in full screen, differing only
 * in the room it has."*). UI-156 measured three differences surviving the import
 * order and left them, because they are specificity wins rather than order wins:
 * `.focus .doc-body` weighs two classes and reaches a turn through the
 * `doc-body` class `Turn.tsx` puts beside `turn-markdown`. Two of them —
 * `font-size` and `line-height` — are now answered by a rule that names turns,
 * and the third is not, because it never bound:
 *
 * | property | column | full screen, before | after |
 * | --- | --- | --- | --- |
 * | font-size | 12.5px | 13.5px | 12.5px |
 * | line-height | 1.5 | 1.7 | 1.5 |
 * | max-width | `none` | 561.23px, on a 487.6px turn | unchanged, still dead |
 *
 * So this file asserts the two that moved, on both surfaces, and asserts of the
 * third only that it does not reach the turn's rendered width. `max-width` is
 * measured rather than read as a string for exactly that reason.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const THREAD: StubRow = {
  id: "th_type",
  type: "thread",
  title: "About the rates",
  path: "data/docs/inbox/th_type.md",
  body: [
    "## user · 2026-07-01T09:00:00Z",
    "",
    "Is **6.1%** right?",
    "",
    "## agent · 2026-07-01T09:05:00Z",
    "",
    "It is.",
  ].join("\n"),
};

interface Type {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly maxWidth: string;
}

/** The two font stacks as this browser resolves them, and never as a literal. */
async function stacks(page: Page): Promise<{ sans: string; serif: string }> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    probe.style.fontFamily = "var(--sans)";
    const sans = getComputedStyle(probe).fontFamily;
    probe.style.fontFamily = "var(--serif)";
    const serif = getComputedStyle(probe).fontFamily;
    probe.remove();
    return { sans, serif };
  });
}

async function typeOf(page: Page, selector: string): Promise<Type> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const cs = getComputedStyle(element);
      return {
        fontFamily: cs.fontFamily,
        fontSize: Number.parseFloat(cs.fontSize),
        lineHeight: Number.parseFloat(cs.lineHeight),
        maxWidth: cs.maxWidth,
      };
    });
}

async function openTheConversation(page: Page): Promise<void> {
  await stubCorpus(page, [VIEW, THREAD]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_type"]').click();
  await page.locator(".reader .thread-conversation .turn").first().waitFor();
  await settledReader(page);
}

test.describe("the kit's stylesheets are the base layer", () => {
  test("a turn in a column reader is the type Reader.css declares", async ({ page }) => {
    await openTheConversation(page);
    const { sans, serif } = await stacks(page);
    const turn = await typeOf(page, ".col .reader .turn-markdown");

    expect(
      turn.fontFamily,
      `a turn is drawn in ${turn.fontFamily}; markdown.css's .doc-body is ${serif}`,
    ).toBe(sans);
    expect(turn.fontFamily).not.toBe(serif);
    // `.turn-markdown { font-size: 12.5px }` against `.doc-body`'s 15px.
    expect(turn.fontSize).toBeCloseTo(12.5, 3);
    // `line-height: 1.5` against `.doc-body`'s 1.62 — read as a ratio, because
    // the declaration is unitless and only the product is computed.
    expect(turn.lineHeight / turn.fontSize).toBeCloseTo(1.5, 2);
    // `max-width: none`: a turn's measure is its card's, never the document's.
    // `.doc-body` would put `var(--doc-measure)` here, which is `100%` in a
    // column — a different string, and the one the defect produced.
    expect(turn.maxWidth).toBe("none");
  });

  test("a conversation body is the type Reader.css declares", async ({ page }) => {
    await openTheConversation(page);
    const { sans, serif } = await stacks(page);
    const body = await typeOf(page, ".col .reader .thread-conversation");

    expect(body.fontFamily).toBe(sans);
    expect(body.fontFamily).not.toBe(serif);
    expect(body.fontSize).toBeCloseTo(12.5, 3);
  });

  test("a turn reads the same in full screen as in a column", async ({ page }) => {
    await openTheConversation(page);
    const inColumn = await typeOf(page, ".col .reader .turn-markdown");

    await page.locator('.reader[data-reader-doc="th_type"] [data-expand]').click();
    await page.locator(".focus.open").waitFor();
    await page.locator(".focus.open .turn-markdown").first().waitFor();
    const inFocus = await typeOf(page, ".focus.open .turn-markdown");

    const { sans } = await stacks(page);
    expect(inFocus.fontFamily, "full screen re-typeset the conversation").toBe(inColumn.fontFamily);
    expect(inFocus.fontFamily).toBe(sans);
    // The two that moved with UI-166. Compared to the column rather than to a
    // literal, because the claim is *the same*, not *this number* — and pinned
    // to the numbers too, so a change that moved both surfaces together would
    // still be seen.
    expect(inFocus.fontSize, "full screen resized the conversation").toBe(inColumn.fontSize);
    expect(inFocus.fontSize).toBeCloseTo(12.5, 3);
    expect(
      inFocus.lineHeight / inFocus.fontSize,
      "full screen re-led the conversation",
    ).toBeCloseTo(inColumn.lineHeight / inColumn.fontSize, 2);
    expect(inFocus.lineHeight / inFocus.fontSize).toBeCloseTo(1.5, 2);
  });

  /**
   * The third difference, and the reason it is left alone: `.focus .doc-body`
   * still puts `var(--doc-measure, 66ch)` on a turn in full screen, and it has
   * never bound — the card the turn sits in is narrower than the measure, on
   * every surface UI-166 measured. So the assertion is about the rendered box,
   * not about the declaration: a `max-width` that binds would show up as a turn
   * narrower than the room its card gives it.
   */
  test("full screen's reading measure does not reach a turn's box", async ({ page }) => {
    await openTheConversation(page);
    await page.locator('.reader[data-reader-doc="th_type"] [data-expand]').click();
    await page.locator(".focus.open .turn-markdown").first().waitFor();

    const boxes = await page
      .locator(".focus.open .turn-markdown")
      .first()
      .evaluate((turn) => {
        const parent = turn.parentElement;
        const cs = getComputedStyle(turn);
        return {
          maxWidth: Number.parseFloat(cs.maxWidth),
          turn: turn.getBoundingClientRect().width,
          room: parent === null ? 0 : parent.getBoundingClientRect().width,
        };
      });

    expect(boxes.room).toBeGreaterThan(0);
    // The turn fills the room it is given…
    expect(Math.abs(boxes.turn - boxes.room)).toBeLessThan(1.5);
    // …because the measure is wider than that room and therefore inert.
    expect(boxes.maxWidth).toBeGreaterThan(boxes.room);
  });
});
