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
 * For a while it could not reproduce at all: SHARED-072's navigation rework
 * made a link followed inside full screen close the overlay rather than push
 * onto a stack, so the focus stack never gained depth and the back control
 * never earned its place. This file was kept against exactly the change that
 * then happened — UI-199 gave the overlay its stack back (a link followed
 * inside full screen continues the excursion there; full screen stays), so
 * `showsBack`'s depth-0 rule is live again and this is what holds it: at the
 * bottom of the stack the header carries the ✕ alone, never a back chevron
 * that would be a second close. Depth's own back button is covered in
 * `focus-stays.spec.ts`.
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
