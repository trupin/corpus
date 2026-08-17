import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * The anchor layer's **behaviour**, in a real browser — the half
 * `anchors.spec.ts` declines to assert because it is a stylesheet suite.
 *
 * UI-027 is why this file exists. Every anchor assertion the suite had was
 * either a computed style over hand-written markup or, in `todos.spec.ts`, a
 * highlight the page had just *created*. Nothing anywhere loaded a document
 * that already had an anchor on it, and that is the state that shipped broken:
 * `offsetsComparable` rejected any body whose final newline the serializer
 * would have added, so a document created without one — which is most of them —
 * showed no highlight, no pip, no chip and no aligned margin card, forever.
 * These tests open documents that arrive with anchors already resolved, and the
 * first one's body deliberately ends without a newline.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real TanStack cache, real ProseMirror, real decorations, real clicks. The
 * disk-and-git half stays in the issue's real-app log, as sprint-016
 * Adjudication 19 requires.
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

/** A second column, so there is somewhere else for a pointer to be resting. */
const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  pinned: true,
  order: 2,
  query: { type: "thread" },
};

/** The regression's shape: a body the serializer would add a final newline to. */
const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve.",
  anchors: [
    {
      anchorId: "anc_1",
      threadId: "th_1",
      exact: "lender spreads",
      prefix: "Short memo about ",
      suffix: " and the shape",
    },
  ],
};

/**
 * A thread **file**, in SPEC.md §6's turn format — `## <author> · <ts>` headings
 * — rather than the bare sentence this used to seed. The stub reports a thread's
 * turns by parsing its body (UI-056), so the format is what makes this a
 * one-turn conversation: the pip beside the anchor counts turns, and a body with
 * no headings is a thread with no turns, here and on the real server alike.
 */
const THREAD: StubRow = {
  id: "th_1",
  type: "thread",
  title: 'Re: "lender spreads"',
  path: "data/docs/threads/th_1.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhich lenders?\n",
  parent: "doc_note",
};

/**
 * Two animation frames: long enough for the browser's own post-layout hover
 * recomputation to be dispatched and for React to have rendered whatever it
 * caused. Asserting before it is asserting about a state the page is in the
 * middle of leaving.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/**
 * Resolves once `target`'s box has read the same for three consecutive frames.
 *
 * `.col` transitions `width` over 250 ms, so a column keeps sliding for a
 * quarter of a second after its neighbour's reader closes. A box measured
 * during that names a place the column has already left, and a pointer aimed
 * there lands on the board's background — `expect`'s retries cannot help,
 * because nothing is coming back under the cursor. Three identical frames is
 * the browser's own answer to "has it stopped", with no invented duration in
 * it: two would accept a transition that happens to hold still for one frame.
 */
