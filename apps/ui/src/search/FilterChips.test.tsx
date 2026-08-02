/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";
import { EMPTY_SEARCH_QUERY, type SearchQuery } from "./searchQuery";
import { hitFixture } from "./searchTransport";

/**
 * The chip row on its own, because one of its states is not reachable from the
 * overlay: the overlay always opens on {@link EMPTY_SEARCH_QUERY}, so a query
 * that already carries a `tag` only arrives through props (a restored view
 * query). The state exists and must keep working, so it is tested where it can
 * be driven honestly rather than asserted about.
 */

afterEach(cleanup);

const HITS = [hitFixture({ id: "doc_a", title: "Greenhouse plan" })];

function renderChips(query: Partial<SearchQuery> = {}) {
  const onChange = vi.fn();
  const view = render(
    <FilterChips
      query={{ ...EMPTY_SEARCH_QUERY, ...query }}
      onChange={onChange}
      tree={{ folders: [] }}
      hits={HITS}
    />,
  );
  return { ...view, onChange };
}

const tagChip = (): HTMLButtonElement => screen.getByRole("button", { name: /^tag: / });

describe("the tag chip with no vocabulary to offer", () => {
  it("renders disabled, and says why in a sentence about the search", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();
    const chip = tagChip();

    expect(chip.textContent).toBe("tag: any");
    expect(chip.disabled).toBe(true);
    expect(chip.getAttribute("title")).toBe(
      "Search results do not carry tags yet, so there is nothing to filter by.",
    );
    // The reason travels in the accessible name too: a disabled button is out of
    // the tab order, so the tooltip alone would never reach a screen reader.
    expect(chip.getAttribute("aria-label")).toBe(
      "tag: any — Search results do not carry tags yet, so there is nothing to filter by.",
    );

    await user.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names neither the endpoint nor the issue tracker", () => {
    renderChips();
    const title = tagChip().getAttribute("title") ?? "";
    for (const leak of ["SearchHit", "/api/search", "CONTRACT-", "SPEC.md", "contract", "#"]) {
      expect(title).not.toContain(leak);
    }
  });

  it("is the only disabled chip in the row", () => {
    const { container } = renderChips();
    const disabled = [...container.querySelectorAll(".search-filters .chip:disabled")].map(
      (node) => node.textContent,
    );
    expect(disabled).toEqual(["tag: any"]);
  });

  it("leaves every other chip cycling", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips();
    await user.click(screen.getByRole("button", { name: "type: any" }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_QUERY, type: "note" });
  });
});

describe("the tag chip with a tag already in the query", () => {
  it("shows the tag, stays live, and clears it on a click", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips({ tag: "irrigation" });
    const chip = tagChip();

    expect(chip.textContent).toBe("tag: irrigation");
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.getAttribute("title")).toBe(
      "Clears the tag — it cannot be applied again here yet.",
    );

    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_QUERY, tag: null });
  });
});
