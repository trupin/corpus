import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-077 in a real browser: one collapse behaviour, the same in every placement.
 *
 * **Why this file exists as a browser suite and not only as component tests.**
 * The defect the rider names is a *width* defect — "whether a conversation can
 * be folded away depends on how wide the window happens to be" — and which
 * placement a thread gets is decided by measuring a live element against
 * `MARGIN_MIN_WIDTH`. jsdom reports every element as zero-width, so a jsdom
 * suite can only ever exercise the narrow half. The viewport is the apparatus
 * here, not scenery.
 *
 * The other three things only a browser can testify to: that a fold survives a
 * **reload** (`localStorage`, which the jsdom runner shadows with an inert
 * global), that a conversation nested six deep expands **where it stands**
 * rather than navigating, and that two columns showing the same document keep
 * their own answer.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real TanStack cache, real ProseMirror, real clicks, real storage.
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

/** A second column over the same folder, for the per-reader assertion. */
const SECOND_VIEW: StubRow = {
  id: "doc_view_two",
  type: "view",
  title: "Also inbox",
  path: "data/docs/views/two.md",
  pinned: true,
  order: 2,
  query: { folder: "inbox" },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  body: "Short memo about lender spreads and the shape of the yield curve today.",
  anchors: [
    { anchorId: "anc_open", threadId: "th_open", exact: "lender spreads" },
    {
      anchorId: "anc_done",
      threadId: "th_done",
      exact: "yield curve",
      threadStatus: "resolved",
    },
  ],
};

const OPEN_THREAD: StubRow = {
  id: "th_open",
  type: "thread",
  title: "Which lenders?",
  path: "data/docs/threads/th_open.md",
  body: "## user · 2026-07-01T09:00:00Z\nWhich lenders?\n\n## agent · 2026-07-01T09:05:00Z\nThree of them.\n",
  parent: "doc_note",
};

const RESOLVED_THREAD: StubRow = {
  id: "th_done",
  type: "thread",
  title: "Settled",
  path: "data/docs/threads/th_done.md",
  body: "## user · 2026-07-01T09:00:00Z\nSettled?\n\n## agent · 2026-07-01T09:01:00Z\nSettled.\n",
  parent: "doc_note",
  status: "resolved",
};

const BASE = [VIEW, NOTE, OPEN_THREAD, RESOLVED_THREAD] as const;

async function openNote(page: Page, rows: readonly StubRow[] = BASE): Promise<void> {
  await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').first().click();
  await page.locator(".reader .ProseMirror").waitFor();
  // The anchors settle a beat after the body: asserting a placement before they
  // land is asserting about the state the reader is on its way out of. A
  // document seeded without anchors has none to wait for.
  const note = rows.find((row) => row.id === "doc_note");
  if ((note?.anchors?.length ?? 0) > 0) await page.locator(".reader .anchor-hl").first().waitFor();
  await page.locator(".reader [data-thread-panel]").first().waitFor();
}

function panel(scope: Page | Locator, id: string): Locator {
  return scope.locator(`[data-thread-panel="${id}"]`);
}

/*
 * A panel's **own** state, by direct child: a conversation renders exactly one
 * of the two, and an expanded one contains its child threads' panels, which have
 * their own answer. A descendant query would report a parent as folded because
 * something five levels inside it is.
 */
const OWN_LINE = "> [data-thread-expand]";
const OWN_CARD = "> .thread-card";

/** Collapsed is "a line and no card" — the two halves are never both on screen. */
async function expectFolded(scope: Page | Locator, id: string): Promise<void> {
  await expect(panel(scope, id).locator(OWN_LINE)).toHaveCount(1);
  await expect(panel(scope, id).locator(OWN_CARD)).toHaveCount(0);
}

async function expectOpen(scope: Page | Locator, id: string): Promise<void> {
  await expect(panel(scope, id).locator(OWN_CARD)).toHaveCount(1);
  await expect(panel(scope, id).locator(OWN_LINE)).toHaveCount(0);
}

/**
 * The two placements, driven the way the app decides between them: a narrow
 * column puts a chip at the anchor, and focus mode puts a card in the margin.
 */
