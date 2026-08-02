import { describe, expect, it } from "vitest";
import {
  activeChipCount,
  AGENT_OPTIONS,
  cycle,
  documentChoices,
  DUE_OPTIONS,
  folderOptions,
  sinceInstant,
  sinceLabel,
  STATUS_OPTIONS,
  tagChipState,
  tagOptions,
  titleOf,
  TYPE_OPTIONS,
} from "./filters";
import { EMPTY_SEARCH_QUERY } from "./searchQuery";
import { hitFixture } from "./searchTransport";

const NOW = new Date("2026-07-27T09:00:00.000Z");

describe("cycle", () => {
  it("starts at `any` and returns to it", () => {
    expect(STATUS_OPTIONS[0]).toBeNull();
    expect(cycle(STATUS_OPTIONS, null)).toBe("open");
    expect(cycle(STATUS_OPTIONS, "open")).toBe("resolved");
    expect(cycle(STATUS_OPTIONS, "archived")).toBeNull();
  });

  it("restarts at `any` for a value the chip does not offer", () => {
    // A view document hand-edited to `type: skill,agent-def` should not strand
    // the chip: one click returns it to a value the row can express.
    expect(cycle(TYPE_OPTIONS, "skill,agent-def")).toBeNull();
  });

  it("covers the contract's own vocabularies", () => {
    expect(DUE_OPTIONS).toContain("overdue");
    expect(AGENT_OPTIONS).toContain("engaged");
  });
});

describe("the `updated` window", () => {
  it("stores the instant, not the window, so a saved view keeps meaning", () => {
    expect(sinceInstant("7d", NOW)).toBe("2026-07-20T09:00:00.000Z");
    expect(sinceInstant("24h", NOW)).toBe("2026-07-26T09:00:00.000Z");
  });

  it("has no instant for a window it does not offer", () => {
    expect(sinceInstant("everything", NOW)).toBeNull();
  });

  it("reads an instant back as the window nearest to it", () => {
    expect(sinceLabel("2026-07-20T09:00:00.000Z", NOW)).toBe("7d");
    expect(sinceLabel("2026-06-27T09:00:00.000Z", NOW)).toBe("30d");
    expect(sinceLabel(null, NOW)).toBeNull();
  });

  it("shows an unparseable stored value verbatim rather than guessing", () => {
    expect(sinceLabel("last tuesday", NOW)).toBe("last tuesday");
  });
});

describe("folderOptions", () => {
  it("offers the workspace's real folders, `any` first", () => {
    expect(
      folderOptions({
        folders: [
          {
            path: "finance",
            name: "finance",
            count: 1,
            totalCount: 2,
            children: [
              { path: "finance/housing", name: "housing", count: 1, totalCount: 1, children: [] },
            ],
          },
        ],
      }),
    ).toEqual([null, "finance", "finance/housing"]);
  });

  it("is just `any` before the tree has answered", () => {
    expect(folderOptions(undefined)).toEqual([null]);
  });
});

describe("tagOptions", () => {
  /**
   * A ranked hit is an id, a title, a heading path and a snippet — no `tags`.
   * The chip stays in the row and still clears a tag, but it has nothing to
   * offer, and saying so in a test is how the gap stops being a mystery.
   */
  it("is just `any`, because a hit carries no tags to collect", () => {
    expect(tagOptions()).toEqual([null]);
  });

  it("clears a tag rather than stranding it", () => {
    expect(cycle(tagOptions(), "finance")).toBeNull();
    expect(cycle(tagOptions(), null)).toBeNull();
  });
});

describe("tagChipState", () => {
  /**
   * The chip's three honest positions. With no vocabulary and nothing set there
   * is nothing a click could do, and a control that renders as an affordance and
   * swallows the click is the defect this replaces (UI-026 eval FAIL-1).
   */
  it("is unavailable when there is nothing to offer and nothing set", () => {
    expect(tagChipState(null)).toBe("unavailable");
  });

  it("still clears a tag the query already carries", () => {
    expect(tagChipState("irrigation")).toBe("clears");
  });

  it("becomes an ordinary cycling chip the moment a vocabulary exists", () => {
    // CONTRACT-026's restoration is one changed return value away: this reads
    // the vocabulary, so nothing else here has to change with it.
    expect(tagChipState(null, [null, "garden"])).toBe("cycles");
    expect(tagChipState("garden", [null, "garden"])).toBe("cycles");
  });
});

describe("the document pickers", () => {
  const hits = [
    hitFixture({ id: "doc_a", title: "Mortgage options" }),
    hitFixture({ id: "th_a", title: "A thread" }),
  ];

  it("offers documents to point at, never threads", () => {
    expect(documentChoices(hits)).toEqual([{ id: "doc_a", title: "Mortgage options" }]);
  });

  it("names a chosen document by its title", () => {
    expect(titleOf(hits, "doc_a")).toBe("Mortgage options");
    expect(titleOf(hits, null)).toBeNull();
  });

  it("falls back to the id for a document no longer in the ranking", () => {
    expect(titleOf(hits, "doc_gone")).toBe("doc_gone");
  });
});

describe("activeChipCount", () => {
  it("counts every narrowing chip, toggles included", () => {
    expect(activeChipCount(EMPTY_SEARCH_QUERY)).toBe(0);
    expect(
      activeChipCount({
        ...EMPTY_SEARCH_QUERY,
        folder: "finance",
        unread: true,
        includeArchived: true,
      }),
    ).toBe(3);
  });

  it("does not count the search text — that is not a chip", () => {
    expect(activeChipCount({ ...EMPTY_SEARCH_QUERY, text: "mortgage" })).toBe(0);
  });
});
