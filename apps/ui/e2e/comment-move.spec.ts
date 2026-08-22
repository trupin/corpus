import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubRow } from "./stubCorpus";
import { POPOVER_DRAG_STEP_COARSE, POPOVER_EDGE_MARGIN } from "../src/anchors/popoverDrag";

/**
 * UI-112 in a real browser: **the composer moves, and what it is about stays
 * lit.**
 *
 * Both halves are pointless to assert anywhere else. A component test can prove
 * a style attribute changed; only a browser can prove that a box the pointer
 * picked up ends up somewhere else on the screen, that it does not follow a
 * scroll of the document beneath it, and that a decoration is really drawn over
 * the words that were selected. The scroll is the apparatus, exactly as in
 * UI-110: it is what turns "the highlight exists" into "the highlight is still
 * findable after you have gone to look at something else".
 *
 * The stub is the transport and nothing above it: real React, real ProseMirror
 * decorations, a real DOM selection, a real drag, and — for the turn — the real
 * CSS Custom Highlight registry.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

/** Long enough that the reader scrolls, which is what the second half needs. */
const PARAGRAPHS = [
  "The rate assumption is 6.1% today, and it drives every figure below it.",
  ...Array.from(
    { length: 18 },
    (_unused, index) => `Filler paragraph ${String(index + 1)}, here to make the document scroll.`,
  ),
];

const MEMO: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: `${PARAGRAPHS.join("\n\n")}\n`,
};

const SUBJECT = PARAGRAPHS[0] ?? "";

