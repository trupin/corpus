# [CONTRACT-086] Nothing on the wire sets the quiet window

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-071
- Blocks: SERVER-151, UI-172

## Spec References

- SPEC.md §7 — the `workspace.reflect` paragraph, `reflect.quiet`
- SPEC.md §9.2 — the workspace reflect routes

## Summary

`GET /api/workspace/reflect` reports `quiet`, the configured window in minutes,
and **`0` disables the automatic path**. No route sets it. Workspace config is
read-only over HTTP, so a person who wants the automatic reflection off must
hand-edit `.corpus/config.json`.

This issue adds the write half, and nothing more. It is deliberately **not** a
general config API: one value moves, the one SPEC.md §7 already names.

## Acceptance Criteria

- [ ] `PUT /api/workspace/reflect/quiet` is defined in `packages/contract`, with
      a body carrying `quiet` as a non-negative integer of minutes
- [ ] Its response is the **same `ReflectStatus`** `GET` returns, so a client
      that sets the value learns the whole new state in one round trip and never
      re-reads to find out what it did
- [ ] The route description says outright that `0` disables the automatic path
      and leaves asking as the only way a reflection happens, citing §7 — the
      published contract must not make a reader open the spec to learn what `0`
      means
- [ ] The upper bound is stated and justified rather than left open, so a typo
      cannot configure a window measured in years
- [ ] `openapi.json` and the generated client regenerate cleanly
- [ ] No general config route, and no second field meaning "automatic on/off"
      (SHARED-071's decision)

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/workspace-reflect.ts` — the new route definition
- `packages/contract/src/schemas/reflect.ts` — the request body schema. The
  `quiet` field's prose already exists on `ReflectStatus` and should be shared
  rather than written twice
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerate

### Key Implementation Details

`PUT`, not `PATCH`: one field, wholly replaced, and idempotent. Setting the same
value twice is the same state.

The response reuses `ReflectStatusSchema`. A caller that switches the automatic
path off wants to know what is pending and how many documents are unreflected in
the same breath, and deriving that from a bare acknowledgement means a second
request.

### Edge Cases

- Negative values are refused by the schema, not clamped.
- A very large value is refused rather than accepted, per the acceptance
  criterion above. Pick the bound and say why in the description.

## Testing Strategy

Contract tests: the route round-trips through the generated client, the schema
refuses a negative and a non-integer, and the description names `0`'s meaning.
Falsify the description assertion by deleting the sentence and watching it fail.

## E2E Verification Plan

Through the generated client against the real server once SERVER-151 lands — not
through a hand-written fetch. A test that calls a hand-rolled helper rather than
`corpus.api.*` has been seen to pass while the contract was wrong (v0.22.0).

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-086]` prefix
