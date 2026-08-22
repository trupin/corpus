# [UI-138] A lane's liveness word re-cuts the name beside it, on a 15-second clock

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
- Related: UI-134 (which found it), UI-131 (which holds the surface), SHARED-057

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§7** — presence: a lane is live exactly while it holds a parked scoped `idle`

## Summary

Found by UI-134's implementer and flagged as out of its scope, then found again
by PR #53's reviewer as a residual with **no owner at all** — not a latent row in
UI-128's ledger, not in UI-136, and in no issue. Filed here so it has one.

`.lane-meta` (`apps/ui/src/console/console.css`) renders a **word** rather than a
number: `live`, `lapsed`, `waiting`, `unknown`. It carries `margin-left: auto`,
so its width decides where `.lane-name` beside it is cut. The words differ in
length, and the value changes on a **fifteen-second** clock as presence is
re-evaluated — so the name re-cuts itself while a person reads the roster, with
nobody touching anything.

It is the same defect as the counts UI-134 fixed, one axis over: `tabular-nums`
cannot help, because the variation is in letters rather than digits.

## Why it was left

UI-134's remit was digit stability, and this is a word. UI-131 was holding the
surface at the time. Neither is a reason it should have ended up unowned, and
the ledger correction in UI-128 records that.

## Acceptance Criteria

- [ ] `.lane-meta`'s width does not depend on which of its four words it holds
- [ ] `.lane-name` is cut at the same point in all four states — measured before
      and after a state change, not asserted by eye
- [ ] The reservation is sized against the four real words, and the measurement
      is stated (SHARED-057 clause 3)
- [ ] A browser test drives a lane through at least two liveness states and
      asserts the name's box is unchanged. **Falsify** by removing the reservation
- [ ] If a workspace can produce a fifth word, say what happens to it

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/console.css` — `.lane-meta`
- `apps/ui/e2e/` — the geometry assertion

### Key Implementation Details

Read UI-131's `.lane-weight` fix in the same file: a fixed `ch` width with
ellipsis, chosen because a `min-width` computed from arrived content is the same
reflow with a later trigger. The same reasoning applies, and the vocabulary here
is closed at four words, so it is easier.

### Edge Cases

- A lane whose presence flips while the pointer is on its row
- The orchestrator's row, which has no resident but does have liveness

## Testing Strategy

A browser geometry test — the clock and the layout are both things jsdom cannot
see.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. A roster with a long lane name; measure the name's box
3. Drive the lane from `live` to `lapsed`; measure again
4. Confirm unchanged

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-138]` prefix
