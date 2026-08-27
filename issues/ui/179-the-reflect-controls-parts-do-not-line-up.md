# [UI-179] The Reflect control's parts do not line up

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-172 (the switch this defect arrived with), UI-153 (the control)

## Spec References

- SPEC.md §10 — the board bar, and "nothing resizes because of what it holds"
- SPEC.md §7, rider 9 — the reflection clock and its control

## Summary

**User report, 2026-08-27, with a screenshot:** _"Alignment is broken."_

The board bar's Reflect control renders three parts in a row — the ask
(`reflecting…`), the automatic switch (`auto off`), and the clock
(`reflected 1d`). In the screenshot the switch sits hard against the clock with
no gap at all, while the ask and the switch are spaced normally. The row reads
as two chips glued to a word rather than as three evenly-spaced parts.

## The suspected cause, to be confirmed by the reproduction

`.reflect-auto` reserves the switch's slot at `width: 7ch` so the control can
render at a fixed width before the status arrives (UI-172's rule: the arrival
paints and moves nothing beside it).

`ch` resolves against **the element's own font**, and `.reflect-auto` inherits
the bar's proportional font. The switch inside it uses `var(--mono)` at
`10.5px`, plus `padding: 2px 6px` and a 1px border on each side. If the switch's
rendered width exceeds 7ch of the *inherited* font, it overflows its slot — and
because the slot is `flex: none` at a fixed width, the overflow spills to the
right and eats the `gap: 6px` that should separate it from the clock.

`auto off` is the wider of the two labels and the one the CSS says the slot is
sized for, so the "off" state is where it shows.

**Measure before changing anything.** The reproduction has to record the slot's
width and the switch's width, in both states, or the fix is a guess.

## Acceptance Criteria

- [x] The switch fits inside its reserved slot in **both** states (`auto`, `auto off`)
- [x] The gap between the switch and the clock equals the gap between the ask and
      the switch — one rhythm across the control
- [x] The slot is still reserved before the status arrives, and the switch's
      arrival still moves nothing beside it (UI-172's rule holds)
- [x] Flipping the switch does not re-width anything
- [x] The board bar is still 38px tall (the e2e spec that pins it stays green)
- [x] A test measures the two gaps rather than asserting a class name

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reflect/ReflectControl.css` — the slot
- `apps/ui/src/reflect/ReflectControl.test.tsx` or an e2e spec — the measurement

### Key Implementation Details

Whatever the slot's width becomes, it must be expressed in a unit that measures
**the switch's own font**, not the bar's — otherwise the same bug returns the
next time either font changes. The honest options are: size the slot in the
switch's own units by setting the mono font on the wrapper, or drop the fixed
width and reserve the space a different way.

Do not fix it by removing the reservation. It exists because a control that
rendered nothing and then a switch would shift the bar when the status arrived,
which is the defect UI-172 records.

### Edge Cases

- The status has not arrived: the slot is empty and still holds its width
- `auto` (the shorter label) must not leave a visible hole where `auto off` was
- A digest exists, so the clock is a `<button>` rather than a `<span>` — the
  gaps must be the same either way

## Testing Strategy

Measure `getBoundingClientRect()` for the switch, its wrapper and the clock, and
assert the two gaps are equal and the switch is contained. A class-name
assertion would pass while the pixels stayed wrong, which is what let this ship.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app against a real workspace
2. Look at the board bar with automatic reflection **off**
3. Expected: even spacing between the ask, the switch and the clock
4. Actual: the switch touches the clock

### Verification Steps

1. Rebuild and reload
2. Measure the three boxes in both switch states
3. Expected: the switch is inside its slot and both gaps are equal

## E2E Verification Log

_Filled in by the implementing agent._

**Implemented on: opus.**

### Reproduction

`apps/ui/e2e/foot-geometry.spec.ts`, against the real board in a real browser,
before a line of CSS changed:

```
✘ the switch sits inside its slot, and the gaps either side of it match
  Expected: <= 1198.625      (the slot's right edge)
  Received:    1206.546875   (the switch's right edge)
```

**8.4px past its own slot.** The slot is `flex: none`, so the overflow spills
rightwards and eats the `gap: 6px` before the clock — which is exactly the
screenshot: `auto off` hard against `reflected 1d` while the ask beside it has
a normal gap.

The cause was the one the issue suspected. `width: 7ch` sat on a wrapper that
inherits the bar's proportional face, while the switch inside it draws in
`var(--mono)` at `10.5px`: `ch` measured one font and the content drew in
another.

### The fix, and the part the first attempt missed

The wrapper now carries the switch's own font, and the width is stated as what
it holds: `calc(8ch + 0.32em + 14px)` — eight characters (`auto off`, the
longer label), the tracking those characters carry, and the chrome the switch
spends on everything that is not the word.

The middle term was not in the first attempt and the overflow only fell from
8.4px to **2.9px**:

```
Expected: <= 1198.625
Received:    1201.5
```

`letter-spacing: 0.04em` is on the switch and `ch` does not measure it. Eight
characters carry eight tracking gaps, hence `0.32em`. Every term is checkable
against the button below it rather than trusted.

**The `margin-left: 8px` went too.** It made the gap before the switch 14px and
the gap after it 6px — a second reason the row read as lopsided, independent of
the overflow. One rhythm now, `.reflect`'s own `gap` on both sides, and the test
asserts the two gaps against **each other** rather than against a number.

### One thing the fix needed that did not exist

`PUT /api/workspace/reflect/quiet` was not implemented in `e2e/stubCorpus.ts` at
all, so the switch could not be pressed in a browser and "flipping it moves
nothing beside it" was unrunnable. UI-172 shipped the switch without it. The
stub now echoes the value it is given on the whole status, as the real route
does.

### Post-implementation verification

```
✓ the switch sits inside its slot, and the gaps either side of it match
✓ flipping the switch moves nothing beside it
```

### Falsification

Restoring `width: 7ch` on a wrapper without the mono font:

```
1 failed  × the switch sits inside its slot, and the gaps either side of it match
1 passed
```

## Completion Checklist (domain agent)

- [x] Reproduced with measurements before any code changed
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