async function stopped(target: Locator): Promise<void> {
  await target.evaluate(
    async (element) =>
      new Promise<void>((resolve) => {
        let previous = "";
        let repeats = 0;
        const tick = (): void => {
          const box = element.getBoundingClientRect();
          const current = `${String(box.x)},${String(box.y)},${String(box.width)},${String(box.height)}`;
          repeats = current === previous ? repeats + 1 : 0;
          previous = current;
          if (repeats >= 2) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function openNote(page: Page, rows: readonly StubRow[]): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
}

test.describe("a document that arrives with an anchor already on it", () => {
  test("paints the highlight over the anchored words on a fresh load", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);

    const highlight = page.locator(".reader .anchor-hl");
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("lender spreads");
    await expect(highlight).toHaveAttribute("data-thread", "th_1");
    await expect(highlight).toHaveAttribute("data-anchor", "anc_1");
    // Drawn over the editable body, not beside it.
    await expect(page.locator(".reader .doc-body .anchor-hl")).toHaveCount(1);
    // …and it is the shipped treatment, not a bare span.
    await expect(highlight).toHaveCSS("border-bottom-width", "2px");
    await expect(page.locator(".reader .anchor-pip")).toHaveText("1");
  });

  test("keeps the highlight across a reload", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await expect(page.locator(".reader .anchor-hl")).toHaveCount(1);

    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expect(page.locator(".reader .anchor-hl")).toHaveText("lender spreads");
  });

  /**
   * The highlight is the way back to a conversation that has been folded — which
   * is what "collapsed is never hidden … its anchored highlight stays in the
   * body" buys (SPEC.md §11, UI-077). So the thread is folded by hand first, and
   * the click is what brings it back.
   */
  test("opens the thread when the highlight is clicked (SPEC.md §11)", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    const slot = page.locator('.thread-slot[data-slot-thread="th_1"]');
    await expect(slot).toHaveClass(/expanded/);

    await slot.locator(".t-collapse").click();
    await expect(slot).toHaveClass(/collapsed/);

    await page.locator(".reader .anchor-hl").click();

    await expect(slot).toHaveClass(/expanded/);
    // It is the anchored thread that opened, and it says which words it is about.
    await expect(slot).toContainText("lender spreads");
  });

  test("keeps the conversation at its anchor while the column is narrow", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);

    await expect(page.locator('.reader .anchor-slot [data-thread-panel="th_1"]')).toHaveCount(1);
    // A narrow column is chip mode: no margin gutter, no margin cards.
    await expect(page.locator(".reader .with-margin")).toHaveCount(0);
    await expect(page.locator(".focus-margin")).toHaveCount(0);
  });

  test("moves the card into the margin, aligned to its anchor, in focus mode", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, THREAD]);
    await page.locator(".reader .anchor-hl").waitFor();

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    const focus = page.locator(".focus.open");
    await expect(focus).toHaveCount(1);
    await expect(focus.locator(".with-margin")).toHaveCount(1);

    const card = focus.locator('.focus-margin > [data-thread-panel="th_1"]');
    await expect(card).toHaveCount(1);
    // The cascade positions absolutely; until it runs every card sits at 0.
    const offsets = await focus.evaluate((root) => {
      const main = root.querySelector(".doc-main");
      const origin = main?.getBoundingClientRect().top ?? 0;
      const anchor = main?.querySelector('.anchor-hl[data-thread="th_1"]') ?? null;
      const placed = root.querySelector('.focus-margin > [data-thread-panel="th_1"]');
      return {
        anchorTop: anchor === null ? null : Math.round(anchor.getBoundingClientRect().top - origin),
        cardTop: placed === null ? null : Math.round(placed.getBoundingClientRect().top - origin),
      };
    });
    expect(offsets.anchorTop).not.toBeNull();
    expect(offsets.cardTop).toBe(offsets.anchorTop);
    // The margin replaces the body's own placement rather than doubling it.
    await expect(focus.locator(".doc-main .anchor-slot [data-thread-panel]")).toHaveCount(0);
  });
});

/**
 * UI-031, in the one file that enters focus mode against the real app.
 *
 * The UI-022 evaluation left the pointer resting over a neighbouring column,
 * followed a ref in full screen, and pressed `esc` seven times to no effect at
 * all — it survived a reload and came back only when the mouse was wiggled.
 * Closing the overlay let the column under the parked cursor adopt the board on
 * a `mouseover` nobody caused, and `Reader`'s escape layer is live only on the
 * active column.
 *
 * Only a browser can testify to this: the `mouseover` on unmount is the
 * browser's, not the app's, and so is the absence of a `mousemove` beside it.
 */
