# [PLUGINS-019] A plugin column lives on a board, and its `onOpen` opens a path

## Domain
plugins

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-149, AGENT-044 (docs/PLUGINS.md text)
- Blocks: —

## Spec References
- SPEC.md §10 — "Plugin system" (a column type is a view with `column: "<plugin>/<type>"`)
- SPEC.md §11 — paths, boards
- SPEC.md §12 — the todos column

## Summary
Nothing in the kit's column API changes: a plugin column is still a `type: view` document with `column: "todos/todos"`, rendered by the plugin, and its rows call `onOpen`. What changes around it: the view is a column because a board lists it, and `onOpen` now opens a path to the right of the plugin column rather than a reader inside it. This issue verifies the todos plugin under the new model, fixes what breaks, and makes `docs/PLUGINS.md` and the plugin README say "board" where they said "pinned".

## Acceptance Criteria
- [ ] With the todos view listed on a board, the column renders, and a click on a todo row opens a path column to its right with the row as origin.
- [ ] "＋ New list → Todos" on a board appends the new view's id to that board's `columns`.
- [ ] The `_fixture` plugin's parity tests pass unchanged or with the minimal update to the board fixture.
- [ ] `plugins/todos/README.md` and `docs/PLUGINS.md` no longer say `pinned`.
- [ ] A plugin column inside a kanban board is impossible by construction (kanban columns are derived) and the docs say so.

## Technical Design

### Files to Create/Modify
- `plugins/todos/ui/*.test.tsx` — a board-based fixture
- `plugins/todos/README.md`, `docs/PLUGINS.md`
- `apps/ui/src/board/pluginColumn.test.tsx` — if the board fixture is shared

### Key Implementation Details
- The kit's `ColumnComponentProps.onOpen` is untouched; UI-149 changes what the board does with it. This issue is the plugin-side check that the contract held.

### Edge Cases
- A board listing a view whose plugin is not installed: the plugin-missing card (§15) renders in the column as before.

## Testing Strategy
Vitest in `plugins/todos` with a board fixture; the UI's plugin column test if shared.

## E2E Verification Plan
### Verification Steps
1. Real app with the todos plugin; add a Todos list to the Attention board; click a todo → path column opens; the origin row is highlighted.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[PLUGINS-019]` prefix
