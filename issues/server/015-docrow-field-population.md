# [SERVER-015] Populate CONTRACT-005's new DocRow fields in the collection query

## Domain

server

## Status

in_progress

## Priority

P1

## Model

opus — mapping already-projected data into newly declared response fields; the shapes are pinned by CONTRACT-005 and the projection schema.

## Dependencies

- Depends on: CONTRACT-005, SERVER-011
- Blocks: — (merges together with CONTRACT-005; UI-003/004 consume the result)

## Spec References

- SPEC.md §11 — staleness ramp, thread-row affordances
- `issues/contract/005-board-contract-growth.md` — the field shapes (authoritative)
- `issues/sprints/sprint-005.md` — Open Conflict 2 (why this issue exists: CONTRACT-005's DocRow growth reds merged SERVER-011)

## Summary

CONTRACT-005 adds staleness-tier and thread fields (agent participation, unread/awaiting) to `DocRowSchema`. SERVER-011 is done and merged, so the new fields red `apps/server`'s typecheck until its row-builder populates them. This issue does exactly that — from data the projection already holds (staleness cutoffs exist in `docs/staleness.ts`; thread agent-state and seen joins exist in `docs/needs.ts`) — and merges together with CONTRACT-005 as one gate.

## Acceptance Criteria

- [ ] Every new DocRow field is populated from existing projection data; non-thread rows carry the contract's absent/null shape exactly.
- [ ] Staleness tier agrees with the `stale` filter and the `stale` attention reason (one shared cutoff source — no second constant).
- [ ] Thread fields agree with the `agent`/`unread` filters (same joins, no drift).
- [ ] The undated-document sentinel behavior follows whatever CONTRACT-005's nullable-timestamps decision lands as.
- [ ] Repo-wide typecheck green against the regenerated client; SERVER-011's eval-verified behaviors unchanged (its filter/FTS/needs suites stay green untouched).
- [ ] E2E: one real-workspace query showing a stale doc's tier, a fresh doc, and a thread row's fields — through the typed client.

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/query.ts` (row building), possibly `staleness.ts`/`needs.ts` exports
- Colocated tests

## Testing Strategy

Row-shape tests per doc type; agreement tests (tier ↔ filter, thread fields ↔ filters); the E2E query.

## E2E Verification Plan

### Verification Steps

1. Real workspace with stale/fresh/thread docs; query through the typed client; fields match the projection's ground truth via sqlite3.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_N/A — coupled growth._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-015]` prefix
