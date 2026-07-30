# [CONTRACT-020] Route: `POST /api/skills` (skill create through the server write path)

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-008 (skills surface)
- Blocks: SERVER-036, CLI-011 (skill-create half)

## Spec References
- SPEC.md §7 — skill genesis (amended: extend-plus-propose "until `corpus skill create` ships (CLI-011)")
- SPEC.md §9.2 — write-path semantics

## Summary
Sprint-015 Open Conflict 1: CLI-011 promises `corpus skill create` "through the server
write path", but no route exists — the server's write paths refuse document roots
outside `data/docs/` (`normalizeDocFolder` prefixes `DOCS_ROOT` unconditionally) and
the skills surface (CONTRACT-008) covers only check/rollback. Define the creation
route: request (skill name, initial SKILL.md content or template selection — mirror
what the CLI verb per its issue needs), responses (201; 400 validation incl. name
pattern; 401; 409 already-exists; 423 lock parity if applicable), following the skills
surface's existing conventions. Orchestrator ruling 2026-07-30: contract → server
(SERVER-036) → CLI, three commits.

## Acceptance Criteria
- [ ] Route defined with the same error-envelope + strictness conventions as the rest of the skills surface; name-pattern traversal guard expressible at the schema level
- [ ] openapi.json + generated client regenerated; route tests per house pattern
- [ ] Response set consistent with SERVER-036's planned behavior (coordinate via the issue files, not guesswork)

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/skills.ts` (+ tests), `openapi.json`, `schema.generated.ts`

## Testing Strategy
Route response-key + schema strictness tests; generation idempotence.

## E2E Verification Plan
Typecheck across consumers; drift check green.

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
