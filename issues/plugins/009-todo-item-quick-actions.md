# [PLUGINS-009] Todo item rows: right-click quick actions (toggle, comment/open thread)

## Domain
plugins

## Status
todo — the SPEC §11 amendment was SIGNED 2026-08-02 (sprint-023 OC2 resolved:
"Amend — plugin menus in"); the amended §11 text now allows plugin-rendered
surfaces to contribute context menus through the kit. Still gated on UI-037
(the reveal payload for "open thread" and the kit menu seam).

## Priority
P2

## Model
opus

## Dependencies
- Depends on: PLUGINS-005, PLUGINS-003, UI-037 (reveal payload for "open
  thread"), SPEC §11 amendment sign-off
- Blocks: —

## Spec References
- SPEC.md §12 todos; §11 context menus (UI-024 pattern)

## Summary
Live dogfood report (2026-08-02): right-clicking a todo item row in the todos
board column does nothing. The core board rows (`ColumnList.tsx`) and the reader
(`DocView.tsx`) have context menus, but the todos plugin renders its own item
rows with no `onContextMenu` at all. The user expects quick actions on an item
without opening the document: toggle done/open, comment on the item (opens an
anchored thread per PLUGINS-003), and open the item's existing thread when one
exists.

## Acceptance Criteria
- [ ] Right-click on a todo item row opens a context menu: toggle done/open;
      comment on item; open existing thread (shown only when the item has one)
- [ ] Toggle goes through the plugin's atomic mutate path (PLUGINS-004) and the
      row preview refreshes without reload
- [ ] Comment produces the same anchored thread as selecting the item's text in
      the reader (PLUGINS-003 anchors) — no new thread shape
- [ ] Menu matches the board's existing context-menu look/keyboard behavior
      (UI-028/UI-030 conventions)

## Technical Design
### Files to Create/Modify
- `plugins/todos/` column row components
- `packages/kit` if the shared context-menu primitive is not yet exported to
  plugins — escalate if the kit surface needs a new export

## Testing Strategy
Component tests for the menu actions; e2e in apps/ui/e2e/todos.spec.ts.

## E2E Verification Plan
Real app: right-click an item → toggle flips the checkbox in the document;
comment opens an anchored thread quoting the item.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
