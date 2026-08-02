# [UI-038] Column header: sort control wraps to its own line in narrow columns

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 board columns (header row)

## Summary
Live dogfood report (2026-08-02, screenshot): shrinking the window makes the
column header's sort control ("last activity ↓") wrap below the filter chips
instead of sharing their row. User directive: everything stays on one line;
when there is no space, degrade the sort label by dropping the word
"activity" (render "last ↓"), never by wrapping.

## Acceptance Criteria
- [ ] Chips row and sort control share one row at all column widths; the row
      never wraps to two lines
- [ ] When the full label does not fit, the sort control renders "last ↓"
      (word "activity" dropped); the ↓/↑ direction glyph is always visible
- [ ] Degradation is width-driven and reversible (label restores when space
      returns); no truncation ellipsis, no overlap with chips
- [ ] Applies to every column type (folder, plugin, views) sharing the header

## Technical Design
### Files to Create/Modify
- The column header component + its css (chips/sort row); container-query or
  measured-width approach — match existing responsive patterns in the board

## Testing Strategy
Component test for the label degradation predicate; e2e resize assertion.

## E2E Verification Plan
Real app: narrow a column until the full label cannot fit; one row, "last ↓";
widen; label restores.

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
