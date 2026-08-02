/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateRow } from "./CreateRow";
import { SearchResults } from "./SearchResults";
import { hitFixture } from "./searchTransport";

afterEach(cleanup);

const HITS = [
  hitFixture({
    id: "doc_mortgage",
    title: "Mortgage options",
    headingPath: "Mortgage options › Rate assumptions",
    snippet: "the base case assumes a 30-year fixed; the mortgage insurance question",
  }),
  hitFixture({ id: "doc_payoff", title: "Payoff maths", headingPath: "Payoff maths" }),
  hitFixture({
    id: "doc_criteria",
    title: "House criteria",
    headingPath: "House criteria › Musts",
  }),
  hitFixture({
    id: "th_rate",
    title: "Rate assumption",
    headingPath: "user · 2026-07-19T10:05:00Z",
    snippet: "is 6.1% the right base case?",
  }),
  hitFixture({ id: "th_rent", title: "Rent vs buy", headingPath: "agent · 2026-07-19T10:07:12Z" }),
];

function renderResults(overrides: Partial<Parameters<typeof SearchResults>[0]> = {}) {
  const onOpen = vi.fn();
  const onCreate = vi.fn();
  const view = render(
    <SearchResults
      hits={HITS}
      query="mortgage"
      offersCreate={false}
      cursor={-1}
      isPending={false}
      isIdle={false}
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

  it("renders exactly the ranking it was handed — no filtering, no re-sorting", () => {
    const { container } = renderResults();
    expect(
      [...container.querySelectorAll<HTMLElement>(".sr[data-sr]")].map(
        (node) => node.dataset["sr"],
      ),
    ).toEqual(["doc_mortgage", "doc_payoff", "doc_criteria", "th_rate", "th_rent"]);
  });

  it("gives each row a kind glyph, a serif title, its snippet and the passage's address", () => {
    const { container } = renderResults();
    const row = container.querySelector<HTMLElement>(".sr[data-sr='doc_mortgage']");
    expect(row?.querySelector(".type-glyph")?.textContent).toBe("doc");
    expect(row?.querySelector(".sr-title")?.textContent).toContain("Mortgage options");
    expect(row?.querySelector(".sr-snippet mark")?.textContent).toBe("mortgage");
    expect(row?.querySelector(".sr-path")?.textContent).toBe("Mortgage options › Rate assumptions");

    const thread = container.querySelector<HTMLElement>(".sr[data-sr='th_rate']");
    expect(thread?.querySelector(".type-glyph")?.textContent).toBe("thread");
    expect(thread?.querySelector(".sr-path")?.textContent).toBe("user · 2026-07-19T10:05:00Z");
  });

  it("gives every row an address — the contract never sends an empty one", () => {
    const { container } = renderResults();
    const paths = [...container.querySelectorAll(".sr-path")].map((node) => node.textContent);
    expect(paths.length).toBe(HITS.length);
    expect(paths.every((path) => path !== "")).toBe(true);
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

  it("opens the hit that was clicked", async () => {
    const user = userEvent.setup();
    const { container, onOpen } = renderResults();
    await user.click(container.querySelector<HTMLElement>(".sr[data-sr='doc_payoff']")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: "doc_payoff" });
  });

  it("distinguishes an unasked search from an empty one, and both from a failure", () => {
    const { container } = renderResults({ hits: [], isIdle: true });
    expect(container.querySelector(".sr-empty")?.textContent).toBe(
      "Type to search — documents, threads and turns, ranked.",
    );

    cleanup();
    const empty = renderResults({ hits: [] });
    expect(empty.container.querySelector(".sr-empty")?.textContent).toBe(
      "Nothing matches this search yet.",
    );

    cleanup();
    const pending = renderResults({ hits: [], isPending: true });
    expect(pending.container.querySelector(".sr-empty")?.textContent).toBe("Searching…");

    cleanup();
    renderResults({ hits: [], error: new Error("no such filter") });
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
    expect(row?.querySelectorAll("b").length).toBe(1);
  });
});
