# [SERVER-037] `POST /api/docs` with a dot-segment folder commits an invisible document

## Domain
server

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-005
- Blocks: —

## Spec References
- SPEC.md §5 — document tree under `data/docs/`; §9.2 — write paths

## Summary
Found by server-dev during SERVER-036's containment verification (2026-07-30),
pre-existing: `POST /api/docs` with `folder: ".claude/skills"` is not refused — it
resolves inside the docs root to `data/docs/.claude/skills/` (containment holds,
nothing escapes), writes the file, **auto-commits it**, then answers
`404 no document with id doc_…` because `classifyPath` skips dot-segment paths and the
projection never indexes what was just committed. Net effect: a document created,
committed to the audit trail, and permanently invisible to every read surface. Fix
direction: refuse dot-segment folder components at validation time (400 naming
`folder`), before any write — reads should never have to learn about paths writes can
produce but the projection won't index.

## Acceptance Criteria
- [ ] A `folder` containing any dot-prefixed segment is a 400 naming the field; nothing written, nothing committed
- [ ] Regression test walks the write→project round-trip for a near-miss legal folder to prove no over-refusal
- [ ] Repro from SERVER-036's log reproduced pre-fix, refused post-fix

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/` folder validation (locate `normalizeDocFolder`/`resolveFolder`), colocated tests

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: pre-fix repro (create → commit → 404), post-fix 400 with clean tree and no commit.

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
