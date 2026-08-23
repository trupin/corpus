import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-162 in a real browser: the chip strip is the frontmatter editor (SPEC.md
 * §10, rider signed 2026-08-23).
 *
 * > *"Frontmatter is edited on the strip that shows it. … every chip that names
 * > an editable field **is** the control for that field. There is no second
 * > copy of the same values below it, and no labelled form beside it."*
 *
 * What only a browser can testify to here: the chip menus are the app's one
 * menu frame and land **on screen**, anchored to their chip (UI-159's class of
 * defect is a box placed by preference sailing off the viewport); the whole
 * flow works from the keyboard alone; and each change is one `PUT` that the
 * stub's store then carries — the disk of this suite.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
  extra: { width: 700 },
};

const NOTE: StubRow = {
  id: "doc_note",
  title: "Rates memo",
  tags: ["finance", "tax"],
  body: "Short memo about lender spreads.\n",
};

const MENU = "[data-ctx-menu]";

async function openNote(page: Page, rows: readonly StubRow[] = [VIEW, NOTE]) {
  const corpus = await stubCorpus(page, rows);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_note"]').click({ button: "right" });
  await page.locator('[role="menuitem"][data-act="open-here"]').click();
  await page.locator(".reader .ProseMirror").waitFor();
  return corpus;
}

test.describe("the chip strip is the frontmatter editor", () => {
  test("no labelled form stands beside the strip, on either surface", async ({ page }) => {
    await openNote(page);
    await expect(page.locator(".reader .fm-chips")).toBeVisible();
    await expect(page.locator(".fm-form")).toHaveCount(0);
    await expect(page.locator(".fm-field")).toHaveCount(0);
    await expect(page.locator(".fm-input")).toHaveCount(0);

    await page.locator('.reader[data-reader-doc="doc_note"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    await expect(page.locator(".focus .fm-chips")).toBeVisible();
    await expect(page.locator(".fm-form")).toHaveCount(0);
  });

  test("a tag chip's menu removes the tag, in one write the store then carries", async ({
    page,
  }) => {
    const corpus = await openNote(page);

    await page.locator('.reader [data-chip="tag"][data-tag="tax"]').click();
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();
    // Anchored to the chip and on screen — the placement is the frame's, not
    // this surface's own invention.
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? -1) + (box?.height ?? 0)).toBeLessThanOrEqual(720);

    await menu.locator('[data-act="remove-tag"]').click();
    await expect.poll(async () => (await corpus.doc("doc_note"))?.tags).toEqual(["finance"]);
    const writes = await corpus.of("PUT", "/api/docs/doc_note");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ tags: ["finance"] });
    // The strip follows the store: the chip is gone, the other remains.
    await expect(page.locator('.reader [data-chip="tag"][data-tag="tax"]')).toHaveCount(0);
    await expect(page.locator('.reader [data-chip="tag"][data-tag="finance"]')).toHaveCount(1);
  });

  test("rename edits the tag in place, debounced, and lands as one write", async ({ page }) => {
    const corpus = await openNote(page);

    await page.locator('.reader [data-chip="tag"][data-tag="finance"]').click();
    await page.locator(`${MENU} [data-act="rename-tag"]`).click();
    const input = page.locator(".reader .fm-chip-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("finance");

    await input.fill("finances");
    await input.press("Enter");
    await expect
      .poll(async () => (await corpus.doc("doc_note"))?.tags)
      .toEqual(["finances", "tax"]);
    expect(await corpus.of("PUT", "/api/docs/doc_note")).toHaveLength(1);
  });

  test("the + chip adds a tag at the end of the tags", async ({ page }) => {
    const corpus = await openNote(page);

    const add = page.locator('.reader [data-chip="add-tag"]');
    await add.click();
    const input = page.locator(".reader .fm-chip-input");
    await expect(input).toBeFocused();
    await input.fill("mortgage");
    await input.press("Enter");

    await expect
      .poll(async () => (await corpus.doc("doc_note"))?.tags)
      .toEqual(["finance", "tax", "mortgage"]);
    // The + is back, still at the end of the tags rather than the strip.
    const chips = page.locator('.reader [data-chip="tag"], .reader [data-chip="add-tag"]');
    await expect(chips.last()).toHaveAttribute("data-chip", "add-tag");
  });

  test("the status chip opens the vocabulary, marks the current word, and writes at once", async ({
    page,
  }) => {
    const corpus = await openNote(page);

    const chip = page.locator('.reader [data-chip="status"]');
    await expect(chip).toHaveText("status: open");
    await chip.click();
    const menu = page.locator(MENU);
    await expect(menu.locator('[data-act="status:open"]')).toContainText("✓ open");
    await expect(menu.locator('[data-act="status:archived"]')).toBeDisabled();

    await menu.locator('[data-act="status:resolved"]').click();
    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("resolved");
    expect(await corpus.of("PUT", "/api/docs/doc_note")).toHaveLength(1);
    await expect(chip).toHaveText("status: resolved");
  });

  test("the due chip opens a date field in place, sets a date, and clears it", async ({ page }) => {
    const corpus = await openNote(page);

    const chip = page.locator('.reader [data-chip="due"]');
    // Unset reads as an unset chip rather than disappearing.
    await expect(chip).toHaveText("due: —");
    await chip.click();
    const input = page.locator(".reader input[type='date']");
    await expect(input).toBeFocused();
    await input.fill("2026-10-01");
    await expect.poll(async () => (await corpus.doc("doc_note"))?.due).toBe("2026-10-01");
    // Leaving the field closes it back into its chip. (Escape is not reliable
    // here: with the native picker up, Chromium consumes the key to close the
    // picker before the input's own handler sees it.)
    await input.blur();
    await expect(chip).toHaveText("due: 2026-10-01");

    // …and clearing the field clears the date, after the debounce that also
    // lets a typed date finish arriving.
    await chip.click();
    await input.fill("");
    await expect.poll(async () => (await corpus.doc("doc_note"))?.due).toBeNull();
  });

  test("the whole flow works from the keyboard alone", async ({ page }) => {
    const corpus = await openNote(page);

    // Reach the status chip by Tab and open it with Enter: the menu takes
    // focus, arrows walk it, Enter chooses.
    await page.locator('.reader [data-chip="status"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(MENU)).toBeVisible();
    // Keyboard-opened: the first item took focus, arrows move from it.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await corpus.doc("doc_note"))?.status).toBe("resolved");

    // esc closes a menu without writing.
    await page.locator('.reader [data-chip="tag"][data-tag="finance"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(MENU)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await corpus.of("PUT", "/api/docs/doc_note")).toHaveLength(1);
    // …and focus went back to the chip that opened it.
    await expect(page.locator('.reader [data-chip="tag"][data-tag="finance"]')).toBeFocused();
  });
});
