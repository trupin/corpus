import type { Route } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-044's close path in a real browser, on the one ordering that used to break
 * it (PR #22 review, MAJOR).
 *
 * A reader closing flushes the document's edit session, and one sitting must
 * produce exactly one acknowledgment. The teardown order is: the editor
 * unmounts, autosave puts its buffered `PUT` on the wire, the surface count
 * reaches zero — so when that last `PUT` is **refused**, the write settles, the
 * sweep ends the session over what actually committed, and anything the failure
 * handler schedules afterwards has no surface left to belong to. A retry armed
 * there could never be cleared, and landing three seconds later it would open a
 * second session nobody is left to close: two `doc.edited` events, two
 * acknowledgment threads, for one sitting.
 *
 * Driven with real timers because the whole defect is a timer: the assertions
 * are taken after the retry window has genuinely elapsed.
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

const NOTE = {
  id: "doc_sitting",
  type: "note",
  title: "A sitting",
  path: "data/docs/inbox/a-sitting.md",
  body: "The first sentence.\n",
};

/** `RETRY_DELAY_MS` (3 s) plus the flush sweep's 300 ms, with room to spare. */
const PAST_THE_RETRY_MS = 5_000;

interface Wire {
  /** Refuse the next body `PUT` — a 500, as a busy server or a blip produces. */
  readonly failNextSave: () => void;
  readonly saves: () => number;
  readonly flushes: () => number;
}

/**
 * Fault injection over the stub, registered after it so Playwright reaches this
 * handler first; everything it does not own is handed straight back.
 */
async function wire(page: import("@playwright/test").Page): Promise<Wire> {
  let armed = false;
  let saves = 0;
  let flushes = 0;
  await page.route("**/api/docs/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT" && path === `/api/docs/${NOTE.id}`) {
      saves += 1;
      if (armed) {
        armed = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "internal", message: "the server refused the save" }),
        });
        return;
      }
    }
    if (request.method() === "POST" && path.endsWith("/edit-session/flush")) flushes += 1;
    await route.fallback();
  });
  return {
    failNextSave: () => {
      armed = true;
    },
    saves: () => saves,
    flushes: () => flushes,
  };
}

test("a save refused as the reader closes still ends the sitting exactly once", async ({
  page,
}) => {
  const corpus = await stubCorpus(page, [INBOX_VIEW, NOTE]);
  const injected = await wire(page);
  await page.goto("/");

  const column = page.locator('.col[data-col="doc_view_inbox"]');
  await column.locator(`.row[data-row-doc="${NOTE.id}"]`).click();
  await page.locator(`.reader[data-reader-doc="${NOTE.id}"]`).waitFor();

  // A save that lands: this is what opens the session on the server.
  await page.locator(".reader .ProseMirror").click();
  // `End` before the surface has focus is a no-op that lands the sentence in the
  // middle of the body instead of at the end — see `soft-wrap.spec.ts`'s
  // `caretIn`. Waiting on the condition, not on a duration.
  await expect(page.locator(".reader .ProseMirror")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" A landed sentence.");
  await expect
    .poll(async () => (await corpus.doc(NOTE.id))?.body ?? "")
    .toContain("A landed sentence.");
  expect(injected.flushes()).toBe(0);

  // The last sentence, typed inside the debounce window — and the reader closed
  // on top of it, with the save it triggers refused.
  injected.failNextSave();
  await page.keyboard.type(" The last sentence.");
  await column.getByRole("button", { name: "‹ Inbox" }).click();

  // The teardown flush went out and was refused; the close path still ends the
  // session, over the range that actually committed.
  await expect.poll(() => injected.saves()).toBe(2);
  await expect.poll(() => injected.flushes()).toBe(1);

  // Past the window an orphaned retry would have fired in.
  await page.waitForTimeout(PAST_THE_RETRY_MS);
  expect(injected.flushes(), "one sitting, one acknowledgment").toBe(1);
  expect(injected.saves(), "a third PUT means a retry outlived its surface").toBe(2);
  // And the refused text never reached the corpus, which is what the
  // acknowledgment's range is entitled to say.
  expect(await corpus.doc(NOTE.id)).toBeDefined();
  expect((await corpus.doc(NOTE.id))?.body).not.toContain("The last sentence.");
});
