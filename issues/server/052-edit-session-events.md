# [SERVER-052] Edit-session end detection → actor-scoped doc.edited emission

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028
- Blocks: UI-044, AGENT-011

## Spec References
- SHARED-008 rider; SPEC §4 (auto-commit squash)

## Summary
Detect the end of a USER edit session on a document and enqueue one
`doc.edited` event per session. Session end = (a) an explicit flush from the
UI (reader closed — the endpoint/mechanism UI-044 calls; check whether the §4
squash machinery already exposes a flush and extend it rather than adding a
parallel one), or (b) inactivity: no user write to that document for the
acknowledgment window (default 3 minutes — config-surfaced, distinct from and
longer than the squash idle). The event carries the session's commit range
(the pre-session commit → the squashed session commit) + stats per
CONTRACT-028. Strictly actor-scoped: agent-authored writes neither start nor
extend a session nor emit; a user session interleaved with agent writes to the
SAME document must not fold agent commits into the reported range (decide and
test the interleaving rule explicitly). Also implement the diff route
(CONTRACT-028) over the existing git show machinery with the bounded body.

## Acceptance Criteria
- [ ] One event per session, both end paths; window configurable, default 3m
- [ ] Actor scoping: agent writes never emit; interleaving rule tested
- [ ] Commit range is exactly the session's edits; squash interplay correct
- [ ] Diff route: bounded unified diff + truncated flag; 404/400 per envelope
- [ ] No write-path latency added (timer/flush side only)

## Technical Design
### Files to Create/Modify
- apps/server: edit-session tracker (colocate with the squash machinery),
  queue enqueue, diff route; config surface for the window

## Testing Strategy
Session tracker unit tests (fake timers, vi.waitFor on real observables — no
setImmediate flush loops); route tests; interleaving matrix.

## E2E Verification Plan
Real server: edit via PUT as user, wait the window, observe the queue event;
close-flush path once UI-044 lands (or via the flush endpoint directly).

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
