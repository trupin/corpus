import { Buffer } from "node:buffer";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * **The comment composer is reachable in the room the chrome leaves** (UI-159).
 *
 * Three times in one phase a control's geometry was written against a viewport
 * that later changed underneath it: UI-145's menu ceiling was a constant,
 * UI-148's popover clamp ran on a drag and never on an opening, and then the
 * board bar and the column strip together — 84px of new chrome — pushed this
 * composer's Send button 42px below the bottom of the window, where a pointer
 * cannot press it and only `⌘↵` still worked.
 *
 * What each of those fixes had in common is a number. This file asserts the
 * absence of one. Every measurement below is read off the running layout: the
 * room is `[data-popover-room]`'s own rectangle — the board's, which is the flex
 * child handed whatever the bands above and below it did not take — and the
 * claims are relations between measured rectangles rather than pixel counts.
 *
 * So the two halves it pins are:
 *
 * 1. **Send is reachable.** Inside the window, inside the room, and it really
 *    sends when a real pointer presses it. This is the half that must never go
 *    red, and a band of chrome added above the board must not make it.
 * 2. **The composer's foot is inside the room.** This is the half that *should*
 *    go red when the chrome grows past what the room can hold — it is the alarm
 *    the last three issues did not have, and the reason a fourth band will be
 *    caught here rather than in a click timeout somewhere else.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** Long enough to scroll, so a passage can be commented on anywhere down it. */
const PARAGRAPHS = [
  "The rate assumption is 6.1% today, and it drives every figure below it.",
  ...Array.from(
    { length: 18 },
    (_unused, index) => `Filler paragraph ${String(index + 1)}, here to make the document scroll.`,
  ),
];

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: `${PARAGRAPHS.join("\n\n")}\n`,
};

const SHOT = {
  name: "shot.png",
  mimeType: "image/png",
  buffer: Buffer.from("\x89PNG\r\n\x1a\nrates-screenshot", "binary"),
};

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

async function rectOf(target: Locator): Promise<Rect> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("no box");
  return { top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height };
}

/** The room the chrome has actually left, read off the surface that declares it. */
async function room(page: Page): Promise<Rect> {
  return rectOf(page.locator("[data-popover-room]"));
}

/**
 * Another band of chrome above the board, of the kind this phase added twice.
 *
 * A real element in the shell's own flex column rather than a stylesheet trick,
 * so the board is squeezed exactly as the board bar and the column strip squeeze
 * it — and every measurement below re-reads the consequences instead of assuming
 * them.
 */
async function addBandAboveTheBoard(page: Page, height: number): Promise<void> {
  await page.evaluate((px: number) => {
    const app = document.querySelector(".app");
    const main = document.querySelector(".main");
    if (app === null || main === null) throw new Error("no shell");
    const band = document.createElement("div");
    band.dataset.testBand = "";
    band.style.cssText = `height:${String(px)}px;flex:none;background:var(--surface-2)`;
    app.insertBefore(band, main);
  }, height);
}

async function openMemo(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  return corpus;
}

/** Opens the reader, then the comment composer, on the memo's first paragraph. */
async function commentOnTheMemo(page: Page): Promise<Locator> {
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  // The reader is still moving for ~210ms after `.ProseMirror` appears
  // (`settle.ts`, UI-146), and every coordinate here is read off it.
  await settledReader(page);
  const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
  await paragraph.selectText();
  await paragraph.click({ button: "right" });
  await page.getByRole("menu").locator('[data-act="comment"]').click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await expect(composer).toBeVisible();
  return composer;
}

/** Inside, with the same margin the placement keeps — never merely overlapping. */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom &&
    inner.left >= outer.left &&
    inner.right <= outer.right
  );
}

test.describe("the comment composer's room", () => {
  test("keeps its send control in the window and in the room, with a file attached", async ({
    page,
  }) => {
    const corpus = await openMemo(page);
    const composer = await commentOnTheMemo(page);
    await composer.getByLabel("Comment").fill("Is this the right chart?");

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const screen: Rect = { top: 0, left: 0, right: viewport.width, bottom: viewport.height };

    // Empty, the composer is placed on the side of the words with the room.
    expect(contains(screen, await rectOf(composer))).toBe(true);
    expect(contains(await room(page), await rectOf(composer))).toBe(true);

    // A chip makes the box ~50px taller. The old placement ran once, at the
    // opening, so the box grew downwards from where it already sat and put this
    // button below the window; the placement is derived again here.
    await page.locator('[data-attach-input="comment"]').setInputFiles([SHOT]);
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toHaveCount(1);

    const send = page.locator("[data-comment-send]");
    expect(contains(screen, await rectOf(send))).toBe(true);
    expect(contains(await room(page), await rectOf(composer))).toBe(true);

    // And the whole claim, made by a pointer rather than by arithmetic: the
    // press lands, and the comment goes.
    await send.click({ timeout: 5_000 });
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
  });

  /**
   * **The band this issue is named for, one more time.**
   *
   * 8px is small enough that no placement need move for it and large enough that
   * a geometry written against yesterday's viewport would be off by it. Nothing
   * in the composer is told the band exists: the room is re-measured, the words
   * sit 8px lower, and both sides of the arithmetic follow.
   */
  test("costs the composer nothing when another band of chrome is added above the board", async ({
    page,
  }) => {
    const corpus = await openMemo(page);
    const before = await room(page);
    await addBandAboveTheBoard(page, 8);
    const after = await room(page);
    // The band really took room off the board, which is what makes the rest of
    // this test evidence rather than a repetition of the one above.
    expect(after.top).toBe(before.top + 8);

    const composer = await commentOnTheMemo(page);
    await page.locator('[data-attach-input="comment"]').setInputFiles([SHOT]);
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toHaveCount(1);

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const screen: Rect = { top: 0, left: 0, right: viewport.width, bottom: viewport.height };
    const send = page.locator("[data-comment-send]");
    expect(contains(screen, await rectOf(send))).toBe(true);
    expect(contains(await room(page), await rectOf(composer))).toBe(true);

    await send.click({ timeout: 5_000 });
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
  });

  /**
   * The console drawer takes its room off the foot rather than the head, and the
   * board's rectangle reports that the same way. It is the fourth step of this
   * issue's verification plan, and it is here because a bound derived from one
   * end of the room is only half a derivation.
   */
  test("keeps its send control reachable with the console drawer open", async ({ page }) => {
    const corpus = await openMemo(page);
    const tall = await room(page);
    await page.getByRole("button", { name: "Toggle console" }).click();
    await expect.poll(async () => (await room(page)).bottom).toBeLessThan(tall.bottom);

    const composer = await commentOnTheMemo(page);
    await page.locator('[data-attach-input="comment"]').setInputFiles([SHOT]);
    await expect(page.locator('[data-dropzone="comment"] .att-chip')).toHaveCount(1);

    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("no viewport");
    const screen: Rect = { top: 0, left: 0, right: viewport.width, bottom: viewport.height };
    const send = page.locator("[data-comment-send]");
    expect(contains(screen, await rectOf(send))).toBe(true);
    expect(contains(await room(page), await rectOf(composer))).toBe(true);

    await send.click({ timeout: 5_000 });
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
  });
});
