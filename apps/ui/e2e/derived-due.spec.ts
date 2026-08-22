import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **A derived `due` is a statement, not a control**, in a real browser — the
 * CRITICAL finding of PR #55's review.
 *
 * UI-093 made this form always live, and one of the controls it made live is one
 * the write path undoes. SERVER-134 converges a derived `due` on every write the
 * server makes, so the shipped date input offered a change that could not land:
 * pick a date on a todo, `isDeliberate` fires `PUT {"due":"2030-01-01"}` at once,
 * the server answers `200`, the convergence overwrites the value in that same
 * write, and the control snaps back to the derived date. No error, no
 * explanation, deadline not set. Measured against a real `corpus` server before
 * this file existed — see the issue's E2E Verification Log.
 *
 * Three signed rules meet here, and they all say the same thing:
 *
 * - **§11 / SHARED-030** — a derived field "shows the value and says where it
 *   comes from, and is editable by nobody".
 * - **`PluginDocType`** (`@corpus/kit/plugin`) — "a surface that would offer a
 *   `due` edit renders it locked".
 * - **SHARED-057 / SHARED-061** — the statement's box may not follow its text. A
 *   **date appearing and disappearing** is the widest change this field makes
 *   (`no deadline` against `2026-09-30`), so the geometry is measured across the
 *   flip rather than asserted from the stylesheet.
 *
 * Per sprint-016 Adjudication 19 this is **half** the evidence: this suite starts
 * no workspace server (INFRA-028), so the derivation reaching the *file* comes
 * from the issue's real-app drill against a real `corpus` server.
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

/**
 * One dated open item and one undated one, so checking the dated one is the act
 * that takes the document's deadline away — `DerivedDocDue`'s middle answer,
 * `{due: null}`: the derivation still applies and there is no deadline.
 */
const TODO_BODY = [
  "Chores that landed in the inbox.",
  "",
  "- [ ] call the plumber (due: 2026-09-30)",
  "- [ ] rinse the filter",
  "",
].join("\n");

const TODO: StubRow = {
  id: "doc_todo",
  type: "todo",
  title: "Inbox chores",
  path: "data/docs/inbox/inbox-chores.md",
  body: TODO_BODY,
  status: "open",
  // What SERVER-134 wrote into the frontmatter the last time the server wrote
  // this document. The surface shows this, never a value it derived itself.
  due: "2026-09-30",
};

/** The same list, put away. An archived document derives nothing (rule 2). */
const ARCHIVED_TODO: StubRow = {
  id: "doc_todo_archived",
  type: "todo",
  title: "Last winter's chores",
  path: "data/docs/inbox/winter.md",
  body: TODO_BODY,
  status: "archived",
  due: "2026-09-30",
};

/**
 * A pre-PLUGINS-005 list whose `items` key was hand-edited into something that
 * no longer parses. `readItems` refuses it, the derivation declines, "the stored
 * value stands" — and a stored value nothing derives is the person's to set.
 */
const MALFORMED: StubRow = {
  id: "doc_todo_legacy",
  type: "todo",
  title: "Hand-edited chores",
  path: "data/docs/inbox/hand-edited.md",
  body: "Chores that landed in the inbox.\n",
  status: "open",
  due: "2026-09-30",
  extra: { items: "nope" },
};

/**
 * **SERVER-134's convergence, standing in for the server this suite does not
 * run.**
 *
 * §12: the derived value "is written into the document's frontmatter whenever the
 * server writes the document". The stub stores what it is sent, so without this a
 * body write would come back carrying the *stored* deadline and the flip could
 * never be observed — the headline assertion would be vacuous rather than false.
 * The rule applied is the plugin's own: the earliest date among the items still
 * open, and `null` when none of them is dated.
 *
 * Registered **after** `stubCorpus` so it is matched first, then handed on with
 * `fallback` — Playwright matches the most recently added route first.
 */
async function stubDerivedWriteBack(
  page: Page,
  docId: string,
): Promise<{ readonly written: (string | null)[] }> {
  const written: (string | null)[] = [];
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
    const dates = [...body.matchAll(/^[ \t]*- \[ \][ \t]+.*\(due: (\d{4}-\d{2}-\d{2})\)/gm)].map(
      (match) => String(match[1]),
    );
    const due = dates.sort()[0] ?? null;
    written.push(due);
    await route.fallback({ postData: JSON.stringify({ ...patch, due }) });
  });
  return { written };
}

/** The plugin's aggregate, answered from the stub's own stored body. */
async function stubTodosAggregate(
  page: Page,
  row: StubRow,
  bodyOf: () => Promise<string>,
): Promise<void> {
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
            docId: row.id,
            title: row.title,
            path: row.path,
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
  await page.locator(`.row[data-row-doc="${docId}"]`).first().click();
  await page.locator(`.reader[data-reader-doc="${docId}"] .fm-form`).waitFor();
}

/**
 * Scoped to the `due` cell by the form's own name for it. `.fm-statement` alone
 * names two elements on a todo now — `status` is a statement too (UI-092) — and a
 * spec that asserted "the statement" would be asserting about whichever came
 * first in the DOM.
 */
const dueCell = (page: Page) => page.locator('.reader .fm-form [data-field="due"]');
const statement = (page: Page) => dueCell(page).locator(".fm-statement");
const dateInput = (page: Page) => dueCell(page).locator('input[type="date"]');
const hint = (page: Page) => dueCell(page).locator(".fm-hint");

