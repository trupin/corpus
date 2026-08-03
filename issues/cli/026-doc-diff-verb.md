# [CLI-026] `corpus doc diff <id> [--from <rev> --to <rev>]`

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-052
- Blocks: AGENT-011

## Spec References
- SHARED-008 rider

## Summary
Thin verb over the diff route: prints the bounded unified diff for a
document's revision range; defaults to the range named by the most recent
`doc.edited` event when invoked without --from/--to is NOT in scope (the
event carries the range; the skill passes it explicitly — keep the verb
stateless). Prints the truncated notice when the server flags it. Output is
agent-facing: stable, pipe-friendly, no decoration beyond the existing verb
conventions.

## Acceptance Criteria
- [ ] Prints the diff for an explicit range; exit 0
- [ ] Truncation surfaced as a clear trailing notice
- [ ] Errors (bad rev, unknown doc) per existing verb error conventions
- [ ] Registered in docs/cli.md generation

## Technical Design
### Files to Create/Modify
- apps/cli/src/commands/doc/diff.ts + registration + tests

## Testing Strategy
Colocated verb tests per house patterns.

## E2E Verification Plan
Real workspace: edit a doc, fetch the event's range, diff it through the verb.

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
