import type { Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { settledBox } from "./settledBox";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * UI-092 — **a derived status is a statement, not a control**, in a real
 * browser.
 *
 * SPEC.md §12 (rider signed 2026-08-12): *"the status control shows the derived
 * value and says it comes from the items, which is not an edit mode but a field
 * that was never the person's to set"*. UI-094 shipped the lock as a disabled
 * `<select>`, which is a different sentence — a disabled control says there is
 * an act here that is momentarily unavailable, and there is no act here.
 *
 * The two rules this file also holds to, both signed into §10:
 *
 * - **SHARED-057** — the statement must not resize when its value changes. A
 *   box whose width follows its text moves the hint under it every time an item
 *   is checked, so the geometry is measured across the flip rather than
 *   asserted from the stylesheet.
 * - **SHARED-030** — the value is shown *with the reason it is not settable*,
 *   in words.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence: this suite
 * starts no workspace server (INFRA-028), so the derivation reaching the *file*
 * comes from the issue's real-app drill against a real `corpus` server. Neither
 * half is acceptance on its own.
 */

const VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  pinned: true,
  order: 1,
  query: { folder: "inbox" },
};

/** A column that shows what the default query hides — the archived case needs one. */
const ARCHIVE_VIEW = {
  id: "doc_view_archive",
  type: "view",
  title: "Archive",
  path: "data/docs/views/archive.md",
  pinned: true,
  order: 2,
  query: { status: "archived" },
};

/** One item left open, so checking it is the act §12 describes. */
const TODO_BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [x] Send the signed form",
  "- [ ] Call the plumber",
  "",
].join("\n");

const TODO: StubRow = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: TODO_BODY,
  status: "open",
};

/** The same list, put away. §12: `archived` is never derived. */
const ARCHIVED_TODO: StubRow = {
  id: "doc_todo_archived",
  type: "todo",
  title: "Last winter's chores",
  path: "data/docs/inbox/winter.md",
  body: TODO_BODY,
  status: "archived",
};

/**
 * A pre-PLUGINS-005 list whose `items` key was hand-edited into something that
 * no longer parses — `todos-legacy.spec.ts`'s state 2.
 *
 * This is the document §12's edge case is about: `readItems` refuses it, so the
 * derivation declines, "the stored value stands", and a stored value nothing
 * derives is the person's to set again. A *well-formed* legacy key is **not**
 * this case — the plugin reads those items fine and derives from them, which is
 * why the fixture below is the malformed one rather than the unmigrated one.
 */
const MALFORMED: StubRow = {
  id: "doc_todo_legacy",
  type: "todo",
  title: "Hand-edited chores",
  path: "data/docs/inbox/hand-edited.md",
  body: "Chores that landed in the inbox.\n",
  status: "open",
  extra: { items: "nope" },
};

/**
 * **SERVER-085's write-back, standing in for the server this suite does not
 * run.**
 *
 * §12: *"the derived value is written into the document's frontmatter whenever
 * the server writes the document"*. The stub stores what it is sent, so without
 * this a body write would come back carrying the *stored* status and the flip
 * could never be observed — which would make this spec's headline assertion
 * vacuous rather than false. The derivation is §12's own rule, and it is applied
 * only to a `todo` whose items are readable, exactly as `deriveStatus` does.
 *
 * Registered **after** `stubCorpus` so it is matched first, then handed on with
 * `fallback` — Playwright matches the most recently added route first.
 */
async function stubDerivedWriteBack(
  page: Page,
  docId: string,
): Promise<{ readonly written: string[] }> {
  const written: string[] = [];
  await page.route(`**/api/docs/${docId}`, async (route) => {
    const request = route.request();
    const patch = (request.method() === "PUT" ? request.postDataJSON() : null) as Record<
      string,
      unknown
    > | null;
    const body = patch?.["body"];
    if (patch === null || typeof body !== "string") {
      await route.fallback();
      return;
    }
    const items = [...body.matchAll(/^[ \t]*- \[([ xX])\][ \t]+\S/gm)];
    const status = items.length > 0 && items.every((item) => item[1] !== " ") ? "resolved" : "open";
    written.push(status);
    await route.fallback({ postData: JSON.stringify({ ...patch, status }) });
  });
  return { written };
}

/** The plugin's aggregate, answered from the stub's own stored body. */
async function stubTodosAggregate(page: Page, bodyOf: () => Promise<string>): Promise<void> {
  await page.route("**/api/x/todos/**", async (route) => {
    const items = [...(await bodyOf()).matchAll(/^[ \t]*- \[([ xX])\][ \t]+(\S[^\n]*)$/gm)].map(
      (match) => ({ text: String(match[2]).trim(), done: match[1] !== " " }),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [
          {
            docId: TODO.id,
            title: TODO.title,
            path: TODO.path,
            status: "open",
            open: items.filter((item) => !item.done).length,
            done: items.filter((item) => item.done).length,
            items,
          },
        ],
      }),
    });
  });
}

async function openDoc(page: Page, docId: string): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await page.locator(`.reader[data-reader-doc="${docId}"] .fm-form`).waitFor();
}

/**
 * **Scoped to the `status` cell, and it has to be.** Since the review of PR #55
 * the `due` field is a statement on a todo too (`derived-due.spec.ts`), so
 * `.fm-statement` alone names two elements and `.fm-hint` names two sentences.
 * `data-field` is the form's own name for a cell — the `<label>`'s text — so
 * this narrows without introducing a second identity for the field.
 */
