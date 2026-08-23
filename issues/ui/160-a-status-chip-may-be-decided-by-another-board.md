# [UI-160] A kanban's status chip may be decided by a different board

## Domain
ui

## Priority
P2

## Status
todo

## Model
opus

## Dependencies
- Depends on: UI-152, SERVER-138

## Spec References
- SPEC.md §5 — "while a document is in a kanban, its stage decides its status"
- SPEC.md §10 — the kanban bullet

## Summary

Raised by the agent that added the `→ open` chip under PR #58's second review,
against its own work rather than someone else's.

**The deciding board is the lowest-`order` kanban that claims the document, and
that need not be the board you are dragging on.** SERVER-138 settled it that
way, and says which board decided in its warning. So every status chip a kanban
column draws — the `→ resolved` chips UI-152 shipped, and the `→ open` chip
added since — is *advisory*: it states what this board's map says, not
necessarily what will be written.

The new chip adds no dishonesty of its own. It extends an existing one, which is
why this is filed rather than left in a commit message.

## What a reader sees

Two kanbans over `stage` claim the same document. Board A, `order: 1`, maps
`done → resolved`. Board B, `order: 2`, maps `done → archived`. Dragging the
card to `done` on **board B** shows `→ archived` on the column and writes
`resolved`, because board A decides. The response's warning names board A, so
nothing is hidden — but the chip the person was looking at was wrong.

## Acceptance Criteria
- [ ] A column whose board is not the deciding board for a document either says
      so or does not promise a status
- [ ] Decide whether the chip should be per-column (what this board would do) or
      per-card (what will actually happen), and say why the other lost. A
      per-card answer costs a lookup the board may not have
- [ ] Whatever is chosen, a person who reads the chip and then drops the card
      is not surprised
- [ ] A test covers two kanbans claiming one document, since one board alone
      cannot exhibit this

## Testing Strategy
Vitest over the chip derivation with two boards in the fixture; Playwright for
the drag if the answer is per-card.

## E2E Verification Plan
### Verification Steps
1. Two kanbans over `stage`, different status maps, same document in scope.
2. Drag on the higher-`order` board.
3. What the chip said and what was written agree, or the chip did not claim.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-160]` prefix
