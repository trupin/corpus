import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  CROWDED_SKILL,
  crowdedLanes,
  stubCorpus,
  type StubOptions,
  type StubRow,
} from "./stubCorpus";

/**
 * Every overlay the product can open, in one place (UI-193).
 *
 * The battery (`overlay-battery.spec.ts`) iterates this module: each entry is
 * opened over the **crowded fixture** (`crowdedLanes()` — the empty case is how
 * the reported defects shipped) at the default window size, in **every state
 * the entry declares**, and judged on four checks — nothing interactive
 * clipped, a working exit affordance, Escape with focus return, and usable
 * scroll regions.
 *
 * ## Why registration cannot be dodged
 *
 * The battery's completeness test scans `apps/ui/src` and `packages/kit/src`
 * for overlay definition sites (`role="dialog"` in a `.tsx`, and imports of
 * kit's `Modal`/`Popover`) and fails, naming the file, when a site is claimed
 * by no entry's `sources`. A new overlay therefore registers or turns the
 * suite red — the correct-by-construction half of UI-193's filing. The inverse
 * also holds: an entry whose `sources` no longer exist fails, so a deleted
 * overlay leaves the registry rather than rotting in it.
 *
 * ## What the scan can and cannot force, honestly
 *
 * The scan forces every overlay definition **site** — a file — to be claimed.
 * It cannot force a **state list**: which states change what a surface offers
 * is runtime behaviour, not syntax, and no static scan of a `.tsx` can
 * enumerate them. So `furtherStates` is a *required* declaration on every
 * entry — the author must positively write the list down, and a single-state
 * entry asserts `furtherStates: []` in as many words — but its completeness
 * is the author's assertion, held by review and by the fact that a missed
 * state is exactly how the
 * phase-60 evaluation's FAIL-1 got through: the designation popover was
 * registered and green in its designating state while the "no owner" state —
 * the one whose popover is the surface's only weight editor (UI-192's own
 * decision record) — laid its weight rows out past the compose panel's clip,
 * unopened by any check. When a surface's content depends on state, every
 * further state joins `furtherStates`, opened and judged separately.
 *
 * The scan deliberately does **not** match `role="menu"`: menus, toasts and
 * the console strip are out of the battery's scope (sprint-026, Out of scope).
 * Kit's `Select` menu is nevertheless *represented* here — once, as the
 * `lane-weight-menu` entry, in the tightest clipping context the product puts
 * it in (the console's 210px drawer) — because every `Select` menu is the same
 * primitive and its geometry defects reproduce wherever the primitive is
 * squeezed hardest. `ComposerAddress`'s popover is a kit `Popover` since
 * UI-192, so the scan covers it like everything else.
 *
 * ## What an entry declares, honestly
 *
 * The exit affordance is typed, because the surfaces disagree on purpose:
 *
 * - `control` — a visible close/cancel control. The battery clicks it and
 *   requires the overlay gone.
 * - `scrim` — `design/index.html` is authoritative for look and feel, and it
 *   draws the ⌘K/`?`/`c` command panels with **no** close control: the scrim
 *   and Escape are their exits. The battery clicks the scrim and requires the
 *   overlay gone. Claiming `scrim` needs that mockup authority — an entry
 *   without it takes a `control`.
 * - `trigger` — the control that opened it stays visible and toggles it
 *   closed (a `Select`'s pill, the query editor's help button).
 *
 * A declared exemption is visible and greppable; a silent skip is neither.
 */

/** One check the battery runs; `expectedFailures` pins a known-red pair. */
export type BatteryCheck = "fits" | "exit" | "escape" | "scroll" | "choice";

export interface ExpectedFailure {
  readonly check: BatteryCheck;
  /** The issue that owes the fix — the battery stays red until it lands. */
  readonly issue: string;
  readonly reason: string;
}

export type ExitAffordance =
  | { readonly kind: "control"; readonly selector: string }
  | { readonly kind: "scrim"; readonly selector: string; readonly authority: string }
  | { readonly kind: "trigger"; readonly selector: string };

