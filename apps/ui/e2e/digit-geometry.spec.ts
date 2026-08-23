import type { IndexStatus } from "@corpus/contract";
import type { Locator, Page } from "@playwright/test";
// `test` comes from the coverage fixture, not from `@playwright/test`: it is the
// same runner plus the browser-side V8 collection the merged gate needs.
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-134 in a real browser: **a count reaching two digits moves nothing**
 * (SPEC.md §10's rider, signed 2026-08-20 — "Nothing resizes because of what it
 * holds", where "a count reaching two digits" is named by clause 1).
 *
 * ## What is measured, and why it is never the number itself
 *
 * Every test below records the box of the thing **beside** the count — the
 * truncating title, the document id, the server's sentence — because that is
 * where the harm lands. A count in proportional figures widens by roughly a
 * character at `9 → 10`, and in each of these rows the neighbour is the item
 * that yields, so the widening is taken out of text a person is reading.
 *
 * ## Two shapes of evidence
 *
 * Where a surface can show both values **at once** — two columns, two rows —
 * the assertion compares them in one frame. That is stronger than
 * a reload: it removes every question about what else settled between the two
 * measurements, and it is what a person actually sees, since a board holds a
 * one-digit count and a two-digit one side by side all day.
 *
 * Where only one instance exists, the value changes under a reload.
 *
 * One test drives a **real clock** instead (`page.clock`), because §8's pending
 * row is the site that moves with nobody touching anything: it re-reads
 * `Date.now()` every 15 s and re-renders a duration that nothing sent it.
 *
 * jsdom implements no layout, so none of this can be asserted in the unit suite;
 * `font-variant-numeric` in particular has no observable effect there at all.
 */

const VIEWPORT = { width: 1180, height: 760 };

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
 * A twentieth of a pixel of tolerance, and no more. A `ch`-sized reservation and
 * the text it was sized for land on different sixty-fourths — `new` measured
 * 42.953125px against a 42.96875px box — which is a rounding artefact and not a
 * thing anybody can see. Every defect this file is about is five pixels or
 * larger, so the tolerance cannot hide one.
 */
function expectSameWidth(actual: number, expected: number, because: string): void {
  expect(
    Math.abs(actual - expected),
    `${because} (${String(actual)} vs ${String(expected)})`,
  ).toBeLessThan(0.05);
}

/**
 * The element's box once it has stopped moving on its own.
 *
 * A thread card settles in stages — the composer's recipient line and the
 * resident badge each arrive on their own query — and a box measured on the
 * frame `.working` first appears is a box that is still about to change. It
 * measured 308.13px wide and settled at 456.16px, which is not a tick and would
 * have been read as one.
 *
 * Two consecutive agreeing measurements, which is the same discipline the tick
 * assertions themselves use: the question is always *did this move by itself*,
 * and a surface still loading is not an answer to it.
 */
async function settledBox(locator: Locator): Promise<Box> {
  let previous = await boxOf(locator);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await locator.page().waitForTimeout(150);
    const next = await boxOf(locator);
    if (
      next.x === previous.x &&
      next.y === previous.y &&
      next.width === previous.width &&
      next.height === previous.height
    ) {
      return next;
    }
    previous = next;
  }
  throw new Error("the element never stopped moving");
}

/** A title long enough that the head has no slack left for a count to eat. */
const LONG_TITLE = "Everything the household has to deal with before the end of the month";

