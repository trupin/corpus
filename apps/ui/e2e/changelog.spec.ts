import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledReader } from "./settle";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * The changelog's clip, in a real browser (UI-089; SPEC.md §5 and §11's rider
 * signed 2026-08-07, re-based on clipping the same day).
 *
 * §11: "Past a threshold of entries it **clips**, exactly as a long fenced block
 * does … the newest entries stay visible, the rest sit behind a control that
 * expands them and says how many are hidden … Clipped entries stay selectable,
 * commentable and searchable like any other body text, and an anchor into a
 * clipped entry still resolves — revealing that conversation expands the clip
 * rather than quietly failing to reach it."
 *
 * **Why a browser and not jsdom.** Everything asserted here is geometry or a
 * live decoration: that a clipped entry is drawn zero pixels tall while still
 * being in the document, that an anchor highlight is painted over words nobody
 * can see, and that revealing that conversation lays the entry out before the
 * scroll aims at it. jsdom has no layout, so `changelogClip.test.tsx` asserts
 * the arithmetic and the DOM, and this asserts what a reader gets.
 *
 * The transport is `stubCorpus.ts` and nothing above it: real React, real
 * TanStack cache, real ProseMirror, real decorations, real clicks.
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

/** Twelve entries, oldest first — the order the workspace skill appends in. */
const ENTRIES = Array.from(
  { length: 12 },
  (_, index) =>
    `- **2026-07-${String(index + 1).padStart(2, "0")}** — the working assumption moved, revision ${String(index + 1)}`,
);

const BODY = [
  "# Mortgage options",
  "",
  "The working rate assumption is 6.4% as of 2026-07-28.",
  "",
  "## Changelog",
  "",
  ...ENTRIES,
  "",
].join("\n");

/**
 * The document, with a conversation anchored **inside the second entry** — one
 * of the seven the clip hides. That anchor is the case §11 calls out by name and
 * the one this spec exists for.
 */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Mortgage options",
  body: BODY,
  anchors: [
    {
      anchorId: "anc_old",
      threadId: "th_old",
      exact: "revision 2",
      prefix: "moved, ",
    },
  ],
};

const THREAD: StubRow = {
  id: "th_old",
  type: "thread",
  title: "Re: revision 2",
  path: "data/docs/threads/th_old.md",
  parent: "doc_note",
  body: [
    "## user · 2026-07-20T09:00:00Z",
    "",
    "Was this the correction or the original figure?",
    "",
  ].join("\n"),
};

/** Every changelog entry the body rendered, clipped or not. */
function entries(page: Page): Locator {
  return page.locator(".reader .ProseMirror.doc-body li");
}

function clippedEntries(page: Page): Locator {
  return page.locator(".reader .ProseMirror.doc-body [data-changelog-clipped]");
}

function control(page: Page): Locator {
  return page.locator(".reader .ProseMirror.doc-body button[data-changelog-more]");
}

/** The laid-out height of each match, in document order. */
async function heights(target: Locator): Promise<readonly number[]> {
  return target.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
}

async function openNote(page: Page): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, [VIEW, NOTE, THREAD]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  // Every test below measures a height or a `y`, and the column is still easing
  // open when the body first paints — see `settledReader`.
  await settledReader(page);
  return corpus;
}

