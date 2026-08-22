import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-037's reveal seam, in a real browser.
 *
 * **How the payload is driven, and why.** The instruction is seeded directly,
 * at exactly one place: the column's navigation entry. A board that restores an
 * entry carrying a reveal enters the reader at the same hop, through the same
 * parse, the same reader and the same flash as any open that names a place
 * inside a document.
 *
 * There was a producer half here until Phase 41, clicking a real item in the
 * todos plugin's column and letting the plugin build the payload (PLUGINS-010).
 * The plugin system is gone (SHARED-064) and nothing shipped produces a
 * `kind: "item"` reveal today — a thread reveal, which the comments list does
 * produce, is covered by `comments-tab.spec.ts`. So what is pinned here is the
 * **reader's** half: an instruction the reader must honour whoever writes it.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence:
 * `playwright.config.ts` starts no workspace server, so the disk, git and
 * projection half comes from the issue's real-app drill. Neither half is
 * acceptance on its own. Real React, real ProseMirror, real layout, real
 * client rectangles — only `fetch` is answered from inside the page.
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

/** Filler, so the item below it is well past the fold of a column reader. */
const FILLER = Array.from(
  { length: 24 },
  (_unused, index) =>
    `Paragraph ${String(index + 1)} of preamble, long enough to push the list below the fold.`,
).join("\n\n");

/**
 * Two identical items with a distinct one between them: the ambiguity
 * sprint-023 OC4 is about, in the shape a todo list actually produces.
 */
const CHORES: StubRow = {
  id: "doc_chores",
  title: "Chores",
  path: "data/docs/inbox/chores.md",
  body: [
    FILLER,
    "",
    "- Call the plumber",
    "- Book the passport appointment",
    "- Call the plumber",
    "",
  ].join("\n"),
};

const THREAD: StubRow = {
  id: "th_1",
  type: "thread",
  title: 'Re: "Call the plumber"',
  path: "data/docs/threads/th_1.md",
  body: "Which plumber?",
  parent: "doc_chores",
};

type Reveal =
  | { kind: "item"; exact: string; prefix?: string; suffix?: string }
  | { kind: "thread"; threadId: string };

/**
 * Opens the board with `doc_chores` already open in the Inbox column, carrying
 * `reveal` as a pending instruction — the state a reveal-carrying open leaves
 * behind before the document has rendered.
 */
/**
 * The SSE endpoint itself — `<origin>/events?token=…` and nothing else.
 *
 * Anchored on the origin and the whole path segment, never a recursive
 * `**\/events*` glob: Playwright matches globs against the whole URL and the dev
 * server serves modules by path, so that glob also captures
 * `…/@fs/…/packages/kit/dist/events/sseBridge.js` and refusing it takes the
 * application down before it renders (console-index.spec.ts's lesson, e875705).
 */
const EVENT_STREAM = /^https?:\/\/[^/]+\/events(\?|$)/;

async function openWithReveal(page: Page, reveal: Reveal | null): Promise<void> {
  await stubCorpus(page, [VIEW, CHORES, THREAD]);
  /*
   * Refused outright, so no stream can ever open. The suite's standing
   * condition is that nothing answers on 8765, but a machine running a
   * workspace server (a parallel agent's, or the user's own) proxies through
   * the dev server — and an open stream means the bridge's reconnect recovery,
   * which refetches every active query and re-renders the reader underneath the
   * assertions. A spec about a one-shot instruction has to own that variable.
   */
  await page.route(EVENT_STREAM, (route) => route.abort("connectionrefused"));
  await page.addInitScript(
    ([columnId, docId, pending]) => {
      window.localStorage.setItem(
        "corpus.board",
        JSON.stringify({
          version: 2,
          columns: {
            [columnId]: {
              scroll: 0,
              nav: [{ docId, scrollY: 0, ...(pending === null ? {} : { reveal: pending }) }],
            },
          },
        }),
      );
    },
    [VIEW.id, CHORES.id, reveal] as const,
  );
  await page.goto("/");
  await page.locator(".reader .ProseMirror").waitFor();
}

/**
 * The gap between the flash box and the rendered line at `at`, measured in the
 * **same frame**, once that line has stopped moving.
 *
 * Both halves matter, and PLUGINS-010's drill is why. A cold open — which is
 * every open from a column, since the reader replaces the list — fires the
 * reveal against a layout that is still settling: on the next frame the chips
 * row un-wraps and the editor re-flows, moving the body up by ~50 px. Measuring
 * at draw time therefore *passes* on a flash that the user will see one to two
 * lines off. So this waits for three identical frames of the target line before
 * reading anything, and reads both boxes in one evaluate so the flash cannot
 * expire between two round trips.
 *
 * `null` means the flash was already gone, which the caller asserts against
 * rather than silently scoring as a distance.
 */
