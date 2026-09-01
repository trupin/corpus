import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-051 in a real browser: **comment on a selection inside a turn** (SPEC.md
 * §10's rider, signed 2026-08-03; §6's recursion).
 *
 * UI-051 shipped without this spec because the stub served no
 * `GET /api/threads/{id}` — a `ThreadCard` never rendered a turn here, so there
 * was nothing to select — and because its anchor resolution implemented rung 2
 * alone, which would have reported the framed duplicate this whole flow exists
 * to get right as `orphaned`. UI-056 fixed both, and this is the coverage that
 * was owed.
 *
 * The subject is deliberately a phrase that occurs **twice in one turn** — a
 * reply quoting the question, an agent restating an assumption — because that is
 * where a selector built from `exact` alone silently attaches a conversation to
 * words nobody pointed at (PR #19's MAJOR). Everything above the transport is
 * the real application: real react-markdown output, a real DOM selection, a real
 * right-click, the real CSS Custom Highlight API. The disk-and-git half is
 * UI-051's own real-app drill against a real `corpus` server.
 */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  order: 1,
  query: { type: "thread" },
};

const PHRASE = "revisit the rate assumption";

/** The turn's own text: two paragraphs, one phrase, twice. */
const TURN_BODY = `Let's ${PHRASE}.\n\nI said ${PHRASE} because 6.1% looks stale.`;

/** The thread **file**, in §6's turn format — what the anchors index into. */
const THREAD_BODY = `## user · 2026-08-03T17:01:12Z\n${TURN_BODY}\n`;

const TURN_TS = "2026-08-03T17:01:12Z";

const THREAD: StubRow = {
  id: "th_dup",
  type: "thread",
  title: "Rate assumption",
  path: "data/docs/threads/th_dup.md",
  body: THREAD_BODY,
};

/** The parent card's own turn bodies, excluding any nested child card's. */
const TURN_PROSE = `.reader [data-thread="th_dup"] > .turns > .turn[data-turn-ts="${TURN_TS}"] > .turn-body .turn-markdown p`;

async function openThread(page: Page, rows: readonly StubRow[]): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="th_dup"]').click();
  // Counted rather than `toBeVisible`: a card that already has child threads
  // renders their turns too, and this waits for *this* conversation's own.
  await expect(page.locator('.reader [data-thread="th_dup"] > .turns > .turn')).toHaveCount(1);
  return corpus;
}

/**
 * A real DOM selection over one occurrence of `phrase` inside `root`.
 *
 * `⌘A` is not usable on a rendered surface and `selectText()` takes a whole
 * element; the point here is a *part* of a paragraph, which is the range a drag
 * would leave.
 */
async function selectPhrase(page: Page, root: string, phrase: string): Promise<void> {
  await page.evaluate(
    ({ root: selector, phrase: needle }) => {
      const host = document.querySelector(selector);
      if (host === null) throw new Error(`no ${selector}`);
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node.textContent ?? "").indexOf(needle);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        const selection = globalThis.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`no “${needle}” in ${selector}`);
    },
    { root, phrase },
  );
}

/** Right-clicks in the middle of the live selection, as a person would. */
async function contextClickSelection(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const range = globalThis.getSelection()?.getRangeAt(0);
    if (range === undefined) throw new Error("nothing selected");
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
}

interface PaintedAnchor {
  readonly text: string;
  /** Index of the paragraph the highlight starts in, among the turn's own. */
  readonly paragraph: number;
}

/**
 * What the CSS Custom Highlight API is actually painting.
 *
 * The anchor highlight in a turn is not an element — `react-markdown` owns every
 * node in a rendered turn, so the paint is a registered `Range` rather than a
 * `<mark>` (`anchors/textHighlight.ts`). Reading the registry is therefore the
 * only way to assert it, and it is the same evidence UI-051's real-app drill
 * recorded.
 */
async function paintedAnchors(page: Page, scope: string): Promise<readonly PaintedAnchor[]> {
  return page.evaluate((selector) => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, Iterable<Range>> })
      .highlights;
    const painted = registry?.get("corpus-turn-anchor");
    if (painted === undefined) return [];
    const paragraphs = [...document.querySelectorAll(selector)];
    return [...painted].map((range) => ({
      text: range.toString(),
      paragraph: paragraphs.findIndex((paragraph) => paragraph.contains(range.startContainer)),
    }));
  }, scope);
}

