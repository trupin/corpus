# [UI-130] The address popover has no ceiling, and rises behind the reader head

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-127 (which measured it and made it 33px worse), SHARED-057

## Spec References

- SPEC.md **§11** — the composer, and *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

Found by UI-127's implementer while measuring the fix, 2026-08-20, and **not
caused by it**.

`.address-pop` has no maximum height and no flip. It grows upward from a
bottom edge, so a workspace with enough lanes produces a card taller than the
space above the composer. Measured at 1280×720 with **five lanes**: the card is
**312px** tall and its top reaches **y=112**, while `.reader-head` ends at
**y=159**. The card's top rows therefore sit behind the head, and the head takes
their pointer events — so those lanes cannot be clicked at all.

**UI-127 made it worse by 33px** and did not create it. Reserving four lines for
the statement adds that much to the resting card. That is stated plainly rather
than left for someone to discover: the fix was right, and it moved a pre-existing
edge closer.

A taller viewport does not help, because the composer sits under the last turn
rather than at the bottom of the reader.

## Why it is a separate issue from UI-127

A card that **resizes** and a card with **no ceiling** are different defects with
different fixes. UI-127's rule is SHARED-057's — size must not follow content.
This one is about a card whose size is legitimate and whose *placement* has no
bound. Folding them together would have meant shipping an unmeasured placement
change inside a P0 fix, on a control a person is currently unable to use.

## Acceptance Criteria

- [ ] The popover never overlaps `.reader-head`, at 1280×720 and at the smallest
      viewport the suite exercises
- [ ] With more lanes than fit, the card is bounded and its list scrolls — the
      bound is stated, and reaching it is visible rather than silent (SHARED-057:
      a listing that reached its bound says so)
- [ ] Every lane remains reachable by pointer **and** by keyboard, including the
      first row, with five lanes and with twenty
- [ ] A browser test measures the card's top against the head's bottom and
      asserts no overlap. **Falsify it** by removing the bound and watching it fail
- [ ] Whatever bounds it does not reintroduce content-driven sizing — the resting
      card's height must still not depend on which lane is previewed (UI-127's
      spec stays green)

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/address.css` — `.address-pop`
- `packages/kit/src/address/ComposerAddress.tsx` — only if a flip needs measuring
- `apps/ui/e2e/address-geometry.spec.ts` — the overlap assertion

### Key Implementation Details

**Read UI-127's E2E log first** for the measurements and the fixture that
produces five lanes. Its spec deliberately uses a three-row fixture, which clears
the head by 80px — so the existing suite passes and proves nothing about this.

A maximum height with an internal scroll is the smaller change. Flipping the card
below the composer is the other option and costs more: the composer sits mid-
document, so below is not reliably clearer than above.

### Edge Cases

- A composer inside the focus shell, where the surrounding chrome differs
- The comment popover host, which is itself already positioned against a selection
- One lane, where the card does not render rows at all

## Testing Strategy

A browser geometry test. jsdom implements no layout, so a unit test cannot see
this at all.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Five lanes, 1280×720: measure the card's top and the head's bottom
3. Click the topmost lane row; confirm the click reaches it
4. Repeat with twenty lanes

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-130]` prefix
