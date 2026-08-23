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
 * **What this file deliberately does not claim.** Full screen still reads a turn
 * a little larger (`FocusMode.css`: `.focus .turn-markdown { font-size: 13.5px }`)
 * and still lends it the body's leading and reading measure, because
 * `.focus .doc-body` weighs two classes and reaches a turn through the `doc-body`
 * class `Turn.tsx` puts beside `turn-markdown`. Those are specificity wins, not
 * order wins: they read the same whichever stylesheet loads first. The claim
 * here is the one the defect broke — **the typeface does not change under the
 * reader** — plus the values `Reader.css` declares for a turn in a column.
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

  test("the typeface does not change when the turn enters full screen", async ({ page }) => {
    await openTheConversation(page);
    const inColumn = await typeOf(page, ".col .reader .turn-markdown");

    await page.locator('.reader[data-reader-doc="th_type"] [data-expand]').click();
    await page.locator(".focus.open").waitFor();
    await page.locator(".focus.open .turn-markdown").first().waitFor();
    const inFocus = await typeOf(page, ".focus.open .turn-markdown");

    const { sans } = await stacks(page);
    expect(inFocus.fontFamily, "full screen re-typeset the conversation").toBe(inColumn.fontFamily);
    expect(inFocus.fontFamily).toBe(sans);
    // And full screen never lets `.focus .doc-body`'s 16.5px reach a turn: the
    // size a reader sees there is `FocusMode.css`'s own 13.5px.
    expect(inFocus.fontSize).toBeCloseTo(13.5, 3);
  });
});
