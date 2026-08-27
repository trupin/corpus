import type { FolderTree, WorkspaceVocabulary } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import {
  docIdOptions,
  docTypeOptions,
  extraKeyOptions,
  folderOptions,
  tagOptions,
} from "./queryVocabulary";

const rows = [
  docRowFixture({ id: "doc_a", type: "note", title: "Mortgage options", tags: ["finance"] }),
  docRowFixture({
    id: "doc_b",
    type: "thread",
    title: "Re: mortgage",
    tags: ["finance", "urgent"],
  }),
  docRowFixture({ id: "doc_c", type: "thread", title: "Re: schools", tags: [] }),
  docRowFixture({ id: "doc_d", type: "todo", title: "Call the broker", tags: ["urgent"] }),
];

describe("docTypeOptions", () => {
  it("lists the types in use, most-used first, with their counts", () => {
    const options = docTypeOptions(rows);
    expect(options.slice(0, 3)).toEqual([
      { value: "thread", detail: "2 documents" },
      { value: "note", detail: "1 document" },
      { value: "todo", detail: "1 document" },
    ]);
  });

  /**
   * `type` is an open string in the contract so a workspace may hold a type this
   * build does not define (SPEC.md §5). Reading it off the corpus is the only
   * way `todo` can be offered at all — no hardcoded list knows about it.
   */
  it("offers an unrecognised type because the workspace uses it", () => {
    expect(docTypeOptions(rows).map((option) => option.value)).toContain("todo");
  });

  it("appends the core types nobody has used yet, marked as such", () => {
    const options = docTypeOptions(rows);
    expect(options).toContainEqual({ value: "view", detail: "core type" });
    expect(options).toContainEqual({ value: "skill", detail: "core type" });
    // A type in use is never repeated in the tail.
    expect(options.filter((option) => option.value === "note")).toHaveLength(1);
  });

  it("still teaches the core vocabulary in an empty workspace", () => {
    expect(docTypeOptions([]).every((option) => option.detail === "core type")).toBe(true);
    expect(docTypeOptions([]).map((option) => option.value)).toContain("note");
  });
});

/**
 * Tags now come from `GET /api/vocabulary` rather than from the sampled page
 * (CONTRACT-092, closing CONTRACT-026). The difference is exhaustiveness: the
 * sample was one page of rows, so a tag used only on older documents was simply
 * not offered in a workspace larger than the page.
 */
describe("tagOptions", () => {
  const VOCABULARY: WorkspaceVocabulary = {
    tags: [
      { value: "finance", count: 12 },
      { value: "urgent", count: 1 },
    ],
    extraKeys: [
      { key: "assignee", count: 4 },
      { key: "estimate", count: 1 },
    ],
  };

  it("offers the workspace's tags with their real counts, in the order given", () => {
    // The server orders by use and then by name, so the client renders what it
    // was handed rather than sorting a second time.
    expect(tagOptions(VOCABULARY)).toEqual([
      { value: "finance", detail: "12 documents" },
      { value: "urgent", detail: "1 document" },
    ]);
  });

  /** No vocabulary means no suggestions — never an invented one. */
  it("offers nothing when the workspace has no tags", () => {
    expect(tagOptions({ tags: [], extraKeys: [] })).toEqual([]);
  });

  /**
   * A failed or pending read is **silence**, not a failure: nothing the query
   * language accepts depends on a name appearing in this menu.
   */
  it("offers nothing when the read has not arrived", () => {
    expect(tagOptions(undefined)).toEqual([]);
  });
});

describe("extraKeyOptions", () => {
  const VOCABULARY: WorkspaceVocabulary = {
    tags: [],
    extraKeys: [
      { key: "assignee", count: 4 },
      { key: "Assignee", count: 1 },
    ],
  };

  it("offers the invented field names, counted, case preserved", () => {
    // Case is preserved because `json_extract` is case-sensitive: `Assignee`
    // finds different documents from `assignee`, so they are two entries.
    expect(extraKeyOptions(VOCABULARY)).toEqual([
      { value: "assignee", detail: "4 documents" },
      { value: "Assignee", detail: "1 document" },
    ]);
  });

  it("offers nothing when the read has not arrived, or the workspace invented none", () => {
    expect(extraKeyOptions(undefined)).toEqual([]);
    expect(extraKeyOptions({ tags: [], extraKeys: [] })).toEqual([]);
  });
});

describe("folderOptions", () => {
  const tree: FolderTree = {
    folders: [
      {
        path: "finance",
        name: "finance",
        count: 2,
        totalCount: 3,
        children: [
          { path: "finance/mortgage", name: "mortgage", count: 1, totalCount: 1, children: [] },
        ],
      },
      { path: "inbox", name: "inbox", count: 4, totalCount: 4, children: [] },
    ],
  };

  it("offers every folder in the hierarchy, descendants included", () => {
    expect(folderOptions(tree)).toEqual([
      { value: "finance", detail: "3 docs" },
      { value: "finance/mortgage", detail: "1 doc" },
      { value: "inbox", detail: "4 docs" },
    ]);
  });

  it("offers nothing before the tree has loaded", () => {
    expect(folderOptions(undefined)).toEqual([]);
  });
});

describe("docIdOptions", () => {
  /** SPEC.md §5: nobody types a `doc_*` id by hand — the title is the handle. */
  it("offers ids under their titles", () => {
    expect(docIdOptions(rows.slice(0, 2))).toEqual([
      { value: "doc_a", detail: "Mortgage options" },
      { value: "doc_b", detail: "Re: mortgage" },
    ]);
  });
});