test.describe("commenting on a selection inside a turn", () => {
  test("anchors to the occurrence that was selected, not the first one", async ({ page }) => {
    const corpus = await openThread(page, [THREADS_VIEW, THREAD]);

    // The second paragraph's copy of the phrase — the one a bare `exact` would
    // never find, because there are two of them.
    await selectPhrase(page, `${TURN_PROSE}:nth-of-type(2)`, PHRASE);
    await contextClickSelection(page);

    // SPEC.md §10's menu on a non-editable body: Comment first, clipboard after.
    const menu = page.getByRole("menu", { name: "Actions for the selection" });
    await expect(menu).toBeVisible();
    expect(
      await menu
        .getByRole("menuitem")
        .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset["act"])),
    ).toEqual(["comment", "copy"]);

    await menu.locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await expect(composer.locator(".cm-quote")).toContainText(PHRASE);
    await composer.getByLabel("Comment").fill("Is this still the assumption?");
    await composer.locator("[data-comment-send]").click();

    // On the wire: a child thread of the *thread*, with §6 framing that names
    // the second occurrence rather than the phrase alone.
    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      parent: string;
      body: string;
      selector: { exact: string; prefix: string; suffix: string };
    };
    expect(posted.parent).toBe("th_dup");
    expect(posted.selector.exact).toBe(PHRASE);
    expect(posted.selector.prefix.endsWith("I said ")).toBe(true);
    expect(posted.selector.suffix).toBe(" because 6.1% looks stale.");
    // The framing is what resolves it: the framed needle occurs once in the file
    // where the phrase alone occurs twice.
    expect(THREAD_BODY.indexOf(posted.selector.prefix + PHRASE + posted.selector.suffix)).not.toBe(
      -1,
    );

    // The highlight the **server's** resolution puts back — one range, over the
    // second paragraph's copy of the phrase.
    await expect
      .poll(async () => paintedAnchors(page, TURN_PROSE))
      .toEqual([{ text: PHRASE, paragraph: 1 }]);

    // …and the conversation itself, nested under the turn it is about, with its
    // first turn rendered — which is `GET /api/threads/{id}` doing its job.
    const child = page.locator(
      `.reader [data-thread="th_dup"] > .turns > .turn[data-turn-ts="${TURN_TS}"] .child-threads .thread-card`,
    );
    await expect(child).toHaveCount(1);
    await expect(child.locator(".turn-body")).toContainText("Is this still the assumption?");
  });

  test("keeps the composer's citation on the first occurrence when that is the one selected", async ({
    page,
  }) => {
    const corpus = await openThread(page, [THREADS_VIEW, THREAD]);

    await selectPhrase(page, `${TURN_PROSE}:nth-of-type(1)`, PHRASE);
    await contextClickSelection(page);
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    const composer = page.getByRole("dialog", { name: "New comment" });
    await composer.getByLabel("Comment").fill("Where did this come from?");
    await composer.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      selector: { exact: string; prefix: string; suffix: string };
    };
    // Same `exact`, different framing: the anchor follows the pointer, and the
    // paint lands in the first paragraph.
    expect(posted.selector.exact).toBe(PHRASE);
    expect(posted.selector.prefix).toBe("Let's ");
    await expect
      .poll(async () => paintedAnchors(page, TURN_PROSE))
      .toEqual([{ text: PHRASE, paragraph: 0 }]);
  });
});

/**
 * The same rules seen from the other side: anchors that were already on the
 * thread when the page loaded, resolved by the stub with the server's rungs 1–2
 * (`serverParity.ts`).
 *
 * This is the pair UI-056 exists for. A framed selector for the duplicated
 * phrase resolves and lands on the occurrence it names; the *same phrase with no
 * context* does not resolve at all, and §6 says the answer there is to orphan —
 * a visible orphan beats a silent misattachment. Both halves are asserted,
 * because a stub that resolved everything would be as wrong as one that resolved
 * nothing.
 */
const FRAMED_CHILD: StubRow = {
  id: "th_framed",
  type: "thread",
  title: "On the restatement",
  path: "data/docs/threads/th_framed.md",
  parent: "th_dup",
  body: "## user · 2026-08-03T17:05:00Z\nWhich number is stale?\n",
};

