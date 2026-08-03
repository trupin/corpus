# [UI-044] Reader close flushes the document's edit session

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-052
- Blocks: —

## Spec References
- SHARED-008 rider

## Summary
When a reader showing a document with an open USER edit session closes (column
reader exits to its list, focus mode closes without the column staying on the
doc, the doc is swapped by navigation), the UI calls the session-flush
mechanism SERVER-052 exposes so the `doc.edited` event fires promptly instead
of waiting out the inactivity window. Must be reliable on tab close/navigation
too, within reason (sendBeacon/keepalive where the platform allows; the
inactivity window is the guaranteed fallback, so best-effort is acceptable and
stated). Never flush sessions the user didn't have (read-only views, agent
edits, unchanged docs).

## Acceptance Criteria
- [ ] Close/navigate-away flushes an active session exactly once
- [ ] No flush when nothing changed or the change was agent-authored
- [ ] Tab-close best-effort path present and stated honestly in tests
- [ ] Back/forward through nav stack doesn't double-flush

## Technical Design
### Files to Create/Modify
- apps/ui reader lifecycle (colocate with useReaderSurface/editor teardown);
  kit method for the flush call

## Testing Strategy
Component tests on the lifecycle triggers; e2e closing a dirty reader and
observing the event (with SERVER-052 landed).

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
