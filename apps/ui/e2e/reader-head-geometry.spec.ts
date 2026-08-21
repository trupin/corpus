import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-135, in a real browser: **the reader's head is a fixed box holding text of
 * unknown length** (SPEC.md §11's rider, signed 2026-08-20 — *"Nothing resizes
 * because of what it holds"*).
 *
 * The defect this pins was ordinary to reach and total in effect. Nothing in
 * `.reader-head` could shrink — `.back` and `.save-chip` were `flex: none`,
 * `.reader-id` was `nowrap` — so the row's only give was one auto margin, and a
 * save chip that grew 246px across its five states spent it. With a `Back` label
 * at the 40% cap the component itself permits, UI-128 measured **655px of
 * content in a 558px box**, ⤢ ending 97px outside the head and clipped away by
 * `.col { overflow: hidden }`: after a save, the two controls a person reaches
 * for next were simply not there.
 *
 * So this file measures rather than describes. It drives a real editor through
 * every one of `saveChipText`'s five outputs, at the longest back label the
 * component permits, in a column at both its reading width and the narrowest
 * width `board/columnWidth.ts` allows, and asserts three things:
 *
 * 1. the head never overflows — `scrollWidth <= clientWidth`, in every state
 * 2. no box in the head moves between states, the chip's least of all
 * 3. ⋯ and ⤢ take a real click and do their real work, in every state
 *
 * **Why the saves are stubbed at the wire and not in the component.** The chip's
 * three `saved` strings are counts the server reports (`PUT /api/docs/{id}` →
 * `anchors: {remapped, orphaned}`), and the stub answers every save with two
 * empty arrays, so three of the five states are unreachable through it. The
 * queue below rewrites that one field on the response and nothing else: the
 * keystroke, the debounce, the `PUT`, the response parsing, the context and the
 * chip are all the shipped ones. Driving the chip by publishing a `SaveState`
 * directly would have proved the CSS and skipped the question of whether the
 * state ever reaches it.
 */

const LONG_TITLE =
  "Mortgage refinancing options for the Rue Rambuteau flat — second pass, with the broker's notes";

const VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
  extra: { width: 336 },
};

/** The parent the excursion starts from — its title is what `.back` carries. */
const PARENT = {
  id: "doc_parent",
  title: LONG_TITLE,
  path: "data/docs/inbox/doc_parent.md",
  body: "Everything about the flat lives here.\n",
};

/**
 * The document that gets edited. It references the parent, so the parent's
 * reader lists it under "Referenced by" — which is how the excursion gains the
 * depth that puts a real document title on the back button.
 */
const NOTE = {
  id: "doc_note",
  title: "Rates",
  path: "data/docs/inbox/doc_note.md",
  // The reference lives in its own paragraph so the first one is plain prose:
  // clicking a paragraph that *is* a `[[ref]]` navigates instead of placing a
  // caret, which is a way to spend a whole run wondering why nothing saved.
  body: "The rate held.\n\nSee [[doc_parent]].\n",
};

/**
 * The same note with two conversations anchored in it, so the head also carries
 * 💬 — the extra control UI-128 measured as harmless and which this file has to
 * keep harmless.
 */
const NOTE_WITH_THREADS = {
  ...NOTE,
  anchors: [
    { anchorId: "anc_open", threadId: "th_open", exact: "rate held" },
    { anchorId: "anc_done", threadId: "th_done", exact: "long form" },
  ],
  // The first paragraph is deliberately unanchored: `nudge` clicks it to place
  // a caret, and a click that lands on a highlight opens the conversation
  // instead — which looks exactly like "the save never fired".
  body: "Notes below.\n\nThe rate held.\n\nSee [[doc_parent]] for the long form.\n",
};

const THREADS = [
  {
    id: "th_open",
    type: "thread",
    title: "Which lender?",
    path: "data/docs/threads/th_open.md",
    parent: "doc_note",
    body: "## user · 2026-07-01T09:00:00Z\nWhich lender?\n",
  },
  {
    id: "th_done",
    type: "thread",
    title: "Settled",
    path: "data/docs/threads/th_done.md",
    parent: "doc_note",
    body: "## user · 2026-07-01T09:00:00Z\nSettled?\n",
  },
];

