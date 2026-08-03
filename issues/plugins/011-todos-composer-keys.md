# [PLUGINS-011] Todos item composer adopts the composer key contract

## Domain
plugins

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 1), UI-052 (sets the contract and, if it
  extracts a shared helper, the thing to reuse)
- Blocks: —

## Spec References
- SPEC.md §11 Global composer, as replaced by SHARED-009 Amendment 1: the
  contract binds "any composer a plugin contributes"

## Summary
`plugins/todos/ui/TodoItemComposer.tsx` sends on `↵` with `⇧↵` for a newline and
an IME guard — correct under the old convention, wrong under the new one. The
signed contract is `↵` newline, `⌘↵` send, and it explicitly covers plugin
composers, so the reference plugin has to demonstrate it rather than diverge.

Watch for the same thing in any other plugin surface that takes text.

## Acceptance Criteria
- [ ] `↵` inserts a newline in the todos item composer; `⌘↵` submits
- [ ] The submit control names its key (`Comment ⌘↵`)
- [ ] IME composition commit still never submits
- [ ] Dismissal (`useDismissable`: escape ordering + outside click) unchanged —
      but see UI-048 item 3, which questions whether outside-click should discard
      a non-empty draft; if UI-048 lands first, follow its resolution
- [ ] If UI-052 extracts a shared key-handling helper, use it rather than
      re-implementing — but only through a path the plugin boundary allows
      (`@corpus/kit*` / `@corpus/contract` only; never `apps/ui`). If the helper
      is not reachable from a plugin, say so — that is a kit-gap note for UI-045.
- [ ] Existing `TodoItemComposer.test.tsx` key assertions updated, not deleted

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/TodoItemComposer.tsx` + tests

## Testing Strategy
Component tests for `↵`, `⌘↵`, IME commit. E2E in `todos-menu.spec.ts` for the
real composer path.

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
