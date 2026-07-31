# [CLI-021] `corpus thread context <id>`

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-024, SERVER-047
- Blocks: AGENT-009

## Spec References
- SPEC.md §7 context packs (SHARED-006 Edit 4)

## Summary
Thin verb over the context route. Output ordered for an agent's read: the anchored
passage/section first, then related excerpts one line each (id · heading path ·
excerpt · relation), the degrade note when semantic ranking wasn't available; `--json`
mirror. No flags beyond `--json` in v1 — the bounds live in the contract.

## Acceptance Criteria
- [ ] All four pack shapes render legibly (anchored / whole-doc / standalone / orphaned)
- [ ] Related lines match CLI-019's frugal line format (one formatter, shared)
- [ ] 404 and error paths per existing verb conventions

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/thread/context.ts` (new + tests); share the hit-line formatter with `search`/`related`

## Testing Strategy
apps/cli scoped: rendering against stubbed packs.

## E2E Verification Plan
Real server via the bin: comment on a doc, `corpus thread context th_…` shows the briefing; verify against the file.

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
