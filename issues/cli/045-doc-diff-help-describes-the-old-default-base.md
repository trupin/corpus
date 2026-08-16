# [CLI-045] `corpus doc diff --help` describes the old default base

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour being described)
- Related: CONTRACT-052 (the same sentence in the published OpenAPI),
  SHARED-045 (the same sentence in SPEC.md)

## Spec References

- SPEC.md §4 — party-scoped commit windows, path-scoped per-document diffs

## Summary

`SERVER-113` changed the diff default base to *the previous commit that touched
this document*. `apps/cli/src/commands/doc/diff.ts` still tells the reader it is
the parent of `to`, at roughly lines 193 and 219.

Lower priority than `CONTRACT-052` only because the audience is narrower and the
correction is cheaper to discover — an agent reading the help and getting a
surprising range can run `git log -- <path>` and see why. An API consumer reading
`openapi.json` gets no such hint.

## Acceptance Criteria

- [ ] The help text states the actual rule, including the empty-tree case for a
      document whose only commit is its first
- [ ] Any other CLI surface describing the diff base is swept in the same pass —
      check `doc show`, the edit-acknowledgment help, and the man-page-style
      output, not only the two known lines
- [ ] No behavioural change

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/diff.ts`

## Testing Strategy

If help text is snapshot-tested, update the snapshot; otherwise this is a
read-and-fix with no new test, and say so rather than inventing one.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] `/lint` passes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-045]` prefix