const ORPHANED_CHILD: StubRow = {
  id: "th_orphan",
  type: "thread",
  title: "On the phrase",
  path: "data/docs/threads/th_orphan.md",
  parent: "th_dup",
  body: "## user · 2026-08-03T17:06:00Z\nWhich one of the two?\n",
};

const SEEDED_THREAD: StubRow = {
  ...THREAD,
  anchors: [
    {
      anchorId: "anc_framed",
      threadId: "th_framed",
      exact: PHRASE,
      prefix: "I said ",
      suffix: " because 6.1% looks stale.",
    },
    // No context: the phrase occurs twice, so rung 2's uniqueness fails and
    // there is no rung the server would run on a read path that could choose.
    { anchorId: "anc_bare", threadId: "th_orphan", exact: PHRASE },
  ],
};

test.describe("a thread that arrives with anchors already on it", () => {
  test("paints the framed one and orphans the context-free duplicate", async ({ page }) => {
    await openThread(page, [THREADS_VIEW, SEEDED_THREAD, FRAMED_CHILD, ORPHANED_CHILD]);

    // Exactly one paint, on the framed anchor's occurrence.
    await expect
      .poll(async () => paintedAnchors(page, TURN_PROSE))
      .toEqual([{ text: PHRASE, paragraph: 1 }]);

    // The framed child hangs off the turn its anchor falls inside…
    const underTurn = page.locator(
      `.reader [data-thread="th_dup"] > .turns > .turn[data-turn-ts="${TURN_TS}"] .child-threads .thread-card`,
    );
    await expect(underTurn).toHaveCount(1);
    await expect(underTurn).toHaveAttribute("data-thread", "th_framed");

    // …and the orphaned one is listed under the conversation instead of being
    // guessed onto a turn or dropped.
    const unanchored = page.locator(
      '.reader [data-thread="th_dup"] > .child-threads .thread-card[data-thread="th_orphan"]',
    );
    await expect(unanchored).toHaveCount(1);
    // It is a real conversation down there, turns and all.
    await expect(unanchored.locator(".turn-body")).toContainText("Which one of the two?");
  });
});

/**
 * UI-087, in the browser the user reported it from: **once, not twice.**
 *
 * `DocView` keyed its below-body thread list off `anchorsHost`, which is false
 * for every thread, so a thread reader listed `reader.threads` in full under a
 * conversation that had already placed every one of them per turn (SPEC.md §10).
 * Both hosts, because the report named both and the duplicate sat above the
 * placement split — it was never a width behaviour.
 *
 * Counted rather than found: the defect is a *second* render, so a `toBeVisible`
 * on either conversation passed before the fix and after it.
 */
