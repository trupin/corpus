# [SERVER-072] Write the corrected selector when a person re-attaches a thread

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-041, SERVER-071 (the selector computation this reuses)
- Blocks: UI-086

## Spec References

- SPEC.md §4 — one action, one commit
- SPEC.md §6 Anchoring

## Summary

The write behind CONTRACT-041. A person has chosen where an orphaned comment
belongs; this makes the choice durable.

## Acceptance Criteria

- [ ] The thread's selector is recomputed from the document's bytes over the
      chosen range and persisted — the same computation SERVER-071 establishes
      for creation, called, not re-implemented
- [ ] The change lands as **one commit** with an author that makes it auditable
      as a person's repair rather than a reconciliation
- [ ] The comment resolves normally on the next read, with no fuzzy rung
- [ ] A range that vanished between the person seeing it and choosing it is
      refused, not approximated. The document is live and the window is real
- [ ] Overlap with another thread's text is refused (§6: two threads on disjoint
      text never claim overlapping text)
- [ ] Nothing else about the thread changes — not its status, not its turns, not
      its timestamps beyond what the commit itself records

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/`, reusing SERVER-071's context computation.

### Notes

- **This is the one path where a selector is rewritten without a diff**, so it
  is worth being explicit in the code about why that is admissible here and
  nowhere else: the evidence is the person's choice, which reconciliation does
  not have and a reader cannot obtain. Say it in the docblock — SERVER-055 was
  reverted for making the opposite call and a future reader will meet this
  function before they meet that history.
- Check the projection: an orphan that becomes attached changes what the board
  shows, so the invalidation has to be right or the repair looks like it failed
  until a reload.

## Testing Strategy

Round-trip through the real route: orphan → re-attach → the file's stored
selector matches the chosen bytes → a fresh read resolves it. Plus the vanished
range, the overlapping range, and an assertion that the commit is one commit.

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
