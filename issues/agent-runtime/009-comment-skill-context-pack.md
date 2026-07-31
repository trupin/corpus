# [AGENT-009] Comment skill starts from the context pack

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-021, AGENT-008
- Blocks: —

## Spec References
- SPEC.md §7 comment skill (SHARED-006 Edit 3), context packs (Edit 4)

## Summary
Amend the comment skill per the signed Edit 3: handling `comment.created` starts from
`corpus thread context <id>` — the pack IS the default context; full-document reads
are the escalation, taken only when the pack is insufficient for the ask, and the
skill says what "insufficient" looks like (the ask references content the pack didn't
carry; an edit must preserve surrounding structure the pack didn't include). Keep
coherent with AGENT-008's rules and the existing reply/trace/lock flow.

## Acceptance Criteria
- [ ] Skill's worked flow opens with the context verb; escalation criteria stated; no step reads the parent wholesale by default
- [ ] Standalone-thread path (no parent) reads naturally with the pack's related-only shape
- [ ] Consistent with AGENT-008 rules (one retrieval doctrine, not two)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md`

## Testing Strategy
Prose audit (`/usr/bin/grep` for contradicting instructions), format check; template-copy test green.

## E2E Verification Plan
`corpus init` scratch workspace: installed skill text opens with the context verb.

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
