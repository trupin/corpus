/** @vitest-environment jsdom */
import type { WorkspaceVocabulary } from "@corpus/contract";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

/**
 * The chip row needs a corpus client now: the `tag:` vocabulary comes from
 * `GET /api/vocabulary` (CONTRACT-092), which is the only source there has ever
 * been for it — a ranked hit deliberately carries no tags.
 *
 * `vocabulary: null` answers the read with a `500`, which is how the "the read
 * failed" state is driven honestly rather than asserted about.
 */
function renderChips(
  query: Partial<SearchQuery> = {},
  vocabulary: WorkspaceVocabulary | null = { tags: [], extraKeys: [] },
) {
  const onChange = vi.fn();
  const fetch = ((input: RequestInfo | URL) => {
    const url = new URL(new Request(input).url);
    if (url.pathname === "/api/vocabulary" && vocabulary !== null) {
      return Promise.resolve(
        new Response(JSON.stringify(vocabulary), {
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ code: "internal_error", message: "no" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;

  const harness = createCorpusTestHarness({ fetch });
  const view = render(
    <harness.Wrapper>
      <FilterChips
        query={{ ...EMPTY_SEARCH_QUERY, ...query }}
        onChange={onChange}
        tree={{ folders: [] }}
        hits={HITS}
      />
    </harness.Wrapper>,
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

/**
 * CONTRACT-026, closed at last. The chip could display and clear a tag and
 * never offer one, because `SearchHit` carries no tags — the defect UI-026's
 * eval recorded as FAIL-1. `filters.ts` said what would fix it: "the day this
 * function returns real tags, the chip becomes a normal cycling chip again with
 * no other edit", and `tagChipState` needed none.
 */
describe("the tag chip with a workspace vocabulary", () => {
  const VOCABULARY: WorkspaceVocabulary = {
    tags: [
      { value: "irrigation", count: 4 },
      { value: "greenhouse", count: 1 },
    ],
    extraKeys: [],
  };

  it("becomes an ordinary cycling chip, with no explanation to give", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips({}, VOCABULARY);

    await waitFor(() => {
      expect(tagChip().disabled).toBe(false);
    });
    // No title: the two apologetic states exist because the chip cannot do its
    // job, and it can now.
    expect(tagChip().getAttribute("title")).toBeNull();

    await user.click(tagChip());
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_QUERY, tag: "irrigation" });
  });

  it("cycles in the order the server gave, most-used first", async () => {
    const user = userEvent.setup();
    const { onChange } = renderChips({ tag: "irrigation" }, VOCABULARY);

    await waitFor(() => {
      expect(tagChip().disabled).toBe(false);
    });
    await user.click(tagChip());
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SEARCH_QUERY, tag: "greenhouse" });
  });

  it("stays disabled when the read fails, rather than breaking the row", async () => {
    renderChips({}, null);
    await waitFor(() => {
      expect(tagChip().disabled).toBe(true);
    });
    // Every other chip is unaffected: the vocabulary is a hint, not a gate.
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "type: any" }).disabled).toBe(
      false,
    );
  });
});
