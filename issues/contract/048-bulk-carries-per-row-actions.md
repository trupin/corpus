# [CONTRACT-048] The bulk request cannot express a staged set

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-032 (signed 2026-08-09)
- Blocks: SERVER-087, UI-083

## Spec References

- SPEC.md **§11** — bulk mode, per-row staged actions, and Save
- SPEC.md **§4** — "A Save carrying a mix of verbs is still one act and still one
  commit"

## Summary

CONTRACT-037 shipped `POST /api/docs/bulk` as `{ids, action}` — **one verb over
many ids**. SHARED-032, signed 2026-08-09, makes each row carry its own staged
action, so archiving three documents and resolving two is one pass. That set
cannot be said in the shipped shape.

The user chose **pairs in one request** at sign-off, over the two alternatives:
grouping client-side into one request per verb is several commits, which is
exactly what §4 forbids and what this route was built to prevent; deferring the
question to UI-083 risks discovering the shape is wrong with the UI already
written against it.

## Acceptance Criteria

- [ ] The request carries a list of `{id, action}` pairs — one act, one commit,
      whatever mix of verbs it holds
- [ ] A whole-result-set selection is expressible: SHARED-032 stages it as a
      **single entry** carrying one action for a query rather than for enumerated
      ids, and the shape must say that without a second endpoint
- [ ] The response is unchanged in kind — the three parts still partition the
      **requested** ids, which PR #37 pinned in prose and two tests
- [ ] An id named twice with different actions is refused, and the refusal says
      so. Last-write-wins here is a silent choice about someone's documents
- [ ] `openapi.json` and the typed client regenerated, never hand-edited
- [ ] The §9.2 bullet is **redrafted before it is ever signed** — the held draft
      in `issues/contract/037-one-action-one-commit.md` describes the old shape.
      Draft it here and hold it; SPEC.md changes need the user's signature

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/bulk.ts`, `routes/bulk.ts`, regenerated
  artifacts.

### Notes

- Read CONTRACT-037's docblocks first: the reasoning for one route with an act
  discriminator, for ids rather than a filter, and for `commit` being one
  nullable sha is unchanged by this and should not be re-derived.
- `BulkAction` stays the discriminated union; what changes is what it is attached
  to. Keep it inline rather than registered — a `oneOf` has no `type: "object"`
  and the named-component invariant catches it.

## Testing Strategy

Round-trip a mixed set; a single-verb set (the old shape's case) still
expressible; a duplicate id with conflicting actions refused; the query-selection
entry; OpenAPI drift.

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
