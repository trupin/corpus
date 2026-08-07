# [CONTRACT-041] A thread has no way to be re-attached to a range a person chose

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-072, UI-086

## Spec References

- SPEC.md §6 Anchoring
- SPEC.md §9.2 — the route inventory

## Summary

Phase B of SERVER-059's chosen route needs a door that does not exist. Today a
thread's anchor is written at creation and rewritten only by reconciliation,
which runs on save and has the diff. There is no way for a **person's decision**
to correct a selector.

## Acceptance Criteria

- [ ] A route that re-attaches an existing thread to a range the caller names
- [ ] The request carries the **range**, not a candidate index or a score — the
      server must not depend on having generated the same candidate list the UI
      showed, or the two drift and a stale list silently attaches to the wrong
      place
- [ ] The server recomputes the selector from the document's bytes (the same
      rule SERVER-071 establishes for creation), rather than storing what the
      caller sends
- [ ] A range that no longer exists, or that overlaps another thread's text, is
      refused with a distinguishable status — not merged and not silently
      dropped
- [ ] It is explicit that this route is **person-initiated**. Whether the agent
      may call it is a spec question, not an implementation default; if the
      answer is no, the contract says so
- [ ] `openapi.json` and the typed client regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/` and `packages/contract/src/schemas/`, plus
  regenerated artifacts.

### Notes

- **§9.2 will need a line for this route.** That inventory has needed one three
  times on this project, was caught by review twice, and pre-empted once. A SPEC
  edit needs user sign-off — draft it in this issue and hold it rather than
  applying it.
- Re-attaching is a mutation of an existing thread, so it inherits §4's
  "one action, one commit" — check whether it composes with CONTRACT-037's work
  rather than inventing a second commit shape.

## Testing Strategy

Contract tests over the happy path, the vanished range, the overlapping range,
and shape rejection; the OpenAPI drift check as usual.

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