test.describe("closing full screen with the pointer parked over another column", () => {
  test("keeps the origin column active, and esc keeps working", async ({ page }) => {
    await openNote(page, [VIEW, THREADS_VIEW, NOTE, THREAD]);
    const origin = page.locator('.col[data-col="doc_view_inbox"]');
    const neighbour = page.locator('.col[data-col="doc_view_threads"]');
    await expect(neighbour).toHaveCount(1);
    await expect(origin).toHaveClass(/kactive/);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);

    // Park the pointer over the neighbouring column's area and leave it there:
    // nothing below moves the mouse again.
    const box = await neighbour.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );

    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);

    /*
     * Chromium recomputes hover when the element under a stationary cursor
     * changes and emits a single `mouseover` on the neighbour with **no**
     * `mousemove` beside it — verified by recording every mouse event across
     * this close. That event is the bug, and it lands a frame after the
     * unmount, so the assertions below have to be made after it: an immediate
     * `toHaveClass` would pass on the state the adoption is about to replace.
     */
    await settle(page);

    // The overlay unmounted under the cursor, and the board did not change hands.
    await expect(origin).toHaveClass(/kactive/);
    await expect(neighbour).not.toHaveClass(/kactive/);

    // Which is the point: `esc` still has the reader beneath to act on.
    await expect(page.locator(".reader")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".reader")).toHaveCount(0);

    /*
     * And an actual movement resumes hover-follows-active. Two things make that
     * a statement about the app rather than about the harness's luck:
     *
     * The column is measured only once it has stopped moving. Closing the reader
     * narrows its column, and `.col` eases `width` for 250 ms, so the neighbour
     * is still travelling when `esc` returns.
     *
     * And the pointer travels in more than one event, as a pointer does.
     * Chromium dispatches a movement's boundary events before its `mousemove`,
     * while `useActiveColumn` activates on `mouseover` and releases the
     * keyboard's latch on `mousemove` — so the opening move of any gesture has
     * its activation dropped by the latch that same move then releases, and the
     * column adopts the board on the next crossing. A lone `mouse.move` offers
     * no next crossing: it used to pass only when the running transition
     * happened to slide a different element under the resting cursor in time,
     * and failed roughly one run in four when it did not. Here the first move
     * releases the latch over the header and the second crosses into the list,
     * which is one small gesture of a hand and two events to the browser.
     */
    await stopped(neighbour);
    const moved = await neighbour.boundingBox();
    const lane = (moved?.x ?? 0) + (moved?.width ?? 0) / 2;
    await page.mouse.move(lane, (moved?.y ?? 0) + 60);
    await settle(page);
    await page.mouse.move(lane, (moved?.y ?? 0) + 120);
    await expect(neighbour).toHaveClass(/kactive/);
  });
});

test.describe("an anchor whose quote has left the body", () => {
  const ORPHANED: StubRow = {
    ...NOTE,
    body: "Short memo about pricing and the shape of the yield curve.",
  };

  test("renders as a detached thread and leaves no phantom highlight (SPEC.md §6)", async ({
    page,
  }) => {
    await openNote(page, [VIEW, ORPHANED, THREAD]);

    await expect(page.locator('[data-thread-section="detached"]')).toHaveCount(1);
    await expect(page.locator(".reader .anchor-hl")).toHaveCount(0);
    await expect(page.locator(".reader .anchor-pip")).toHaveCount(0);
    // Still fully usable: the conversation is listed and fully repliable.
    await expect(
      page.locator('[data-thread-section="detached"] [data-thread-panel="th_1"]'),
    ).toHaveCount(1);
  });
});

/**
 * UI-062, in the browser.
 *
 * Reported live: commenting on a selection that began inside `**bold**` left a
 * thread card pinned to the **top** of the document instead of beside the words.
 * The quote on the card carried the closing asterisks — which is correct, the
 * selector quotes the file and not the screen — but the file itself was one the
 * editor prints differently: it kept the blank line every editor leaves after
 * the frontmatter fence, so every offset in it was one past where the editor's
 * own text puts it. The anchor resolved, no highlight could be drawn from its
 * offsets, and a margin card with no highlight to measure fell to zero.
 *
 * Both halves are asserted here because only a browser has the layout the
 * second one is about: a card's `top` is written by the cascade after measuring
 * a live `getBoundingClientRect`.
 */