const PLACEMENTS = [
  {
    name: "at the anchor, in a narrow column",
    enter: async (page: Page): Promise<Locator> => {
      await expect(page.locator(".reader .with-margin")).toHaveCount(0);
      return page.locator(".reader");
    },
  },
  {
    name: "in the margin, in full screen",
    enter: async (page: Page): Promise<Locator> => {
      await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
      const focus = page.locator(".focus.open");
      await expect(focus.locator(".with-margin")).toHaveCount(1);
      await expect(focus.locator(".focus-margin")).toHaveCount(1);
      return focus;
    },
  },
] as const;

for (const placement of PLACEMENTS) {
  test.describe(`a document carrying one resolved and one open thread — ${placement.name}`, () => {
    test("shows the open one full and the resolved one collapsed", async ({ page }) => {
      await openNote(page);
      const scope = await placement.enter(page);

      await expectOpen(scope, "th_open");
      await expect(panel(scope, "th_open").locator(".turn")).toHaveCount(2);
      await expect(panel(scope, "th_open").locator("[data-composer]")).toHaveCount(1);

      await expectFolded(scope, "th_done");
      // Collapsed is never hidden: it still says its size and its subject.
      const line = panel(scope, "th_done").locator(OWN_LINE);
      await expect(line).toContainText("2 turns");
      await expect(line).toContainText("resolved");
      await expect(line).toContainText("yield curve");
      // And it is still in the record: the highlight over its passage stays.
      await expect(scope.locator('.anchor-hl[data-thread="th_done"]')).toHaveCount(1);
    });

    test("expands the collapsed one in place, leaving the other alone", async ({ page }) => {
      await openNote(page);
      const scope = await placement.enter(page);
      await expectFolded(scope, "th_done");

      await panel(scope, "th_done").locator(OWN_LINE).click();
      await expectOpen(scope, "th_done");
      // Where it stood — the reader never went anywhere.
      await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toHaveCount(1);
      await expectOpen(scope, "th_open");
    });

    test("folds the open one on demand, from its own control", async ({ page }) => {
      await openNote(page);
      const scope = await placement.enter(page);
      await expectOpen(scope, "th_open");

      await panel(scope, "th_open").locator(".t-collapse").click();
      await expectFolded(scope, "th_open");
      // The resolved one is untouched — a fold is per conversation.
      await expectFolded(scope, "th_done");
    });
  });
}

test.describe("the rule and the reader", () => {
  test("does not collapse a resolved thread holding a turn nobody has seen", async ({ page }) => {
    await openNote(page, [VIEW, NOTE, OPEN_THREAD, { ...RESOLVED_THREAD, unread: true }]);
    await expectOpen(page, "th_done");
  });

  test("collapses a thread resolved on screen, and expands it when reopened", async ({ page }) => {
    await openNote(page);
    await expectOpen(page, "th_open");

    await panel(page, "th_open").locator('[data-resolve="th_open"]').click();
    await expectFolded(page, "th_open");

    // Reopening re-asserts the rule the other way.
    await panel(page, "th_open").locator(OWN_LINE).click();
    await panel(page, "th_open").locator('[data-resolve="th_open"]').click();
    await expect(panel(page, "th_open").locator(".t-status")).toHaveText("open");
    await expectOpen(page, "th_open");
  });

  test("keeps a hand-made fold through navigating away and back, and through a reload", async ({
    page,
  }) => {
    await openNote(page);
    await panel(page, "th_open").locator(".t-collapse").click();
    await expectFolded(page, "th_open");

    // Back to the list and in again — a fresh reader over the same document.
    await page.keyboard.press("Escape");
    await expect(page.locator(".reader")).toHaveCount(0);
    await page.locator('.row[data-row-doc="doc_note"]').first().click();
    await page.locator(".reader .ProseMirror").waitFor();
    await expectFolded(page, "th_open");

    // And a reload, which is the only thing `localStorage` is for here.
    await page.reload();
    await page.locator(".reader .ProseMirror").waitFor();
    await expectFolded(page, "th_open");
    // The rule still governs the one nobody touched.
    await expectFolded(page, "th_done");
  });

  test("leaves a second column showing the same document with its own answer", async ({ page }) => {
    await openNote(page, [VIEW, SECOND_VIEW, NOTE, OPEN_THREAD, RESOLVED_THREAD]);
    const first = page.locator('.col[data-col="doc_view_inbox"]');
    const second = page.locator('.col[data-col="doc_view_two"]');

    await panel(first, "th_open").locator(".t-collapse").click();
    await expectFolded(first, "th_open");

    await second.locator('.row[data-row-doc="doc_note"]').click();
    await second.locator(".reader .ProseMirror").waitFor();
    await expectOpen(second, "th_open");
    // …and the first column did not change its mind.
    await expectFolded(first, "th_open");
  });
});

