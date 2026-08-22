# [UI-150] Explorer: a retractable tree at the left, preview and keep, open in a chosen board, document and folder menus

## Domain
ui

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: UI-149, CONTRACT-075 (folder menu items call the typed client; SERVER-139 for them to work end to end)
- Blocks: —

## Spec References
- SPEC.md §11 — rider 1 (the explorer), rider 3 (the explorer's preview path, loose paths at the left edge)
- SPEC.md §9.2 — `GET /api/tree`, folder routes
- `design/navigation.html` — `renderExplorer`, `openFromExplorer`, `treeDocMenu`, `treeFolderMenu`, the resizer

## Summary
A panel at the left edge of the board, retractable horizontally the way the console retracts vertically, showing the workspace tree with documents under folders. Click opens a preview path on the default-open board, double-click keeps it, right-click picks a board or an action. Folders get the acts of CONTRACT-075. A board document in the tree is the board.

## Acceptance Criteria
- [ ] `Explorer.tsx` mounts inside `.main` beside the board (`Shell.tsx`), closed by default, toggled by the board-bar icon and `⌘B`; width resizable by a drag handle and by keyboard on the handle, bounded by the viewport (SPEC §11: a bound is derived from the room), remembered in `corpus.explorer` local state (`useExplorerLayout`, a horizontal twin of `useConsoleLayout`'s storage/version/resize pattern).
- [ ] Tree: `useTree()` for folders with counts; a folder's documents load on expand via `GET /api/docs?folder=<path>&limit=…` with the §11 "listing reached its bound" treatment past the limit; collapse state local; `.claude/skills` appears as the tree already reports it.
- [ ] Rows: type glyph, title, a dot when open on the showing board, `.origin` styling when it is the explorer path's origin, dimmed with an `archived` tag when archived (explorer lists include archived, the one list that does — say so in a title).
- [ ] Click → `openFromExplorer(doc)`: on the `default-open` board (fallback: the first board), replacing the existing explorer-origin path, loop rule applied; double-click → the same, then detached (kept); right-click → Open in <default>, Open and keep, Open in full screen, "open in…" every other board, Move to folder… (existing move dialog), Archive, Delete (asks). A `type: board` row: click → `openBoard(id)` from UI-148; menu: Open the board / Restore and open, Open the board document, Archive board / Restore, Delete.
- [ ] Folder right-click: New document here (creates into the folder, title selected — the existing create path), Pin as a column on this board (creates a `folder:` view and appends it to the showing board), Rename folder, Archive folder, Unarchive folder, Delete folder (asks, names the count). Each calls the CONTRACT-075 client and applies the returned documents to the query cache.
- [ ] Keyboard inside the tree: `↑`/`↓` move, `←`/`→` collapse/expand, `↵` open, `⌥↵` open and keep, the context-menu key opens the menu.
- [ ] Tree rows never resize the panel (titles truncate); the panel never pushes the board below its minimum — the board scrolls.
- [ ] e2e `explorer.spec.ts`: toggle and width persist across reload; click lands on Files; second click replaces; double-click keeps; board row restores an archived board; folder rename applies without reload.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/explorer/Explorer.tsx`, `ExplorerTree.tsx`, `useExplorerLayout.ts`, `useFolderDocs.ts`, `explorerMenus.ts`, tests, `explorer.css`
- `apps/ui/src/shell/Shell.tsx`, `shell/BoardBar.tsx` (toggle)
- `apps/ui/src/keyboard/shortcuts.ts` (`⌘B`)
- `apps/ui/src/board/openInColumn.tsx` — `origin: { view: "explorer", doc }` is a reserved origin UI-149 defined
- e2e: `explorer.spec.ts` (new), `stubCorpus.ts` (tree + folder routes)

### Key Implementation Details
- Update tree rows in place on re-render (keyed), not by replacing the subtree: the prototype found Chrome drops a double-click when the first click replaces the node.
- The explorer is a sibling of the board, not an overlay: it takes width from the board like the console takes height (§11's drawer rule).

### Edge Cases
- No default-open board: the first board in order receives; the row menu still lists all.
- A folder with thousands of documents: the limit and the "bound reached" line, never a scroll of everything.

## Testing Strategy
Vitest for layout hook, tree building from `FolderTree`, menus; Playwright for the flows above.

## E2E Verification Plan
### Verification Steps
1. Real app, `⌘B`, expand `finance/`, click a note → Files board, path at the left, tree row marked origin; click another → replaced; double-click a third → kept, next click opens a new preview.
2. Right-click `inbox/` → Rename → `triage`; tree and open columns update without reload.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-150]` prefix
