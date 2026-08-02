# [PLUGINS-010] Clicking a todo item opens its document with the item revealed

## Domain
plugins

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: PLUGINS-005, UI-037 (the reveal seam: discriminated payload
  through kit's onOpen/OpenTarget/NavEntry + reader scroll/flash support —
  sprint-023 OC5; there is no existing anchor-flash to reuse, the original
  criterion was wrong)
- Blocks: —

## Spec References
- SPEC.md §12 todos; §11 reader (anchor highlight/scroll behavior)

## Summary
Live dogfood report (2026-08-02): clicking an item row in the todos column opens
the parent todo document positioned at the top, with nothing indicating which
item was clicked. For long lists (the user has a 17-item document) the clicked
item can be off-screen. Expected: the reader opens scrolled to the clicked item
with a transient highlight — same visual language as the anchor-highlight flash
used when opening a thread's anchor.

## Acceptance Criteria
- [ ] Clicking an item row opens the document scrolled so the item is visible
- [ ] The clicked item gets a transient highlight (reuses the existing anchor
      flash treatment, not a new style)
- [ ] Clicking the document group header keeps today's behavior (top of doc)
- [ ] Works in both the column reader and full-screen focus

## Technical Design
### Files to Create/Modify
- `plugins/todos/` row click wiring (carry the item's line/text to the reader)
- `apps/ui` reader scroll-to support if the existing anchor-scroll path cannot
  be targeted by a plugin — escalate for a kit export if needed

## Testing Strategy
Component test for the click payload; e2e asserting scroll position + flash on
a long fixture document.

## E2E Verification Plan
Real app: 15+ item doc; click a bottom item in the column; reader opens with
that item visible and flashed.

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
