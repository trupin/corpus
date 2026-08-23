# [UI-151] Column strip: one tab per column, grouped by path, dimmed when off screen, click scrolls, × closes

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-149
- Blocks: —

## Spec References
- SPEC.md §10 — rider 4 (the column strip), "nothing resizes because of what it holds"
- `design/navigation.html` — `renderColbar`, `watchVisibility`, `goTo`

## Summary
A board with several paths is wider than a screen, and the user asked for a way to see and reach every column at once. The strip above the board is the board in miniature: one tab per column, grouped exactly as the board groups them, off-screen tabs dimmed, click to scroll.

## Acceptance Criteria
- [ ] `ColumnStrip.tsx` renders above the board (inside the board wrapper, beside the explorer): a `.ctab` per column in strip order; query tabs show kind + title, reader tabs show document type + title in the serif face; a path's tabs sit in a `.cgroup` band (dashed; solid when loose) prefixed with `◂ <origin>` or `◦ path`.
- [ ] An `IntersectionObserver` on the board marks a tab `.seen` when its column is at least half in view; unseen tabs are dimmed.
- [ ] Click → the column scrolls into view (`inline: "center"`) and becomes the active column; the active tab is outlined and is itself kept in view inside the strip; `←`/`→` and every act that changes the active column move the outline.
- [ ] A path tab shows `×` on hover: closes that column and everything after it (UI-149's `closeCol`). Query tabs have no `×`.
- [ ] Tabs have a fixed max width and truncate; the strip scrolls horizontally with its scrollbar hidden; it never grows in height.
- [ ] e2e `column-strip.spec.ts`: eight columns → eight tabs in order; click the first → board scrolls home and the seen set flips; `×` drops the right tabs.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/ColumnStrip.tsx`, `useColumnVisibility.ts`, tests, css
- `apps/ui/src/shell/Board.tsx` — mount, pass the strip and the active key

### Key Implementation Details
- The strip renders from the same strip model UI-149 keeps, so it can never disagree with the board about order or grouping.
- Visibility is an observer, not a scroll listener, so it costs nothing while idle.

### Edge Cases
- A board with no columns: the strip is empty and hidden (`:empty`).
- A query column showing its in-place reader: its tab shows the open document's title, not the view's.

## Testing Strategy
Vitest for tab derivation from a strip; Playwright for scroll and visibility (the observer needs a real viewport).

## E2E Verification Plan
### Verification Steps
1. Real app, build three paths; the strip lists them grouped; scroll the board by hand; dimming follows; click a far tab; it centres.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-151]` prefix
