# [SERVER-031] Empty JSON body returns 500 instead of 400

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — a validator-wrapper fix with a clear reproduction.

## Dependencies

- Depends on: SERVER-003
- Blocks: —

## Spec References

- issues/evals/SERVER-019-eval.md — orchestrator-adjudication note 2 (2026-07-28)

## Summary

Found by the sprint-013 evaluator (pre-existing, not a regression): a `POST` with
`content-type: application/json` and an **empty body** returns `500 internal_error` (Hono's
validator throws "Malformed JSON in request body") on `/api/check`, `/api/threads`, `/api/docs` —
any JSON route. A malformed request is the caller's error: it should be a `400` with the standard
error envelope. Fix once at the shared validator/defaultHook layer, not per route; add a test that
sweeps every POST/PUT/PATCH route in `ENDPOINT_INVENTORY` with an empty body and asserts 400.

## Acceptance Criteria

- [ ] Empty and malformed JSON bodies return 400 with the standard error shape on every JSON
      route; no route 500s.
- [ ] One shared fix; inventory-driven sweep test.

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
