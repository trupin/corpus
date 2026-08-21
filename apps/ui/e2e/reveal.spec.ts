import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-037's reveal seam, in a real browser.
 *
 * **How the payload is driven, and why.** When this spec was written the seam
 * had no producer, so nothing shipped passed a reveal to `onOpen`; the first
 * two describes below seed the instruction directly, and the last one — added
 * by PLUGINS-010 — clicks a todo item in the real plugin column and lets the
 * plugin build the payload. Both halves are worth keeping: the seeded ones pin
 * the reader against an instruction no producer has to be able to make, and the
 * clicked ones pin that a producer makes one the reader understands.
 *
 * The seeded path is entered at exactly one place: the column's navigation
 * entry. A board that restores an entry carrying a reveal is the *same* open a
 * plugin makes, at the same hop, through the same parse, the same reader and
 * the same flash; the only difference is which side of a page load the
 * instruction was written on.
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

/* ------------------------------------------------------------------------- *
 * The producer half (PLUGINS-010): a real click, in the real todos plugin
 * column, through `onOpen`.
 *
 * Everything above seeds the navigation entry, because when it was written
 * nothing shipped produced a reveal. The todos column does now — clicking an
 * item is the act the dogfood report was about — so these tests never touch
 * `localStorage`: they click a row in a plugin column and assert what the
 * reader does, which is the whole path, producer included.
 * ------------------------------------------------------------------------- */

interface ChoreItem {
  readonly text: string;
  readonly done: boolean;
  readonly due?: string;
}

/**
 * The list, once — the column's aggregate and the document's body are both
 * generated from it, exactly as production keeps them in step (the plugin's
 * `GET /lists` parses the same body the editor renders).
 *
 * Two identical open items with a **checked** one between them: the ambiguity
 * of sprint-023 OC4, framed by a line the column does not display and the
 * reader does.
 *
 * **The duplicated item is the one carrying a deadline**, deliberately (PR #19
 * review, MAJOR 1). A deadline renders as part of its own line, so it sits
 * between the quote and the line below it; a payload whose frame ignored that
 * could never match, and the reader's fallback quietly flashed the *first*
 * "Call the plumber" instead. Putting the marker on a non-duplicated item —
 * which is what this fixture used to do — is precisely the arrangement in which
 * producer and consumer never meet.
 */
const CHORE_ITEMS: readonly ChoreItem[] = [
  { text: "Call the plumber", done: false, due: "2026-08-09" },
  { text: "Book the passport appointment", done: false, due: "2026-08-01" },
  { text: "Send the signed form", done: true },
  { text: "Call the plumber", done: false, due: "2026-08-09" },
  { text: "Rinse the filters", done: false },
];

const TODOS_VIEW: StubRow = {
  id: "doc_view_todos",
  type: "view",
  title: "Todos",
  path: "data/docs/views/todos.md",
  pinned: true,
  order: 1,
  column: "todos/todos",
};

const CHORE_LIST: StubRow = {
  id: "doc_chores_list",
  type: "todo",
  title: "Chores",
  path: "data/docs/inbox/chores-list.md",
  body: [
    FILLER,
    "",
    ...CHORE_ITEMS.map(
      (item) =>
        `- [${item.done ? "x" : " "}] ${item.text}${item.due === undefined ? "" : ` (due: ${item.due})`}`,
    ),
    "",
  ].join("\n"),
};

/**
 * A board whose one column is the todos plugin column, with the plugin's own
 * aggregate answered.
 *
 * The aggregate is the *only* thing stubbed beyond `stubCorpus` — the column,
 * its rows, the payload it builds and the reader that honours it are all the
 * shipped code, in a real browser.
 */
