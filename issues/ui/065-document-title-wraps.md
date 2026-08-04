# [UI-065] A long document title is cut off instead of wrapping

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
- `design/index.html` is authoritative for look and feel
- SPEC.md §11 Document view

## Summary
Live report 2026-08-04: _"Document's title can only show on one line, meaning it
is cut when too long. I want it to be wrapped."_

The title is the document's name and the thing a reader orients by; truncating it
hides exactly the distinguishing tail when several documents share a prefix
(`Catch-Up Report — 2026-08-03` and `Catch-Up Report — 2026-08-04` differ only at
the end). Let it wrap.

## Acceptance Criteria
- [ ] A long title wraps to as many lines as it needs, in the reader and in
      focus mode
- [ ] Nothing below it is overlapped or pushed off — the surrounding layout
      reflows rather than colliding
- [ ] It stays editable: the title is an input surface, so wrapping must not
      break typing, caret placement, or selection in it
- [ ] Short titles are visually unchanged
- [ ] Check the same treatment in the places a title is *deliberately* one line —
      board rows and column headers, where truncation is the right answer because
      the row is a fixed-height list item. State which surfaces wrap and which
      truncate, so the difference is intentional rather than incidental
- [ ] Consistent with `design/index.html`; if the mockup shows one line, say so
      and treat this as a deliberate departure

## Technical Design
### Files to Create/Modify
- The reader's title element and its CSS (likely `apps/ui/src/reader/`), plus
  focus mode
- `design/index.html` if the mockup should follow

## Testing Strategy
Component test with a long title asserting the rendered height grows and no text
is clipped; visual check in the real app at a narrow column width.

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