test.describe("a comment whose selection began inside inline markup", () => {
  /** The file as it sits on disk: a leading blank line, and a bold run. */
  const STANDUP: StubRow = {
    id: "doc_note",
    title: "Standup",
    body: "\n# Standup\n\n**Moushmi Verma** on repositioning Fernando under Mesbah, from Monday.\n\nA closing paragraph, so the document is taller than one line.\n",
    anchors: [
      {
        anchorId: "anc_1",
        threadId: "th_1",
        exact: "Moushmi Verma** on repositioning Fernando under Mesbah",
        prefix: "# Standup\n\n**",
        suffix: ", from Monday.",
      },
    ],
  };

  const STANDUP_THREAD: StubRow = {
    ...THREAD,
    title: 'Re: "Moushmi Verma** on repositioning Fernando under Mesbah"',
  };

  test("highlights the selected words, and none of the markup", async ({ page }) => {
    await openNote(page, [VIEW, STANDUP, STANDUP_THREAD]);

    const highlights = page.locator(".reader .doc-body .anchor-hl");
    // Two spans, because the `**` between them has no position to be inside of.
    await expect(highlights).toHaveCount(2);
    await expect(highlights.first()).toHaveText("Moushmi Verma");
    await expect(highlights.nth(1)).toHaveText(" on repositioning Fernando under Mesbah");
    /*
     * No composer is opened here — the document arrives with its anchor already
     * resolved — so there is only ever the server's generation of `.anchor-hl`
     * and no empty window to fall into. But the read is still the non-waiting
     * `$$eval` form (see UI-117's note below), and it backs a *negative* claim,
     * which an empty array would satisfy while proving nothing. So it is
     * asserted positively as well, over `textContent`: if it ever reads
     * nothing, it fails rather than passes.
     */
    const drawn = (await highlights.allTextContents()).join("");
    expect(drawn).toBe("Moushmi Verma on repositioning Fernando under Mesbah");
    expect(drawn).not.toContain("*");
    await expect(page.locator(".reader .anchor-pip")).toHaveCount(1);
    // Nothing was demoted to the list below the body.
    await expect(page.locator("[data-thread-section]")).toHaveCount(0);
  });

  test("puts the card beside its anchor, not at the top of the document", async ({ page }) => {
    await openNote(page, [VIEW, STANDUP, STANDUP_THREAD]);
    await page.locator(".reader .anchor-hl").first().waitFor();

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    const focus = page.locator(".focus.open");
    await expect(focus.locator(".with-margin")).toHaveCount(1);

    const offsets = await focus.evaluate((root) => {
      const main = root.querySelector(".doc-main");
      const origin = main?.getBoundingClientRect().top ?? 0;
      const anchor = main?.querySelector('.anchor-hl[data-thread="th_1"]') ?? null;
      const card = root.querySelector('.focus-margin > [data-thread-panel="th_1"]');
      return {
        anchorTop: anchor === null ? null : Math.round(anchor.getBoundingClientRect().top - origin),
        cardTop: card === null ? null : Math.round(card.getBoundingClientRect().top - origin),
      };
    });
    expect(offsets.anchorTop).not.toBeNull();
    // The failure this pins: a card at 0 while its anchor is well down the page.
    expect(offsets.anchorTop).toBeGreaterThan(0);
    expect(offsets.cardTop).toBe(offsets.anchorTop);
  });
});

/**
 * UI-068, in the browser: what a **new** comment quotes.
 *
 * UI-062's half of this was placement — an anchor that already existed, drawn
 * against a file the editor prints differently. This is capture, and it fails
 * one step earlier and one step worse. The quote used to be sliced out of the
 * editor's *printing*, so on the file below — the reported one, a padded table
 * under the blank line every editor leaves after the frontmatter fence — the
 * selector carried `prefix: "rm |\n| Mesbah   | infra    |\n\n**"`, cells that
 * exist nowhere on disk. §6's ladder matches literally, so rung 1 had nothing to
 * find, and a quote that itself straddled the padding had nothing to find at
 * *any* rung: the conversation was orphaned before anyone read it.
 *
 * The stub resolves anchors by the server's own rungs (`serverParity.ts`), so
 * both halves are observable here: what went on the wire, and whether the thread
 * came back attached to the words.
 */