async function openTodosBoard(page: Page): Promise<void> {
  await stubCorpus(page, [TODOS_VIEW, CHORE_LIST]);
  await page.route(EVENT_STREAM, (route) => route.abort("connectionrefused"));
  // Registered after `stubCorpus`, whose `**\/api\/**` handler would otherwise
  // swallow it: Playwright matches the most recently added route first.
  await page.route("**/api/x/todos/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [
          {
            docId: CHORE_LIST.id,
            title: CHORE_LIST.title,
            path: CHORE_LIST.path,
            status: "open",
            open: CHORE_ITEMS.filter((item) => !item.done).length,
            done: CHORE_ITEMS.filter((item) => item.done).length,
            items: CHORE_ITEMS,
          },
        ],
      }),
    }),
  );
  await page.goto("/");
  await page.locator(".todos-column .check").first().waitFor();
}

/** The column row for the item at `at` in the document's item list. */
function itemRow(page: Page, at: number): Locator {
  return page.locator(`.todos-column .check[data-todos-item="${String(at)}"]`);
}

/** The rendered lines of the open document, in body order. */
function renderedItems(page: Page): Locator {
  return page.locator(".reader .ProseMirror li");
}

/**
 * How far the flash box sits from the rendered line at `at`, **read in one
 * frame**.
 *
 * The single `evaluate` is the whole of it, and it is not a convenience. This
 * used to take two boundingBox round trips, and a cold open is still moving
 * between them: the reveal re-aims the reader through
 * `REVEAL_SETTLE_FRAMES`, so the scroller travels — measured at 52 px between
 * the two reads on one run and 584 px on another. Subtracting a `y` read before
 * that move from a `y` read after it reports a distance neither box was ever
 * at. It scored 23.06 px on a run where both rectangles, read together, were
 * 1.00 px apart.
 *
 * So the two rectangles are read in the same frame and the tolerance stays
 * where it was. What is asserted is unchanged — the flash is on its line — and
 * the measurement is now of one moment rather than of two.
 */
async function distanceToItem(page: Page, at: number): Promise<number> {
  const gap = await page.evaluate((index) => {
    const flash = document.querySelector(".reveal-flash");
    const line = document.querySelectorAll(".reader .ProseMirror li")[index];
    if (flash === null || line === undefined) return null;
    return Math.abs(flash.getBoundingClientRect().y - line.getBoundingClientRect().y);
  }, at);
  // `null` is the flash already gone or the line never rendered. Failing here
  // rather than answering a distance keeps a "further than 12 px" assertion
  // from passing because there was nothing to measure.
  expect(gap, "there was no flash and line to measure in the same frame").not.toBeNull();
  return gap ?? Number.MAX_SAFE_INTEGER;
}