test.describe("a document whose changelog is past the threshold", () => {
  test("keeps the newest entries visible and draws the rest at no height", async ({ page }) => {
    await openNote(page);

    // Every entry is in the document — the clip cuts, it does not remove.
    await expect(entries(page)).toHaveCount(12);
    await expect(clippedEntries(page)).toHaveCount(7);

    const measured = await heights(entries(page));
    expect(measured.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    for (const height of measured.slice(7)) expect(height).toBeGreaterThan(0);

    // The newest five are the ones that stayed, and they read as themselves.
    await expect(entries(page).nth(11)).toContainText("revision 12");
    await expect(entries(page).nth(7)).toContainText("revision 8");
  });

  test("offers one control that names the whole size and how many are hidden", async ({ page }) => {
    await openNote(page);

    await expect(control(page)).toHaveCount(1);
    await expect(control(page)).toHaveText("Show all 12 entries · 7 hidden");
    await expect(control(page)).toHaveAttribute("aria-expanded", "false");
    // A real control with a real box, not a decoration nobody can hit.
    const box = await control(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test("expands in place — the same body, the same scroll, nothing navigated", async ({ page }) => {
    await openNote(page);
    const url = page.url();
    const heading = page.locator(".reader .ProseMirror.doc-body h1");
    const before = await heading.boundingBox();

    await control(page).click();

    await expect(clippedEntries(page)).toHaveCount(0);
    for (const height of await heights(entries(page))) expect(height).toBeGreaterThan(0);
    await expect(control(page)).toHaveText("Show less");
    await expect(control(page)).toHaveAttribute("aria-expanded", "true");
    // In place: same reader, same document, same route — and the document did
    // not move out from under the reader above the section.
    expect(page.url()).toBe(url);
    await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toHaveCount(1);
    expect((await heading.boundingBox())?.y).toBe(before?.y);

    await control(page).click();
    await expect(clippedEntries(page)).toHaveCount(7);
  });

  test("expands from the keyboard alone", async ({ page }) => {
    await openNote(page);

    // §11 adds no exclusive-pointer capability: the control is a button, it
    // takes focus, and its own activation keys reach it — the host binds `↵`
    // globally, which is why the button claims the key rather than preventing it.
    await control(page).focus();
    await expect(control(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(clippedEntries(page)).toHaveCount(0);
    await expect(control(page)).toHaveText("Show less");
  });

  /**
   * §11: "clipped entries stay selectable, commentable and searchable like any
   * other body text" — which is a statement about the entries not being
   * *removed*, and it is asserted here as the two things a browser can show.
   *
   * **What a clip cannot do, and neither can the fence's.** Text a browser is
   * not painting is text `Selection.toString()` does not return — measured here
   * before this assertion was written: a `Range` over the clipped entries came
   * back holding the list markers and nothing else. That is true of every clip,
   * including `CodeFence`'s lines below its cut, and §11 asks for this one
   * "exactly as a long fenced block does". So the guarantee is delivered the way
   * a clip can deliver it: the entries are still in the document, and **any
   * selection that reaches them opens the clip** — after which they select,
   * comment and edit like the rest of the body. Nothing is ever selected, or
   * typed into, inside a box nobody can see.
   */
  test("opens when a selection reaches the clipped entries, and writes nothing", async ({
    page,
  }) => {
    const corpus = await openNote(page);

    await page.locator(".reader .ProseMirror.doc-body").click();
    await page.keyboard.press("ControlOrMeta+a");

    await expect(clippedEntries(page)).toHaveCount(0);
    await expect(control(page)).toHaveText("Show less");
    // Now that they are drawn, they are text a selection holds.
    const selected = await page.evaluate(() => globalThis.getSelection()?.toString() ?? "");
    expect(selected).toContain("revision 1");
    expect(selected).toContain("revision 12");

    // And nothing was written: the clip is drawn, never edited, so a document
    // opened, clipped, selected across and expanded produces no `PUT` at all.
    expect(await corpus.of("PUT")).toHaveLength(0);
    expect((await corpus.doc("doc_note"))?.body).toBe(BODY);
  });
});

test.describe("a conversation anchored inside a clipped entry", () => {
  test("still resolves — the highlight is painted on words nobody can see", async ({ page }) => {
    await openNote(page);

    const highlight = page.locator('.reader .anchor-hl[data-thread="th_old"]');
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("revision 2");
    // Resolved, and inside the clip: the anchor is matched against the document
    // rather than against the laid-out box, so being off screen costs it nothing.
    await expect(
      page.locator(
        '.reader .ProseMirror.doc-body [data-changelog-clipped] .anchor-hl[data-thread="th_old"]',
      ),
    ).toHaveCount(1);
    // Nobody can see it: its entry is drawn at no height and clips it away.
    // (The span's *own* rect is unaffected — `getBoundingClientRect` ignores an
    // ancestor's overflow — so what is asserted is the clipping, not the box.)
    await expect(highlight).not.toBeInViewport();
  });

  test("expands the clip when the conversation is revealed", async ({ page }) => {
    await openNote(page);

    // The comments list is how a reader jumps to a conversation by name — the
    // 💬 popover this replaced did the same, through the same reveal seam
    // (UI-037). Before UI-089 this landed on a box of no height: the jump
    // "succeeded" and showed the reader nothing, which is exactly the quiet
    // failure §11 forbids.
    const reader = page.locator('.reader[data-reader-doc="doc_note"]');
    await reader.locator(".comments-btn").click();
    await reader.locator('[data-comment-row="th_old"] [data-reveal-thread]').click();

    await expect(clippedEntries(page)).toHaveCount(0);
    const highlight = page.locator('.reader .anchor-hl[data-thread="th_old"]');
    expect((await highlight.boundingBox())?.height ?? 0).toBeGreaterThan(0);
    await expect(highlight).toBeInViewport();
    // The clip stays open after the flash goes out — the reader was brought
    // somewhere, not shown it for a second.
    await page.waitForTimeout(1500);
    await expect(clippedEntries(page)).toHaveCount(0);
  });
});
