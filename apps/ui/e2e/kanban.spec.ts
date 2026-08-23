import type { JSHandle } from "@playwright/test";
import { expect, test } from "./coverage";
import { stubCorpus, type StubRow } from "./stubCorpus";

/**
 * Kanban boards, in a real browser (UI-152; SPEC.md §10, rider 6).
 *
 * Three things are proved here and nowhere else.
 *
 * **The columns are derived.** No view document exists for any of them: the
 * board document names a field and its stages, and one column per stage appears,
 * each issuing the query the derivation computed — including the first column's
 * single `stage=,<first>` request, which is what makes "the unstaged sit in the
 * first column" one round trip rather than two responses ORed in the client.
 *
 * **The drag restriction is the client's alone.** The server enforces the status
 * map and never the transitions (SERVER-138 answers a stage off the graph with a
 * `200`), so a refused drop is refused because this app refused it. The test for
 * it therefore asserts that **nothing reached the wire**, not merely that a toast
 * appeared: a refusal that still wrote would satisfy the toast and fail here.
 *
 * **The coupling is the server's alone.** A drag sends `stage` and nothing else,
 * and the status the board's `kanban.status` map decides comes back in the
 * response — which is what the toast reads.
 */

/** The seed's kanban over `status` (AGENT-042): three stages, no `transitions`. */
const BY_STATUS: StubRow = {
  id: "doc_board_by_status",
  type: "board",
  title: "By status",
  path: "data/docs/boards/by-status.md",
  order: 1,
  defaultOpen: true,
  kanban: { field: "status", stages: ["open", "resolved", "archived"] },
  query: { type: "note" },
};

/** A kanban over `stage`, with a written graph and a status map. */
const HOUSE: StubRow = {
  id: "doc_board_house",
  type: "board",
  title: "House hunt",
  path: "data/docs/boards/house.md",
  order: 2,
  kanban: {
    field: "stage",
    stages: ["candidates", "visiting", "offer", "done"],
    transitions: {
      candidates: ["visiting"],
      visiting: ["offer", "candidates"],
      offer: ["done"],
      done: [],
    },
    status: { done: "resolved" },
  },
  query: { folder: "housing" },
};

const UNSTAGED: StubRow = {
  id: "doc_maple",
  title: "Maple Street",
  path: "data/docs/housing/maple.md",
  body: "Two bedrooms.\n",
};

const VISITING: StubRow = {
  id: "doc_oak",
  title: "Oak Lane",
  path: "data/docs/housing/oak.md",
  stage: "visiting",
  body: "Viewing on Tuesday.\n",
};

const OFFER: StubRow = {
  id: "doc_elm",
  title: "Elm Court",
  path: "data/docs/housing/elm.md",
  stage: "offer",
  body: "Offer in.\n",
};

const OUTSIDE: StubRow = {
  id: "doc_tax",
  title: "Tax return",
  path: "data/docs/finance/tax.md",
  body: "Due in April.\n",
};

const SEED = [BY_STATUS, HOUSE, UNSTAGED, VISITING, OFFER, OUTSIDE];

const column = (board: string, stage: string): string => `.col[data-col="${board}#${stage}"]`;
const houseCol = (stage: string): string => column("doc_board_house", stage);

/** Shows the House hunt board and waits for its stages to be drawn. */
async function showHouse(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('.boardbar .board-tab[data-board="doc_board_house"]').click();
  await expect(page.locator(`${houseCol("candidates")} .col-title`)).toHaveText("candidates");
}

/** A live `DataTransfer`, so the drag events reach the app's real handlers. */
async function transfer(page: import("@playwright/test").Page): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(() => new DataTransfer());
}