/** What the server says about one save. `hold` is what makes `saving…` visible. */
type SaveOutcome =
  | {
      readonly kind: "ok";
      readonly remapped: number;
      readonly orphaned: number;
      readonly holdMs?: number;
    }
  | { readonly kind: "fail" };

/**
 * Queues the answers the next few `PUT /api/docs/{id}` calls get.
 *
 * Installed before the page's own scripts, so the client captures this `fetch`
 * rather than the platform's. Only `anchors` is rewritten — the document, the
 * key and the warnings are the stub's, which is what keeps the save path real.
 */
async function planSaves(page: Page, outcomes: readonly SaveOutcome[]): Promise<void> {
  await page.addInitScript((queued: readonly SaveOutcome[]) => {
    const pending = [...queued];
    const original = globalThis.fetch.bind(globalThis);
    const anchorIds = (prefix: string, count: number): readonly string[] =>
      Array.from({ length: count }, (_unused, index) => `anc_${prefix}${String(index)}`);

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();
      const isSave =
        method === "PUT" && /^\/api\/docs\/[^/]+$/.test(new URL(href, location.href).pathname);
      if (!isSave) return original(input, init);

      const outcome = pending.shift();
      if (outcome === undefined) return original(input, init);
      if (outcome.kind === "fail") {
        return new Response(JSON.stringify({ code: "internal", message: "the disk is full" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (outcome.holdMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, outcome.holdMs));
      }
      const response = await original(input, init);
      const payload = (await response.json()) as Record<string, unknown>;
      payload["anchors"] = {
        remapped: anchorIds("r", outcome.remapped),
        orphaned: anchorIds("o", outcome.orphaned),
      };
      return new Response(JSON.stringify(payload), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    };
  }, outcomes);
}

/**
 * One element's place in the head, in whole pixels and **relative to the head's
 * own left edge**.
 *
 * Not viewport coordinates, and not fractions. The board is a horizontal
 * scroller with snap points, so a click in the editor can move it by a fraction
 * of a pixel — which changes every viewport rect and the sub-pixel snapping of
 * every width with it, while nothing in the layout has moved at all. The
 * question here is where a control sits *in its row*, so that is what is
 * measured.
 */
interface Box {
  readonly x: number;
  readonly width: number;
  readonly right: number;
}

interface HeadGeometry {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  /** The trailing edge of the last child — where the row actually ends. */
  readonly lastRight: number;
  readonly back: Box;
  readonly readerId: Box;
  readonly chip: Box;
  readonly menu: Box;
  readonly expand: Box;
}

async function headGeometry(page: Page, scope: string): Promise<HeadGeometry> {
  return page.evaluate((root) => {
    const head = document.querySelector(`${root} .reader-head`);
    if (head === null) throw new Error(`no reader head under ${root}`);
    const origin = head.getBoundingClientRect().left;
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left - origin),
        width: Math.round(rect.width),
        right: Math.round(rect.right - origin),
      };
    };
    const find = (selector: string): Element => {
      const element = head.querySelector(selector);
      if (element === null) throw new Error(`no ${selector} in the head`);
      return element;
    };
    const children = [...head.children].filter(
      (child) => !child.classList.contains("comments-pop"),
    );
    const last = children.at(-1);
    return {
      scrollWidth: head.scrollWidth,
      clientWidth: head.clientWidth,
      lastRight: last === undefined ? 0 : box(last).right,
      back: box(find(".back")),
      readerId: box(find(".reader-id")),
      chip: box(find("[data-save-chip]")),
      menu: box(find("[data-doc-menu]")),
      expand: box(find("[data-expand]")),
    };
  }, scope);
}

