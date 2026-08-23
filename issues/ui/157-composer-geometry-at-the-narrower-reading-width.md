# [UI-157] The composer's address line misbehaves at the path column's 440px

## Domain
ui

## Priority
P2

## Status
todo

## Model
opus

## Dependencies
- Depends on: UI-149 (which found it)
- Related: SHARED-061 — nothing resizes because of what it holds

## Spec References
- SPEC.md §10 — "UI — the board", the reader and its composers

## Summary

Found by UI-149's implementer while porting the e2e suites to the new default
reading width, and **reproduced with a probe rather than inferred** from a
failing assertion.

A path column is 440px at base, where a query column's reader used to be 560px.
At the narrower width the composer's address line can wrap, or scroll under a
click, when the composer's foot sits at the clipped edge of the reading surface:
the click's `pointerdown` scrolls the foot into view and the `mouseup` lands
somewhere else, so the click misses its target.

Surfaced through `address-room-geometry` and `resident`. Both suites are ported
and green — they now open at a seeded 560 width through "Open here", which
preserves the claims they were written to make. **So this issue is not a red
test. It is a behaviour nobody is asserting.**

## Why it is filed rather than fixed

UI-149 was already the largest change in Phase 41, and the honest scope of this
one is the composer's geometry at any narrow width — not the width UI-149
happened to choose. It belongs with SHARED-061's rule: a surface is as large as
its place allows, and a control inside it must stay reachable at every width the
place can take, rather than at the one width the tests happen to use.

## Acceptance Criteria
- [ ] A composer at 440px keeps its address line and its send control reachable
      by pointer, with no scroll-under-click
- [ ] Measured across the width range a path column can actually take, not at
      one chosen number
- [ ] The ported suites can drop their seeded 560 width and still pass
- [ ] A test fails when the geometry regresses — a click that misses is
      invisible to any assertion that only checks the element exists

## Testing Strategy
Playwright, with a real pointer sequence rather than a synthetic click, at
several widths.

## E2E Verification Plan
### Verification Steps
1. Open a document in a path column at 440px.
2. Put the composer's foot at the clipped edge.
3. Click the address line with a real pointer, and again at 560 and at the
   maximum width.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-157]` prefix
