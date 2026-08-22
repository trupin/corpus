import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-032 in a real browser: **`↵` presses the control that has focus.**
 *
 * The board binds `↵` to "open the highlighted document" on a *document* keydown
 * listener and calls `preventDefault()` (SPEC.md §10's scheme, `useShortcuts`).
 * A `<button>` activates on `↵` through its **default action**, which runs after
 * every listener and only if nothing cancelled the event — so for as long as the
 * board claimed the key, no focused button anywhere in board scope could be
 * pressed by keyboard. It was found three times on three different controls
 * (UI-030's reader ⋯, UI-041's fence copy button, UI-139's console tabs) and
 * patched locally each time.
 *
 * Only a real browser performs a default action, so only a real browser can
 * prove the key gets through. Every assertion below is therefore about the
 * **act that ran**, never about a key having been pressed.
 *
 * The rule is one mechanism (`ownsActivationKeys`, documented in
 * `keyboard/shortcuts.ts`), so this file proves it on controls in three
 * different surfaces — a reader, a column header, the console — none of which
 * knows anything about the rule, plus the two cases the rule must not break:
 * the board's own row, and every board key that is not an activation key.
 */

const INBOX_VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

const NOTE = { id: "doc_note", title: "Mortgage options", body: "6.4% this week." };
const OTHER = { id: "doc_other", title: "Rates" };

async function board(page: Page): Promise<void> {
  await stubCorpus(page, [INBOX_VIEW, NOTE, OTHER]);
  await page.goto("/");
  await page.locator(".board").waitFor();
}

test.describe("↵ presses the focused control", () => {
  test("the reader's ⋯ trigger opens on ↵, exactly as it does on Space", async ({ page }) => {
    await board(page);
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await expect(page.locator(".reader")).toBeVisible();

    const dots = page.locator(".reader [data-doc-menu]");
    const menu = page.getByRole("menu", { name: "Document actions" });

    await dots.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();

    // …and the key the trigger never lost still works: nothing binds Space.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(dots).toBeFocused();
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
  });

  test("a column header's ⋯ trigger opens on ↵", async ({ page }) => {
    await board(page);
    const trigger = page.locator('.col[data-col="doc_view_inbox"] .col-menu');

    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toBeVisible();
  });

  /**
   * UI-139 worked around this defect inside its own `role="tablist"`, with an
   * `Enter`/`Space` branch that marks the event handled before the document
   * listener sees it. The general rule must not fight that local handling — the
   * tabs must still switch — so this pins the outcome rather than the route.
   */
  test("a console tab switches on ↵", async ({ page }) => {
    await board(page);
    await page.locator(".console-strip").click();
    await page.locator(".console-body").waitFor();

    const notices = page.locator("#console-tab-notices");
    await notices.focus();
    await page.keyboard.press("Enter");

    await expect(notices).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#console-tab-jobs")).toHaveAttribute("aria-selected", "false");
  });
});

test.describe("what the rule must not take away", () => {
  /**
   * The trap this issue is mostly about: the board's row is itself a control
   * (`role="button"`, `tabindex="0"`), and `↵` on the **highlighted** row is
   * SPEC.md §10's binding. A rule phrased as "skip when a control has focus"
   * would have cost the scheme its own key.
   */
  test("↵ still opens the highlighted row", async ({ page }) => {
    await board(page);

    await page.locator('.row[data-row-doc="doc_note"]').hover();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".row.kbd")).toHaveAttribute("data-row-doc", "doc_note");

    await page.keyboard.press("Enter");
    await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toBeVisible();
  });

  test("↵ opens the highlighted row when the row itself holds focus", async ({ page }) => {
    await board(page);

    const row = page.locator('.row[data-row-doc="doc_note"]');
    await row.focus();
    await expect(row).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator('.reader[data-reader-doc="doc_note"]')).toBeVisible();
  });

  /**
   * The rule yields **the activation key**, not the keyboard. A focused ⋯ does
   * not stop `j` from moving the row cursor, because `j` is not a key a button
   * presses itself with.
   */
  test("the board's other keys still act while a control holds focus", async ({ page }) => {
    await board(page);
    const trigger = page.locator('.col[data-col="doc_view_inbox"] .col-menu');
    await trigger.focus();

    await page.keyboard.press("j");
    await expect(page.locator(".row.kbd")).toHaveCount(1);
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.keyboard.press("c");
    await expect(page.locator(".overlay.open")).toHaveCount(1);
  });
});