async function openMemo(page: Page): Promise<void> {
  await stubCorpus(page, [VIEW, MEMO]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  // Every coordinate below is read off the document, and the document is still
  // moving for ~210ms after `.ProseMirror` appears (`settle.ts`, UI-146).
  // Measured here it is worse than a stale coordinate: a right-click that lands
  // while the column is still easing open makes Chromium scroll the reader
  // **188px** to bring the focused body into view, so the composer opens under
  // a paragraph that is no longer where it was aimed at.
  await settledReader(page);
}

/** Opens the composer on the memo's first paragraph, as a person does. */
async function commentOnTheFirstParagraph(page: Page): Promise<Locator> {
  const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
  await expect(paragraph).toHaveText(SUBJECT);
  await paragraph.selectText();
  await paragraph.click({ button: "right" });
  await page.getByRole("menu").locator('[data-act="comment"]').click();
  const composer = page.getByRole("dialog", { name: "New comment" });
  await expect(composer).toBeVisible();
  return composer;
}

interface Box {
  readonly x: number;
  readonly y: number;
}

async function corner(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("no box");
  return { x: Math.round(box.x), y: Math.round(box.y) };
}

/**
 * How far down this composer may still be put, from where it opened.
 *
 * `popoverDrag`'s clamp keeps the whole box inside the viewport with
 * `POPOVER_EDGE_MARGIN` to spare, so a box that opened at `top` has
 * `height - POPOVER_EDGE_MARGIN - boxHeight - top` of travel left underneath it
 * and not one pixel more.
 *
 * **It has to be measured, because it is not a constant.** The composer opens
 * under the words it is about, so where those words sit decides how much room
 * is beneath it — and what sits above them decides where they sit. This spec
 * used to drag a flat 220px, which was room the layout offered until UI-093 put
 * the frontmatter form on screen at all times: the form pushed the first
 * paragraph ~75px down the page, the composer opened ~75px lower with it, and
 * 220px stopped fitting. CI failed it deterministically at 46px short — the
 * clamp doing its job, on a drag the viewport no longer had room for. Asserting
 * a distance the layout does not offer tests the clamp, not the landing.
 */
async function roomBelow(page: Page, composer: Locator): Promise<number> {
  const box = await composer.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("no box");
  return viewport.height - POPOVER_EDGE_MARGIN - box.height - box.y;
}

/** Picks the composer up by its grip and puts it down `dx, dy` away. */
async function dragBy(page: Page, composer: Locator, dx: number, dy: number): Promise<void> {
  const grip = composer.locator("[data-comment-drag]");
  const box = await grip.boundingBox();
  if (box === null) throw new Error("no grip");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe("the comment composer on a document selection", () => {
  test("lights the selection on open, before anything is sent", async ({ page }) => {
    await openMemo(page);
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(0);

    await commentOnTheFirstParagraph(page);

    const provisional = page.locator('.reader .doc-body .anchor-hl[data-provisional="true"]');
    await expect(provisional).toHaveCount(1);
    await expect(provisional).toHaveText(SUBJECT);
    // The same paint an anchor gets (§6): the class is the anchor's own, and
    // there is no pip, because there is no conversation to count turns of.
    await expect(page.locator(".reader .anchor-pip")).toHaveCount(0);
  });

  test("moves where it is put, and stays there while the document scrolls under it", async ({
    page,
  }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);
    const before = await corner(composer);

    /*
     * Half the room the layout actually offers underneath the box.
     *
     * Half rather than all of it, so the box is put down **inside** the clamp:
     * a drag the clamp refused would land on the floor instead, tens of pixels
     * from where it was asked for, and fail below. The tolerance stays at the
     * two pixels a rounded `top` costs — this is an exact landing, not an
     * approximate one.
     */
    const down = Math.round((await roomBelow(page, composer)) / 2);
    expect(down, "the composer opens with no room left to be moved into").toBeGreaterThan(
      POPOVER_DRAG_STEP_COARSE,
    );

    await dragBy(page, composer, 60, down);
    const dropped = await corner(composer);
    // Within a pixel of the displacement: this is a real gesture, not a jump.
    expect(Math.abs(dropped.x - (before.x + 60))).toBeLessThanOrEqual(2);
    expect(Math.abs(dropped.y - (before.y + down))).toBeLessThanOrEqual(2);

    // Scroll the surface underneath: the words move, the composer does not.
    const highlight = page.locator('.reader .doc-body .anchor-hl[data-provisional="true"]');
    const textBefore = await corner(highlight);
    // Aimed at the lit words themselves, read live: a point derived from
    // anything measured earlier can miss, because `.col` transitions its width
    // for 250 ms after a reader opens.
    const over = await highlight.boundingBox();
    await page.mouse.move((over?.x ?? 0) + 4, (over?.y ?? 0) + (over?.height ?? 0) / 2);
    await page.mouse.wheel(0, 320);
    await expect.poll(async () => (await corner(highlight)).y).not.toBe(textBefore.y);

    expect(await corner(composer)).toEqual(dropped);
    // And the words are still lit, on their own text, which is the whole point
    // of scrolling away to check something.
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText(SUBJECT);
  });

  test("cannot be dragged off the screen", async ({ page }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);

    const before = await corner(composer);
    await dragBy(page, composer, -4000, -4000);
    const pinned = await corner(composer);
    // It really went to the corner, rather than refusing to move at all.
    expect(pinned.x).toBeLessThan(before.x);
    expect(pinned.x).toBeGreaterThanOrEqual(0);
    expect(pinned.x).toBeLessThanOrEqual(12);
    expect(pinned.y).toBeGreaterThanOrEqual(0);
    expect(pinned.y).toBeLessThanOrEqual(12);

    await dragBy(page, composer, 4000, 4000);
    const box = await composer.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  });

  /** §11 adds no exclusive-pointer capability. */
  test("moves from the keyboard, by a handle that is focusable", async ({ page }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);
    const before = await corner(composer);

    const grip = composer.locator("[data-comment-drag]");
    await grip.focus();
    await expect(grip).toBeFocused();
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");

    const moved = await corner(composer);
    expect(moved.y).toBeGreaterThan(before.y);
    expect(moved.x).toBeGreaterThan(before.x);
  });

  /**
   * Picking the box up must not cost what is being written in it — the grip
   * declines the press's default, so the caret stays in the field and the
   * sentence continues where it left off.
   */
  test("keeps the caret in the field across a drag", async ({ page }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);
    const field = composer.getByRole("textbox", { name: "Comment" });
    await field.fill("Where does ");

    await dragBy(page, composer, 100, 160);
    await page.keyboard.type("6.1% come from?");

    await expect(field).toHaveValue("Where does 6.1% come from?");
  });

  test("puts the light out when the comment is abandoned, leaving no mark", async ({ page }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden();
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(0);
  });

  /**
   * A position chosen because it cleared *that* paragraph means nothing for the
   * next one, so a second selection opens the composer where the words are.
   */
  test("opens afresh on a new selection rather than where the last one was left", async ({
    page,
  }) => {
    await openMemo(page);
    const composer = await commentOnTheFirstParagraph(page);
    const opened = await corner(composer);
    await dragBy(page, composer, 120, 260);
    const dropped = await corner(composer);
    expect(dropped).not.toEqual(opened);
    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden();

    const second = page.locator(".reader .doc-body[contenteditable] > p").nth(2);
    await second.selectText();
    await second.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    await expect(composer).toBeVisible();

    expect(await corner(composer)).not.toEqual(dropped);
    // Placed against the words it is about, which is where it opens.
    const anchored = await corner(page.locator('.anchor-hl[data-provisional="true"]'));
    expect(Math.abs((await corner(composer)).y - anchored.y)).toBeLessThan(200);
  });
});