test.describe("a thread's children, counted", () => {
  const placements = (scope: string, threadId: string): string =>
    `${scope} [data-thread-panel="${threadId}"]`;

  test("renders each child once in a column and once in full screen", async ({ page }) => {
    await openThread(page, [THREADS_VIEW, SEEDED_THREAD, FRAMED_CHILD, ORPHANED_CHILD]);

    // Both children are on screen — the per-turn one and the orphaned one…
    await expect(page.locator(placements(".reader", "th_framed"))).toHaveCount(1);
    await expect(page.locator(placements(".reader", "th_orphan"))).toHaveCount(1);
    // …and there is no second listing of the set below the conversation. The
    // list itself is not gone (a `view` document still needs it); it is a
    // thread that no longer takes it.
    await expect(page.locator(".reader .thread-slots")).toHaveCount(0);

    // ⤢ — the same document view at the other measure.
    await page.locator(".reader [data-expand]").click();
    await expect(page.locator(".focus.open")).toBeVisible();
    await expect(page.locator('.focus.open [data-thread="th_dup"] > .turns > .turn')).toHaveCount(
      1,
    );
    await expect(page.locator(placements(".focus.open", "th_framed"))).toHaveCount(1);
    await expect(page.locator(placements(".focus.open", "th_orphan"))).toHaveCount(1);
    await expect(page.locator(".focus.open .thread-slots")).toHaveCount(0);
    // The orphaned child is still reachable full screen, and still a real
    // conversation rather than a line the fix left behind.
    await expect(
      page.locator(`${placements(".focus.open", "th_orphan")} .turn-body`),
    ).toContainText("Which one of the two?");
  });

  /**
   * The branch the fix had to keep. A `view` document's body is its stored query,
   * so it renders statically and hosts no anchor layer — nothing places its
   * threads, and this list is the only render they get. A fix that deleted the
   * catch-all with the duplicate would have dropped them silently.
   */
  test("still lists the threads on a document whose body places none", async ({ page }) => {
    await stubCorpus(page, [VIEWS_VIEW, TARGET_VIEW, ON_THE_VIEW]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator(`.col[data-col="${VIEWS_VIEW.id}"] .row[data-row-doc="doc_v"]`).click();
    await expect(page.locator('.reader[data-reader-doc="doc_v"]')).toBeVisible();

    await expect(page.locator(".reader .thread-slots")).toHaveCount(1);
    await expect(page.locator(placements(".reader", "th_on_view"))).toHaveCount(1);
  });
});

/** A column listing view documents, so one can be opened in a reader at all. */
const VIEWS_VIEW: StubRow = {
  id: "doc_view_views",
  type: "view",
  title: "Views",
  path: "data/docs/views/views.md",
  order: 2,
  query: { type: "view" },
};

const TARGET_VIEW: StubRow = {
  id: "doc_v",
  type: "view",
  title: "Saved search",
  path: "data/docs/views/saved.md",
  query: { type: "note" },
};

const ON_THE_VIEW: StubRow = {
  id: "th_on_view",
  type: "thread",
  title: "About this view",
  path: "data/docs/threads/th_on_view.md",
  parent: "doc_v",
  body: "## user · 2026-08-07T09:00:00Z\nShould this be pinned?\n",
};

/**
 * **UI-060 and UI-061 in a real browser**: the two ways a selection in a turn
 * used to come back as something other than what was pointed at.
 *
 * Both are asserted here rather than in jsdom alone because both are about what
 * the *renderer* draws. `sourceTrace.ts`'s parity is checked against
 * `MarkdownView`'s own output in `renderParity.test.tsx`, and this is the same
 * claim carried through a real Chromium selection, a real right-click, and the
 * real request that leaves the page.
 */

/** One `hen` on screen. Two, before UI-060, once the paragraph join closed up. */
const JOIN_BODY = "the\n\nnext hen";

const JOIN_THREAD: StubRow = {
  id: "th_join",
  type: "thread",
  title: "A paragraph join",
  path: "data/docs/threads/th_join.md",
  body: `## user · 2026-08-03T17:01:12Z\n${JOIN_BODY}\n`,
};

async function openThreadById(
  page: Page,
  rows: readonly StubRow[],
  id: string,
  turns = 1,
): Promise<StubCorpus> {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${id}"]`).click();
  await expect(page.locator(`.reader [data-thread="${id}"] > .turns > .turn`)).toHaveCount(turns);
  return corpus;
}

test.describe("a selection beside a paragraph join", () => {
  /**
   * The measured case (PR #20's review, closed by UI-060). `the⏎⏎next hen`
   * renders one `hen`; the trace used to close the join up and see two, so the
   * occurrence index shifted and the anchor came back over `he⏎⏎` — the words
   * either side of the break. PR #20 made that a refusal, so until now this
   * selection offered no Comment item at all.
   */
  test("anchors to the word selected, not to the break beside it", async ({ page }) => {
    const corpus = await openThreadById(page, [THREADS_VIEW, JOIN_THREAD], "th_join");
    const prose = '.reader [data-thread="th_join"] .turn-markdown p';
    // One `hen` in the rendered turn, whatever the trace used to think.
    expect(await page.locator(prose).allInnerTexts()).toEqual(["the", "next hen"]);

    await selectPhrase(page, `${prose}:nth-of-type(2)`, "hen");
    await contextClickSelection(page);

    // The item is offered at all, which it was not before UI-060.
    const menu = page.getByRole("menu", { name: "Actions for the selection" });
    await expect(menu.locator('[data-act="comment"]')).toBeVisible();
    await menu.locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await expect(composer.locator(".cm-quote")).toContainText("hen");
    await composer.getByLabel("Comment").fill("Which hen?");
    await composer.locator("[data-comment-send]").click();

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      selector: { exact: string; prefix: string; suffix: string };
    };
    // Three characters, and the file spells them where the reader saw them —
    // never `he\n\n`, which is what this used to produce before it was refused.
    expect(posted.selector.exact).toBe("hen");
    expect(posted.selector.exact).not.toContain("\n");
    expect(
      JOIN_THREAD.body?.indexOf(posted.selector.prefix + "hen" + posted.selector.suffix),
    ).not.toBe(-1);
  });
});
