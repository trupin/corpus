import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * **Focus mode offers one way out, not two** (UI-100, reported 2026-08-08).
 *
 * The report was a `✕ Close` sitting beside a `‹ <title>` chevron — two controls
 * that read as the same action. `ReaderHead`'s `showsBack` has always said
 * otherwise, and its unit tests have always agreed; what nothing asserted was
 * the **rendered header**, which is where the person was looking.
 *
 * It no longer reproduces: SHARED-072's navigation rework made a link followed
 * inside full screen close the overlay rather than push onto a stack, so the
 * focus stack never gains depth and the back control never earns its place. That
 * is a fix by consequence, and a fix by consequence is exactly the kind that
 * comes back — the next feature to give focus mode a stack of its own would
 * restore the symptom with every unit test still green. Hence this file.
 */

const VIEW: StubRow = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

const ALPHA: StubRow = {
  id: "doc_alpha",
  title: "Alpha note",
  path: "data/docs/inbox/alpha.md",
  body: "See [[doc_beta]] for more.\n",
};

const BETA: StubRow = {
  id: "doc_beta",
  title: "Beta note",
  path: "data/docs/inbox/beta.md",
  body: "Beta body.\n",
};

/** Controls in a head that leave where they are: the ✕ and any back chevron. */
const EXITS = ".focus .reader-head .back, .focus .focus-head .back";

test("the focus header carries exactly one control that leaves it", async ({ page }) => {
  await stubCorpus(page, [VIEW, ALPHA, BETA]);
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator('.row[data-row-doc="doc_alpha"]').click();
  await page.locator(".reader .ProseMirror").waitFor();

  await page.keyboard.press("f");
  await page.locator(".focus.open").waitFor();

  await expect(page.locator(EXITS)).toHaveCount(1);
  await expect(page.locator(EXITS)).toHaveText("✕ Close");

  // And it is not named after the document already open, which is what made the
  // two controls read alike in the report.
  await expect(page.locator(EXITS)).not.toContainText("Alpha note");
});