/**
 * Declared on a kit `Select` menu state: the battery picks this row with a
 * real mouse and requires the choice to **survive** — menu closed, the
 * trigger showing the label, the row checked on a reopen (UI-198). The
 * v0.36.0 suites asserted a click *chooses* and never that the choice
 * outlives the close, which is exactly the half that shipped broken: WebKit
 * blurs the focused option to `body` on mousedown, the old blur-dismiss tore
 * the menu down before `mouseup`, and no Safari user could pick a level at
 * all. The row's label doubles as what the trigger must show, because a
 * `Select` pill renders the chosen item's label and nothing else.
 */
export interface SelectChoiceDecl {
  /** The `menuitemradio` accessible name to pick — and the label the trigger must then show. */
  readonly pick: string;
}

export interface ScrollRegionDecl {
  /** The scrollable region, inside the surface. */
  readonly selector: string;
  /**
   * The visible overflow affordance this region promises while overflowing —
   * an "N more" line, or a kit `[data-overflowing="true"]` marker. Only
   * declared affordances are asserted: a raw region has no generic one.
   */
  readonly affordance?: string;
}

/**
 * One further state of an overlay's surface — the battery opens every declared
 * state and runs all four checks in each. A state overrides only what it
 * actually changes: the no-owner designation popover lives on a different host
 * (the global composer), so it overrides everything; a state that merely adds
 * content to the same surface would override nothing but `open`.
 */
export interface OverlayState {
  readonly id: string;
  /** Opens the overlay in this state over the crowded fixture. */
  readonly open: (page: Page) => Promise<void>;
  /** The open overlay's root in this state; the entry's when absent. */
  readonly surface?: string;
  readonly exit?: ExitAffordance;
  /** Overrides the entry's opener; `null` still means "none survives". */
  readonly opener?: string | null;
  /** Replaces (not merges) the entry's scroll regions for this state. */
  readonly scrollRegions?: readonly ScrollRegionDecl[];
  /** The pick-and-survive probe for a `Select` menu state; the entry's when absent. */
  readonly choice?: SelectChoiceDecl;
}

export interface OverlayEntry {
  readonly id: string;
  /** Repo-relative files whose overlay markup this entry vouches for. */
  readonly sources: readonly string[];
  /** The open overlay's root — what the checks scan and what must close. */
  readonly surface: string;
  readonly exit: ExitAffordance;
  /**
   * Where focus must land after Escape, or `null` when no opener survives the
   * gesture (a keyboard chord, a selection). `null` skips the focus-return
   * half only — closure is asserted for every entry.
   */
  readonly opener: string | null;
  readonly scrollRegions: readonly ScrollRegionDecl[];
  /** Opens the overlay over the crowded fixture; resolves once visible. */
  readonly open: (page: Page) => Promise<void>;
  /**
   * Every state **beyond `open`'s** that changes what this surface offers,
   * each opened and judged by the battery on all four checks. Required, never
   * defaulted: `[]` is the author's written assertion that one opener shows
   * everything the surface can offer — see the header for what the scan can
   * and cannot force. A surface whose content depends on state (the
   * designation popover's weight rows exist only with no owner standing)
   * declares each such state here, or the battery has never seen it.
   */
  readonly furtherStates: readonly OverlayState[];
  readonly expectedFailures?: readonly ExpectedFailure[];
  /**
   * The pick-and-survive probe (UI-198), declared on every `Select` menu
   * entry: the battery clicks this row with a real mouse and requires the
   * choice to hold — on the trigger after the close, and checked on a
   * reopen. Undeclared on surfaces that choose nothing (a panel, a popover).
   */
  readonly choice?: SelectChoiceDecl;
}

/* ── The shared crowded corpus ─────────────────────────────────────────── */

const THREADS_VIEW: StubRow = {
  id: "doc_view_threads",
  type: "view",
  title: "Conversations",
  path: "data/docs/views/threads.md",
  query: { type: ["thread"] },
  order: 1,
};

const NOTES_VIEW: StubRow = {
  id: "doc_view_notes",
  type: "view",
  title: "Notes",
  path: "data/docs/views/notes.md",
  query: { folder: "inbox" },
  order: 2,
};

export const BATTERY_PHRASE = "revisit the rate assumption";

/** The conversation the comment popover and the reply composer open over. */
const HOST_THREAD: StubRow = {
  id: "th_host",
  type: "thread",
  title: "Rate assumption",
  path: "data/docs/threads/th_host.md",
  body: `## user · 2026-08-03T17:01:12Z\nLet's ${BATTERY_PHRASE}.\n`,
};

