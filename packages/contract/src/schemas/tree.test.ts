import { describe, expect, it } from "vitest";
import { FolderNodeSchema, FolderTreeSchema } from "./tree.js";

const leaf = { path: "finance/mortgage", name: "mortgage", count: 2, totalCount: 2, children: [] };

const branch = {
  path: "finance",
  name: "finance",
  count: 3,
  totalCount: 5,
  children: [leaf],
};

describe("FolderNode", () => {
  it("round-trips a leaf folder", () => {
    expect(FolderNodeSchema.parse(leaf)).toEqual(leaf);
  });

  it("round-trips nesting, so the tree can be arbitrarily deep", () => {
    const deep = {
      path: "a",
      name: "a",
      count: 0,
      totalCount: 7,
      children: [{ ...branch, path: "a/finance", children: [{ ...leaf, path: "a/finance/m" }] }],
    };
    expect(FolderNodeSchema.parse(deep)).toEqual(deep);
  });

  it("distinguishes direct documents from the subtree total", () => {
    const parsed = FolderNodeSchema.parse(branch);
    expect(parsed.count).toBe(3);
    expect(parsed.totalCount).toBe(5);
  });

  it("requires `children`, so a folder with none says so explicitly", () => {
    const { children: _children, ...withoutChildren } = leaf;
    expect(FolderNodeSchema.safeParse(withoutChildren).success).toBe(false);
  });

  it.each([
    ["a negative count", { count: -1 }],
    ["a fractional count", { totalCount: 1.5 }],
  ])("rejects %s", (_label, override) => {
    expect(FolderNodeSchema.safeParse({ ...leaf, ...override }).success).toBe(false);
  });

  it("rejects a child that is not a folder node, at any depth", () => {
    const broken = { ...branch, children: [{ path: "finance/x", name: "x" }] };
    expect(FolderNodeSchema.safeParse(broken).success).toBe(false);
  });
});

describe("FolderTree", () => {
  it("round-trips the response shape", () => {
    const tree = { folders: [branch] };
    expect(FolderTreeSchema.parse(tree)).toEqual(tree);
  });

  it("round-trips an empty workspace", () => {
    expect(FolderTreeSchema.parse({ folders: [] })).toEqual({ folders: [] });
  });

  it("names the root with the empty path, which is `data/docs/` itself", () => {
    const tree = { folders: [{ path: "", name: "", count: 4, totalCount: 4, children: [] }] };
    expect(FolderTreeSchema.parse(tree)).toEqual(tree);
  });
});