/* ── The same thing one surface over: a selection inside a turn ────────── */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 1,
  query: { type: "thread" },
};

const PHRASE = "revisit the rate assumption";
const TURN_TS = "2026-08-03T17:01:12Z";

const THREAD: StubRow = {
  id: "th_dup",
  type: "thread",
  title: "Rate assumption",
  path: "data/docs/threads/th_dup.md",
  body: `## user · ${TURN_TS}\nLet's ${PHRASE}.\n\nI said ${PHRASE} because 6.1% looks stale.\n`,
};

const TURN_PROSE = `.reader [data-thread="th_dup"] > .turns > .turn[data-turn-ts="${TURN_TS}"] > .turn-body .turn-markdown p`;

/**
 * What the CSS Custom Highlight API is actually painting.
 *
 * A rendered turn is `react-markdown` output — React owns every node, so the
 * paint is a registered `Range` rather than a `<mark>`. Reading the registry is
 * the only honest way to assert it (`turn-comment.spec.ts` reads it the same
 * way for the server's own anchors).
 */
async function painted(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, Iterable<Range>> })
      .highlights;
    const ranges = registry?.get("corpus-turn-anchor");
    return ranges === undefined ? [] : [...ranges].map((range) => range.toString());
  });
}

test.describe("the comment composer on a selection inside a turn", () => {
  test("lights the words on open and puts them out when abandoned", async ({ page }) => {
    await stubCorpus(page, [THREADS_VIEW, THREAD]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="th_dup"]').click();
    await expect(page.locator('.reader [data-thread="th_dup"] > .turns > .turn')).toHaveCount(1);
    expect(await painted(page)).toEqual([]);

    await page.evaluate(
      ({ root, phrase }) => {
        const host = document.querySelector(root);
        if (host === null) throw new Error(`no ${root}`);
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = (node.textContent ?? "").indexOf(phrase);
          if (at === -1) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + phrase.length);
          const selection = globalThis.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
        throw new Error(`no “${phrase}”`);
      },
      { root: `${TURN_PROSE}:nth-of-type(2)`, phrase: PHRASE },
    );
    const point = await page.evaluate(() => {
      const range = globalThis.getSelection()?.getRangeAt(0);
      if (range === undefined) throw new Error("nothing selected");
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await expect(composer).toBeVisible();
    // Lit before anything is posted — the complaint was that this arrived with
    // the server's anchor, which is after the comment is written.
    await expect.poll(async () => painted(page)).toEqual([PHRASE]);

    // The composer moves here too, over a surface nobody is typing into.
    const before = await corner(composer);
    await dragBy(page, composer, 80, 140);
    expect((await corner(composer)).x).toBeGreaterThan(before.x);
    expect(await painted(page)).toEqual([PHRASE]);

    await page.keyboard.press("Escape");
    await expect(composer).toBeHidden();
    await expect.poll(async () => painted(page)).toEqual([]);
  });
});
