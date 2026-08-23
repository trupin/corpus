import type { FolderNode } from "@corpus/contract";

/**
 * Every folder in the workspace, as one sorted list of paths — the destinations
 * the tree's document menu offers "Move to …" (UI-158,
 * `POST /api/docs/{id}/move`).
 *
 * **Flat and sorted by path**, which puts a folder next to its own children:
 * `finance`, `finance/mortgage`, `finance/tax`. The tree's own walk sorts by
 * *name* per level, and a flat menu built that way would separate a parent from
 * its children by every sibling in between.
 *
 * The paths are the server's own spelling, relative to `data/docs/` and with no
 * trailing slash — exactly what the move route takes as a bare name. Nothing
 * here normalises: a destination whose case was guessed at is a file in the
 * wrong place.
 */
export function moveTargets(folders: readonly FolderNode[]): readonly string[] {
  const paths: string[] = [];
  const walk = (nodes: readonly FolderNode[]): void => {
    for (const node of nodes) {
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(folders);
  return paths.sort((left, right) => left.localeCompare(right));
}