/** Types into the body, which is what starts a save. */
async function nudge(page: Page, text: string): Promise<void> {
  const paragraph = page.locator(".col.reading .doc-editor .ProseMirror p").first();
  await paragraph.click();
  await expect(page.locator(".col.reading .doc-editor .ProseMirror")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

const COLUMN = ".col.reading";
const CHIP = `${COLUMN} .reader-head [data-save-chip]`;

/**
 * Opens `doc_note` with the long-titled parent underneath it in the nav stack,
 * so `.back` carries a real document title at the cap `.back` permits.
 */
async function openWithLongBackLabel(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_parent"]').click();
  await expect(page.locator(`${COLUMN} .reader-head .back-label`)).toHaveText(`‹ Inbox`);
  // Down one level, by the link the parent's own reader offers.
  await page.locator(`${COLUMN} .backlinks .ref`).click();
  await expect(page.locator(`${COLUMN} .reader-head .back-label`)).toHaveText(`‹ ${LONG_TITLE}`);
  await expect(page.locator(`${COLUMN} .doc-editor .ProseMirror p`).first()).toBeVisible();
}

/** Both controls, clicked for real, with the thing each one does asserted. */
async function bothControlsWork(page: Page, where: string): Promise<void> {
  await page.locator(`${COLUMN} .reader-head [data-doc-menu]`).click();
  await expect(page.locator(`${COLUMN} .reader-head .comments-pop.open`), where).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(`${COLUMN} .reader-head .comments-pop.open`)).toHaveCount(0);

  await page.locator(`${COLUMN} .reader-head [data-expand]`).click();
  await expect(page.locator(".focus.open"), where).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".focus.open")).toHaveCount(0);
}

