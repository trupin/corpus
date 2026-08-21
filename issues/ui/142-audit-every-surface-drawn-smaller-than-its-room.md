# [UI-142] Audit: every surface drawn smaller than the room it has

## Domain
ui

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-061
- Related: UI-128 (the audit this mirrors), UI-130, UI-136, SHARED-057

## Spec References
- SPEC.md **§11** — *"a surface is as large as its place allows"* (rider authorized 2026-08-21), and SHARED-057's paragraph immediately above it, which it completes

## Summary

The user reported the composer's address popover as unreadable — *"The size of
this window is so small I can't even see what's in it"* — and asked for the
class rather than the instance: *"Do an audit for these kinds of issues around
element size and fix them."*

SHARED-061 is the rule, authorized before this audit runs so that findings can
be checked against a paragraph rather than against taste. This issue is the
sweep.

## What to look for

The rule gives three checkable questions, and every finding must answer one of
them with a **measurement in a real browser**, not a reading of CSS:

1. **Is the bound a constant?** A `max-width`, `max-height` or a `--*-cap` in
   pixels, chosen once, that never consults the viewport, the host column, or
   the distance from the anchor to the edge. The reported defect is exactly
   this: `address.css` carries `max-width: min(330px, 86vw)` and
   `--address-pop-cap: 280px`.
2. **Does ordinary content need a scrollbar at a comfortable window size?** Not
   pathological content — ordinary. A lane list showing two of its lanes with
   `scroll for the rest` while the window is half empty is the reported symptom.
3. **Is the surface much smaller than what it opens over?** A popover a third
   the width of its column, a panel that could take the space beside it and does
   not.

## Where UI-128 already pointed

**Read UI-128's ledger first.** It recorded 31 latent sites, eight flagged as
promotion candidates, and it named three surfaces *"drawn larger than the room
they open into"* — the search overlay clipping the composer's card, a reader
column resolving its width asynchronously, and the reply footer over-full at the
default column width. Those are the same family seen from the other side and are
tracked as **UI-136**. Reconcile with it rather than re-filing it: if UI-136's
three are really this defect, say so and fold them in.

## Method, taken from UI-128 because it worked

- Read **every** stylesheet in `apps/ui/src` and `packages/kit/src`, in full.
  UI-128 read 28 and its value came from completeness, not sampling.
- Grep is a starting point, not the audit: `max-width`, `max-height`,
  `min-width`, `--*-cap`, `overflow: auto`, `overflow-y: scroll`. A constant
  bound is the signal; a scrollbar beside empty space is the confirmation.
- **Measure each reachable finding in a real browser at more than one window
  size.** A defect that only shows at 1440px is still a defect, and one that
  disappears at 1440px was never measured.
- **Rank by the order a person meets it.** UI-128 ranked six clusters and the
  ranking is what made the fixes tractable.
- Separate **reachable** from **latent** and say which is which. Do not fix a
  latent site silently; list it.

## The first finding is already known

`packages/kit/src/address/address.css` — the composer address card. Fix it as
part of this issue: it is what the user reported, and it should not wait behind
a sweep. Note the file's own comment, *"Every section keeps its size; the lane
list's is the one that gives"*, which was a reasonable decision under a rule
that only pointed one way and is now the wrong default.

**This file is in `packages/kit`.** The browser loads `packages/kit/dist`, so
nothing you change here is visible until `npm run build -w packages/kit`. Three
false negatives in the last release came from this exact trap.

## Acceptance Criteria
- [ ] Every stylesheet in `apps/ui/src` and `packages/kit/src` read in full, and
      the count reported
- [ ] A ledger: reachable findings ranked, latent findings listed, compliant
      surfaces counted — the shape UI-128 produced
- [ ] Every reachable finding carries a browser measurement at two window sizes
- [ ] The address card is fixed, and the user's screenshot case is re-measured
- [ ] Every fix is bounded against real room — viewport, host, or anchor
      distance — and no fix introduces a new pixel constant
- [ ] **No fix breaks SHARED-057.** Each resized surface is re-checked for
      growth driven by content; the room is the input and the content is not
- [ ] A surface that genuinely cannot be given its room says so
- [ ] UI-136 is reconciled: folded in, or explicitly kept apart with a reason

## Testing Strategy

Geometry specs in the manner of `reader-head-geometry.spec.ts` and
`digit-geometry.spec.ts`, which already exist and are the precedent. A test that
pins a pixel constant is the wrong test — v0.15.0 lost a CI cycle to exactly
that, because a constant true on one machine's fonts is false on another's.
Assert the **relationship**: the surface is at least some fraction of its host,
or grows when the viewport does.

## E2E Verification Plan

Reproduce the reported case first, at the window size the user was at, and
record the measurement before any fix.

## E2E Verification Log

_[Agent fills — state the model]_