test.describe("a comment captured on a file the editor prints differently", () => {
  /** The file as it sits on disk: single-spaced cells, and a leading blank line. */
  const FILE =
    "\n# Standup\n\n| who | area |\n| --- | ---- |\n| Fernando | platform |\n" +
    "| Mesbah | infra |\n\n**Moushmi Verma** wrote it up on Monday.\n";

  const STANDUP: StubRow = { id: "doc_note", title: "Standup", body: FILE };

  /** What the printer would write for that file — padded, and one byte shorter. */
  const PADDED = "| Mesbah   | infra    |";

  async function commentOnTheParagraph(page: Page): Promise<void> {
    // A direct child: the table's own cells are paragraphs too.
    const paragraph = page.locator(".reader .doc-body[contenteditable] > p").first();
    await expect(paragraph).toHaveText("Moushmi Verma wrote it up on Monday.");
    await paragraph.selectText();
    await paragraph.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();
    const composer = page.getByRole("dialog", { name: "New comment" });
    await composer.getByLabel("Comment").fill("Who is Mesbah?");
    await composer.locator("[data-comment-send]").click();
  }

  test("puts a quote and a context the file literally contains on the wire", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, STANDUP]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    await commentOnTheParagraph(page);

    await expect.poll(async () => (await corpus.of("POST", "/api/threads")).length).toBe(1);
    const posted = (await corpus.of("POST", "/api/threads"))[0]?.body as {
      readonly selector: {
        readonly exact: string;
        readonly prefix: string;
        readonly suffix: string;
      };
    };
    const { exact, prefix, suffix } = posted.selector;
    // The quote is markdown, asterisks and all — that rule is unchanged. The
    // opening `**` is outside it because a selection starts at a *position*, and
    // the first position in the paragraph is inside the bold run.
    expect(exact).toBe("Moushmi Verma** wrote it up on Monday.");
    // And the whole selector is a slice of the file, which is what rung 1 needs.
    expect(FILE).toContain(prefix + exact + suffix);
    // The failure: the printer's padded row, quoted as though it were on disk.
    expect(prefix).not.toContain(PADDED);
    expect(prefix).toContain("| Mesbah | infra |");
  });

  test("leaves the thread anchored to the words, not orphaned at birth", async ({ page }) => {
    await stubCorpus(page, [VIEW, STANDUP]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    await commentOnTheParagraph(page);

    /*
     * The stub stores the anchor and resolves it on the next read, by §6's
     * rungs — so a highlight here is the server's answer, not the optimistic
     * decoration, which the refetch clears. `[data-thread]` is what *makes* it
     * the server's answer rather than merely asserting it in prose: the
     * composer paints its own `.anchor-hl` over the same words from the moment
     * it opens, carrying `data-provisional` and no thread id
     * (`anchorDecorations.ts`), and it splits on the same `**` into the same
     * two spans.
     *
     * That scoping is also what removes a race, and the mechanism is worth
     * spelling out, because this line used to fail on it (UI-117):
     *
     * `.anchor-hl` has **two generations** across a send, and the count is 2 in
     * both. `useAnchorLayer`'s `post` forgets the provisional range in the
     * mutation's `onSuccess`; the server's anchors land only once the
     * invalidated document read resolves and `applyAnchors` runs. Sampling the
     * selector every frame through this flow, with the refetch slowed, gives
     * `0 → 2 (provisional) → 0 → 2 (server)`.
     *
     * So `toHaveCount(2)` on the *unscoped* selector could be satisfied by the
     * provisional pair and return — a count assertion says two nodes matched at
     * some instant, and nothing about which generation they belonged to or
     * whether they are still there. A read taken after it could then land in
     * the empty window. `allInnerTexts()` and `allTextContents()` are both
     * `$$eval`: one atomic page evaluation with **no waiting at all**, and `[]`
     * when nothing matches — and `[].join("")` is `""`, which is exactly the
     * value a loaded full-suite run failed with here.
     *
     * `innerText` is the more fragile of the two reads on principle — it is
     * defined over *rendered* text, so it answers for layout and computed
     * visibility, where `textContent` is a pure tree read — but that is not
     * what broke this line, and swapping the read alone would not have fixed
     * it. What fixes it is **waiting**: for the generation that is final, and
     * then for the text, rather than reading either once.
     */
    const highlight = page.locator(".reader .doc-body .anchor-hl[data-thread]");
    // Two spans, because the `**` the quote crosses has no position to be
    // inside of — the same shape UI-062's fixture draws.
    await expect(highlight).toHaveCount(2);
    await expect
      .poll(async () => (await highlight.allTextContents()).join(""))
      .toBe("Moushmi Verma wrote it up on Monday.");
    await expect(page.locator('[data-thread-section="detached"]')).toHaveCount(0);
  });
});

