# [UI-061] A selection spanning several turns is silently truncated to one

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: —

## Spec References
- SPEC.md §11 Thread view, "Commenting on a selection" (SHARED-009 Amendment 2)

## Summary
Fable review of PR #20, MINOR. `apps/ui/src/thread/useTurnComments.tsx:132` with
`apps/ui/src/anchors/renderedRange.ts:79-87`: when a selection spans several
turns, the range is clamped to whichever `.turn-markdown` root was right-clicked.
Select three turns, right-click the middle one, and the comment anchors to the
whole middle turn — the rest is dropped with no signal.

A comment anchors to one turn by construction, and that is correct: a child
thread has one parent and one anchor. The defect is that the narrowing is
**silent**. The user finds out by noticing the citation in the composer is
shorter than what they highlighted — if they notice at all, and the citation is
the only place it shows.

## Acceptance Criteria
- [ ] A cross-turn selection does not silently produce a one-turn anchor
- [ ] Either the selection menu declines it with a reason ("a comment anchors to
      one turn"), or the narrowing is stated before the composer opens — decide
      which and say why in the code
- [ ] Whatever is chosen, the user learns it **before** writing the comment, not
      by inspecting the citation afterwards
- [ ] A selection inside one turn is completely unaffected — no new refusal, no
      new prompt on the common path
- [ ] Selecting across a turn boundary and then right-clicking *outside* any turn
      behaves as it does today

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/useTurnComments.tsx`
- `apps/ui/src/menu/SelectionMenuItems.tsx` if the menu carries the message
- tests

### Notes
- Whole-turn 💬 remains the fallback for anything the selection path declines, so
  the user is never without a way to comment.

## Testing Strategy
Component test with a selection spanning two rendered turns; assert the outcome
chosen above rather than the current silent clamp.

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