function notes(prefix: string, folder: string, count: number): StubRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${String(index)}`,
    type: "note",
    title: `${prefix} note ${String(index)}`,
    path: `data/docs/${folder}/${prefix}-${String(index)}.md`,
    body: "Prose.",
  }));
}

test.describe("the board's column count", () => {
  /**
   * Two columns, identical but for how many documents their folder holds. Their
   * heads are the same width and their titles are the same string, so if the
   * count's box is stable the two `.col-title` boxes are the same width — and if
   * it is not, the nine-document column's title is a character wider than the
   * twelve-document one's.
   */
  test("does not re-cut the column title when it crosses into two digits", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await stubCorpus(page, [
      {
        id: "doc_view_nine",
        type: "view",
        title: LONG_TITLE,
        path: "data/docs/views/nine.md",
        order: 1,
        query: { folder: "nine" },
      },
      {
        id: "doc_view_twelve",
        type: "view",
        title: LONG_TITLE,
        path: "data/docs/views/twelve.md",
        order: 2,
        query: { folder: "twelve" },
      },
      ...notes("nine", "nine", 9),
      ...notes("twelve", "twelve", 12),
    ]);
    await page.goto("/");

    const nine = page.locator('.col[data-col="doc_view_nine"]');
    const twelve = page.locator('.col[data-col="doc_view_twelve"]');
    await expect(nine.locator(".col-count")).toHaveText("9");
    await expect(twelve.locator(".col-count")).toHaveText("12");

    const nineTitle = await boxOf(nine.locator(".col-title"));
    const twelveTitle = await boxOf(twelve.locator(".col-title"));
    const nineCount = await boxOf(nine.locator(".col-count"));
    const twelveCount = await boxOf(twelve.locator(".col-count"));

    expectSameWidth(twelveCount.width, nineCount.width, "the count's box grew with its digits");
    expectSameWidth(twelveTitle.width, nineTitle.width, "the title paid for the extra digit");
  });
});

test.describe("the kit row's unread pill", () => {
  /**
   * Three rows, one list: a thread row that reads `new`, a document row with 9
   * unread threads, and one with 12. `.row-badges` is `flex: none` and
   * `.row-title` is the truncating item, so the pill's width comes straight out
   * of the title beside it.
   *
   * The word/number swap is here on purpose. Tabular figures cannot touch it —
   * `new` and `9` are not the same width in any font — so this row is the one
   * that proves the reservation rather than the font feature.
   */
  test("holds one box for `new`, `9` and `12`", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await stubCorpus(page, [
      {
        id: "doc_view_unread",
        type: "view",
        title: "Unread",
        path: "data/docs/views/unread.md",
        order: 1,
        query: { folder: "unread" },
      },
      {
        id: "th_new",
        type: "thread",
        title: LONG_TITLE,
        path: "data/docs/unread/th-new.md",
        unread: true,
      },
      {
        id: "doc_nine",
        type: "note",
        title: LONG_TITLE,
        path: "data/docs/unread/nine.md",
        unreadThreads: 9,
      },
      {
        id: "doc_twelve",
        type: "note",
        title: LONG_TITLE,
        path: "data/docs/unread/twelve.md",
        unreadThreads: 12,
      },
    ]);
    await page.goto("/");

    const row = (id: string): Locator => page.locator(`.row[data-row-doc="${id}"]`);
    await expect(row("th_new").locator(".unread")).toHaveText("new");
    await expect(row("doc_nine").locator(".unread")).toHaveText("9");
    await expect(row("doc_twelve").locator(".unread")).toHaveText("12");

    const word = await boxOf(row("th_new").locator(".unread"));
    const nine = await boxOf(row("doc_nine").locator(".unread"));
    const twelve = await boxOf(row("doc_twelve").locator(".unread"));
    expectSameWidth(nine.width, word.width, "a one-digit pill is not the word's width");
    expectSameWidth(twelve.width, nine.width, "a two-digit pill is not a one-digit pill's width");

    /*
     * The titles are compared **between the two document rows only**. The `new`
     * row is a thread, and a thread row wears a six-letter `.type-glyph` where a
     * note wears four — measured at 12.4px, which has nothing to do with any
     * count. The word/number swap is already answered one assertion above, where
     * the three pills are shown to be one box.
     */
    const nineTitle = await boxOf(row("doc_nine").locator(".row-title"));
    const twelveTitle = await boxOf(row("doc_twelve").locator(".row-title"));
    expectSameWidth(twelveTitle.width, nineTitle.width, "the title paid for the extra digit");
  });
});

test.describe("the reader's thread count", () => {
  /**
   * The 💬 control is `flex: none` by UI-135's rule — a control never yields —
   * so a count crossing into two digits widens the control and the head pays out
   * of `.back` and `.reader-id`, the two runs of text it truncates.
   *
   * Two columns, so two readers are open in the same frame — the same shape of
   * evidence the board test uses. The two subjects' ids are deliberately the
   * same length: `.reader-id` renders the document id, so ids of unequal length
   * would make the two heads differ for a reason that has nothing to do with a
   * count (measured at 12.6px before they were evened up).
   *
   * **Everything else in the head is held equal too, and both halves of that
   * were learned the hard way.**
   *
   * The two columns carry the *same title*. They used to read `Notes 1` and
   * `Notes 2`, and `.back` renders that title: `1` and `2` are not the same
   * advance width in `-apple-system`, so the two `.back` boxes differed by
   * 0.56px intrinsically. `.back` is `flex: 0 4 auto` beside a `.reader-id`
   * that is `flex: 0 1 auto`, so a head with no slack redistributes that
   * difference — 0.25px of it landed on the id, and the id is the thing under
   * test. A confound the fixture introduced is still a confound.
   *
   * The heads are also measured **once they have stopped moving**. A column
   * used to run a 250ms `width` transition when a reader opened in it
   * (`board/Column.css`, until UI-146), and the second reader's head was being
   * read part-way up that ramp — 347px climbing to 398px, with the id and the
   * back label shrinking against it the whole way. That is what made this assertion's
   * failure move between runs (0.75px, 0.94px and 3.9px were all observed on
   * the same build): it was not measuring a count, it was measuring how far a
   * transition had got. Hence the head's own width is asserted equal below,
   * rather than assumed — the assumption is what hid this.
   */
  test("does not re-cut the document id when it crosses into two digits", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);

    /** Threads whose `parent` is the subject — what the 💬 count counts. */
    const threads = (subject: string, count: number): StubRow[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `th_${subject}_${String(index)}`,
        type: "thread",
        title: `Thread ${String(index)}`,
        path: `data/docs/${subject}/th-${String(index)}.md`,
        parent: `doc_${subject}`,
        body: `## user · 2026-08-19T10:0${String(index % 10)}:00Z\n\nA question.\n`,
      }));

    const column = (subject: string, order: number): StubRow[] => [
      {
        id: `doc_view_${subject}`,
        type: "view",
        // One title for both columns: `.back` renders it, and two titles that
        // differ by a digit are two different `.back` widths — see above.
        title: "Notes",
        path: `data/docs/views/${subject}.md`,
        order,
        query: { folder: subject },
        /*
         * The narrowest column the board allows (`MIN_COLUMN_WIDTH`). At the
         * default 336px the head still has slack, so 💬 growing eats the slack
         * and nothing is re-cut — the defect is real and simply not reachable
         * there. A person reading in a narrow column is exactly who meets it,
         * and it is the width at which the fix can be falsified.
         */
        extra: { width: 240 },
      },
      {
        id: `doc_${subject}`,
        type: "note",
        title: "The subject",
        path: `data/docs/${subject}/subject.md`,
        body: "Prose the threads are anchored in.",
      },
    ];

    await stubCorpus(page, [
      ...column("aaa", 1),
      ...threads("aaa", 9),
      ...column("bbb", 2),
      ...threads("bbb", 12),
    ]);
    await page.goto("/");

    // Two readers, one frame — the same reason the board test above uses two
    // columns: it removes every question about what else settled between two
    // measurements, and both heads are the same width by construction.
    const head = async (
      subject: string,
      count: string,
    ): Promise<{ head: Box; id: Box; button: Box }> => {
      // "Open here" — the head under test is the column's own, at the 240px
      // the column carries; a plain click now opens a 440px path column
      // instead (UI-149, rider 3).
      await page
        .locator(`.col[data-col="doc_view_${subject}"] .row[data-row-doc="doc_${subject}"]`)
        .click({ button: "right" });
      await page.locator('[role="menuitem"][data-act="open-here"]').click();
      const reader = page.locator(
        `.col[data-col="doc_view_${subject}"] .reader[data-reader-doc="doc_${subject}"] .reader-head`,
      );
      await expect(reader.locator(".comments-count")).toHaveText(count);
      // Every item in this head is sized against the column's width, and the
      // head has arrivals of its own after the reader mounts.
      return {
        head: await settledBox(reader),
        id: await boxOf(reader.locator(".reader-id")),
        button: await boxOf(reader.locator(".comments-btn")),
      };
    };

    const nine = await head("aaa", "9");
    const twelve = await head("bbb", "12");

    /*
     * The precondition, asserted rather than assumed: these two heads are the
     * same box, so the only thing left that could differ between them is the
     * count. Every failure this test has ever had was this line's — a head
     * still growing, or a head whose back label was a different string — and
     * without it the id's measurement has nothing to mean.
     */
    expectSameWidth(twelve.head.width, nine.head.width, "the two heads are not the same box");

    /*
     * **The control's own box is the assertion**, and the id's is the
     * consequence. A control that changes size when its number does is clause 1
     * exactly — and it is the sharper measurement: the button grew 6.6px
     * unfixed, while the id, which cuts at a character boundary, only ever shows
     * part of that (1.75px, measured).
     *
     * The id is held to the same twentieth of a pixel as everything else in
     * this file. It carried its own half-pixel allowance while the two heads
     * were quietly different sizes, and once they are the same size the two ids
     * measure identically — 88.734px against 88.734px — so there is nothing for
     * a wider tolerance to be for.
     */
    expectSameWidth(
      twelve.button.width,
      nine.button.width,
      "the 💬 control resized with its count",
    );
    expectSameWidth(twelve.id.width, nine.id.width, "the document id was re-cut");
  });
});