/** A 1×1 PNG, for the image the viewer opens. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const IMAGE_DOC: StubRow = {
  id: "doc_pic",
  title: "The broker's chart",
  path: "data/docs/inbox/pic.md",
  // The ref is what the focus-mode entry's excursion-depth state follows
  // (UI-199): a link inside full screen continues the excursion there.
  body: "![The chart](/attachments/att_chart.png)\n\nDiscussed in [[th_host]].\n",
};

/**
 * Boots the app over the crowded fixture: ten long-named lanes, the tier table
 * with long labels, a conversation and an image note to open overlays over.
 */
export async function bootCrowded(page: Page, options?: StubOptions): Promise<void> {
  // The default window, pinned rather than inherited: the battery's verdicts
  // are geometry, and a config drift must not silently re-judge them.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await stubCorpus(page, [THREADS_VIEW, NOTES_VIEW, HOST_THREAD, IMAGE_DOC, CROWDED_SKILL], {
    lanes: crowdedLanes(),
    agent: { live: true, since: new Date().toISOString() },
    ...options,
  });
  // Registered after `stubCorpus`, so it wins the route: the viewer's image
  // must actually decode for its box to have a size worth judging.
  await page.route(/^https?:\/\/[^/]+\/attachments\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(PNG_BASE64, "base64"),
    }),
  );
  await page.goto("/");
  await page.locator(".board").waitFor();
}

/**
 * Opens the global composer with "no owner — the main agent" picked: the "at"
 * pill leaves and the address popover carries the WEIGHT rows (UI-192). The
 * label is `ComposeOverlay.tsx`'s `NO_RESIDENT_LABEL`, spelled out here the
 * way a person reads it rather than imported — the battery drives the product
 * through its real menus.
 */
export async function openComposeNoOwner(page: Page): Promise<void> {
  await bootCrowded(page);
  await page.keyboard.press("c");
  await page.locator(".compose-panel textarea").waitFor();
  await page.locator('[data-select="owner"]').click();
  await page.getByRole("menuitemradio", { name: "no owner — the main agent", exact: true }).click();
}

/** Opens `th_host` in a column reader, composer at the foot. */
async function openHostReader(page: Page): Promise<void> {
  await page.locator('.row[data-row-doc="th_host"]').click({ button: "right" });
  await page.locator('[role="menuitem"][data-act="open-here"]').click();
  await page.locator('.reader [data-composer="th_host"]').waitFor();
}

/**
 * Resolves once `selector`'s box has read the same three times running — the
 * address line re-words itself when the roster lands, and a press inside that
 * window is no press at all (`address-room-geometry.spec.ts`'s fixture rule).
 */
