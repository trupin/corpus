import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-053: SPEC.md §11's one keyboard contract, in all three menus that answer
 * to it, in a real browser.
 *
 * A real browser is not optional here. The user's report is about `⇥`, and what
 * `⇥` does when nobody claims it — move focus to the next control — is a
 * browser behaviour with no jsdom equivalent: jsdom never moves focus on Tab, so
 * a unit test cannot fail the way the shipped app failed. What *can* be
 * observed, and is the mechanism, is whether the press was cancelled — so every
 * assertion below reads `defaultPrevented` off the real keydown as it bubbles
 * past the menu, and then checks where the focus actually ended up.
 *
 * The stub is the transport and nothing above it (`stubCorpus.ts`): real React,
 * real ProseMirror, real focus traversal.
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

const NOTE: StubRow = {
  id: "doc_note",
  title: "Quarterly memo",
  path: "data/docs/inbox/quarterly-memo.md",
  body: "Lead paragraph.\n",
};

const OTHER: StubRow = {
  id: "doc_other",
  title: "Lender spreads",
  path: "data/docs/inbox/lender-spreads.md",
  body: "Other note.\n",
};

/** So `@` lists something beyond the generic `@agent` and the arrows have room. */
const RESEARCHER: StubRow = {
  id: "doc_researcher",
  type: "agent-def",
  title: "Researcher",
  path: ".claude/agents/researcher.md",
  body: "Reads things.\n",
};

const CORPUS = [VIEW, NOTE, OTHER, RESEARCHER];

/**
 * Arms a one-shot recorder for the next `⇥`, read after the press.
 *
 * The listener sits on `window` in the bubble phase, so it runs *after* both
 * claimants — React's delegated root handler for the composers and the query
 * field, and ProseMirror's own `keydown` on the contenteditable — and therefore
 * sees the flag they set. `true` means the browser's focus move was cancelled,
 * which is the whole of what "⇥ does not move focus" means mechanically.
 */
interface TabRecorder {
  /** `null` until a `⇥` has actually been seen, so "never pressed" cannot read as "not cancelled". */
  __tabPrevented: boolean | null;
}

async function armTabRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __tabPrevented: boolean | null };
    store.__tabPrevented = null;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Tab") store.__tabPrevented = event.defaultPrevented;
      },
      { once: true },
    );
  });
}

async function tabWasCancelled(page: Page): Promise<boolean | null> {
  return page.evaluate(() => (window as unknown as TabRecorder).__tabPrevented);
}

test.describe("the composers' `@` menu", () => {
  test("wraps with the arrows, accepts on ⇥, and keeps the caret in the field", async ({
    page,
  }) => {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.keyboard.press("c");
    const box = page.getByLabel("Ask the agent, or capture a thought");
    await expect(box).toBeFocused();

    await box.pressSequentially("@");
    const menu = page.getByRole("listbox", { name: "Composer completions" });
    const options = menu.getByRole("option");
    // The generic `@agent`, and the one `agent-def` document in the corpus.
    await expect(options).toHaveCount(2);

    // Wrapping at both ends: ↑ from the first row lands on the last.
    await box.press("ArrowUp");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await box.press("ArrowDown");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    await armTabRecorder(page);
    await box.press("Tab");
    expect(await tabWasCancelled(page)).toBe(true);
    await expect(box).toHaveValue("@agent ");
    await expect(box).toBeFocused();
    await expect(menu).toBeHidden();
  });

  test("hands ⇥ back to the browser once no menu is open", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.keyboard.press("c");
    const box = page.getByLabel("Ask the agent, or capture a thought");
    await expect(box).toBeFocused();

    // No trigger typed, so no menu — and `⇥` means what it means in any form.
    await armTabRecorder(page);
    await box.press("Tab");
    expect(await tabWasCancelled(page)).toBe(false);
    await expect(box).not.toBeFocused();
  });

  test("esc dismisses and leaves the typed text exactly as it stands", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();

    await page.keyboard.press("c");
    const box = page.getByLabel("Ask the agent, or capture a thought");
    await box.pressSequentially("ask @res");
    await expect(page.getByRole("listbox", { name: "Composer completions" })).toBeVisible();

    await box.press("Escape");
    await expect(page.getByRole("listbox", { name: "Composer completions" })).toBeHidden();
    await expect(box).toHaveValue("ask @res");
    // One press closed the menu, not the overlay behind it.
    await expect(box).toBeVisible();
  });
});

test.describe("the document editor's `[[` menu", () => {
  async function openEditor(page: Page): Promise<void> {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.locator('.row[data-row-doc="doc_note"]').click();
    await page.locator(".reader .ProseMirror").waitFor();
    await page.locator(".reader .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
  }

  test("is the kit's menu, wraps, and accepts on ⇥ without leaving the editor", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.type("[[");

    const menu = page.getByRole("listbox", { name: "Link a document" });
    const options = menu.getByRole("option");
    await expect(menu).toBeVisible();
    await expect(options.first()).toHaveAttribute("aria-selected", "true");

    // Same highlight class the composers' menu emits — one implementation.
    await expect(options.first()).toHaveClass("ac-item active");

    await page.keyboard.press("ArrowUp");
    await expect(options.last()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");

    const title = await options.first().locator(".k").textContent();
    await armTabRecorder(page);
    await page.keyboard.press("Tab");
    // The proof the report asked for: the press is cancelled, so the focus move
    // `⇥` would otherwise perform never happens, and the caret is still here.
    expect(await tabWasCancelled(page)).toBe(true);
    await expect(page.locator(".reader .ProseMirror")).toBeFocused();
    await expect(page.locator(".reader .ProseMirror .ref")).toHaveText(title ?? "");
  });

  test("esc dismisses and leaves the literal `[[` in the body", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type("[[");
    await expect(page.getByRole("listbox", { name: "Link a document" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Link a document" })).toBeHidden();
    await expect(page.locator(".reader .ProseMirror")).toContainText("[[");
    // The first esc belonged to the menu; the reader is still open behind it.
    await expect(page.locator(".reader .ProseMirror")).toBeVisible();
  });
});

test.describe("the column query editor's menu", () => {
  async function openQueryEditor(page: Page): Promise<void> {
    await stubCorpus(page, CORPUS);
    await page.goto("/");
    await page.locator(".board").waitFor();
    await page.getByRole("button", { name: /List options for Inbox/ }).click();
    await page.getByRole("menuitem", { name: /Edit query/ }).click();
  }

  test("wraps, accepts on ⇥, and keeps the caret in the field", async ({ page }) => {
    await openQueryEditor(page);
    const field = page.getByLabel("Edit query for Inbox");
    await expect(field).toBeFocused();

    await field.press("ControlOrMeta+a");
    await field.pressSequentially("status=");

    const menu = page.getByRole("listbox", { name: /Query completions/ });
    const options = menu.getByRole("option");
    await expect(options).toHaveCount(3);

    await field.press("ArrowUp");
    await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowDown");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    await armTabRecorder(page);
    await field.press("Tab");
    expect(await tabWasCancelled(page)).toBe(true);
    await expect(field).toHaveValue("status=open");
    await expect(field).toBeFocused();
  });
});
