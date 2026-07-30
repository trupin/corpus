# [SERVER-036] Skill-create write path (documents outside `data/docs/`)

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-020
- Blocks: CLI-011 (skill-create half)

## Spec References
- SPEC.md §7 — skill genesis; §9.2 — write paths; §14 — validation

## Summary
Sprint-015 Open Conflict 1, server half: implement `POST /api/skills` — create
`.claude/skills/{name}/SKILL.md` through the standard mutation pipeline (validate,
per-document lane, git auto-commit with acting party, projection like the rollback
handler already does for skill docs). The blocker to solve properly: `normalizeDocFolder`
unconditionally prefixes `DOCS_ROOT` and `doc move` refuses skills — creation needs a
sanctioned root-aware seam, not a bypass. Reuse the rollback handler's skills-root
conventions (path derivation, synthetic doc ids, name-pattern traversal guard, no tree
badge). Refusals: name collision 409 (incl. archived-skill collision semantics — decide
and document), validation 400, lock parity per the contract.

## Acceptance Criteria
- [ ] Creation lands as a normal auto-commit, projected, SSE-invalidated; sole-writer preserved
- [ ] No write path accepts arbitrary roots — the seam is skills-specific or explicitly enumerated
- [ ] Collision with an installed skill → 409; the archived-skill case decided and tested
- [ ] Tests per house pattern incl. traversal-guard and validation-refusal cases

## Technical Design
### Files to Create/Modify
- `apps/server/src/skills/create.ts` (+ tests), route mount, shared write-path seam touch-ups as needed

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); real-workspace integration tests as the rollback suite does.

## E2E Verification Plan
Real server + scratch workspace (subshell-cd init pattern): create → file on disk, commit authored, visible to check/rollback; collision and traversal refusals over HTTP.

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
