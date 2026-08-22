import type { FolderTree } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import { docIdOptions, docTypeOptions, folderOptions, tagOptions } from "./queryVocabulary";

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

describe("tagOptions", () => {
  it("counts every tag across the rows, most-used first", () => {
    expect(tagOptions(rows)).toEqual([
      { value: "finance", detail: "2 documents" },
      { value: "urgent", detail: "2 documents" },
    ]);
  });

  /** No vocabulary means no suggestions — never an invented one. */
  it("offers nothing when the workspace has no tags", () => {
    expect(tagOptions([docRowFixture({ tags: [] })])).toEqual([]);
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