test.describe("the console's failed-chunk count", () => {
  const BASE: IndexStatus = {
    indexed: 273,
    pending: 12,
    failed: 9,
    identity: "ollama/nomic-embed-text@768",
    rebuilding: true,
    state: "indexing",
  };
  /**
   * Long enough that `.index-detail` fills the row and truncates. A shorter one
   * leaves slack, the count grows into the slack, and the sentence is untouched
   * — which is true and is not this issue: the assertion has to be made where
   * the sentence is the thing that pays.
   */
  const DETAIL =
    "re-embedding after the model identity changed — the search stays lexical " +
    "until this finishes, and every document already indexed under the previous " +
    "model is being read again from disk in the order the projection lists it";

  /**
   * `.index-failed` is `margin-left: auto` against `.index-detail`, which
   * truncates since UI-133. So every character the count gains is a character
   * cut off the server's sentence.
   */
  test("does not shorten the server's sentence as it climbs", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    let failed = 9;
    await stubCorpus(page, [
      {
        id: "doc_view_inbox",
        type: "view",
        title: "Inbox",
        path: "data/docs/views/inbox.md",
        order: 1,
        query: { folder: "inbox" },
      },
    ]);
    await page.route("**/api/index/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...BASE, failed, detail: DETAIL } satisfies IndexStatus),
      });
    });

    await page.goto("/");
    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    const detail = page.locator(".index-status .index-detail");
    await expect(page.locator(".index-failed")).toHaveText("9 failed");
    const few = await boxOf(detail);

    failed = 147;
    await page.reload();
    await page.locator(".console-body").waitFor();
    await expect(page.locator(".index-failed")).toHaveText("147 failed");
    const many = await boxOf(detail);

    expectSameWidth(
      many.width,
      few.width,
      "the sentence was re-cut to make room for two more digits",
    );
  });
});

