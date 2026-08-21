# [UI-136] Two surfaces are drawn taller than the room they open into

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-130 (which measured the first), UI-129 (which measured the second), SHARED-057

## Spec References

- SPEC.md **§11** — the search overlay, the composer, and *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

Two findings from the v0.15.0 fixes, both **pre-existing**, both left rather than
folded into a P0 or a P1 whose scope they are not.

**1. The search panel clips the global composer's address card.** Found by
UI-130. `.search-panel` sets `overflow: hidden`, and the card has always been
drawn taller than the room above the composer's line there — **157px against
132px** — so its top padding and its lead are cropped. UI-130 deliberately bounds
the card to the nearest **scrollport** rather than to the nearest clip, because
bounding to the clip squeezed a three-lane list to one visible row and broke
UI-127's compose test. The reasoning is written into `clipperOf`'s docblock.

**2. A reader column resolves its width asynchronously.** Found by UI-129 while
stabilising a spec: a column measured **345px at first paint and 558px settled**.
Everything laid out against that width moves when it lands. That agent worked
around it in the test with a `settledReader()` helper that waits for two
identical readings — a test-side repair for a product-side fact.

The second is the same class as three of the audit's six clusters: **a value that
arrives later than the box laid out against it** (SHARED-057 names it in its
first sentence).

## Why these are one issue

Both are *placement against a container whose size is not yet known*, rather than
a box that follows its own content. They are the residue of the same sweep, and
solving either probably teaches the other.

## Acceptance Criteria

- [ ] The global composer's address card is fully visible inside the search
      overlay, with its lead and padding intact, at 1280×720 and at the smallest
      viewport the suite exercises
- [ ] Whatever bounds it there does **not** squeeze a three-lane list to one
      visible row — UI-130 tried that and it failed UI-127's compose test
- [ ] A reader column's width is settled before content is laid out against it,
      or the content tolerates the change without moving
- [ ] `settledReader()` in the e2e helpers is no longer needed to hide a product
      fact — either it is deleted, or its docblock says which product behaviour it
      still legitimately waits for
- [ ] A browser test measures each, falsified by reverting

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx` — `clipperOf`, and read its
  docblock before changing what it bounds to
- `apps/ui/src/search/` — `.search-panel`'s `overflow`
- the reader column's width resolution
- `apps/ui/e2e/` — the helper and the measurements

### Key Implementation Details

**Read `clipperOf`'s docblock first.** It records exactly why bounding to a clip
was rejected once, and a fix that re-derives that decision without reading it will
re-derive the failure too.

### Edge Cases

- A composer inside the focus shell
- The comment popover, which has no scrollport above it and is already correct
- A column being dragged wider while a card is open

## Testing Strategy

Browser geometry tests. jsdom implements no layout, so neither of these is
visible to a unit test.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Open the search overlay, open the composer's address card, measure its top
   against the panel's clip
3. Load a reader column cold and measure its width at first paint and settled
4. Confirm nothing laid out against it moved

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-136]` prefix
