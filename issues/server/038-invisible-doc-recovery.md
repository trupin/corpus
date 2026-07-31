# [SERVER-038] Recovery path for already-committed invisible documents

## Domain
server

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-037, CONTRACT-025 (doctor warnings surface — sprint-018 Open Conflict 1)
- Blocks: —

## Spec References
- SPEC.md §5 — document tree; §14 — doctor/validation

## Summary
SERVER-037's TEST-564 finding (2026-07-30): the fix is forward-only, and `db doctor` is
*structurally* silent about invisible documents committed before it — `enumerateDocuments`
skips the same segments `classifyPath` does, so a pre-fix file under
`data/docs/.claude/…` or `data/docs/node_modules/…` is findable only by `git log` plus a
raw filesystem walk. Add a recovery surface: a doctor warning pass that walks
`data/docs/` ignoring the skip rules and reports unindexable files (path + the commit
that created them), and/or a small cleanup verb. Report-only is an acceptable v1 —
deletion stays a user act.

## Acceptance Criteria
- [ ] `corpus db doctor` (or a dedicated flag) names every file under `data/docs/` the projection will never index, with its creating commit
- [ ] Zero false positives on a healthy workspace (near-miss folders like `my.notes` stay silent)
- [ ] Report-only unless a cleanup verb is explicitly added with user-act semantics

## Technical Design
### Files to Create/Modify
- `apps/server/src/projection/` doctor pass (+ tests); CLI output passthrough if doctor's wire shape changes (contract rider then)

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); fixture with a pre-seeded invisible file.

## E2E Verification Plan
Real server on a workspace carrying a pre-fix invisible file (SERVER-037's repro recipe): doctor names it; healthy workspace stays clean.

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
