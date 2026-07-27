# [CONTRACT-004] Mandatory request bodies are typed optional in the generated client

## Domain

contract

## Status

in_progress

## Priority

P1

## Model

opus — mechanical `required: true` sweep with a pinned invariant; the only judgment (which bodies are genuinely mandatory) is enumerable from the routes.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: — (should land before UI-002 consumes the mutating client surface broadly)

## Spec References

- SPEC.md §9.3 — the generated client is the consumer surface; compile-time honesty is the point
- `issues/contract/002-contract-full-surface.md` — halt-addendum E2E note (discovery record)

## Summary

Found during the halt-reason addendum: OpenAPI treats an omitted `requestBody.required` as `false`, so every route body ships optional and `openapi-typescript` emits `requestBody?:` — `client.api.POST("/api/docs")` with no body compiles and then 400s at runtime. The two genuinely-omittable bodies (`halt`, `fail`) now declare `required: false` explicitly; the ~9 mandatory ones must declare `required: true` so omission is a compile error.

## Acceptance Criteria

- [ ] Every route with a request body declares `required` explicitly — `true` unless the route is designed for bare POSTs (currently exactly `halt` and `fail`); no route relies on OpenAPI's implicit default.
- [ ] Invariant test: walk the document; any operation with a requestBody must carry an explicit `required` key (catches the class).
- [ ] Compile-time probes: `POST /api/docs` (and one more mandatory-body route) without a body is a `tsc` error post-fix (reproduce compiling pre-fix first); `halt`/`fail` without a body still compile.
- [ ] Consumers still typecheck: run the repo-wide typecheck; if `apps/cli`/`apps/ui` call sites break, they were latent runtime 400s — report them, fix only if within a one-line call-site correction, otherwise escalate.
- [ ] **Rider (evaluator doc nit, sprint-003 round 2)**: `haltQueue`'s route description names only two of three outcomes — a bare re-halt also **clears** a previously recorded reason. Correct the text ("replace, add, or clear") while in `routes/queue.ts`; behavior is already correct.
- [ ] Artifacts regenerated, byte-deterministic, drift check green.

## Sprint-004 Adjudication (binding, 2026-07-27)

The "exactly halt and fail" enumeration in this issue is factually wrong (seen, acquire-lock, and `PUT /api/docs/{id}` are also wholly optional). **Pinned rule instead of a list**: a request body is `required: false` iff every field in its schema is optional (a bare invocation is meaningful); any body with at least one required field declares `required: true`. The invariant test asserts the rule against the schemas, not a hand-list; sprint-004 TEST-71's enumeration derives from applying the rule.

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/*.ts` — explicit `required` on every body
- `packages/contract/src/openapi.test.ts` — the explicit-required invariant
- Regenerated artifacts

## Testing Strategy

The invariant test plus the compile probes; existing route/client tests must stay green.

## E2E Verification Plan

### Verification Steps

1. Pre-fix: scratch `tsc` file calling `POST /api/docs` with no body compiles (log it).
2. Post-fix: same file fails to compile; bare `halt`/`fail` still compile; drift green twice.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills]_

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
- [ ] Committed with `[CONTRACT-004]` prefix