test.describe("a click on a todo item", () => {
  test("opens its document scrolled to that line, and flashes the line", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 1).click();

    await expect(page.locator(`.reader[data-reader-doc="${CHORE_LIST.id}"]`)).toHaveCount(1);
    await expect(page.locator(".reveal-flash")).toHaveCount(1);
    expect(await distanceToItem(page, 1)).toBeLessThan(12);

    // The document is long, and the item was below the fold: the reader moved.
    const scrolled = await page
      .locator(".reader .reader-scroll")
      .evaluate((element) => element.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const box = await page.locator(".reveal-flash").boundingBox();
    const viewport = page.viewportSize();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? Number.MAX_SAFE_INTEGER).toBeLessThan(viewport?.height ?? 0);
  });

  /**
   * The drill's own case, pinned: a real click, measured on the frame the user
   * sees rather than the frame the box was drawn on.
   *
   * Every open from this column is a cold open — the column list is replaced by
   * the reader, so there is no "already rendered" click that would land on a
   * settled layout. The reveal therefore always fires one frame early, and the
   * flash has to follow the line to where it ends up.
   */
  test("holds the box on the clicked line once the document has settled", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 1).click();
    await expect(page.locator(".reveal-flash")).toHaveCount(1);

    const gap = await settledGap(page, 1);
    expect(gap).not.toBeNull();
    expect(gap ?? Number.MAX_SAFE_INTEGER).toBeLessThan(12);
  });

  /**
   * sprint-023 OC4, end to end, and the one place the producer's frame and the
   * reader's occurrence rule actually meet. Both rows read "Call the plumber";
   * the payload is what distinguishes them, and it has to survive two things
   * the column never shows — the **checked** item above the second one, and the
   * clicked item's **own deadline**, which the reader renders between the quote
   * and the line below it.
   */
  test("reveals the duplicate that was clicked, not the first line with the same words", async ({
    page,
  }) => {
    await openTodosBoard(page);
    await itemRow(page, 3).click();

    await expect(page.locator(".reveal-flash")).toHaveCount(1);
    expect(await distanceToItem(page, 3)).toBeLessThan(12);
    expect(await distanceToItem(page, 0)).toBeGreaterThan(12);
  });

  test("reveals the first of the duplicates when that is the one clicked", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 0).click();

    await expect(page.locator(".reveal-flash")).toHaveCount(1);
    expect(await distanceToItem(page, 0)).toBeLessThan(12);
    expect(await distanceToItem(page, 3)).toBeGreaterThan(12);
  });

  test("leaves the document alone: the flash is drawn over it and takes itself away", async ({
    page,
  }) => {
    await openTodosBoard(page);
    await itemRow(page, 1).click();

    await expect(page.locator("[data-reveal-flash]")).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 4000 });
    await expect(renderedItems(page)).toHaveCount(CHORE_ITEMS.length);
    await expect(page.locator(".reader .ProseMirror [class*='reveal']")).toHaveCount(0);
  });

  /**
   * The instruction is one-shot (UI-037), and a producer must not resurrect it:
   * the reveal rides `localStorage`, so a leak would re-flash this document on
   * every load of this board, forever.
   */
  test("spends the instruction — reopening the board flashes nothing", async ({ page }) => {
    await openTodosBoard(page);
    await itemRow(page, 1).click();
    await expect(page.locator(".reveal-flash")).toHaveCount(1);

    // Wait for the scroll capture's own footprint before reading the entry: it
    // is debounced, and the entry it writes is the one the reload will read.
    await expect
      .poll(async () => (await storedEntry(page, TODOS_VIEW.id))?.scrollY ?? 0)
      .toBeGreaterThan(0);
    expect((await storedEntry(page, TODOS_VIEW.id))?.reveal ?? null).toBeNull();

    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator(`.reader[data-reader-doc="${CHORE_LIST.id}"]`)).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 2000 });
  });

  test("opens the document at the top when the list heading is clicked instead", async ({
    page,
  }) => {
    await openTodosBoard(page);
    await page.locator(".todos-group-head").click();

    await expect(page.locator(`.reader[data-reader-doc="${CHORE_LIST.id}"]`)).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0);
    const scrolled = await page
      .locator(".reader .reader-scroll")
      .evaluate((element) => element.scrollTop);
    expect(scrolled).toBe(0);
    expect((await storedEntry(page, TODOS_VIEW.id))?.reveal ?? null).toBeNull();
  });

  /**
   * The full-screen host, from the same click.
   *
   * `useReaderSurface` is shared by the column reader and focus mode, and
   * UI-037 pins both halves; what a *plugin* can reach is the column reader,
   * because `Column.tsx` hands a plugin body `onOpen` and no focus seam. So the
   * claim asserted here is the one that is actually reachable and the one that
   * bites: expanding to full screen after a reveal shows the same document, and
   * the instruction — already spent in the column — does not fire a second time
   * in the other host.
   */
  test("carries into full screen as an open, with the instruction already spent", async ({
    page,
  }) => {
    await openTodosBoard(page);
    await itemRow(page, 1).click();
    await expect(page.locator(".reveal-flash")).toHaveCount(1);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 4000 });

    await page.locator(`.reader[data-reader-doc="${CHORE_LIST.id}"] [data-expand]`).click();
    const focus = page.locator(".focus.open");
    await expect(focus).toHaveCount(1);
    await expect(focus.locator(".ProseMirror li")).toHaveCount(CHORE_ITEMS.length);
    await expect(page.locator("[data-reveal-flash]")).toHaveCount(0, { timeout: 2000 });
  });
});
