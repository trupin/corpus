# [UI-140] A reveal on a cold open silently does nothing when the body is slow

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: UI-063 (whose anchored row leads to its anchor through this seam)
- Related: UI-079 (which diagnosed it and was misfiled as a test bug), UI-037
  (the reveal seam), PLUGINS-010

## Spec References

- SPEC.md **§11** — *"Selecting an anchored row reveals it at its anchor in the
  document"*, and the reveal-on-open behaviour UI-037 built

## Summary

Filed from UI-079's diagnosis, 2026-08-21. UI-079 was filed as a duration-shaped
test hazard — a spec waiting on a decoration with a finite lifetime. It is not.
The agent sent to make the spec sturdier measured it instead and found the spec
was right: **the flash is never drawn.**

`apps/ui/src/reader/useReaderSurface.ts:255-275` retries the reveal
`REVEAL_RETRIES × REVEAL_RETRY_MS` = 5 × 80ms ≈ **320ms** from the moment
`hasContent` goes true, then calls `revealedCallback` — spending the navigation
instruction — **whether or not anything was drawn**.

The comment above it says so deliberately: *"Giving up counts as honouring it"*,
which is right for a quote the document no longer contains. But it does not
distinguish **"not there"** from **"not there yet"**, and on a cold open the
editor is still mounting its own DOM.

So "open this document **at this**" opens the document at the top, draws no
flash, and forgets what it was for — with no signal to the user and nothing left
to retry from.

## Measured, not inferred

`reveal.spec.ts --workers=8 --repeat-each=20`: **9 failed of 360 (2.5%)**, no
synthetic load, on a 2026 laptop. **~19%** with four cores otherwise busy.
Failures hit 7 of 18 tests, all in the seeded cold-open describes; the
todo-click describe, which reveals into an already-mounted reader, never failed.

Three agreeing lines of evidence:

- `reveal.spec.ts:189`'s bare `toHaveCount(1)` failed with `14 × locator
  resolved to 0 elements` over 5s
- an in-page rAF sampler alive for 9.4s recorded `drawn=false` on every failure
  while `items=3` and `stored=reveal-consumed` — the instruction was spent
- uncontended, the same probe draws at t=843ms and removes at ~2000ms. Under
  load one PASS drew at **t=4325ms**, thirteen times the budget.

## Why this is P0 and in this release

UI-063 is this release's headline surface and its central act is *selecting an
anchored row reveals it at its anchor*. That act runs through this seam. A
comments list whose rows lead nowhere on one open in forty — one in five on a
loaded machine — has not shipped the thing the release is named for.

## What to build

Two things are worth deciding together, and the issue does not pre-decide them:

1. **Should the budget be frames rather than milliseconds?** A loaded machine
   has fewer frames per second, which is exactly when a millisecond budget
   shortens in real terms. The current budget is at its weakest precisely when
   the work is slowest.
2. **Should spending the instruction be conditional on having drawn something?**
   Giving up must stay possible — a quote the document no longer contains must
   not retry forever — but "not there" and "not there yet" need telling apart.

Whatever is chosen, a reveal that gives up should not do so silently: a person
who asked to be taken somewhere and was not is owed something.

## Acceptance Criteria

- [ ] A cold open with a reveal target draws its flash under contention, not
      only on an idle machine
- [ ] `reveal.spec.ts --workers=8 --repeat-each=20` passes 360/360, run with
      other cores loaded — the same rig that measured the defect
- [ ] A reveal target the document genuinely no longer contains still gives up,
      and does not retry forever
- [ ] Giving up is not silent
- [ ] The instruction is not spent on a reveal that drew nothing, or if it is,
      the reason is written down where the next reader will find it
- [ ] `reveal.spec.ts` is **not** made sturdier to accommodate the fix — UI-079
      declined to do that deliberately, and it is the only alarm on this surface

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/useReaderSurface.ts` — the retry budget and the callback
- `apps/ui/src/reader/reveal.ts` — the budget constants

### Notes

UI-079's log holds the full measurement rig and should be read before
re-measuring anything: the per-frame sampler, the load generator, and the exact
`--repeat-each` invocation are all recorded there.

## Testing Strategy

The defect is a race that fires on one open in forty, so a single green run
proves nothing. Use UI-079's rig: `--workers=8 --repeat-each=20` with cores
loaded, before and after.

## E2E Verification Plan

1. Reproduce at the measured rate before touching anything
2. Fix
3. Re-run the same rig and report the rate, not a pass/fail

## E2E Verification Log

_[Agent fills — state the model]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified
