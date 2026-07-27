# [CONTRACT-003] Request schemas with `.default()` render as required fields in the generated client

## Domain

contract

## Status

in_progress

## Priority

P1

## Model

opus — mechanical schema adjustment with a pinned convention; the only judgment (optional-in, defaulted-out) is adjudicated below.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: — (should land before SERVER-005 implements doc creation and UI-002 consumes `POST /api/docs`)

## Spec References

- SPEC.md §9.3 — contract-first; the generated client is the consumer surface
- `issues/contract/002-contract-full-surface.md` — escalation 2 in its final report (discovery record)

## Summary

Found during CONTRACT-002: CONTRACT-001's `CreateDocRequestSchema` uses `.default()` on `tags`/`status`/`due`/`evergreen`, and `openapi-typescript` renders defaulted fields as **required** in request types — so a typed `POST /api/docs` caller must send all four fields, defeating the point of a server-side default. The same hazard applies to any request schema written since (audit the full surface, not just this one). Response-side defaults are unaffected.

## Acceptance Criteria

- [ ] Convention pinned in a schema-file comment and applied across every request schema: request-side optional fields are `.optional()` on the wire with the server-applied default stated in `.describe()` (optional-in); `.default()` is reserved for response/parse-side schemas where the parsed object should carry the value (defaulted-out). Zod-level defaults that must survive for server parsing move to server-side parse wrappers, not the shared request schema.
- [ ] `CreateDocRequestSchema.tags/status/due/evergreen` become optional in the generated request type; a `tsc` probe proves `client.api.POST("/api/docs", { body: { title } })` compiles.
- [ ] Full-surface audit: no other request schema renders a defaulted field as required (test iterating the generated types or the OpenAPI document's requestBody required arrays against schemas carrying defaults).
- [ ] The tri-state `requestsAgent` adjudication is untouched (it is already defaultless by design — this issue must not reintroduce a default there).
- [ ] Artifacts regenerated; drift check green; generation byte-deterministic.
- [ ] Server semantics unchanged: SERVER-005+ applies the documented defaults server-side (record the handoff in the issue log; no server code changes here).

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` (and any other request schema the audit flags)
- `packages/contract/src/openapi.test.ts` — the no-required-defaulted-request-field invariant
- Regenerated `openapi.json` + `client/schema.generated.ts`

### Key Implementation Details

The invariant test is the durable part: for every operation with a requestBody, no property listed in `required` may carry a `default` in its schema. That catches the class, not the instance.

## Testing Strategy

Vitest in packages/contract: the invariant test, round-trips for changed schemas, a compile-time probe (type-level assertion) that the minimal create-doc body compiles.

## E2E Verification Plan

### Verification Steps

1. `tsc` probe: minimal `POST /api/docs` body compiles pre-fix fails / post-fix passes.
2. Regenerate twice — byte-identical; drift check green.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills — reproduce the required-field rendering pre-fix.]_

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
- [ ] Committed with `[CONTRACT-003]` prefix
