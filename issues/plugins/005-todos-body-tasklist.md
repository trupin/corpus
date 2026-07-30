# [PLUGINS-005] Todos items move into the body as GFM task-lists

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-005
- Blocks: PLUGINS-006, PLUGINS-007

## Spec References
- SPEC.md §12 as amended by SHARED-005 (pending sign-off)

## Summary
First implementation leg of the PLUGINS-003 design (full analysis in
issues/plugins/003-item-level-commenting.md): `plugins/todos/server/items.ts` becomes a
body task-list parser/serializer (GFM `- [ ]` / `- [x]` lines) replacing the
`extra.items` array; the plugin routes recompute the body under the existing atomic
`mutateDoc` seam; CLI surfaces (`corpus todos …`) unchanged in shape; migration for
existing `extra.items` documents (policy decided at implementation per the design's
open question 4: bulk `corpus todos migrate` vs migrate-on-first-write — decide,
justify) plus tolerant reads mid-transition; seed template updated. Per-item `due` and
`ts` handling per SHARED-005's signed answers (design open questions 1 and 5).

## Acceptance Criteria
- [ ] Parser/serializer round-trips the body byte-stably for untouched lines
- [ ] All existing todos routes/CLI verbs behave identically against body-backed items (parity tests updated, not deleted)
- [ ] Migration policy implemented + tested; mixed-format reads tolerated per the design
- [ ] Lost-update protections preserved (mutateDoc; expectedText guards against body lines)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, subshell-cd/--workspace from outside the repo, ports 9180-9199, never 8765): full CLI round-trip on body-backed lists; migration drill.

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
