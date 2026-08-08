# [UI-091] Pre-check the two refusals the composer still cannot see

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-044
- Blocks: —

## Spec References

- SPEC.md §11 — the form says what is wrong before it is sent

## Summary

Completes PR #28's pre-check. `formPreflight.ts` covers the marker collisions;
the unterminated fence and the fabricated turn heading arrive as a write refusal
instead, because the scanners were unreachable (CONTRACT-044 fixes that).

§11 was deliberately scoped on review to promise only what ships, so this issue
is what lets that sentence widen — and widening it is a **SPEC edit needing user
sign-off**, drafted here and held, not applied.

## Acceptance Criteria

- [ ] An answer leaving a fence open is caught before submitting, naming the
      field and the line the fence opened on
- [ ] An answer containing a fabricated turn heading is caught the same way, if
      CONTRACT-044 moved `parseTurns`; if it did not, this criterion is dropped
      explicitly rather than quietly
- [ ] It **calls** the shared scanner, never a copy
- [ ] The server refusal stays as the backstop and keeps working — this is a
      second line of defence, not a replacement
- [ ] The e2e stub exercises the same rule the server does
- [ ] A §11 amendment is drafted for user sign-off and held

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/formPreflight.ts`, whose docblock already records why
  these two are absent — update it rather than leaving a stale explanation.

## Testing Strategy

Fixtures for both shapes asserted as caught before any request is made, with the
zero-requests assertion the existing pre-check tests already use.

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
