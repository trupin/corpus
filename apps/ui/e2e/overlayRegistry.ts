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
 * the reported defects shipped) at the default window size, and judged on four
 * checks — nothing interactive clipped, a working exit affordance, Escape with
 * focus return, and usable scroll regions.
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
 * The scan deliberately does **not** match `role="menu"`: menus, toasts and
 * the console strip are out of the battery's scope (sprint-026, Out of scope).
 * Kit's `Select` menu is nevertheless *represented* here — once, as the
 * `lane-weight-menu` entry, in the tightest clipping context the product puts
 * it in (the console's 210px drawer) — because every `Select` menu is the same
 * primitive and its geometry defects reproduce wherever the primitive is
 * squeezed hardest. `ComposerAddress`'s popover renders no `role="dialog"`
 * today; it is pinned by explicit registration until UI-192 rebuilds it on kit
 * `Popover`, after which the scan covers it like everything else.
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
export type BatteryCheck = "fits" | "exit" | "escape" | "scroll";

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
  readonly expectedFailures?: readonly ExpectedFailure[];
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
  body: "![The chart](/attachments/att_chart.png)\n",
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
    // Pre-UI-192 the popover has no close control at all — the entry declares
    // the control UI-192 owes, and the exit check is expected-fail until then.
    exit: { kind: "control", selector: '[data-address-pop="th_host"] [data-address-close]' },
    opener: 'button[data-address-line="th_host"]',
    scrollRegions: [
      {
        selector: ".recipient-lanes",
        affordance: '[data-address-more="th_host"]',
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
    /**
     * TEST-1269: the battery reproduces the reported defect — these three stay
     * red until UI-192 rebuilds the popover on kit `Popover`, and the moment
     * that lands they pass "unexpectedly" and force this block's removal.
     * Failure text recorded from the 2026-09-07 run, in UI-193's E2E log.
     */
    expectedFailures: [
      {
        check: "exit",
        issue: "UI-192",
        reason:
          "the pre-rebuild popover renders no close control — an outside press was the only " +
          'exit (battery: "no visible exit control at [data-address-pop=\\"th_host\\"] ' +
          '[data-address-close]")',
      },
      {
        check: "escape",
        issue: "UI-192",
        reason:
          "ComposerAddress.tsx deliberately leaves Escape to the app's chain, and the chain " +
          "closes the whole reader out from under it: after Escape the opener itself is gone " +
          '(battery: toBeFocused found no button[data-address-line="th_host"])',
      },
      {
        check: "scroll",
        issue: "UI-192",
        reason:
          "the roster region is an unusable sliver over the crowded fixture (battery: " +
          '".recipient-lanes overflows at 25px — below --min-usable-height (120px)")',
      },
    ],
  },
  {
    id: "lane-weight-menu",
    sources: ["packages/kit/src/components/Controls/Select.tsx"],
    surface: "[data-lane-weight-panel] .select-menu",
    exit: { kind: "trigger", selector: '[data-select="lane-weight"]' },
    opener: '[data-select="lane-weight"]',
    scrollRegions: [],
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
