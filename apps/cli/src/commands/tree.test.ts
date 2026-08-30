import type { FolderNode } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { treeLines } from "./tree.js";

/**
 * `corpus tree`'s rendering (CLI-023). The request is one typed call with
 * nothing to decide, so what is worth testing is the shape a reader gets.
 */
function folder(
  path: string,
  count: number,
  totalCount: number,
  children: readonly FolderNode[] = [],
): FolderNode {
  return { path, name: path.split("/").at(-1) ?? path, count, totalCount, children };
}

describe("treeLines", () => {
  it("prints one line per folder, indented by depth", () => {
    expect(
      treeLines([folder("finance", 2, 5, [folder("finance/2026", 3, 3)]), folder("inbox", 7, 7)]),
    ).toEqual(["finance  2 (5)", "  finance/2026  3", "inbox  7"]);
  });

  it("shows the total only where it differs from the folder's own count", () => {
    // A parent whose descendants hold documents it does not is the common case,
    // and one number there would hide whichever it was not.
    expect(treeLines([folder("a", 0, 4, [folder("a/b", 4, 4)])])).toEqual(["a  0 (4)", "  a/b  4"]);
    expect(treeLines([folder("flat", 3, 3)])).toEqual(["flat  3"]);
  });

  it("names the path, not the folder's name", () => {
    // `--folder` takes a path, and a name repeated at two depths would be
    // ambiguous exactly where it mattered.
    const lines = treeLines([folder("a", 0, 1, [folder("a/notes", 1, 1)])]);
    expect(lines[1]).toContain("a/notes");
  });

  it("nests to any depth", () => {
    expect(treeLines([folder("a", 0, 1, [folder("a/b", 0, 1, [folder("a/b/c", 1, 1)])])])).toEqual([
      "a  0 (1)",
      "  a/b  0 (1)",
      "    a/b/c  1",
    ]);
  });

  it("prints nothing for a workspace with no folders", () => {
    // An empty tree is an answer, not a failure: a fresh workspace has one.
    expect(treeLines([])).toEqual([]);
  });

  it("carries no title, id or body — structure is not enumeration (SPEC.md §7)", () => {
    const rendered = treeLines([folder("finance", 2, 5, [folder("finance/2026", 3, 3)])]).join(
      "\n",
    );
    expect(rendered).not.toMatch(/doc_|th_/);
    expect(rendered.split("\n").every((line) => /^\s*\S+\s+\d+( \(\d+\))?$/.test(line))).toBe(true);
  });
});