/**
 * The one collapse in the app that had no way back. Past the drawn depth a child
 * thread rendered as a chip that **navigated away**, so reading it meant losing
 * your place — and the turns that deep lost their "comment on this" control with
 * it. §11's "every collapse expands again in place" is what forces both fixes.
 */
test.describe("a conversation nested deeper than the surface can draw", () => {
  /** A whole-document thread on the note, then five child threads under it. */
  const CHAIN: readonly StubRow[] = Array.from({ length: 6 }, (_, index) => {
    const depth = index + 1;
    const previous = `th_d${String(depth - 1)}`;
    return {
      id: `th_d${String(depth)}`,
      type: "thread",
      title: `depth ${String(depth)}`,
      path: `data/docs/threads/th_d${String(depth)}.md`,
      body: `## user · 2026-07-0${String(depth)}T09:00:00Z\nlevel ${String(depth)} of the nest\n`,
      parent: depth === 1 ? "doc_note" : previous,
    } satisfies StubRow;
  });

  test("is collapsed rather than dropped, and expands where it stands", async ({ page }) => {
    await openNote(page, [VIEW, { ...NOTE, anchors: [] }, ...CHAIN]);

    // Five levels are drawn; the sixth is placed collapsed rather than dropped.
    for (const depth of [1, 2, 3, 4, 5]) {
      await expectOpen(page, `th_d${String(depth)}`);
    }
    await expectFolded(page, "th_d6");

    const reader = page.locator(".reader");
    await expect(reader).toHaveAttribute("data-reader-doc", "doc_note");
    await panel(page, "th_d6").locator(OWN_LINE).click();

    // Expanded in place — the reader is still on the same document.
    await expectOpen(page, "th_d6");
    await expect(reader).toHaveAttribute("data-reader-doc", "doc_note");
    // `th_d1` hangs off the document at depth 0, so the sixth conversation in
    // the chain is the first one past `MAX_DRAWN_DEPTH`.
    await expect(panel(page, "th_d6").locator(OWN_CARD)).toHaveAttribute("data-depth", "5");
    // And its turns can be commented on again.
    await expect(panel(page, "th_d6").locator(".turn-comment").first()).toHaveCount(1);
  });
});

/**
 * SPEC.md §11: the fold claims **no new key**, so it has to be reachable without
 * a pointer through controls that already exist — an ordinary focusable button,
 * and the conversation's own right-click menu.
 */
test.describe("the fold claims no key of its own", () => {
  test("is operable from the keyboard", async ({ page }) => {
    await openNote(page);
    const line = panel(page, "th_done").locator(OWN_LINE);
    await expect(line).toHaveAttribute("aria-expanded", "false");
    await line.focus();
    await expect(line).toBeFocused();
    await page.keyboard.press("Enter");
    await expectOpen(page, "th_done");
  });

  test("sits in the conversation's own right-click menu, beside resolve", async ({ page }) => {
    await openNote(page);
    await panel(page, "th_done").locator(OWN_LINE).click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu.locator('[data-act="collapse"]')).toContainText("Expand");
    await expect(menu.locator('[data-act="resolve"]')).toHaveCount(1);

    await menu.locator('[data-act="collapse"]').click();
    await expectOpen(page, "th_done");
  });
});
