# [CONTRACT-086] Nothing on the wire sets the quiet window

## Domain

contract

## Status

done

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

- [x] `PUT /api/workspace/reflect/quiet` is defined in `packages/contract`, with
      a body carrying `quiet` as a non-negative integer of minutes
- [x] Its response is the **same `ReflectStatus`** `GET` returns, so a client
      that sets the value learns the whole new state in one round trip and never
      re-reads to find out what it did
- [x] The route description says outright that `0` disables the automatic path
      and leaves asking as the only way a reflection happens, citing §7 — the
      published contract must not make a reader open the spec to learn what `0`
      means
- [x] The upper bound is stated and justified rather than left open, so a typo
      cannot configure a window measured in years
- [x] `openapi.json` and the generated client regenerate cleanly
- [x] No general config route, and no second field meaning "automatic on/off"
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

Implemented by the orchestrator on opus, 2026-08-25.

### The two calls this issue had to make

**A sub-resource, not a `PATCH`.** `GET /api/workspace/reflect` answers a report
of five fields, and exactly one of them is settable. A `PATCH` there would
publish a resource whose fields are mostly read-only and leave a caller to work
out which one is not. `PUT /api/workspace/reflect/quiet` says what it sets in its
own path. A test pins that neither path carries a `patch`.

**The bound is 7 days, and it is new.** The field was read-only, so an unbounded
integer cost nothing. Writable, it lets one mistyped digit configure a window
measured in years — armed to look at and never firing, which is the worst pair,
because `0` at least says what it means. Seven days is where a person stops
choosing a cadence.

**One factory, two uses.** `quietMinutesField()` builds the field for both
`ReflectStatus` and `ReflectQuietRequest`, and a test asserts the two published
descriptions are byte-identical. What `GET` reports is what `PUT` set, so a
reader who learns what `0` means from one finds the same sentence on the other.

### Falsification

Removing `.max(MAX_REFLECT_QUIET_MINUTES)` and regenerating:

```
× bounds the window rather than accepting any integer
  Tests  1 failed | 5 passed
```

### What the surface's own pins caught

Four existing gates refused the route until it was declared properly, which is
the drift-check working: the endpoint inventory, the request-body count, the
mandatory/omittable partition, and `additionalProperties: false`. The body is
`z.strictObject` and `required: true` — a bare `PUT` would be a request to set
the window to nothing in particular, and `0` is a value rather than an absence.

### Checks

```
vitest run packages/contract      70 files, 2989 tests passed   exit 0
eslint packages/contract/src                                     exit 0
tsc -p tsconfig.build.json                                       exit 0
generate (openapi.json + client)                                 clean
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[CONTRACT-086]` prefix
