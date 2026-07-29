# [CONTRACT-017] `CreateThreadRequest` accepts unknown keys — silent unanchored threads

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus — schema strictness with a consumer-impact sweep.

## Dependencies

- Depends on: CONTRACT-009
- Blocks: —

## Spec References

- issues/evals/SERVER-019-eval.md — orchestrator-adjudication note 3 (2026-07-28)

## Summary

Found by the sprint-013 evaluator (pre-existing): `CreateThreadRequest` is not strict — sending
`anchor: {quote: …}` instead of the declared `selector: {exact: …}` yields `200` with a silently
unanchored thread (`anchorId: null`). A typoed key should be a 400, not a silently different
outcome. Evaluate making the request schema strict (or at minimum rejecting unknown top-level
keys), sweep the other request schemas for the same class, and check the multipart path
(CONTRACT-009) still round-trips. Consumer impact expected to be nil (UI/CLI send declared keys),
but the generated-client round-trip and e2e must prove it.

## Acceptance Criteria

- [ ] Unknown top-level keys on `CreateThreadRequest` are rejected 400; other request schemas
      audited with the chosen policy stated.
- [ ] Artifacts regenerated idempotently; consumers unaffected (typecheck + e2e green).

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
