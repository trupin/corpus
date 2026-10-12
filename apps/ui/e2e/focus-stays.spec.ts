import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-199 — **full screen stays** (user report, 2026-09-09: "When I open a
 * document in full screen mode, I want to stay in full screen mode").
 *
 * Before the fix, a link followed inside full screen closed the overlay and
 * landed the document as a loose path (SPEC.md §10, rider 3) — every followed
 * link silently dropped the mode. The 2026-08-22 navigation-rework decision
 * record had already ruled the direction: full screen is a mode a person
 * leaves deliberately, never a side effect of navigating. So the overlay now
 * keeps its own navigation stack through every in-app document-to-document
 * navigation, and leaving is explicit only.
 *
 * What "every navigation" means was enumerated in the pre-fix reproduction,
 * in this browser, and each kind gets a test below:
 *
 * - **A link in the document body** — the one navigation that dropped the
 *   mode. It now pushes onto the overlay's stack.
 * - **Back within the excursion** — the ‹ button once the stack has depth. It
 *   navigates, never closes (until the bottom, where it is not rendered —
 *   `focus-exit.spec.ts` holds that half).
 * - **The search overlay's `↵` over full screen** — search opens above focus
 *   (`z` 40 over 35), and since UI-200 the pick navigates the excursion: the
 *   board routes any seam open that arrives while the mode is up onto the
 *   overlay's own stack. Before that, the pick landed as a loose path BEHIND
 *   the `aria-modal` overlay — the mode persisted (correct) but the gesture's
 *   result was invisible.
 * - **Board rows and the explorer** — pointer-unreachable under the
 *   full-viewport overlay: they are not navigations that exist from inside
 *   the mode. Browser back/forward likewise: the app is a single route, so
 *   history has no in-app entry to go back to.
 *
 * Leaving stays explicit — ✕, `esc` — and the overlay battery's focus-mode
 * entry (exit control `[data-close-focus]`, Escape with closure) is
 * unchanged. A reload deliberately does not restore the mode: the reasons
 * are recorded on `Board`'s `focusDoc` state, and the last test holds the
 * decision.
 */

const INBOX_VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** A chain to walk without leaving full screen: A → B → C. */
const NOTE_A: StubRow = {
  id: "doc_alpha",
  title: "Mortgage options",
  body: "Start from [[doc_beta]] before deciding.",
};
const NOTE_B: StubRow = {
  id: "doc_beta",
  title: "Rate table",
  body: "Back to [[doc_alpha]], or on to [[doc_gamma]].",
};
const NOTE_C: StubRow = { id: "doc_gamma", title: "Payoff model", body: "Fifteen years." };

const CORPUS = [INBOX_VIEW, NOTE_A, NOTE_B, NOTE_C];

/** Boots the board and enters full screen on Alpha, via its row's path column. */
async function enterFullScreen(page: Page): Promise<void> {
  await stubCorpus(page, CORPUS);
  await page.goto("/");
  await page.locator('.row[data-row-doc="doc_alpha"]').click();
  await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator(".focus.open")).toBeVisible();
  await expect(page.locator(".focus .doc-title")).toHaveValue("Mortgage options");
}

const focusTitle = (page: Page): ReturnType<Page["locator"]> => page.locator(".focus .doc-title");

/** The in-excursion back button: the head's chevron, never the ✕. */
const BACK = ".focus .reader-head .back:not([data-close-focus])";

