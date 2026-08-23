# [CONTRACT-079] Record the two warning codes Phase 41 added from the server's tree

## Domain
contract

## Priority
P3

## Status
todo

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, SERVER-138

## Spec References
- SPEC.md §9.2 — "a response's warnings also carry effects on documents the request never named"

## Summary

Raised by PR #58's reviewer as a tracker cost rather than a defect.

`WARNING_CODES` gained two members during Phase 41 — `stage_status` and
`default_open_cleared` — added from **`apps/server`'s workspace**, by
SERVER-138, because the enum is closed and both of its acceptance criteria
require the response to name what it changed. The reviewer judged the call
right: routing two enum members through a separate contract issue would have
cost a serialization, the generated artifacts moved in the same commit as the
schema, and the breach was flagged in the commit body and the PR body.

**What is missing is only the record.** No CONTRACT row names the enum change,
so the contract's own history does not show where those two members came from.
CONTRACT-078 covers the adjacent gap — a folder act cannot report a refused
document — but not this.

## What this issue is for

A bookkeeping row, so the enum's history is queryable from the contract's own
domain. There is nothing to build unless the audit below finds something.

## Acceptance Criteria
- [ ] The two members are described where the domain records its published
      vocabulary, naming SERVER-138 as where they were added and why
- [ ] Audit the two descriptions against what the server actually emits. One is
      known stale already: `stage_status`'s text said the coupling is silent for
      a stage the deciding board does not draw, which stopped being true when
      that carve-out was removed under PR #58's review
- [ ] No other `WARNING_CODES` member describes behaviour the server no longer
      has

## Testing Strategy
The existing published-shape tests. This is a description audit, so the test is
reading each one against its emitter.

## E2E Verification Plan
### Verification Steps
1. Trigger each of the two warnings against a real server.
2. Compare the emitted text and the published description.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-079]` prefix