async function settledGap(page: Page, at: number): Promise<number | null> {
  return page.evaluate(async (index) => {
    const line = document.querySelectorAll(".reader .ProseMirror li")[index];
    if (line === undefined) return null;
    await new Promise<void>((resolve) => {
      let previous = "";
      let repeats = 0;
      const tick = (): void => {
        const box = line.getBoundingClientRect();
        const current = `${String(box.y)},${String(box.height)}`;
        repeats = current === previous ? repeats + 1 : 0;
        previous = current;
        if (repeats >= 2) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const flash = document.querySelector(".reveal-flash");
    if (flash === null) return null;
    return Math.abs(flash.getBoundingClientRect().y - line.getBoundingClientRect().y);
  }, at);
}

interface StoredEntry {
  readonly docId?: string;
  readonly scrollY?: number;
  readonly reveal?: unknown;
}

/**
 * The Inbox column's open entry, as the board persisted it — the reveal's
 * actual storage, read the way the next page load will read it.
 */
async function storedEntry(page: Page, columnId: string = VIEW.id): Promise<StoredEntry | null> {
  return page.evaluate((column) => {
    const raw = window.localStorage.getItem("corpus.board");
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as {
      columns?: Record<string, { nav?: StoredEntry[] } | undefined>;
    };
    return parsed.columns?.[column]?.nav?.at(-1) ?? null;
  }, columnId);
}

test.describe("an open that names an item", () => {
  test("scrolls the item into view and flashes it, over the real text", async ({ page }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });

    const flash = page.locator(".reveal-flash");
    await expect(flash).toHaveCount(1);

    // The box traces the item: same line, same left edge, same width.
    const item = page.locator(".reader .ProseMirror li", {
      hasText: "Book the passport appointment",
    });
    const itemBox = await item.boundingBox();
    const flashBox = await flash.boundingBox();
    expect(itemBox).not.toBeNull();
    expect(flashBox).not.toBeNull();
    expect(Math.abs((flashBox?.y ?? 0) - (itemBox?.y ?? 0))).toBeLessThan(12);

    // …and it is on screen, which it was not before the reveal ran.
    const scrolled = await page
      .locator(".reader .reader-scroll")
      .evaluate((element) => element.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const viewport = page.viewportSize();
    expect(flashBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(flashBox?.y ?? Number.MAX_SAFE_INTEGER).toBeLessThan(viewport?.height ?? 0);
  });

  /**
   * The defect PLUGINS-010's drill found, on the seeded path (it reproduces
   * with no plugin anywhere: `flashY: 450` against a target line at `527`).
   *
   * The assertion above measures at draw time, and at draw time the box was
   * always right — that is what made this invisible to the suite and obvious to
   * a user. What is asserted here is where the box is once the document has
   * stopped moving, which is the only frame anybody actually looks at.
   */
  test("holds the box on the line after the cold open's layout settles", async ({ page }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });
    await expect(page.locator(".reveal-flash")).toHaveCount(1);

    const gap = await settledGap(page, 1);
    expect(gap).not.toBeNull();
    expect(gap ?? Number.MAX_SAFE_INTEGER).toBeLessThan(12);
  });

  /**
   * The same defect, stated so it cannot pass by luck.
   *
   * Whether a cold open's reveal lands before or after the column's 250 ms
   * width transition depends on how fast the document arrives, so the test
   * above is an end-state guard rather than a reproducer — measured here it
   * reads 24 px off on one run and 1 px on the next. What is *always* true is
   * the property the fix installs: while the flash is lit it sits on its line,
   * wherever that line has got to. Moving the surface under it on purpose is
   * the deterministic form of the same question, and a fixed-position box drawn
   * once fails it by exactly the distance the text travelled.
   */
  test("follows its line when the surface moves under the lit flash", async ({ page }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });
    await expect(page.locator(".reveal-flash")).toHaveCount(1);

    const moved = await page.evaluate(() => {
      const scroller = document.querySelector(".reader .reader-scroll");
      const line = document.querySelectorAll(".reader .ProseMirror li")[1];
      if (scroller === null || line === undefined) return null;
      const before = line.getBoundingClientRect().y;
      // Upwards: the reveal has just scrolled down to park the line a third of
      // the way in, so there is room above and none below.
      scroller.scrollTop -= 120;
      return { before, after: line.getBoundingClientRect().y };
    });
    // The text really did travel — otherwise the assertion below is vacuous.
    expect(moved).not.toBeNull();
    expect(Math.abs((moved?.after ?? 0) - (moved?.before ?? 0))).toBeGreaterThan(100);

    const gap = await settledGap(page, 1);
    expect(gap).not.toBeNull();
    expect(gap ?? Number.MAX_SAFE_INTEGER).toBeLessThan(12);
  });

  test("wears the flash treatment the rest of the board's flashes wear", async ({ page }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });
    const flash = page.locator(".reveal-flash");
    const accentWash = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent-wash").trim(),
    );
    await expect(flash).toHaveCSS("background-color", accentWash);
    // Decoration only: it must never take a click meant for the text under it.
    await expect(flash).toHaveCSS("pointer-events", "none");
    await expect(page.locator("[data-reveal-flash]")).toHaveAttribute("aria-hidden", "true");
  });

  test("is transient — it takes itself away and leaves the document untouched", async ({
    page,
  }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 4000 });

    // Nothing was added to the DOM the editor owns, and the body still reads
    // exactly as it did: the flash was drawn over it, never applied to it.
    await expect(page.locator(".reader .ProseMirror li")).toHaveCount(3);
    await expect(page.locator(".reader .ProseMirror [class*='reveal']")).toHaveCount(0);
  });

  test("takes the instruction off the entry, so a reload does not flash again", async ({
    page,
  }) => {
    await openWithReveal(page, { kind: "item", exact: "Book the passport appointment" });
    await expect(page.locator(".reveal-flash")).toHaveCount(1);

    /*
     * The claim is **durable**, not momentary, and asserting the momentary
     * version is what made this test flake — and what caught a real bug.
     *
     * Revealing scrolls the reader, and the scroll capture that follows is
     * debounced by 150 ms; it used to write its entry from a pre-consume
     * snapshot, putting the instruction back after the entry had briefly gone
     * clean. So: wait for the offset that capture persists to land, and only
     * then assert the entry carries no instruction. Waiting on the observable
     * that matters rather than on a duration — `scrollY` is the capture's own
     * footprint, so its arrival is proof the write this races has happened.
     */
    await expect.poll(async () => (await storedEntry(page))?.scrollY ?? 0).toBeGreaterThan(0);
    await expect.poll(async () => (await storedEntry(page))?.reveal ?? null).toBeNull();

    // The reader is still open on the document, at the offset the reveal left
    // it: what was consumed is the instruction, not the navigation.
    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator('.reader[data-reader-doc="doc_chores"]')).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0);
    // …and it stays gone: nothing rewrites the instruction after the fact.
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 2000 });
  });

  /**
   * sprint-023 OC4. Two identical items, and `exact` alone would silently flash
   * the wrong one — the failure that is worse than no reveal, because it looks
   * like it worked.
   */
  test("uses the prefix to pick which of two identical items it meant", async ({ page }) => {
    await openWithReveal(page, {
      kind: "item",
      exact: "Call the plumber",
      prefix: "Book the passport appointment",
    });

    const flashBox = await page.locator(".reveal-flash").boundingBox();
    const items = page.locator(".reader .ProseMirror li");
    const second = await items.nth(2).boundingBox();
    const first = await items.nth(0).boundingBox();
    expect(Math.abs((flashBox?.y ?? 0) - (second?.y ?? 0))).toBeLessThan(12);
    expect(Math.abs((flashBox?.y ?? 0) - (first?.y ?? 0))).toBeGreaterThan(12);
  });

  test("opens at the top, with no flash at all, when nothing was named", async ({ page }) => {
    await openWithReveal(page, null);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0);
    const scrolled = await page
      .locator(".reader .reader-scroll")
      .evaluate((element) => element.scrollTop);
    expect(scrolled).toBe(0);
  });
});

test.describe("an open that names a thread", () => {
  test("expands and flashes the thread, through the 💬 jump that already existed", async ({
    page,
  }) => {
    await openWithReveal(page, { kind: "thread", threadId: "th_1" });

    const expanded = page.locator('.thread-slot.expanded[data-slot-thread="th_1"]');
    await expect(expanded).toHaveCount(1);
    await expect(page.locator(".thread-card.flash")).toHaveCount(1);
    // One mechanism, two destinations: a thread reveal draws no box of its own.
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0);
  });

  test("is one-shot too — the entry keeps the open and forgets the instruction", async ({
    page,
  }) => {
    await openWithReveal(page, { kind: "thread", threadId: "th_1" });
    await expect(page.locator(".thread-card.flash")).toHaveCount(1);

    await expect.poll(async () => (await storedEntry(page))?.reveal ?? null).toBeNull();
    // The open survives the instruction being forgotten: the column is still
    // reading this document, it just has nothing left to point at.
    expect((await storedEntry(page))?.docId).toBe(CHORES.id);

    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator(".thread-card.flash")).toHaveCount(0);
  });
});
