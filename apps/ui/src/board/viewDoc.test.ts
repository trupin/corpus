import { docRowFixture } from "@corpus/kit/testing";
import type { DocRow } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { compareColumns, formatQueryString, parseQueryString, toBoardColumn } from "./viewDoc";

function view(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({
    id: "doc_view",
    type: "view",
    title: "A list",
    pinned: true,
    order: 10,
    ...overrides,
  });
}

describe("toBoardColumn", () => {
  it("reads the whole column off the view document's own frontmatter", () => {
    const column = toBoardColumn(
      view({
        id: "doc_threads",
        title: "Conversations",
        order: 30,
        query: { type: "thread", status: "open" },
      }),
    );

    expect(column).toMatchObject({
      id: "doc_threads",
      title: "Conversations",
      order: 30,
      kind: "view",
      filter: { type: "thread", status: "open" },
      folder: null,
      plugin: null,
      error: null,
    });
    expect(column.chips.map((chip) => chip.label)).toEqual(["type: thread", "status: open"]);
  });

  it("joins array values the way the wire's comma-separated form does", () => {
    const column = toBoardColumn(view({ query: { type: ["note", "view"], tag: ["a", "b"] } }));
    expect(column.filter).toEqual({ type: "note,view", tag: "a,b" });
    expect(column.chips.map((chip) => chip.label)).toEqual(["type: note, view", "tag: a, b"]);
  });

  it("renders numbers and booleans, which YAML makes easy to write", () => {
    const column = toBoardColumn(view({ query: { unread: true, limit: 20 } }));
    expect(column.filter).toEqual({ unread: "true", limit: "20" });
    // `limit` is pagination, not a filter the user chose.
    expect(column.chips.map((chip) => chip.key)).toEqual(["unread"]);
  });

  it("calls a folder-scoped view a folder column and remembers where ＋ creates", () => {
    const column = toBoardColumn(view({ query: { folder: "finance" } }));
    expect(column.kind).toBe("folder");
    expect(column.folder).toBe("finance");
    // The prototype writes folder chips with a trailing slash.
    expect(column.chips[0]?.label).toBe("folder: finance/");
  });

  it("calls a `column:` view a plugin column and splits the reference", () => {
    const column = toBoardColumn(view({ column: "todos/board", query: { type: "todo" } }));
    expect(column.kind).toBe("plugin");
    expect(column.plugin).toEqual({ plugin: "todos", type: "board" });
    expect(column.error).toBeNull();
  });

  it("labels the sort the prototype's way, and defaults to the server's sort", () => {
    expect(toBoardColumn(view({ query: {} })).sortLabel).toBe("last activity ↓");
    expect(toBoardColumn(view({ query: { sort: "created" } })).sortLabel).toBe("created ↑");
    // An unknown sort renders verbatim rather than vanishing.
    expect(toBoardColumn(view({ query: { sort: "sideways" } })).sortLabel).toBe("sideways");
  });

  it("keeps a column whose frontmatter is wrong, and says what is wrong", () => {
    // `query: needs=me` is perfectly good YAML — and not a map.
    const broken = toBoardColumn(view({ query: "needs=me" as unknown as DocRow["query"] }));
    expect(broken.error).toContain("not a map of filters");
    expect(broken.id).toBe("doc_view");

    const badColumn = toBoardColumn(view({ column: "todos" }));
    expect(badColumn.error).toContain("<plugin>/<type>");

    const badValue = toBoardColumn(
      view({ query: { folder: { deep: true } } as unknown as DocRow["query"] }),
    );
    expect(badValue.error).toContain("folder");
  });

  it("treats an absent query as no filters rather than an error", () => {
    const column = toBoardColumn(view({ query: null }));
    expect(column.error).toBeNull();
    expect(column.filter).toEqual({});
    expect(column.chips).toEqual([]);
  });
});

describe("compareColumns", () => {
  const columns = [
    toBoardColumn(view({ id: "doc_b", title: "Beta", order: 20 })),
    toBoardColumn(view({ id: "doc_a", title: "Alpha", order: 20 })),
    toBoardColumn(view({ id: "doc_z", title: "Zulu", order: null })),
    toBoardColumn(view({ id: "doc_c", title: "Gamma", order: 10 })),
  ];

  it("sorts by order, nulls last, then title, then id", () => {
    expect([...columns].sort(compareColumns).map((column) => column.id)).toEqual([
      "doc_c",
      "doc_a",
      "doc_b",
      "doc_z",
    ]);
  });

  it("is stable across repeated sorts of a shuffled set", () => {
    const first = [...columns].sort(compareColumns).map((column) => column.id);
    const second = [...columns]
      .reverse()
      .sort(compareColumns)
      .map((column) => column.id);
    expect(second).toEqual(first);
  });

  it("breaks a full tie on id", () => {
    const left = toBoardColumn(view({ id: "doc_a", title: "Same", order: 10 }));
    const right = toBoardColumn(view({ id: "doc_b", title: "Same", order: 10 }));
    expect(compareColumns(left, right)).toBeLessThan(0);
    expect(compareColumns(right, left)).toBeGreaterThan(0);
    expect(compareColumns(left, left)).toBe(0);
  });
});

describe("the query-string round trip the ⋯ menu edits", () => {
  it("round-trips a stored query", () => {
    const filter = { type: "thread", status: "open" };
    expect(formatQueryString(filter)).toBe("type=thread&status=open");
    expect(parseQueryString(formatQueryString(filter))).toEqual(filter);
  });

  it("ignores empty and malformed fragments rather than writing them", () => {
    expect(parseQueryString(" type=note && =x & broken & tag= ")).toEqual({ type: "note" });
    expect(parseQueryString("")).toEqual({});
  });

  it("keeps a value containing an equals sign intact", () => {
    expect(parseQueryString("q=a=b")).toEqual({ q: "a=b" });
  });
});
