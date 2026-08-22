# [UI-148] Boards: the board bar, columns read from the board document, order and pin writes go to the board, one board always open

## Domain
ui

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-077, SERVER-138
- Blocks: UI-149, UI-152, UI-153

## Spec References
- SPEC.md §11 — "UI — the board" (rider 2: boards as documents; rider 1's last sentence: a board document in the explorer is the board)
- `design/navigation.html` — the board bar, tab reorder, the board document's reader

## Summary
Today `useColumns` asks for `GET /api/docs?pinned=true&type=view&sort=order` and the strip is the answer. After this issue the strip is one board's `columns`, the board bar above the board lists every board, and every write that used to touch a view's `order` or `pinned` touches the board document instead. The prototype is the reference for every control named here.

## Acceptance Criteria
- [ ] `useBoards()` reads `GET /api/docs?type=board&sort=order` (archived excluded by default) and `useColumns(boardId)` resolves the board's `columns` against `GET /api/docs?type=view` by id, in the board's order; an id that resolves to nothing renders an error column card naming the id (the §11 "error card" pattern), never a crash.
- [ ] The board bar: one tab per board in `order`, the showing board marked, `＋` creates an empty board document (`type: board`, `folder: boards`, `columns: []`, `order` = last + 1) and switches to it, `×` archives the board document (present only when more than one board shows; archiving the last is refused with a toast), right-click offers Rename, Move left/right, Make it the default open target, Archive, Delete (asks first).
- [ ] Tabs drag to reorder; the drop writes `order` on every board, one `updateDocById` batch (or the server's multi-write if SERVER-138 exposes one), one toast. `⌘1`…`⌘9` switch boards in bar order.
- [ ] Which board shows is browser-local and survives reload; a browser that remembers no board shows the `default-open` board, else the first in `order` (§11 amendment, 2026-08-22); a remembered board that is archived or deleted falls back the same way.
- [ ] Column reorder (`columnOrder.ts`, `useColumnOrder.ts`, `⇧←/⇧→`) rewrites the board's `columns`; `newList.ts`/`useSaveAsView.ts`/`useCreateInColumn.ts` create the view **without** `pinned`/`order` and append its id to the current board; "Remove from this board" filters `columns` and leaves the view document alone.
- [ ] Column width keeps riding the view's `extra` (unchanged).
- [ ] The board document's reader shows its frontmatter and a one-line explanation (prototype: "A board is a document. Edit columns here…"); the explorer hook `openBoard(id)` (restore if archived, then show) is exported for UI-150.
- [ ] Board-local state moves to version 3: `corpus.board` becomes `{ version: 3, board: id, boards: { [id]: { columns: {...} } } }`; a v2 blob is discarded (one lost scroll position per column, the v2 precedent).
- [ ] e2e: `board.spec.ts`'s "ghost column with nothing pinned" becomes "a board with no columns shows the empty state and the ghost column"; `stubCorpus.ts` serves `type: board` documents; a new `boards.spec.ts` covers create, archive-refused-at-one, reorder-writes-order.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/useBoards.ts` (new), `useColumns.ts`, `viewDoc.ts` (drop `order`/`pinned` reads)
- `apps/ui/src/shell/BoardBar.tsx` (new), `shell/Shell.tsx` (mount between Topbar and Board), `shell/Board.tsx` (take `boardId`)
- `apps/ui/src/board/columnOrder.ts`, `useColumnOrder.ts`, `newList.ts`, `useSaveAsView.ts`, `useCreateInColumn.ts`, `NewListPicker.tsx`
- `apps/ui/src/board/useBoardLocalState.ts` — v3
- `apps/ui/src/reader/DocView.tsx` — board frontmatter rendering (small)
- `apps/ui/e2e/stubCorpus.ts`, `board.spec.ts`, `boards.spec.ts` (new)

### Key Implementation Details
- Keep `BoardColumn` as the rendered shape; only its source changes. `compareColumns` goes; order is the board's array order.
- The bar is chrome like the topbar: `flex: none`, fixed height, tab titles truncate (SPEC §11: nothing resizes because of what it holds).
- One board always open: compute from the non-archived list length, both for hiding `×` and for refusing the act.

### Edge Cases
- Two boards with the same `order`: title, then id, as `sort=order` already does.
- A board whose `columns` lists the same view twice: render it twice (the file says so), no dedupe.
- No boards at all (a workspace that never ran the migration): the bar shows one disabled tab "No boards — run `corpus upgrade`" and the board is empty; nothing is invented.

## Testing Strategy
Vitest for `useBoards`, column resolution, v3 migration, the one-board rule; Playwright for the bar.

## E2E Verification Plan
### Verification Steps
1. Real app on a fresh `corpus init` (AGENT-044 seeds): three tabs in order; drag Files first; reload; order holds; `corpus doc show` on each board shows the rewritten `order`.
2. Archive Attention and Files → `×` gone on the last; archive via menu refused.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-148]` prefix