test.describe("the pending row's clock", () => {
  /**
   * The one site that moves with **nobody touching anything** (SPEC.md §8).
   * `useNowTick` re-reads `Date.now()` every 15 s and the row re-renders a
   * duration nothing sent it, so this test installs a real clock and advances it
   * rather than seeding two fixtures — the tick is the thing under test.
   */
  const START = new Date("2026-08-20T12:00:00Z");
  const MINUTE = 60_000;

  /**
   * Opens the thread with an **unfinished queue event** against it.
   *
   * The pending row is driven by the queue, never by who spoke last
   * (`outstandingAgentRequest.ts`), so the job is what makes it render at all.
   * The clock is installed before the first navigation so that `Date.now()` is
   * `START` from the page's first line onwards.
   */
  async function openThread(page: Page, sinceMs: number): Promise<void> {
    const since = new Date(START.getTime() - sinceMs).toISOString();
    await page.clock.install({ time: START });
    await stubCorpus(
      page,
      [
        {
          id: "doc_view_threads",
          type: "view",
          title: "Conversations",
          path: "data/docs/views/threads.md",
          order: 1,
          query: { type: "thread" },
        },
        {
          id: "th_pending",
          type: "thread",
          title: "Q3 planning",
          path: "data/docs/threads/th_pending.md",
          body: `## user · ${since}\n\n@agent where did the forecast land?\n`,
        },
      ],
      {
        jobs: [
          {
            eventId: "evt_pending",
            type: "comment.created",
            status: "in-progress",
            started: since,
            originId: "th_pending",
          },
        ],
      },
    );
    await page.goto("/");
    await page.locator('.row[data-row-doc="th_pending"]').click();
    await page.locator(".thread-card .working").waitFor();
  }

  test("ticks 18m → 19m without moving its own dot or the row's height", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await openThread(page, 18 * MINUTE + 30_000);

    const row = page.locator(".thread-card .working");
    const dot = row.locator(".working-dot, .queued-dot");
    await expect(row).toContainText("18m");
    const before = { row: await settledBox(row), dot: await boxOf(dot) };

    await page.clock.fastForward("00:40");
    await expect(row).toContainText("19m");
    const after = { row: await boxOf(row), dot: await boxOf(dot) };

    expect(after.dot, "the dot moved on a tick nobody asked for").toEqual(before.dot);
    expect(after.row.height, "the row changed height on a tick").toBe(before.row.height);
    expectSameWidth(after.row.width, before.row.width, "the row changed width on a tick");
  });

  /**
   * The unit crossing, recorded rather than fixed. `59m → 1h 00m` is three more
   * characters and no digit setting closes it (`elapsed.test.ts` pins the
   * shapes). It is safe here because the duration ends a sentence that ends the
   * row: the row's own box is decided by the thread column, not by the sentence.
   */
  test("crosses 59m → 1h 00m without resizing the row it sits in", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await openThread(page, 59 * MINUTE + 30_000);

    const row = page.locator(".thread-card .working");
    await expect(row).toContainText("59m");
    const before = await settledBox(row);

    await page.clock.fastForward("00:40");
    await expect(row).toContainText("1h 00m");
    const after = await boxOf(row);

    expect(after, "the pending row resized on a unit crossing").toEqual(before);
  });
});