test.describe("a kanban's columns are its stages", () => {
  test("derives one column per stage of the seed board, resolving no view document", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));

    const stub = await stubCorpus(page, SEED);
    await page.goto("/");

    await expect(page.locator(".board .col.qcol .col-title")).toHaveText([
      "open",
      "resolved",
      "archived",
    ]);
    await expect(page.locator(".board .col.qcol .col-kind").first()).toHaveText("stage");
    await expect(page.locator(column("doc_board_by_status", "open"))).toBeVisible();

    // The scope is the board's `query`, and the column's own value is the field.
    const reads = await stub.of("GET", "/api/docs");
    const searches = reads.map((call) => call.search);
    expect(searches.some((search) => search.includes("status=open"))).toBe(true);
    expect(searches.some((search) => search.includes("status=archived"))).toBe(true);
    // A `status` kanban needs no null sentinel — every document has a status.
    expect(searches.some((search) => search.includes("stage=,"))).toBe(false);

    // The tab says what it is, and the bar says what a drag does here.
    await expect(
      page.locator('.boardbar .board-tab[data-board="doc_board_by_status"] .tag').first(),
    ).toHaveText("kanban");
    await expect(page.locator(".boardbar .board-hint")).toContainText("kanban over status");
    await expect(page.locator(".boardbar .board-hint")).toContainText(
      "a drag moves one stage left or right",
    );
    expect(uncaught).toEqual([]);
  });

  test("holds the unstaged in the first column, in ONE request", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    // Maple Street carries no stage at all; Oak Lane is in `visiting`.
    await expect(
      page.locator(`${houseCol("candidates")} .row[data-row-doc="doc_maple"]`),
    ).toBeVisible();
    await expect(
      page.locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`),
    ).toBeVisible();
    // …and the document outside the scope is on no column of this board.
    await expect(page.locator('.board .row[data-row-doc="doc_tax"]')).toHaveCount(0);

    /*
     * The first column is `folder=housing&stage=,candidates` and nothing else:
     * one request for the first stage *and* the unstaged, which is what the
     * empty element in the comma-separated list buys (CONTRACT-074).
     */
    const searches = (await stub.of("GET", "/api/docs")).map((call) => call.search);
    expect(
      searches.filter((search) => search === "?folder=housing&stage=%2Ccandidates"),
    ).toHaveLength(1);
    // The other column asks for its stage alone, with no sentinel.
    expect(searches).toContain("?folder=housing&stage=visiting");
  });

  test("draws the field chip, the sentinel note, the status map and the edges", async ({
    page,
  }) => {
    await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    await expect(page.locator(`${houseCol("candidates")} .chips > .chip`)).toHaveText([
      "folder: housing/",
      "stage: candidates",
      "or no stage",
      "→ visiting",
    ]);
    await expect(page.locator(`${houseCol("done")} .chips > .chip`)).toHaveText([
      "folder: housing/",
      "stage: done",
      "→ resolved",
      "→ ∅",
    ]);
    await expect(page.locator(`${houseCol("done")} .chips > .chip.good`)).toHaveText("→ resolved");
  });

  test("counts what is in scope and in no column, so nothing vanishes silently", async ({
    page,
  }) => {
    const stray: StubRow = {
      id: "doc_birch",
      title: "Birch Row",
      path: "data/docs/housing/birch.md",
      // A stage this board does not draw: in scope, and in none of its columns.
      stage: "gazumped",
    };
    await stubCorpus(page, [...SEED, stray]);
    await page.goto("/");
    await showHouse(page);

    await expect(page.locator('.board .row[data-row-doc="doc_birch"]')).toHaveCount(0);
    await expect(page.locator(".boardbar .board-hint")).toContainText(
      "1 document in scope with a stage this board does not list",
    );
  });
});

test.describe("a drag follows the transition graph", () => {
  test("lights what the graph reaches and dims what it does not", async ({ page }) => {
    await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    const data = await transfer(page);
    await page
      .locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`)
      .dispatchEvent("dragstart", { dataTransfer: data });

    // visiting → offer and visiting → candidates are drawn; visiting → done is not.
    await expect(page.locator(houseCol("offer"))).toHaveClass(/\bcan-drop\b/);
    await expect(page.locator(houseCol("candidates"))).toHaveClass(/\bcan-drop\b/);
    await expect(page.locator(houseCol("done"))).toHaveClass(/\bno-drop\b/);
    // The column the row came from is neither a target nor a refusal.
    await expect(page.locator(houseCol("visiting"))).not.toHaveClass(/\b(can|no)-drop\b/);

    // The column under the pointer says which of the two it is.
    await page.locator(houseCol("done")).dispatchEvent("dragover", { dataTransfer: data });
    await expect(page.locator(houseCol("done"))).toHaveClass(/\bdrop-bad\b/);
    await page.locator(houseCol("offer")).dispatchEvent("dragover", { dataTransfer: data });
    await expect(page.locator(houseCol("offer"))).toHaveClass(/\bdrop-over\b/);

    await page
      .locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`)
      .dispatchEvent("dragend");
    await expect(page.locator(houseCol("done"))).not.toHaveClass(/\bno-drop\b/);
  });

  test("REFUSES a drop off the graph, and writes nothing at all", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    const data = await transfer(page);
    const row = page.locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`);
    await row.dispatchEvent("dragstart", { dataTransfer: data });
    await page.locator(houseCol("done")).dispatchEvent("drop", { dataTransfer: data });

    await expect(page.locator(".toast")).toContainText(
      "“visiting” does not lead to “done” on this board.",
    );
    await expect(page.locator(".toast")).toContainText("Set stage in the document to override");

    /*
     * The claim this test exists for. The server does not enforce transitions,
     * so the only thing standing between this gesture and a written `stage` is
     * the app's own rule — and a test that stopped at the toast would pass with
     * that rule deleted.
     */
    expect(await stub.of("PUT")).toHaveLength(0);
    expect((await stub.doc("doc_oak"))?.stage).toBe("visiting");
    // The card did not move either.
    await expect(
      page.locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`),
    ).toBeVisible();
  });

  test("accepts a drop the graph draws, and reports BOTH fields the server wrote", async ({
    page,
  }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    const data = await transfer(page);
    await page
      .locator(`${houseCol("offer")} .row[data-row-doc="doc_elm"]`)
      .dispatchEvent("dragstart", { dataTransfer: data });
    await page.locator(houseCol("done")).dispatchEvent("drop", { dataTransfer: data });

    await expect(page.locator(".toast")).toContainText("Elm Court");
    await expect(page.locator(".toast")).toContainText("stage → done");
    await expect(page.locator(".toast")).toContainText("status → resolved");

    // One request, carrying `stage` and nothing else: the status is the
    // server's, decided by the board's `kanban.status` map (SPEC.md §5).
    const writes = await stub.of("PUT", "/api/docs/doc_elm");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ stage: "done" });

    const stored = await stub.doc("doc_elm");
    expect(stored?.stage).toBe("done");
    expect(stored?.status).toBe("resolved");

    await expect(page.locator(`${houseCol("done")} .row[data-row-doc="doc_elm"]`)).toBeVisible();
  });

  test("moves a card with the real pointer gesture too", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    await page
      .locator(`${houseCol("candidates")} .row[data-row-doc="doc_maple"]`)
      .dragTo(page.locator(`${houseCol("visiting")} .col-list`));

    await expect(
      page.locator(`${houseCol("visiting")} .row[data-row-doc="doc_maple"]`),
    ).toBeVisible();
    expect((await stub.doc("doc_maple"))?.stage).toBe("visiting");
  });

  test("does not make a view column's rows draggable at all", async ({ page }) => {
    const view: StubRow = {
      id: "doc_view_inbox",
      type: "view",
      title: "Inbox",
      path: "data/docs/views/inbox.md",
      query: { folder: "housing" },
    };
    const plain: StubRow = {
      id: "doc_board_plain",
      type: "board",
      title: "Plain",
      path: "data/docs/boards/plain.md",
      order: 1,
      defaultOpen: true,
      columns: ["doc_view_inbox"],
    };
    await stubCorpus(page, [plain, view, UNSTAGED]);
    await page.goto("/");

    await expect(
      page.locator('.col[data-col="doc_view_inbox"] .row[data-row-doc="doc_maple"]'),
    ).not.toHaveAttribute("draggable", "true");
  });
});

test.describe("setting the field is the way past the graph", () => {
  test("the reader's `stage ▾` skips two columns, and the toast names the coupled status", async ({
    page,
  }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    // Open Maple Street — unstaged, in the first column — in a path.
    await page.locator(`${houseCol("candidates")} .row[data-row-doc="doc_maple"]`).click();
    const reader = page.locator(".pcol .reader-scroll").first();
    await expect(reader.locator(".doc-title")).toHaveValue("Maple Street");

    // `candidates` does not lead to `done`, and this control does not care.
    await reader.locator('.fm-field[data-field="stage"] select').selectOption("done");

    await expect(page.locator(".toast")).toContainText("set status to `resolved`");
    await expect(page.locator(".toast")).toContainText("House hunt");

    const writes = await stub.of("PUT", "/api/docs/doc_maple");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ stage: "done" });
    expect((await stub.doc("doc_maple"))?.status).toBe("resolved");
  });

  test("offers every stage of the board that claims the document, plus a clear", async ({
    page,
  }) => {
    await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    await page.locator(`${houseCol("visiting")} .row[data-row-doc="doc_oak"]`).click();
    const select = page.locator('.pcol .fm-field[data-field="stage"] select').first();
    await expect(select.locator("optgroup")).toHaveAttribute("label", "House hunt");
    await expect(select.locator("option")).toHaveText([
      "Clear the stage",
      "candidates",
      "visiting",
      "offer",
      "done",
    ]);
  });
});

test.describe("the board document draws its own graph", () => {
  test("draws a node per stage, the mapped one outlined, and the explanation", async ({ page }) => {
    await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    // "Open the board document" from a stage column's ⋯.
    await page.locator(`${houseCol("offer")} .col-menu`).click();
    await page.getByRole("menuitem", { name: /Open the board document/ }).click();

    const reader = page.locator(".pcol .reader-scroll").first();
    await expect(reader.locator("svg.graph")).toBeVisible();
    await expect(reader.locator("svg.graph rect.node")).toHaveCount(4);
    await expect(reader.locator("svg.graph rect.node.mapped")).toHaveCount(1);
    await expect(reader.locator("svg.graph path.back")).toHaveCount(1);
    await expect(reader.locator(".kanban-explanation")).toContainText(
      "A drag follows the transitions drawn above and nothing else",
    );
    await expect(reader.locator(".kanban-explanation")).toContainText("writes");
  });

  test("a stage column's ⋯ edits the board, and never removes a column", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");
    await showHouse(page);

    await page.locator(`${houseCol("visiting")} .col-menu`).click();
    await expect(page.getByRole("menuitem", { name: /Remove from this board/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Edit query/ })).toHaveCount(0);
    await page.getByRole("menuitem", { name: /Move left/ }).click();

    await expect(page.locator(".board .col.qcol .col-title")).toHaveText([
      "visiting",
      "candidates",
      "offer",
      "done",
    ]);
    const writes = await stub.of("PUT", "/api/docs/doc_board_house");
    expect(writes).toHaveLength(1);
    expect((writes[0]?.body as { kanban: { stages: string[] } }).kanban.stages).toEqual([
      "visiting",
      "candidates",
      "offer",
      "done",
    ]);
  });
});

test.describe("creating a kanban", () => {
  test("`＋ → Kanban…` asks in a form and writes one board document", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");

    await page.locator(".boardbar .board-add").click();
    await page.getByRole("menuitem", { name: /Kanban/ }).click();

    const dialog = page.getByRole("dialog", { name: "New kanban board" });
    await dialog.getByLabel(/Board title/).fill("Tax season");
    await dialog.getByLabel(/Stages, in funnel order/).fill("gather, file, paid");
    await dialog.getByLabel(/Transitions/).fill("gather > file; file > paid, gather");
    await dialog.getByLabel(/Scope/).fill("folder:finance");
    await dialog.getByRole("button", { name: "Create the board" }).click();

    const created = await stub.of("POST", "/api/docs");
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({
      type: "board",
      title: "Tax season",
      kanban: {
        field: "stage",
        stages: ["gather", "file", "paid"],
        transitions: { gather: ["file"], file: ["paid", "gather"], paid: [] },
      },
      query: { folder: "finance" },
    });
  });

  test("`＋ → Empty board` still creates a board with no kanban at all", async ({ page }) => {
    const stub = await stubCorpus(page, SEED);
    await page.goto("/");

    await page.locator(".boardbar .board-add").click();
    await page.getByRole("menuitem", { name: /Empty board/ }).click();

    const created = await stub.of("POST", "/api/docs");
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({ type: "board", columns: [] });
    expect(Object.hasOwn(created[0]?.body as object, "kanban")).toBe(false);
  });
});
