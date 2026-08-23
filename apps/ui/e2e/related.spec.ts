import { expect, test } from "./coverage";
import { stubCorpus } from "./stubCorpus";

/**
 * UI-025's related panel, in a real browser.
 *
 * Like the rest of the suite this runs against the Vite dev server with **no**
 * workspace server behind it, so the corpus is served from inside the page (see
 * `stubCorpus.ts`). That is half the evidence, and the half a browser is good
 * for: the panel's presence in both hosts, its rows and their relation labels,
 * the click that pushes the navigation stack, and the absence — `null`, not an
 * empty box — when nothing is related. The other half, a real ranking computed
 * by a real server over a real `links` table and a real semantic index, is the
 * issue's real-app drill.
 *
 * The `similar` and `both` rows are seeded rather than derived, and deliberately
 * so: a browser stub holds no semantic index, and a spec that could only assert
 * `linked` would pin one third of a vocabulary whose whole point is that the UI
 * renders all of it without knowing which retrieval phase produced a row.
 */

const INBOX_VIEW = {
  id: "doc_view_inbox",
  type: "view",
  title: "Inbox",
  path: "data/docs/views/inbox.md",
  order: 1,
  query: { folder: "inbox" },
};

/** The open document: linked to `doc_rates`, and related to three things. */
const MORTGAGE = {
  id: "doc_mortgage",
  title: "Mortgage options",
  body: "Compare against [[doc_rates]] before deciding.",
  related: [
    { id: "doc_rates", relation: "linked" },
    { id: "doc_offers", relation: "similar" },
    { id: "doc_payoff", relation: "both" },
  ],
};

const RATES = { id: "doc_rates", title: "Rates", body: "6.4% this week." };
const OFFERS = { id: "doc_offers", title: "Lender offers", body: "Two lenders quoted." };
const PAYOFF = { id: "doc_payoff", title: "Payoff plan", body: "Fifteen years." };

/** Nothing links to it and nothing is seeded: the empty ranking. */
const LONELY = { id: "doc_lonely", title: "A lonely note", body: "Nobody has linked this." };

const CORPUS = [INBOX_VIEW, MORTGAGE, RATES, OFFERS, PAYOFF, LONELY];

async function openReader(page: import("@playwright/test").Page, docId: string): Promise<void> {
  await page.goto("/");
  await page.locator(".board").waitFor();
  await page.locator(`.row[data-row-doc="${docId}"]`).click();
  await expect(page.locator(`.reader[data-reader-doc="${docId}"] .doc-title`)).toBeVisible();
}

test.describe("the related panel", () => {
  test("renders the ranking with its relation labels, beside backlinks", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_mortgage");

    const panel = page.locator(".reader .related");
    await expect(panel).toBeVisible();
    await expect(panel.locator("h3")).toHaveText("Related");

    // The server's order, and the server's word for why — all three of them.
    await expect(panel.locator(".related-doc .ref")).toHaveText([
      "Rates",
      "Lender offers",
      "Payoff plan",
    ]);
    await expect(panel.locator(".related-doc .relation")).toHaveText(["linked", "similar", "both"]);
  });

  /**
   * Beside "Referenced by", not instead of it. `doc_rates` is referenced by the
   * mortgage note *and* related to it, so it is the one document in this corpus
   * that shows the pair — which is the arrangement SPEC.md §10 describes and the
   * one a single-panel implementation would pass every other test without.
   */
  test("sits beside the backlinks panel, both below the body", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_rates");

    await expect(page.locator(".reader .backlinks h3")).toHaveText("Referenced by");
    await expect(page.locator(".reader .backlinks .ref")).toHaveText("Mortgage options");
    await expect(page.locator(".reader .related h3")).toHaveText("Related");
    // Derived from the ref graph, since nothing was seeded for this document.
    await expect(page.locator(".reader .related .ref")).toHaveText("Mortgage options");
    await expect(page.locator(".reader .related .relation")).toHaveText("linked");

    /*
     * In that order, as siblings below the body. They sit inside
     * `.doc-body-slot` (UI-063), the document half's wrapper, which is
     * `display: contents` — invisible to layout, and a real element the walk
     * has to step into.
     */
    const order = await page
      .locator(".reader .doc-main .doc-body-slot")
      .evaluate((half) =>
        [...half.children]
          .map((child) => child.className)
          .filter((name) => name === "backlinks" || name === "related"),
      );
    expect(order).toEqual(["backlinks", "related"]);
  });

  test("a row pushes the navigation stack, and Back returns", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_mortgage");

    // A `similar` row, so the click path is exercised on a relation the
    // reference graph could never have produced.
    await page.locator('.reader .related [data-related="doc_offers"]').click();
    await expect(page.locator(".reader .doc-title")).toHaveValue("Lender offers");

    const back = page.locator(".reader .back");
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator(".reader .doc-title")).toHaveValue("Mortgage options");
  });

  test("renders nothing at all when nothing is related", async ({ page }) => {
    const corpus = await stubCorpus(page, CORPUS);
    await openReader(page, "doc_lonely");

    // The request was made and answered empty; the absence is the answer.
    await expect
      .poll(async () => (await corpus.of("GET", "/api/docs/doc_lonely/related")).length)
      .toBe(1);
    await expect(page.locator(".reader .related")).toHaveCount(0);
    await expect(page.getByText("Related", { exact: true })).toHaveCount(0);
  });

  test("is present in focus mode, at focus mode's measure", async ({ page }) => {
    await stubCorpus(page, CORPUS);
    await openReader(page, "doc_mortgage");

    await page.locator('.reader[data-reader-doc="doc_mortgage"] [data-expand]').click();
    await expect(page.locator(".focus.open")).toHaveCount(1);
    const panel = page.locator(".focus .related");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".related-doc")).toHaveCount(3);

    // One mount, two hosts: focus mode renders over the column reader, and the
    // panel must not appear twice inside the overlay.
    await expect(page.locator(".focus .related")).toHaveCount(1);

    // TEST-1016: the pair is measured together, and focus mode restyles the
    // measure. A panel left off `FocusMode.css`'s list would be 62ch here.
    const measures = await panel.evaluate((node) => {
      const backlinks = document.querySelector(".focus .backlinks");
      return {
        related: getComputedStyle(node).maxWidth,
        backlinks: backlinks === null ? null : getComputedStyle(backlinks).maxWidth,
      };
    });
    expect(measures.related).not.toBe("none");
    if (measures.backlinks !== null) expect(measures.related).toBe(measures.backlinks);
  });
});
