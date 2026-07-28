/** @vitest-environment jsdom */
import { docRowFixture } from "@corpus/kit/testing";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateRow } from "./CreateRow";
import { SearchResults } from "./SearchResults";

afterEach(cleanup);

const ITEMS = [
  docRowFixture({
    id: "doc_mortgage",
    title: "Mortgage options",
    path: "data/docs/finance/housing/mortgage.md",
    snippets: [
      {
        field: "body",
        segments: [
          { text: "…the ", match: false },
          { text: "mortgage", match: true },
          { text: " insurance question…", match: false },
        ],
      },
    ],
  }),
  docRowFixture({ id: "doc_payoff", title: "Payoff maths" }),
  docRowFixture({ id: "doc_criteria", title: "House criteria" }),
  docRowFixture({
    id: "th_rate",
    type: "thread",
    title: "Rate assumption",
    path: "data/threads/th_rate.md",
    parent: "doc_mortgage",
    parentTitle: "Mortgage options",
    turnCount: 4,
  }),
  docRowFixture({
    id: "th_rent",
    type: "thread",
    title: "Rent vs buy",
    path: "data/threads/th_rent.md",
    turnCount: 3,
  }),
];

function renderResults(overrides: Partial<Parameters<typeof SearchResults>[0]> = {}) {
  const onOpen = vi.fn();
  const onCreate = vi.fn();
  const view = render(
    <SearchResults
      items={ITEMS}
      query="mortgage"
      offersCreate={false}
      cursor={-1}
      isPending={false}
      error={null}
      onOpen={onOpen}
      onCreate={onCreate}
      {...overrides}
    />,
  );
  return { ...view, onOpen, onCreate };
}

describe("SearchResults", () => {
  it("renders the prototype's group headers with their counts", () => {
    const { container } = renderResults();
    expect([...container.querySelectorAll(".sr-group")].map((node) => node.textContent)).toEqual([
      "Documents · 3",
      "Threads · 2",
    ]);
  });

  it("renders exactly the rows it was handed — no filtering, no re-sorting", () => {
    const { container } = renderResults();
    expect(
      [...container.querySelectorAll<HTMLElement>(".sr[data-sr]")].map(
        (node) => node.dataset["sr"],
      ),
    ).toEqual(["doc_mortgage", "doc_payoff", "doc_criteria", "th_rate", "th_rent"]);
  });

  it("gives each row a type glyph, a serif title, its snippet and a mono path", () => {
    const { container } = renderResults();
    const row = container.querySelector<HTMLElement>(".sr[data-sr='doc_mortgage']");
    expect(row?.querySelector(".type-glyph")?.textContent).toBe("note");
    expect(row?.querySelector(".sr-title")?.textContent).toContain("Mortgage options");
    expect(row?.querySelector(".sr-snippet mark")?.textContent).toBe("mortgage");
    expect(row?.querySelector(".sr-path")?.textContent).toContain("finance/housing/");

    const thread = container.querySelector<HTMLElement>(".sr[data-sr='th_rate']");
    expect(thread?.querySelector(".sr-path")?.textContent).toBe("on Mortgage options · open");
  });

  it("renders no snippet element for a row the query did not highlight", () => {
    const { container } = renderResults();
    const row = container.querySelector<HTMLElement>(".sr[data-sr='doc_payoff']");
    expect(row?.querySelector(".sr-snippet")).toBeNull();
  });

  it("marks exactly one row with the keyboard cursor", () => {
    const { container } = renderResults({ cursor: 3 });
    const lit = container.querySelectorAll(".sr.kbd");
    expect(lit.length).toBe(1);
    expect((lit[0] as HTMLElement).dataset["sr"]).toBe("th_rate");
  });

  it("counts the create row as position zero of the cursor", () => {
    const { container } = renderResults({ offersCreate: true, cursor: 0 });
    expect(container.querySelectorAll(".sr.kbd").length).toBe(1);
    expect(container.querySelector(".sr.kbd")?.classList.contains("sr-create")).toBe(true);

    cleanup();
    const shifted = renderResults({ offersCreate: true, cursor: 1 });
    expect((shifted.container.querySelector(".sr.kbd") as HTMLElement).dataset["sr"]).toBe(
      "doc_mortgage",
    );
  });

  it("opens the row that was clicked", async () => {
    const user = userEvent.setup();
    const { container, onOpen } = renderResults();
    await user.click(container.querySelector<HTMLElement>(".sr[data-sr='doc_payoff']")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: "doc_payoff" });
  });

  it("says so when a search comes back empty, and when it fails", () => {
    const { container } = renderResults({ items: [] });
    expect(container.querySelector(".sr-empty")?.textContent).toBe(
      "Nothing matches this search yet.",
    );

    cleanup();
    renderResults({ items: [], error: new Error("no such filter") });
    expect(screen.getByRole("alert").textContent).toContain("no such filter");
  });
});

describe("CreateRow", () => {
  it("reads exactly as the prototype writes it, with the query in a serif bold", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const { container } = render(
      <CreateRow query="new thought" isCursor={false} onActivate={onActivate} />,
    );
    const row = container.querySelector<HTMLElement>(".sr-create");
    expect(row?.textContent).toBe('＋ Create "new thought" — opens ready to edit, in inbox/');
    expect(row?.querySelector("b")?.textContent).toBe("new thought");

    await user.click(row!);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("renders a query that looks like markup as text", () => {
    const { container } = render(
      <CreateRow query="<b>bold</b>" isCursor={false} onActivate={vi.fn()} />,
    );
    const row = container.querySelector<HTMLElement>(".sr-create");
    expect(row?.textContent).toContain("<b>bold</b>");
    // One `<b>` — the prototype's serif wrapper — and no injected second one.
    expect(row?.querySelectorAll("b").length).toBe(1);
  });
});
