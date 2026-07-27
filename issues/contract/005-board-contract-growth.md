# [CONTRACT-005] Board contract growth: query-key vocabulary, DocRow staleness + thread fields

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — additive schema growth with shapes pinned by SPEC §9.2/§11 and the sprint-004 findings; no open design questions.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: UI-002 (query-key vocabulary), UI-003/UI-004 (DocRow fields)

## Spec References

- SPEC.md §11 — staleness ramp, thread-row affordances, board columns
- SPEC.md §9.2 — collection query row content
- `issues/sprints/sprint-004.md` — Open Conflicts 2 and 7 (discovery record)

## Summary

Two gaps found while sprint-004 pinned SERVER-007/011 to the shipped contract: (1) the SSE query-key **vocabulary** (which key arrays exist, what invalidates what) lives nowhere in the contract, so UI-002 would mirror it by hand and drift; (2) `DocRowSchema` carries no staleness tier and no thread-specific fields (agent participation, awaiting/unread affordances), which UI-003/004's rows and the staleness ramp need — SERVER-011 was adjudicated to implement the contract exactly, so the fields must arrive here before the UI consumes them.

## Acceptance Criteria

- [ ] The query-key vocabulary is published in the contract (schemas/sse.ts): the closed set of key shapes (e.g. `["docs"]`, `["docs", {filter-hash}]`, `["doc", id]`, `["thread", id]`, `["tree"]`, `["queue"]`, `["jobs"]`, `["job-log", id]` — derive the actual set from SPEC §11's refetch surfaces and SERVER-007's emitter), each with a description of what emits it and what should refetch on it; exported constants/helpers so server emitter and UI bridge share one source.
- [ ] `DocRowSchema` gains the §11 fields: staleness tier (the enum the staleness ramp renders), and for thread rows the agent-participation state and unread/awaiting affordances — nullable/absent for non-thread rows, consistent with the "thread filters no-op on non-threads" convention.
- [ ] SERVER-011's projection query can populate every new field from existing tables (verify against the shipped schema; if a field needs data the projection lacks, flag it instead of inventing).
- [ ] All standing invariants hold (400/401, no request defaults, explicit required, component purity); artifacts regenerated, byte-deterministic, drift green.
- [ ] Round-trip tests for changed schemas; the vocabulary constants have a test pinning the closed set.

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/sse.ts` — vocabulary
- `packages/contract/src/schemas/query.ts` — DocRow additions
- Tests + regenerated artifacts

## Testing Strategy

Round-trips, vocabulary closed-set pin, invariant suite stays green, consumer typecheck across workspaces.

## E2E Verification Plan

### Verification Steps

1. Regenerate twice — byte-identical; drift green.
2. Repo-wide typecheck; SERVER-011's routes still mount (its handlers may need to populate the new fields — coordinate via report, don't edit apps/server).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_N/A — additive growth._

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
- [ ] Committed with `[CONTRACT-005]` prefix
