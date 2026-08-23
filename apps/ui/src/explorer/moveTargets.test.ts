import type { FolderNode } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { moveTargets } from "./moveTargets";

/**
 * The destinations the tree's "Move to …" items name (UI-158).
 */

function folder(path: string, children: readonly FolderNode[] = []): FolderNode {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    count: 0,
    totalCount: 0,
    children,
  };
}

describe("moveTargets", () => {
  it("flattens every depth of the tree, not only the top level", () => {
    expect(
      moveTargets([folder("finance", [folder("finance/tax", [folder("finance/tax/2025")])])]),
    ).toEqual(["finance", "finance/tax", "finance/tax/2025"]);
  });

  it("sorts by path, so a folder stands beside its own children", () => {
    // Sorting by name per level, as the tree itself does, would put `zeta`
    // between `finance` and `finance/tax`.
    const targets = moveTargets([
      folder("zeta"),
      folder("finance", [folder("finance/tax")]),
      folder("alpha"),
    ]);
    expect(targets).toEqual(["alpha", "finance", "finance/tax", "zeta"]);
  });

  it("spells each path exactly as the server did", () => {
    // No trailing slash, no `data/docs/` prefix, no case folded: the move route
    // takes a bare name, and a destination guessed at is a file in the wrong
    // place.
    expect(moveTargets([folder("Inbox")])).toEqual(["Inbox"]);
  });

  it("answers an empty list for a workspace with no folders", () => {
    expect(moveTargets([])).toEqual([]);
  });
});
