# [CONTRACT-025] Rider: doctor response gains a report-only warnings surface

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: SERVER-038

## Spec References
- SPEC.md §14 doctor bullet; SERVER-038's report-only recovery pass (sprint-018 Open Conflict 1 adjudication, 2026-07-30)

## Summary
`GET /api/db/doctor`'s response deliberately carries failures only (`DRIFT_KINDS` is
a closed enum; `routes/db.ts` records that `warnings` is absent by design). SERVER-038
needs a home for report-only findings — files the projection will never index, named
with their creating commit — that must NOT fail doctor (§14's `rebuild && doctor`
clean invariant). Add an optional `warnings` array to the doctor response: each entry
a warning kind (its own open-ended literal set, separate from `DRIFT_KINDS`), path,
human message, and optional commit. Additive only; existing clients unaffected.
Note for the ledger: a one-line §14 mention ("doctor may carry report-only warnings")
goes into the next spec sign-off round — this rider implements an already-planned
issue, it does not change pass/fail semantics.

## Acceptance Criteria
- [ ] Doctor response schema gains optional `warnings`; failures/exit semantics untouched; A-era client types still compile
- [ ] Warning kind space is extensible without a contract edit per new kind (single literal union owned here, or a pattern — decide and document)
- [ ] openapi.json + client regenerated, drift check green; CLI doctor output unaffected until SERVER-038 consumes it

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/db.ts` (+ tests), regenerated artifacts

## Testing Strategy
packages/contract scoped: schema round-trip with and without warnings; compat assertion.

## E2E Verification Plan
Build + drift check green; server compiles unchanged (optional field).

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