/**
 * Resolves once `locator`'s box has read the same three times running, 100ms
 * apart — UI-127's helper, for `derived-status.spec.ts`'s reason: the column
 * widens when a reader opens in it, over a transition, so a box measured too
 * early is a box of a column still moving.
 *
 * A fixture concern and never an assertion — what is asserted is that two settled
 * boxes either side of a value change are identical.
 */
async function settled(page: Page, locator: Locator): Promise<void> {
  let last = "";
  let same = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const box = JSON.stringify(await locator.boundingBox());
    same = box !== "null" && box === last ? same + 1 : 0;
    if (same >= 3) return;
    last = box;
    await page.waitForTimeout(100);
  }
  throw new Error("the frontmatter form never stopped moving");
}

test.describe("a due date its document derives", () => {
  test("states the date where the control was, and says where it came from", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, TODO, async () => (await corpus.doc(TODO.id))?.body ?? "");
    await openDoc(page, TODO.id);

    await expect(statement(page)).toHaveText("2026-09-30");
    // Not a switched-off date picker, which would read as an act that is
    // momentarily unavailable. There is no act here.
    await expect(dateInput(page)).toHaveCount(0);
    await expect(hint(page)).toContainText("derived from this document’s own content");

    const chrome = await statement(page).evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        border: style.borderTopColor,
        focusable: (node as HTMLElement).tabIndex >= 0,
      };
    });
    expect(chrome.tag).toBe("OUTPUT");
    expect(chrome.focusable).toBe(false);
    expect(chrome.border).toContain("rgba(0, 0, 0, 0)");

    // The whole of the finding: nothing here can send a `due` the write path
    // would immediately undo, so nothing does.
    expect(await corpus.of("PUT", `/api/docs/${TODO.id}`)).toHaveLength(0);
  });

  test("loses the deadline when the last dated item is checked, without resizing", async ({
    page,
  }) => {
    const corpus = await stubCorpus(page, [VIEW, TODO]);
    await stubTodosAggregate(page, TODO, async () => (await corpus.doc(TODO.id))?.body ?? "");
    const writeBack = await stubDerivedWriteBack(page, TODO.id);
    await openDoc(page, TODO.id);
    await page.locator(".reader .ProseMirror").waitFor();

    await expect(statement(page)).toHaveText("2026-09-30");
    await settled(page, page.locator(".reader .fm-form"));
    const before = await statement(page).boundingBox();
    const formBefore = await page.locator(".reader .fm-form").boundingBox();
    const hintBefore = await hint(page).boundingBox();

    await page.locator('.reader .ProseMirror li input[type="checkbox"]').first().click();

    // `{due: null}` — the derivation still applies, and the answer is none. The
    // field says so rather than falling back to a control.
    await expect(statement(page)).toHaveText("no deadline");
    expect(writeBack.written.at(-1)).toBeNull();
    await expect(dateInput(page)).toHaveCount(0);
    await expect(hint(page)).toContainText("derived from this document’s own content");

    // SHARED-057: the value changed and the box did not. `no deadline` is the
    // wider string, so a box that followed its text would move the hint under it
    // every time an item was checked.
    await settled(page, page.locator(".reader .fm-form"));
    expect(await statement(page).boundingBox()).toEqual(before);
    expect(await page.locator(".reader .fm-form").boundingBox()).toEqual(formBefore);
    expect(await hint(page).boundingBox()).toEqual(hintBefore);

    // And back: unchecking restores the deadline, on the same element.
    await page.locator('.reader .ProseMirror li input[type="checkbox"]').first().click();
    await expect(statement(page)).toHaveText("2026-09-30");
    expect(await statement(page).boundingBox()).toEqual(before);
  });

  test("keeps an ordinary date control on a list whose items cannot be read", async ({ page }) => {
    const corpus = await stubCorpus(page, [VIEW, MALFORMED]);
    await stubTodosAggregate(
      page,
      MALFORMED,
      async () => (await corpus.doc(MALFORMED.id))?.body ?? "",
    );
    await openDoc(page, MALFORMED.id);

    await expect(statement(page)).toHaveCount(0);
    await expect(dateInput(page)).toBeEnabled();
    await expect(dateInput(page)).toHaveValue("2026-09-30");

    // The release is real, not cosmetic: the date reaches the wire.
    await dateInput(page).fill("2030-01-01");
    await expect
      .poll(async () => (await corpus.of("PUT", `/api/docs/${MALFORMED.id}`)).length)
      .toBeGreaterThan(0);
    const writes = await corpus.of("PUT", `/api/docs/${MALFORMED.id}`);
    expect((writes.at(-1)?.body as { due?: string } | undefined)?.due).toBe("2030-01-01");
  });

  test("keeps an ordinary date control on an archived list", async ({ page }) => {
    // Archiving is a fact about `status`, not about `due`: rule 2 makes an
    // archived document one of the two states every derivation declines, so the
    // deadline is the person's again — where the `status` control stays locked.
    const corpus = await stubCorpus(page, [VIEW, ARCHIVE_VIEW, ARCHIVED_TODO]);
    await stubTodosAggregate(
      page,
      ARCHIVED_TODO,
      async () => (await corpus.doc(ARCHIVED_TODO.id))?.body ?? "",
    );
    await openDoc(page, ARCHIVED_TODO.id);

    await expect(statement(page)).toHaveCount(0);
    await expect(dateInput(page)).toBeEnabled();
    await expect(page.locator('.reader .fm-form [data-field="status"] select')).toBeDisabled();
  });
});