/**
 * **§15 M4's milestone check, asserted rather than assumed** (UI-099): "select
 * text → comment ('note only') → **highlight + chip appear without reload**".
 *
 * The suite had every half of this except the one that shipped broken. UI-068's
 * pair above proves what a *new* comment puts on the wire and that it comes back
 * attached — on a file whose respelling is confined to a table. Neither asserts
 * the **chip**, and neither uses a body where the two printings of the document
 * disagree about *structure*, which is the case the reporter hit.
 *
 * The body below is that case, reduced: a further paragraph of an outer list
 * item, after a nested sublist. Printing it once drops the blank line before that
 * paragraph; printing it again reads it as a continuation of the **nested** item
 * and indents it to match. Two consequences, and this test would have caught
 * both — the placement refused the whole document over that one newline, and the
 * layer traced a text the editor was not showing, so `applyAnchors` declined
 * forever. The comment is on the **first bullet**, well above the construct that
 * disagrees, which is what makes "no highlight anywhere" the observable failure.
 */
test.describe("commenting on a selection, on a file the printer restructures", () => {
  const NESTED: StubRow = {
    id: "doc_nested",
    title: "Nested notes",
    body:
      "- Outer bullet leads in.\n" +
      "  - Nested bullet one.\n" +
      "  - Nested bullet two.\n" +
      "\n" +
      "  A trailing paragraph of the outer item.\n" +
      "- Second outer bullet.\n",
  };

  test("shows the highlight and the chip at the anchor, without a reload", async ({ page }) => {
    await stubCorpus(page, [VIEW, NESTED]);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_nested"]').click();
    await page.locator(".reader .ProseMirror").waitFor();

    // The outer item's own paragraph — before the construct the printer moves.
    const bullet = page
      .locator(".reader .doc-body[contenteditable] li p", { hasText: "Outer bullet leads in" })
      .first();
    await expect(bullet).toHaveText("Outer bullet leads in.");
    await bullet.selectText();
    await bullet.click({ button: "right" });
    await page.getByRole("menu").locator('[data-act="comment"]').click();

    const composer = page.getByRole("dialog", { name: "New comment" });
    await composer.getByLabel("Comment").fill("Is this still true?");
    // "note only": §15 M4 names the note case, and an explicit `false` is what
    // keeps a note from being enqueued as a job.
    await composer.getByRole("button", { name: /note only|ask agent/i }).click();
    await composer.locator("[data-comment-send]").click();

    // No `page.reload()` anywhere below: "without reload" is the assertion.
    const highlight = page.locator(".reader .doc-body .anchor-hl");
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText("Outer bullet leads in.");

    /*
     * And the conversation is drawn at it, not listed below the body as one the
     * view could not place.
     *
     * **These three carry the test; do not trim them as redundant** (PR #39
     * review, MINOR 6). §15 M4's "highlight" half is satisfiable with no
     * server-derived placement at all: `useAnchorLayer` paints an *optimistic*
     * `.anchor-hl` from the range the composer was opened on, and it survives
     * until the server's own anchor replaces it. Reverting `rebaseRange`'s
     * per-passage equality — the fix that lets the server's range be placed at
     * all — leaves the highlight assertion above **green** and fails here, on
     * the chip. So the highlight says the comment was captured; the chip and the
     * empty `unplaced` section are what say the anchor came back and was placed.
     *
     * (Reverting the *other* fix, the layer's trace, does take the highlight
     * down — the optimistic decoration goes through the same `applyAnchors` gate
     * and that gate declines when the trace and the editor's document disagree.)
     */
    await expect(page.locator(".reader .anchor-slot [data-thread-panel]")).toHaveCount(1);
    await expect(page.locator(".reader .anchor-pip")).toHaveText("1");
    await expect(page.locator('[data-thread-section="unplaced"]')).toHaveCount(0);
  });
});
