# [UI-149] Paths: a row opens a column to the right, no loops, open here, restart, new path right, keep, close, close all — and every `open()` caller lands in a path

## Domain
ui

## Status
todo

## Priority
P0

## Model
fable — the novel design of the phase; every other UI issue builds on its model, and the `open()` resolution change touches five callers with different intent.

## Dependencies
- Depends on: UI-148
- Blocks: UI-150, UI-151, PLUGINS-019

## Spec References
- SPEC.md §11 — rider 3 (paths), the keyboard scheme, "nothing resizes because of what it holds"
- `design/navigation.html` — `openFromView`, `openFromPath`, `openHere`, `restartPathHere`, `newPathRight`, `detachPath`, `closeCol`, `closeAllPaths`, `recenterIfInPath`, the strip reconciliation in `boardState`

## Summary
Replaces "click a row, the column widens into a reader" with "click a row, a reader column opens to its right". The board's strip becomes a sequence of query columns and paths, paths being browser-local chains of reader columns hanging off an origin row (or off nothing). The prototype's acts and rules are the contract; this issue ports them onto the real components — the existing `Reader`, `Column`, the nav stack, the escape stack — rather than rewriting them.

## Acceptance Criteria
- [ ] **Strip model** in local state v3 (UI-148's blob): per board, an ordered list of `{ kind: "query", view, stack }` and `{ kind: "path", id, origin: { view, doc } | { view: "explorer", doc } | null, cols: [{ stack: NavEntry[] }] }`. Reconciliation keeps query items in the board's order and paths in place relative to the item before them (port `boardState`).
- [ ] **Open from a row** (`ColumnList` row click, `↵`): a path hangs off that row; a second pick from the same column replaces the path; the origin row carries `.origin` (accent bar, `▸`) while its path is open; a row open elsewhere on the board carries a dot.
- [ ] **Follow a link** inside a path column (`[[refs]]`, backlinks, bare-id handles, plugin `onOpen`): the path continues right, truncating what was after that column.
- [ ] **No loops**: a document already in the path → `scrollIntoView({inline:"center"})` on its column, a flash, a toast, nothing closed. The rule is per board.
- [ ] **Open here** (row menu, `⌥↵`, reader menu): pushes onto that column's own nav stack — the existing reader inside a query column, unchanged; inside a path column it navigates in place and truncates to the right. The loop rule applies here too.
- [ ] **Restart the path here**, **New path to the right**, **Keep — detach from its origin**, **Close this column and after**, **Close the whole path**, from the path column's `⋯` and right-click; **Close paths** on the board bar with its count pill; `esc` closes the active path column (after overlays and focus mode, before the column reader's back), `⇧esc` closes every path on the board.
- [ ] **Query columns stop widening** (`Column.tsx` lines ~237-242 `readingFloor`): a path column has its own width (`440px` base, then the user-adjustable width rule of §11 applies to it like any column); `soft-wrap.spec.ts` "column widens" and `reader.spec.ts` "column reader measure" are rewritten for the new geometry.
- [ ] **Every `open()` caller** through `openInColumn.tsx` resolves to a path: a caller that passes `columnId` (the keyboard's `↵` on a highlighted row) hangs the path off that row; a caller with a `subject` or nothing (search overlay `↵`, console `↗ open`, `LaneScope`, a link inside focus mode, "open in <board>") lands as a **loose path at the left edge** of the current board. `resolveColumn`'s folder/type precedence is deleted; `reveal` and `selectTitle` ride the path column's first `NavEntry` unchanged. The `OpenTarget` contract grows `origin?: { view, doc }` and `placement?: "origin" | "left"`.
- [ ] **Focus mode is untouched** except that `f`/`⇧↵`/`⤢` work from a path column too, and a link followed inside focus closes focus and opens a loose path.
- [ ] **Paths render** as a band (`.path`, dashed border; solid when loose) holding `.pcol` columns with the prototype's head: `◂ <origin>` / `◂ <previous doc>` / `◦ path · no origin`, back when the stack is deeper than one, `⤢`, `⋯`, `✕`. Snap scrolling follows the newest path column; a 13″ width (1280px) is measured in an e2e test with the explorer closed.
- [ ] Context menus: the row menu gains Open / Open here / Open in full screen / open in… <boards>; the path column menu is the prototype's; plugin rows keep their own items under the same rules.
- [ ] e2e `paths.spec.ts`: open, continue, loop re-centre, replace, open-here, restart, new-right, close-all, the search overlay landing left, focus link landing left.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/strip.ts` (new: the model and the acts, pure), `strip.test.ts`
- `apps/ui/src/board/useBoardLocalState.ts` — v3 shape shared with UI-148; coordinate the blob in one place
- `apps/ui/src/board/PathBand.tsx`, `PathColumn.tsx` (new; `PathColumn` mounts the existing `Reader` with its own `NavStackApi` over the column's `stack`)
- `apps/ui/src/board/Column.tsx` — drop the widening; keep the in-place reader
- `apps/ui/src/board/openInColumn.tsx` — `OpenTarget` growth, `resolveColumn` removal, the left-edge placement
- `apps/ui/src/shell/Board.tsx` — render the strip; the board commands (`openHighlighted`, `closeActivePathColumn`, `closeAllPaths`, `restartPathHere`, `newPathRight`)
- `apps/ui/src/keyboard/shortcuts.ts`, `boardCommands.ts`, `CheatSheet.tsx` — `⌥↵`, `esc` layering, `⇧esc`
- `apps/ui/src/menu/RowMenuItems.tsx`, a new `PathColumnMenuItems.tsx`
- call sites: `search/SearchOverlay.tsx`, `console/JobDetail.tsx`, `console/LaneScope.tsx`, `reader/Reader.tsx`, `reader/FocusMode.tsx`
- e2e: `paths.spec.ts` (new), `reader.spec.ts`, `soft-wrap.spec.ts`, `column-header.spec.ts` updates

### Key Implementation Details
- Port the prototype's acts as pure functions over the strip (`openFromView(strip, view, doc)` returns a new strip plus the key to focus); the component layer only calls them and scrolls. That is what makes the loop rule and the replacement rule testable without a DOM.
- `PathColumn` reuses `useNavStack`'s API over `cols[i].stack` so scroll restore, reveal and the empty-document abandonment rule (§11) work unchanged inside a path.
- The active column (`kactive`) is one key across query and path columns: `q:<view>` / `p:<id>:<idx>`.
- Origin highlight is derived at render from the strip, never stored on the row.

### Edge Cases
- The origin row leaves its column (its document is archived, moved, or its stage changes — UI-152): the path stays where it is, its head still names the origin column; the user decided on 2026-08-22 to leave this as is for now.
- A board switch keeps each board's paths; `Close paths` acts on the showing board only.
- Opening a document that is the top of a query column's in-place reader is not a loop (the rule is per path).

## Testing Strategy
Vitest on `strip.ts` for every act and rule; component tests for `PathColumn` head and menus; Playwright for geometry and keys.

## E2E Verification Plan
### Verification Steps
1. Real app: Inbox row → path; two links → three columns; link back to the first document → re-centre, toast; pick another Inbox row → replaced.
2. `⌘K`, pick a result, `↵` → loose path at the left edge; `f` on it; follow a link in focus → focus closes, loose path at the left.
3. 1280px window, explorer closed: the newest path column is fully in view after each open.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, >5 files)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-149]` prefix
