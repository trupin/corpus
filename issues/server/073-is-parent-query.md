# [SERVER-073] Answer `isParent` in the collection query

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-042
- Blocks: UI-088

## Spec References

- SPEC.md §9.2 — the collection query endpoint
- SPEC.md §9.1 — the projection

## Summary

The server half of the user's `isParent` request (see CONTRACT-042 for the
decided semantics): `isParent=true` selects documents with **no parent**.

## Acceptance Criteria

- [ ] `isParent=true` returns only rows whose `parent` is null; `isParent=false`
      only rows where it is set
- [ ] Absent changes nothing about the result set — asserted, not assumed
- [ ] It **composes** with every other filter, including `q` (FTS), `type`,
      `needs=` and paging. A filter that works alone and breaks under
      composition is the failure mode worth testing for here, because views
      combine filters by nature
- [ ] `total` / paging counts reflect the filter, so a windowed answer does not
      look complete (the defect CONTRACT-035 exists for)
- [ ] The contradiction case (`parent=<id>` together with `isParent=true`)
      behaves as CONTRACT-042 declared — same behaviour, not merely compatible
- [ ] A query plan that does not table-scan: check whether the existing index
      set covers a null test on `parent`, and say what you found

## Technical Design

### Files to Create/Modify

- The collection query builder in `apps/server/src/docs/`, and the projection
  index set in `apps/server/src/projection/` if one is needed.

### Notes

- If an index is added, that is a `SCHEMA_VERSION` bump and a rebuild — say so
  and follow the note convention already in `projection/schema.ts`, which
  records *why* each bump changes verdicts for bytes already on disk.
- Check what `parent` actually holds for non-thread rows before implementing the
  null test; CONTRACT-042 flags this as a thing to verify rather than assume.

## Testing Strategy

Fixtures with top-level documents, child threads, and a standalone document with
no children (which must match `isParent=true`). Composition with `q`, `type`,
`needs=` and paging. Plus the contradiction case.

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