async function settled(page: Page, selector: string): Promise<void> {
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await page.locator(selector).boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never stopped moving`);
}

/* ── The registry ──────────────────────────────────────────────────────── */

export const OVERLAYS: readonly OverlayEntry[] = [
  {
    id: "search",
    sources: ["apps/ui/src/search/SearchOverlay.tsx"],
    surface: '.search-panel[aria-label="Search"]',
    exit: {
      kind: "scrim",
      selector: ".overlay.open",
      authority: "design/index.html draws the ⌘K panel with no close control",
    },
    opener: null,
    scrollRegions: [{ selector: ".search-results" }],
    furtherStates: [
      /*
       * Search stacked over full screen (UI-200): ⌘K opens above the
       * full-viewport focus overlay, and it is the one seam surface reachable
       * from inside the mode. Same panel, same scrim, same scroll region —
       * what this state adds is the layer beneath, and the battery's closure
       * checks are what hold the escape chain's order: if Escape (or the
       * scrim) closed focus instead of search, the panel would still be
       * standing and the check would fail. What a pick *does* from here —
       * navigate the excursion, never a loose path behind the modal — is
       * `focus-stays.spec.ts`'s to hold, because it is a navigation, not an
       * overlay anatomy.
       */
      {
        id: "over-focus-mode",
        open: async (page) => {
          await bootCrowded(page);
          await page.locator('.row[data-row-doc="doc_pic"]').click();
          await page.locator(".reader .ProseMirror").waitFor();
          await page.keyboard.press("f");
          await page.locator(".focus.open").waitFor();
          await page.keyboard.press("ControlOrMeta+k");
          await page.locator('.search-panel[aria-label="Search"]').waitFor();
        },
      },
    ],
    open: async (page) => {
      await bootCrowded(page);
      await page.keyboard.press("ControlOrMeta+k");
      await page.locator('.search-panel[aria-label="Search"]').waitFor();
    },
  },
  {
    id: "cheat-sheet",
    sources: ["apps/ui/src/keyboard/CheatSheet.tsx"],
    surface: ".kbd-panel",
    exit: {
      kind: "scrim",
      selector: ".overlay.open",
      authority: "design/index.html draws the ? panel with no close control",
    },
    opener: null,
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.keyboard.press("?");
      await page.locator(".kbd-panel").waitFor();
    },
  },
  {
    id: "compose",
    sources: ["apps/ui/src/compose/ComposeOverlay.tsx"],
    surface: ".compose-panel",
    exit: {
      kind: "scrim",
      selector: ".overlay.open",
      authority: "design/index.html draws the compose panel with no close control",
    },
    opener: null,
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.keyboard.press("c");
      await page.locator(".compose-panel").waitFor();
    },
  },
  {
    id: "kanban-dialog",
    sources: ["apps/ui/src/board/KanbanDialog.tsx"],
    surface: ".kanban-dialog",
    exit: { kind: "control", selector: ".kanban-cancel" },
    // The dialog opens from a menu item that closes with the menu, so no
    // opener survives to take focus back.
    opener: null,
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.getByRole("button", { name: "New board" }).click();
      await page.getByRole("menuitem", { name: /Kanban/ }).click();
      await page.locator(".kanban-dialog").waitFor();
    },
  },
  {
    id: "query-help",
    sources: ["apps/ui/src/board/query/QueryHelp.tsx"],
    surface: '[role="dialog"][aria-label="Query syntax"]',
    exit: { kind: "trigger", selector: 'button[aria-label="Query syntax for Conversations"]' },
    opener: 'button[aria-label="Query syntax for Conversations"]',
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.getByRole("button", { name: "List options for Conversations" }).click();
      await page.getByRole("menuitem", { name: /Edit query/ }).click();
      await page.getByRole("button", { name: "Query syntax for Conversations" }).click();
      await page.locator('[role="dialog"][aria-label="Query syntax"]').waitFor();
    },
  },
  {
    id: "upgrade",
    sources: ["apps/ui/src/upgrade/UpgradePanel.tsx"],
    surface: ".upgrade-panel",
    exit: { kind: "control", selector: ".upgrade-panel .btn-close" },
    opener: ".c-status-button",
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      // Registered after `stubCorpus`, so these win their routes: the strip
      // needs a version to click and the panel a release to report.
      await page.route("**/api/health", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            version: "0.35.0",
            uptimeSeconds: 12,
            workspace: "/tmp/stub-workspace",
          }),
        }),
      );
      await page.route("**/api/upgrade/check", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            installed: "0.35.0",
            latest: "0.36.0",
            upgradeAvailable: true,
            verifiable: true,
            notesUrl: "https://example.invalid/releases/v0.36.0",
            reachable: true,
            detail: null,
          }),
        }),
      );
      await page.locator(".c-status-button").click();
      await page.locator(".upgrade-panel").waitFor();
    },
  },
  {
    id: "image-viewer",
    sources: ["apps/ui/src/image/ImageViewer.tsx"],
    surface: ".overlay.image-viewer",
    exit: { kind: "control", selector: ".image-viewer-close" },
    opener: '.reader [data-reader-doc="doc_pic"] img, .reader img',
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.locator('.row[data-row-doc="doc_pic"]').click();
      const image = page.locator(".reader img").first();
      await image.waitFor();
      // Decoded, not merely mounted: a 1px placeholder box is not clickable.
      await page
        .locator(".reader img")
        .first()
        .evaluate((node) => (node as HTMLImageElement).decode());
      await image.click();
      await page.locator(".overlay.image-viewer").waitFor();
    },
  },
  {
    id: "focus-mode",
    sources: ["apps/ui/src/reader/FocusMode.tsx"],
    surface: ".focus.open",
    exit: { kind: "control", selector: "[data-close-focus]" },
    opener: null,
    scrollRegions: [{ selector: ".focus-scroll" }],
    furtherStates: [
      /*
       * The excursion with depth (UI-199 — full screen stays): a link
       * followed inside full screen continues on the overlay's own stack,
       * and the head gains the ‹ back chevron beside the ✕ — a control the
       * bottom-of-stack state never shows (`showsBack`). Unreachable before
       * UI-199, when following a link closed the overlay; now it is the
       * state every reading excursion passes through. Exit and Escape are
       * the entry's own — leaving stays explicit, from any depth.
       */
      {
        id: "excursion-depth",
        open: async (page) => {
          await bootCrowded(page);
          await page.locator('.row[data-row-doc="doc_pic"]').click();
          await page.locator(".reader .ProseMirror").waitFor();
          await page.keyboard.press("f");
          await page.locator(".focus.open").waitFor();
          await page.locator('.focus .doc-body [data-corpus-ref="th_host"]').click();
          await page.locator(".focus .reader-head .back:not([data-close-focus])").waitFor();
        },
      },
    ],
    open: async (page) => {
      await bootCrowded(page);
      await page.locator('.row[data-row-doc="doc_pic"]').click();
      await page.locator(".reader .ProseMirror").waitFor();
      await page.keyboard.press("f");
      await page.locator(".focus.open").waitFor();
    },
  },
  {
    id: "comment-popover",
    sources: ["apps/ui/src/anchors/CommentPopover.tsx"],
    surface: "[data-comment-pop]",
    exit: { kind: "control", selector: "[data-comment-pop] [data-comment-cancel]" },
    opener: null,
    scrollRegions: [],
    furtherStates: [],
    open: async (page) => {
      await bootCrowded(page);
      await page.locator('.row[data-row-doc="th_host"]').click();
      await page.locator('.reader [data-thread="th_host"] .turn-markdown p').first().waitFor();
      await page.evaluate((needle) => {
        const host = document.querySelector(".reader .turn-markdown p");
        if (host === null) throw new Error("no turn paragraph");
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
        throw new Error(`no “${needle}” in the turn`);
      }, BATTERY_PHRASE);
      const point = await page.evaluate(() => {
        const range = globalThis.getSelection()?.getRangeAt(0);
        if (range === undefined) throw new Error("nothing selected");
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.mouse.click(point.x, point.y, { button: "right" });
      await page.locator('[role="menuitem"][data-act="comment"]').click();
      await page.locator("[data-comment-pop]").waitFor();
    },
  },
  {
    id: "designation-popover",
    sources: ["packages/kit/src/address/ComposerAddress.tsx"],
    surface: '[data-address-pop="th_host"]',
    // The kit `Popover`'s always-rendered ✕ (UI-192 rebuilt the card on it;
    // the three expected failures that stood here — exit, escape, scroll —
    // were TEST-1269's reproduction of the reported defect, and they flipped
    // to passes when the rebuild landed).
    exit: { kind: "control", selector: '[data-address-pop="th_host"] .kit-popover-close' },
    opener: 'button[data-address-line="th_host"]',
    scrollRegions: [
      {
        selector: ".recipient-lanes",
        affordance: '[data-address-more="th_host"]',
      },
    ],
    furtherStates: [
      /*
       * The state the phase-60 evaluation found unreached (FAIL-1): with
       * "no owner — the main agent" picked in the global composer, the "at"
       * pill leaves and the popover's WEIGHT rows become the surface's only
       * weight editor (UI-192's decision record). The card opens inside
       * `.search-panel.compose-panel` — a fixed-height `overflow: hidden` box
       * — so this is also the tightest clipping context any ComposerAddress
       * host provides, and the state in which the crowded card cannot fit its
       * clip whole: the fit caps it at the panel and the card scrolls as one
       * piece. Declaring the card as a scroll region below exempts its
       * content from the fits hit-test *by design* (that check judges
       * un-scrollable clipping), so reachability of the weight rows in this
       * state is asserted by the battery's dedicated probe — hit-test returns
       * the row, a real click chooses a level — not left to the generic
       * check the declaration just softened.
       */
      {
        id: "no-owner",
        surface: '[data-address-pop="compose"]',
        exit: {
          kind: "control",
          selector: '[data-address-pop="compose"] .kit-popover-close',
        },
        opener: 'button[data-address-line="compose"]',
        scrollRegions: [
          {
            selector: ".recipient-lanes",
            affordance: '[data-address-more="compose"]',
          },
          // The card itself, capped at the compose panel's height (see above).
          { selector: '[data-address-pop="compose"]' },
        ],
        open: async (page) => {
          await openComposeNoOwner(page);
          await page.mouse.move(4, 4);
          await settled(page, 'button[data-address-line="compose"]');
          await page.locator('button[data-address-line="compose"]').click();
          await page.locator('[data-address-pop="compose"]').waitFor();
          await page.mouse.move(4, 4);
        },
      },
    ],
    open: async (page) => {
      await bootCrowded(page);
      await openHostReader(page);
      await page.mouse.move(4, 4);
      await settled(page, 'button[data-address-line="th_host"]');
      await page.locator('button[data-address-line="th_host"]').click();
      await page.locator('[data-address-pop="th_host"]').waitFor();
      await page.mouse.move(4, 4);
    },
  },
  {
    id: "lane-weight-menu",
    sources: ["packages/kit/src/components/Controls/Select.tsx"],
    surface: "[data-lane-weight-panel] .select-menu",
    exit: { kind: "trigger", selector: '[data-select="lane-weight"]' },
    opener: '[data-select="lane-weight"]',
    scrollRegions: [],
    // th_crowd_0 stands at "light", so this pick is a real change.
    choice: { pick: "Standard weight for everyday drafting and correspondence" },
    /*
     * The header's "every `Select` menu is the same primitive" reasoning held
     * for the primitive and not for the stylesheets around it: a *surface*
     * CSS rule can re-geometry one instance of the fixed menu, and one did —
     * `compose.css` kept a pre-fixed-positioning `.compose-settings
     * .select-menu { bottom: calc(100% + 4px) }` override whose `bottom`,
     * against a `position: fixed` box, resolves on the viewport and
     * over-constrains the menu into a blank sliver (PR #77 review, finding 1;
     * the kit `Select` flips upward on its own since UI-193, which was the
     * override's whole purpose). So the composer's two menus are opened as
     * states of their own: same primitive, different stylesheet scope — the
     * class this guards against is per-surface geometry overrides, which no
     * one-context entry can witness.
     */
    furtherStates: [
      {
        id: "compose-owner",
        surface: ".compose-settings .select-menu",
        exit: { kind: "trigger", selector: '[data-select="owner"]' },
        opener: '[data-select="owner"]',
        choice: { pick: "no owner — the main agent" },
        open: async (page) => {
          await openComposeMenu(page, "owner");
        },
      },
      {
        id: "compose-at",
        surface: ".compose-settings .select-menu",
        exit: { kind: "trigger", selector: '[data-select="resident-weight"]' },
        opener: '[data-select="resident-weight"]',
        choice: { pick: "Heavy, judgment-laden, or irreversible without a sign-off" },
        open: async (page) => {
          await openComposeMenu(page, "resident-weight");
        },
      },
    ],
    open: async (page) => {
      await bootCrowded(page);
      await page.locator(".console-strip").click();
      await page.locator(".console-body").waitFor();
      await page.getByRole("tab", { name: "Residents" }).click();
      await page.locator('[data-lane="th_crowd_0"]').click();
      await page.locator('[data-lane-scope="th_crowd_0"]').waitFor();
      await page.locator('[data-select="lane-weight"]').click();
      await page.locator(".select-menu").waitFor();
    },
  },
];

/**
 * Opens the global composer over the crowded fixture and one of its settings
 * row's `Select` menus — `owner`, or `resident-weight` (the "at" pill, shown
 * while a designation stands). The row re-words itself while the roster and
 * the tier table land, so the trigger is clicked only once its box has
 * settled, the address-line rule.
 */
export async function openComposeMenu(
  page: Page,
  select: "owner" | "resident-weight",
): Promise<void> {
  await bootCrowded(page);
  await page.keyboard.press("c");
  await page.locator(".compose-panel textarea").waitFor();
  await settled(page, `[data-select="${select}"]`);
  await page.locator(`[data-select="${select}"]`).click();
  await page.locator(".compose-settings .select-menu").waitFor();
}