test.describe("full screen stays (UI-199)", () => {
  test("a followed link navigates the overlay, and a second one chains", async ({ page }) => {
    await enterFullScreen(page);

    await page.locator('.focus .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(focusTitle(page)).toHaveValue("Rate table");
    await expect(page.locator(".focus.open")).toHaveCount(1);

    await page.locator('.focus .doc-body [data-corpus-ref="doc_gamma"]').click();
    await expect(focusTitle(page)).toHaveValue("Payoff model");
    await expect(page.locator(".focus.open")).toHaveCount(1);

    // Nothing landed on the board behind: the excursion is the overlay's own.
    await expect(page.locator(".path.loose")).toHaveCount(0);
    await expect(page.locator(".pcol")).toHaveCount(1);
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeAttached();
  });

  test("back walks the excursion inside the mode, named after where it goes", async ({ page }) => {
    await enterFullScreen(page);
    await page.locator('.focus .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(focusTitle(page)).toHaveValue("Rate table");

    const back = page.locator(BACK);
    await expect(back).toHaveText("‹ Mortgage options");
    await back.click();

    await expect(focusTitle(page)).toHaveValue("Mortgage options");
    await expect(page.locator(".focus.open")).toHaveCount(1);
    // Bottom of the stack: the chevron has left, the ✕ stands alone
    // (`focus-exit.spec.ts`'s rule, holding after a real excursion).
    await expect(page.locator(BACK)).toHaveCount(0);
    await expect(page.locator(".focus [data-close-focus]")).toHaveCount(1);
  });

  test("a search pick made inside the mode navigates the excursion (UI-200)", async ({ page }) => {
    await enterFullScreen(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".overlay.open")).toBeVisible();
    await page.getByLabel("Search query").fill("Payoff model");
    await page.locator('.sr[data-sr="doc_gamma"]').waitFor();
    await page.keyboard.press("Enter");

    // The gesture's result is where the person is: full screen shows the
    // pick. Before UI-200 it landed as a loose path behind the `aria-modal`
    // overlay — the mode persisted but nothing visible happened.
    await expect(page.locator(".overlay.open")).toHaveCount(0);
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await expect(focusTitle(page)).toHaveValue("Payoff model");
    // Nothing landed on the board behind: the pick continued the excursion.
    await expect(page.locator(".path.loose")).toHaveCount(0);

    // A pick is a push: back walks it, named after where the search was made.
    const back = page.locator(BACK);
    await expect(back).toHaveText("‹ Mortgage options");
    await back.click();
    await expect(focusTitle(page)).toHaveValue("Mortgage options");
    await expect(page.locator(".focus.open")).toHaveCount(1);
  });

  test("Escape over full screen closes search only — the mode persists", async ({ page }) => {
    await enterFullScreen(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".overlay.open")).toBeVisible();
    await page.keyboard.press("Escape");

    // One layer per press: the search overlay leaves, full screen holds.
    await expect(page.locator(".overlay.open")).toHaveCount(0);
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await expect(focusTitle(page)).toHaveValue("Mortgage options");
  });

  test("leaving is explicit: esc closes, from any depth, in one press", async ({ page }) => {
    await enterFullScreen(page);
    await page.locator('.focus .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(focusTitle(page)).toHaveValue("Rate table");

    // Escape is the leave gesture, not a back button: one press ends the
    // excursion even with depth on the stack (the battery's focus-mode
    // contract — Escape closes the overlay).
    await page.keyboard.press("Escape");
    await expect(page.locator(".focus.open")).toHaveCount(0);
    // The board is exactly as full screen left it.
    await expect(page.locator('.pcol .reader[data-reader-doc="doc_alpha"]')).toBeVisible();
  });

  test("leaving is explicit: the ✕ closes from depth too", async ({ page }) => {
    await enterFullScreen(page);
    await page.locator('.focus .doc-body [data-corpus-ref="doc_beta"]').click();
    await expect(focusTitle(page)).toHaveValue("Rate table");

    await page.locator(".focus [data-close-focus]").click();
    await expect(page.locator(".focus.open")).toHaveCount(0);
  });

  test("a reload does not restore the mode — the decision, held", async ({ page }) => {
    await enterFullScreen(page);

    // `stubCorpus`'s routes survive the reload; the mode must not.
    await page.reload();
    await page.locator('.row[data-row-doc="doc_alpha"]').waitFor();

    /*
     * Deliberate, not an omission (UI-199's third criterion): the per-viewer
     * conveniences that survive a reload are all board-shaped — readers,
     * paths, widths — while no overlay does; the excursion stack is in-memory
     * by design, so a restored mode would come back amnesiac; and a reload is
     * the universal recover gesture, which a restored `aria-modal` overlay
     * would defeat. The full reasoning is on `Board`'s `focusDoc` state.
     */
    await expect(page.locator(".focus")).toHaveCount(0);
    await expect(page.locator(".board")).toBeVisible();
  });
});