test.describe("the reader head never resizes because of what it holds", () => {
  /**
   * The acceptance test. Five save states, one head, and nothing in it moves.
   */
  test("holds every save state in one box, and keeps ⋯ and ⤢ inside the column", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW, PARENT, NOTE]);
    await planSaves(page, [
      { kind: "ok", remapped: 0, orphaned: 0, holdMs: 1_500 },
      { kind: "ok", remapped: 3, orphaned: 0 },
      { kind: "ok", remapped: 0, orphaned: 12 },
      { kind: "fail" },
      // The hook retries a failure once, by itself. The second refusal is what
      // leaves the chip sitting in its error state long enough to measure.
      { kind: "fail" },
    ]);
    await openWithLongBackLabel(page);

    const seen: Record<string, HeadGeometry> = {};
    /*
     * Each measurement waits for the column to be at its settled reading width
     * first. `.col.reading` animates its width over 250 ms (UI-019), and a
     * sample taken inside that animation describes a row that is mid-flight
     * rather than a row that resized — which is a different claim from the one
     * this test makes. The head's own width is compared between states anyway,
     * so a column that really did move still fails, and says so in its own
     * name rather than the chip's.
     */
    const record = async (label: string): Promise<void> => {
      await expect(page.locator(COLUMN)).toHaveCSS("width", "560px");
      seen[label] = await headGeometry(page, COLUMN);
    };

    // 1 — idle. Nothing has been typed, and the chip says nothing.
    await expect(page.locator(CHIP)).toHaveText("");
    await record("idle");

    // 2 — saving. Held on the wire for 1.5s so the state is a state, not a blink.
    await nudge(page, " Again.");
    await expect(page.locator(CHIP)).toHaveText("saving…");
    await record("saving…");

    // 3 — committed, with the anchors untouched.
    await expect(page.locator(CHIP)).toHaveText("committed · git ✓");
    await record("committed · git ✓");

    // 4 — committed, with anchors remapped.
    await nudge(page, " More.");
    await expect(page.locator(CHIP)).toHaveText("committed · git ✓ · 3 anchors moved");
    await record("committed · git ✓ · 3 anchors moved");

    // 5 — committed, with anchors orphaned: the longest string the chip has.
    await nudge(page, " Yet more.");
    await expect(page.locator(CHIP)).toHaveText("committed · git ✓ · 12 anchors orphaned");
    await record("committed · git ✓ · 12 anchors orphaned");

    // 6 — failed. A different element (a retry button), and the same box.
    await nudge(page, " And again.");
    await expect(page.locator(CHIP)).toHaveText("save failed — retry", { timeout: 15_000 });
    await record("save failed — retry");

    const states = Object.entries(seen);
    expect(states).toHaveLength(6);

    for (const [label, geometry] of states) {
      // The head holds its content — so nothing is clipped, so nothing is lost.
      expect(geometry.scrollWidth, `${label}: scrollWidth`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
      // …and the last control ends inside the head rather than past its edge,
      // which is the failure `.col { overflow: hidden }` turned into a missing
      // button (UI-128 measured `lastRight=674` against a head ending at 577).
      expect(geometry.lastRight, `${label}: last child's right edge`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
    }

    /*
     * Measure the box, change the content, measure again, assert unchanged. The
     * chip is the item whose text changes, so it is named first — but the whole
     * row is compared, because the defect was never the chip's own width: it was
     * what the chip's width did to everything to the right of it.
     */
    const frame = (geometry: HeadGeometry): Record<string, unknown> => ({
      headWidth: geometry.clientWidth,
      back: geometry.back,
      // Pinned, not merely quiet: with the chip's box reserved, the id has
      // nothing left to be pushed by.
      readerId: geometry.readerId,
      chip: geometry.chip,
      menu: geometry.menu,
      expand: geometry.expand,
    });
    const [firstLabel, first] = states[0] as [string, HeadGeometry];
    for (const [label, geometry] of states) {
      expect(frame(geometry), `${label} against ${firstLabel}`).toEqual(frame(first));
    }

    // And the controls are not merely present — they work, in the state the
    // defect used to strike in, which is the one just after a save.
    await bothControlsWork(page, "after a save, at the reading width");
  });

  /**
   * The same head at the narrowest width a column can be, which is where a
   * reservation would break if it were a hard one. It is not: the chip's box is
   * reserved against its own *text* and still yields to its *container*, so the
   * row fits and the controls survive.
   *
   * `MIN_COLUMN_WIDTH` is reached through the viewport rather than through a
   * drag, because `clampColumnWidth` measures every width — the stored one and
   * the reading floor alike — against the window that is actually there. A
   * viewport this narrow leaves room for exactly the minimum, which is the
   * honest way to a 240px column with a reader open in it.
   */
  test("survives the narrowest column `columnWidth.ts` permits", async ({ page }) => {
    await page.setViewportSize({ width: 288, height: 900 });
    await stubCorpus(page, [VIEW, PARENT, NOTE]);
    await planSaves(page, [{ kind: "ok", remapped: 0, orphaned: 12 }]);
    await openWithLongBackLabel(page);

    const column = page.locator(COLUMN);
    await expect(column).toHaveCSS("width", "240px");

    const before = await headGeometry(page, COLUMN);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth);

    await nudge(page, " Narrow.");
    await expect(page.locator(CHIP)).toHaveText("committed · git ✓ · 12 anchors orphaned");

    const after = await headGeometry(page, COLUMN);
    expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth);
    expect(after.lastRight).toBeLessThanOrEqual(after.clientWidth);
    expect(after.chip).toEqual(before.chip);
    expect(after.menu).toEqual(before.menu);
    expect(after.expand).toEqual(before.expand);

    await bothControlsWork(page, "at 240px, the narrowest a column goes");
  });

  /**
   * The same narrow head with a fourth item in it: 💬, which appears whenever the
   * document has conversations on it.
   *
   * UI-128 measured 💬 as *not* pushing the controls, and that had to stay true —
   * but it is the case that spends the last of the row's slack, so it is the one
   * a reservation would break. It does not: the chip is reserved against its own
   * text and still yields to its container, so the extra control is paid for by
   * the two runs of text and not by ⋯ or ⤢.
   */
  test("still fits when the document carries conversations, at that same width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 288, height: 900 });
    await stubCorpus(page, [VIEW, PARENT, NOTE_WITH_THREADS, ...THREADS]);
    await planSaves(page, [{ kind: "ok", remapped: 0, orphaned: 12 }]);
    await openWithLongBackLabel(page);

    await expect(page.locator(COLUMN)).toHaveCSS("width", "240px");
    await expect(page.locator(`${COLUMN} .reader-head .comments-btn`)).toHaveText("💬 2");

    const before = await headGeometry(page, COLUMN);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth);

    await nudge(page, " Narrow.");
    await expect(page.locator(CHIP)).toHaveText("committed · git ✓ · 12 anchors orphaned");

    const after = await headGeometry(page, COLUMN);
    expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth);
    expect(after.lastRight).toBeLessThanOrEqual(after.clientWidth);
    expect(after.chip).toEqual(before.chip);
    expect(after.menu).toEqual(before.menu);
    expect(after.expand).toEqual(before.expand);

    await bothControlsWork(page, "at 240px, with 💬 on the row");
  });

  /**
   * What the reservation is made of, asserted where it can drift.
   *
   * The hidden copy is `SaveChip`'s own `saveChipText` output, carried on
   * `data-reserve` and drawn by `Reader.css`'s `::before`. If either half is
   * removed the box stops being reserved and the test above starts failing for a
   * reason that reads as a layout mystery — so the mechanism is named here.
   */
  test("reserves the chip's box with a hidden copy of its longest string", async ({ page }) => {
    await stubCorpus(page, [VIEW, PARENT, NOTE]);
    await openWithLongBackLabel(page);

    const reserved = await page.locator(CHIP).getAttribute("data-reserve");
    expect(reserved).toBe("committed · git ✓ · 99 anchors orphaned");

    const drawn = await page.locator(CHIP).evaluate((chip) => ({
      content: getComputedStyle(chip, "::before").content,
      visibility: getComputedStyle(chip, "::before").visibility,
      // An idle chip says nothing and still occupies its slot.
      text: chip.textContent,
      width: Math.round(chip.getBoundingClientRect().width * 100) / 100,
    }));
    expect(drawn.content).toContain("99 anchors orphaned");
    expect(drawn.visibility).toBe("hidden");
    expect(drawn.text).toBe("");
    expect(drawn.width).toBeGreaterThan(100);
  });

  /**
   * The other half of SHARED-057's clause 2: what truncates is revealed, never
   * silently cut. Both runs of variable text in the head carry their whole value
   * on a `title`.
   */
  test("reveals the whole of every value the head truncates", async ({ page }) => {
    await stubCorpus(page, [VIEW, PARENT, NOTE]);
    await planSaves(page, [{ kind: "ok", remapped: 0, orphaned: 12 }]);
    await openWithLongBackLabel(page);

    await expect(page.locator(`${COLUMN} .reader-head .back`)).toHaveAttribute(
      "title",
      `‹ ${LONG_TITLE} — Back (shift-click, or ⇧esc: straight to list)`,
    );
    await expect(page.locator(`${COLUMN} .reader-head .reader-id`)).toHaveAttribute(
      "title",
      "doc_note · git ✓",
    );

    await nudge(page, " Reveal.");
    await expect(page.locator(CHIP)).toHaveAttribute(
      "title",
      "committed · git ✓ · 12 anchors orphaned",
    );
  });

  /**
   * The two patterns UI-135 must not undo, both already right before it.
   */
  test("keeps ⤢ disabled rather than unmounted, and the chip present rather than absent", async ({
    page,
  }) => {
    await stubCorpus(page, [VIEW, PARENT, NOTE]);
    await openWithLongBackLabel(page);

    // `SaveChip` renders an empty element with no editor state to report, so the
    // head does not reflow the moment the first save lands.
    await expect(page.locator(CHIP)).toHaveCount(1);
    await expect(page.locator(CHIP)).toHaveText("");
    // ⋯ and ⤢ are both there, and ⤢ is enabled once the document has loaded.
    await expect(page.locator(`${COLUMN} .reader-head [data-expand]`)).toBeEnabled();
    await expect(page.locator(`${COLUMN} .reader-head [data-doc-menu]`)).toBeEnabled();
  });
});
