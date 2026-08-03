# [CONTRACT-028] `doc.edited` queue event + doc-diff route

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-008
- Blocks: SERVER-052, CLI-026

## Spec References
- SHARED-008 rider

## Summary
Two additions. (1) A `doc.edited` queue-event payload: document id, the edit
session's commit range (from/to revisions), and change stats (files always 1;
insertions/deletions or hunk count — pick what git furnishes cheaply); NEVER
the diff body (frugal-event rule, same economics as context packs). Fit the
existing event-schema family and the closed event-kind vocabulary. (2) A diff
route for the CLI verb: `GET /api/docs/{id}/diff?from=<rev>&to=<rev>` (shape it
against the existing git/show surface — reuse before inventing), returning the
unified diff bounded by a size cap with a `truncated` flag, matching the
CONTEXT_MAX_* bounding conventions.

## Acceptance Criteria
- [ ] Event schema in the queue vocabulary; kind enum extended deliberately
- [ ] Diff route with bounded body + truncated flag; errors per house envelope
- [ ] openapi.json + generated client regenerated (drift-checked)

## Technical Design
### Files to Create/Modify
- packages/contract event schemas + routes + inventory + generated artifacts

## Testing Strategy
Schema/route tests per house patterns.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
