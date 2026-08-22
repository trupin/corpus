# [UI-143] `--says-lines: 4` is over-reserved now that the card has room

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-142
- Related: SHARED-061, SHARED-057, UI-137

## Spec References
- SPEC.md **§10** — SHARED-057's reserve rule and SHARED-061's room rule, which are one rule in two halves

## Summary

Raised by UI-142's implementer against its own fix, 2026-08-21.

`--says-lines: 4` reserves four lines for a lane's §7 statement in the composer
address card. That reservation was measured when the card was 240px wide. UI-142
widened it to the room it actually has — 400px in the reported case — and at the
wider measure **no §7 statement reaches four lines**, so an ordinary card now
carries roughly two lines of white space.

## Why it was left, and why that reasoning is worth keeping

The implementer declined to shrink it, and the argument is the same one
SHARED-061 was written on:

> a smaller count is a constant re-measured at one measure, and the measure is
> no longer one thing.

That is right. Changing `4` to `2` would fix the reported card at the width it
happens to have today and would be wrong again the moment the card is wider or
narrower — which, after UI-142, it now legitimately is. The defect is not the
number's value; it is that the reservation is expressed in **lines** while the
thing it reserves for is measured in **characters at a width**.

## What to build

A reservation derived from the room, as SHARED-061 requires of a bound:
the statement's own height at the card's actual width, reserved so it does not
move when it arrives late (SHARED-057's requirement, which is what
`--says-lines` exists for and must survive).

**Both halves must hold at once**, and that is the whole difficulty:
- the box must not grow when the statement lands (SHARED-057), and
- the box must not reserve room the statement cannot use (SHARED-061).

The honest shape is that the reserve is computed from the width the card has,
not chosen ahead. UI-142's `roomFor()` already measures the room in both axes
and is the obvious place to start.

## Acceptance Criteria
- [ ] The card reserves the height its statement can actually occupy at its
      current width
- [ ] The statement arriving still moves nothing (SHARED-057 unbroken — this is
      the criterion the original reserve exists for)
- [ ] No new pixel or line constant: the reserve is derived
- [ ] Measured at three card widths, including the narrow case that motivated
      `4` in the first place, and the wide case UI-142 created
- [ ] The white space in the reported case is gone

## Testing Strategy
A geometry spec asserting the relationship — the reserve equals the rendered
statement's height at that width — never a pinned line count or pixel value.

## E2E Verification Log
_[Agent fills — state the model]_
