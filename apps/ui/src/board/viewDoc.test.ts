import { docRowFixture } from "@corpus/kit/testing";
import type { DocRow } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { formatQueryString, missingColumn, parseQueryString, toBoardColumn } from "./viewDoc";

function view(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({ id: "doc_view", type: "view", title: "A list", ...overrides });
}

/** The slot a column occupies on a board; the same as the view id unless repeated. */
function asColumn(row: DocRow, slot = row.id) {
  return toBoardColumn(slot, row);
}

describe("toBoardColumn", () => {
  it("reads the whole column off the view document's own frontmatter", () => {
    const result = asColumn(
      view({
        id: "doc_threads",
        title: "Conversations",
        query: { type: "thread", status: "open" },
      }),
    );

    expect(result).toMatchObject({
      id: "doc_threads",
      viewId: "doc_threads",
      title: "Conversations",
      kind: "view",
      filter: { type: "thread", status: "open" },
      folder: null,
      error: null,
    });
    expect(result.chips.map((chip) => chip.label)).toEqual(["type: thread", "status: open"]);
  });

  it("joins array values the way the wire's comma-separated form does", () => {
    const column = asColumn(view({ query: { type: ["note", "view"], tag: ["a", "b"] } }));
    expect(column.filter).toEqual({ type: "note,view", tag: "a,b" });
    expect(column.chips.map((chip) => chip.label)).toEqual(["type: note, view", "tag: a, b"]);
  });

  it("renders numbers and booleans, which YAML makes easy to write", () => {
    const column = asColumn(view({ query: { unread: true, limit: 20 } }));
    expect(column.filter).toEqual({ unread: "true", limit: "20" });
    // `limit` is pagination, not a filter the user chose.
    expect(column.chips.map((chip) => chip.key)).toEqual(["unread"]);
  });

  it("calls a folder-scoped view a folder column and remembers where ＋ creates", () => {
    const column = asColumn(view({ query: { folder: "finance" } }));
    expect(column.kind).toBe("folder");
    expect(column.folder).toBe("finance");
    // The prototype writes folder chips with a trailing slash.
    expect(column.chips[0]?.label).toBe("folder: finance/");
  });

  /**
   * `column:` is not a key the core defines, so it is extra frontmatter — the
   * server preserves it verbatim and never interprets it (SPEC.md §9.1), and
   * neither does this file. A workspace whose view documents still carry one
   * keeps them, and they are still queries the board runs (SHARED-066).
   */
  it("ignores a `column:` reference, which no longer names anything", () => {
    const column = asColumn(view({ extra: { column: "todos/board" }, query: { type: "todo" } }));
    expect(column.kind).toBe("view");
    expect(column.filter).toEqual({ type: "todo" });
    expect(column.error).toBeNull();
    // And it does not disturb the one key this file *does* read out of `extra`.
    expect(column.width).toBeNull();
  });

  it("labels the sort the prototype's way, and defaults to the server's sort", () => {
    expect(asColumn(view({ query: {} })).sortLabel).toBe("last activity ↓");
    expect(asColumn(view({ query: { sort: "created" } })).sortLabel).toBe("created ↑");
    // An unknown sort renders verbatim rather than vanishing.
    expect(asColumn(view({ query: { sort: "sideways" } })).sortLabel).toBe("sideways");
  });

  it("keeps a column whose frontmatter is wrong, and says what is wrong", () => {
    // `query: needs=me` is perfectly good YAML — and not a map.
    const broken = asColumn(view({ query: "needs=me" as unknown as DocRow["query"] }));
    expect(broken.error).toContain("not a map of filters");
    expect(broken.id).toBe("doc_view");

    const badValue = asColumn(
      view({ query: { folder: { deep: true } } as unknown as DocRow["query"] }),
    );
    expect(badValue.error).toContain("folder");
  });

  /**
   * UI-088. `isParent=true` selects documents with **no** parent
   * (CONTRACT-042), so `isParent: true` on a chip would tell a user the
   * opposite of what their column shows. These pin the words, because the words
   * are the only explanation the board gives.
   */
  describe("the isParent chip, whose parameter name contradicts its meaning", () => {
    it("says top-level only, never that the document is a parent", () => {
      const column = asColumn(view({ query: { isParent: true } }));
      expect(column.filter).toEqual({ isParent: "true" });
      expect(column.chips).toEqual([{ key: "isParent", label: "isParent: top-level only" }]);
      expect(column.chips[0]?.label).not.toContain("true");
    });

    it("says children only for the other direction", () => {
      const column = asColumn(view({ query: { isParent: false } }));
      expect(column.filter).toEqual({ isParent: "false" });
      expect(column.chips).toEqual([{ key: "isParent", label: "isParent: children only" }]);
    });

    /**
     * The server owns which values are legal. A hand-edited `isParent: yes` is
     * shown as written and refused on the round trip, rather than dressed up in
     * a phrase this file invented for it.
     */
    it("shows a value it has no phrase for exactly as the file wrote it", () => {
      expect(asColumn(view({ query: { isParent: "yes" } })).chips[0]?.label).toBe("isParent: yes");
    });

    it("stands alongside the filters already on the view rather than replacing them", () => {
      const column = asColumn(
        view({ query: { folder: "finance", type: ["note", "thread"], isParent: true } }),
      );
      // Every filter reaches the request; `isParent` is one more `&`, not a mode.
      expect(column.filter).toEqual({
        folder: "finance",
        type: "note,thread",
        isParent: "true",
      });
      expect(formatQueryString(column.filter)).toBe(
        "folder=finance&type=note,thread&isParent=true",
      );
      expect(column.chips.map((chip) => chip.label)).toEqual([
        "folder: finance/",
        "type: note, thread",
        "isParent: top-level only",
      ]);
      // A `folder:` column stays a folder column: this filter changes no kind.
      expect(column.kind).toBe("folder");
    });

    /**
     * A view document written before this parameter existed must load, and
     * render, exactly as it did — nothing here injects `isParent`, so no column
     * quietly starts hiding rows when this ships.
     */
    it("leaves a query that never mentions it completely untouched", () => {
      const stored = { type: "thread", status: "open", sort: "-updated" };
      const column = asColumn(view({ query: stored }));
      expect(column.filter).toEqual(stored);
      expect(Object.keys(column.filter)).not.toContain("isParent");
      expect(column.chips.map((chip) => chip.label)).toEqual(["type: thread", "status: open"]);
      expect(column.error).toBeNull();
    });
  });

  it("treats an absent query as no filters rather than an error", () => {
    const column = asColumn(view({ query: null }));
    expect(column.error).toBeNull();
    expect(column.filter).toEqual({});
    expect(column.chips).toEqual([]);
  });
});

describe("missingColumn", () => {
  /**
   * "An id that resolves to nothing renders an error column card naming the id
   * (the §10 error card pattern), never a crash" (UI-148).
   */
  it("names the id it could not resolve, and carries no query", () => {
    const gone = missingColumn("doc_gone", "doc_gone");
    expect(gone.missing).toBe(true);
    expect(gone.title).toBe("doc_gone");
    expect(gone.viewId).toBe("doc_gone");
    expect(gone.filter).toEqual({});
    expect(gone.chips).toEqual([]);
    expect(gone.error).toContain("no `type: view` document");
  });

  it("keeps the slot it was listed at, so a repeat is still two columns", () => {
    expect(missingColumn("doc_gone#1", "doc_gone").id).toBe("doc_gone#1");
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