const statusCell = (page: Page) => page.locator('.reader .fm-form [data-field="status"]');
const statement = (page: Page) => statusCell(page).locator(".fm-statement");
const statusSelect = (page: Page) => statusCell(page).locator("select");
const hint = (page: Page) => statusCell(page).locator(".fm-hint");

test.describe("a status its document derives", () => {
  test("states the value where the control was, and says where it came from", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openDoc(page, TODO.id);

    await expect(statement(page)).toHaveText("open");
    // Not a dropdown at all — not even a disabled one.
    await expect(statusSelect(page)).toHaveCount(0);
    await expect(hint(page)).toContainText("derived from this document’s own content");
    // Nothing about it invites a click: no frame, no field background, and it
    // is not a control any pointer or keyboard can reach.
    const chrome = await statement(page).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        role: node.getAttribute("role") ?? node.tagName.toLowerCase(),
        border: style.borderTopColor,
        background: style.backgroundColor,
        focusable: (node as HTMLElement).tabIndex >= 0,
      };
    });
    expect(chrome.tag).toBe("OUTPUT");
    expect(chrome.focusable).toBe(false);
    expect(chrome.border).toContain("rgba(0, 0, 0, 0)");

    // And it agrees with the strip above it and the row behind it.
    await expect(page.locator(".reader .fm-chips .chip.on")).toHaveText("open");
    await expect(page.locator(`.row[data-row-doc="${TODO.id}"]`)).toHaveAttribute(
      "data-row-status",
      "open",
    );
  });

  test("flips when the last item is checked, with no reload and no resize", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(TODO.id))?.body ?? "");
    const writeBack = await stubDerivedWriteBack(page, TODO.id);
    await openDoc(page, TODO.id);
    await page.locator(".reader .ProseMirror").waitFor();

    // A page that reloaded loses this, so the assertion at the end is what makes
    // "live" mean live rather than "right again on the next paint".
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)["__uiO92"] = "same document";
    });

    const panel = page.locator(`[data-todo-panel="${TODO.id}"]`);
    await expect(panel.locator("[data-stat-open]")).toHaveText("1");
    await expect(statement(page)).toHaveText("open");
    await settledBox(page, page.locator(".reader .fm-form"));
    const before = await statement(page).boundingBox();
    const formBefore = await page.locator(".reader .fm-form").boundingBox();
    const hintBefore = await hint(page).boundingBox();

    // The act §12 describes: check the last open item, in the body editor.
    await page.locator('.reader .ProseMirror li input[type="checkbox"]').nth(1).click();

    await expect(statement(page)).toHaveText("resolved");
    // The DocPanel's counts moved on the same screen, from the same body.
    await expect(panel.locator("[data-stat-open]")).toHaveText("0");
    await expect(page.locator(".reader .fm-chips .chip.on")).toHaveText("resolved");
    await expect(page.locator(`.row[data-row-doc="${TODO.id}"]`)).toHaveAttribute(
      "data-row-status",
      "resolved",
    );
    expect(writeBack.written.at(-1)).toBe("resolved");

    // SHARED-057: the value changed and nothing moved.
    await settledBox(page, page.locator(".reader .fm-form"));
    expect(await statement(page).boundingBox()).toEqual(before);
    expect(await page.locator(".reader .fm-form").boundingBox()).toEqual(formBefore);
    expect(await hint(page).boundingBox()).toEqual(hintBefore);

    // Still no control, and still the same page.
    await expect(statusSelect(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>)["__uiO92"]),
    ).toBe("same document");

    // Unchecking it reopens the list, with no separate act.
    await page.locator('.reader .ProseMirror li input[type="checkbox"]').nth(1).click();
    await expect(statement(page)).toHaveText("open");
  });

  test("keeps an ordinary control on a list whose items cannot be read", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, MALFORMED]);
    await stubTodosAggregate(page, async () => (await corpus.doc(MALFORMED.id))?.body ?? "");
    await openDoc(page, MALFORMED.id);

    // The plugin says the items are unreadable, so nothing is derived and §12's
    // "the stored value stands" makes the field the person's again.
    await expect(page.locator(".reader [data-todo-legacy]")).toBeVisible();
    await expect(statement(page)).toHaveCount(0);
    await expect(statusSelect(page)).toBeEnabled();
    await expect(statusSelect(page)).toHaveValue("open");

    // And it writes: this is a real control, not a nicer-looking lock.
    await statusSelect(page).selectOption("resolved");
    await expect
      .poll(async () => (await corpus.of("PUT", `/api/docs/${MALFORMED.id}`)).length)
      .toBeGreaterThan(0);
    const writes = await corpus.of("PUT", `/api/docs/${MALFORMED.id}`);
    expect((writes.at(-1)?.body as { status?: string } | undefined)?.status).toBe("resolved");
  });

  test("shows an archived list as archived, and says that is not a reading of it", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, ARCHIVE_VIEW, ARCHIVED_TODO]);
    await stubTodosAggregate(page, async () => (await corpus.doc(ARCHIVED_TODO.id))?.body ?? "");
    await openDoc(page, ARCHIVED_TODO.id);

    // §12: "an archived todo document reads `archived` whatever its items say".
    await expect(statement(page)).toHaveCount(0);
    await expect(statusSelect(page)).toBeDisabled();
    await expect(statusSelect(page)).toHaveValue("archived");
    await expect(hint(page)).toContainText("not a reading of its content");
    await expect(hint(page)).toContainText("Unarchive in the ⋯ menu");
  });
});
