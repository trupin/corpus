# [UI-181] The Reflect label runs its count into its noun

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
- Related: UI-179 (the same control), UI-153 (the label), SHARED-062's rider on
  §10 (the count's own box)

## Spec References

- SPEC.md §10 — the board bar, and the rider signed 2026-08-20 giving the count
  a fixed-width slot
- SPEC.md §7, rider 9 — the reflection clock

## Summary

**User report, 2026-08-27, with a screenshot:** _"there's no space between 5 and
changes."_

The control reads `Reflect ·  5changes since 1d`. The space that belongs after
the number is missing, and the gap before it looks doubled.

## What is behind it

**The string is correct and the layout eats it.** Probed in a real browser:

```
textContent  "Reflect · 5 changes since 1w"
aria-label   "Reflect · 5 changes since 1w"
innerText    "Reflect ·\n5\nchanges since 1w"
display      flex
childNodes   #text:"Reflect · "   SPAN:"5"   #text:" changes since 1w"
```

`reflectControlLabel` composes the three pieces with their spaces, and the DOM
carries them. `.reflect-ask` is `display: flex`, so **each contiguous run of text
becomes an anonymous flex item, and CSS strips whitespace at both ends of one**.
Both spaces disappear at layout, which no assertion on `textContent` or on the
accessible name can see — and both existing tests assert exactly those.

The doubled gap before the number is a different thing and is **not** a defect:
`.reflect-count` is `min-width: 2ch; text-align: right`, so a one-digit count is
right-aligned in a two-digit slot. That reserved column is what keeps `9` → `10`
from moving anything, and it is the trade SHARED-062's rider signed.

## Acceptance Criteria

- [x] The rendered label reads `Reflect · 5 changes since 1d` — the space after
      the count is visible
- [x] The test measures **`innerText`**, not `textContent`: the string was
      always right, and asserting it again would pass while the defect stood
- [x] The count keeps its fixed-width slot, so a count crossing to two digits
      still moves nothing
- [x] The accessible name is still one sentence
- [x] The board bar is still 38px tall

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reflect/ReflectControl.tsx` — the three pieces
- `apps/ui/src/reflect/ReflectControl.css` — whitespace that survives a flex row
- `apps/ui/e2e/foot-geometry.spec.ts` — the measurement

### Key Implementation Details

The lead and the trail have to stop being anonymous flex items, or their
whitespace has to stop being trimmable. Wrapping each in an element and giving
it `white-space: pre` does both, and keeps `reflectControlLabel` composing the
sentence exactly as it does now — the fix belongs in the rendering, not in the
strings, because the strings were never wrong.

Do not fix it with a flex `gap`: the count's slot already supplies the space on
its left, and a uniform gap would add a second one there.

### Edge Cases

- `Reflect` with no count at all — the trail is empty and must add nothing
- `reflecting…` — one piece, no count
- A two-digit count, where the slot is full and the spaces are the only spacing

## Testing Strategy

`innerText` in a real browser, against the label `reflectControlLabel` composed.
Falsify by removing the whitespace rule and confirming the assertion goes red.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real app, a corpus with unreflected documents and a clock behind them
2. Expected: `Reflect · 5 changes since 1d`
3. Actual: `Reflect ·  5changes since 1d`

### Verification Steps

1. Rebuild, reload, read `innerText` off the button

## E2E Verification Log

_Filled in by the implementing agent._

**Implemented on: opus.**

### Reproduction

Probed in a real browser before anything changed — the summary above carries it,
and the line that matters is:

```
textContent  "Reflect · 5 changes since 1w"     ← both spaces
innerText    "Reflect ·\n5\nchanges since 1w"   ← neither
```

### The fix

`label.lead` and `label.trail` are rendered inside `<span className="reflect-said">`
with `white-space: pre`. They stop being anonymous flex items, so nothing trims
them. `reflectControlLabel` is untouched: the strings were never wrong.

`pre` rather than `nowrap`, deliberately — `nowrap` still collapses a **leading**
space, and a leading space is exactly what the trail carries.

### The measurement changed twice, and the second time is the point

**`innerText` cannot answer this question.** With the fix in, it reports
`"Reflect · \n5\nchanges since 1w"` — a flex row's items are block boxes to
`innerText`, so it inserts a newline between every piece whatever the spacing
does. The acceptance criterion asked for `innerText` and was wrong to.

**Box-to-box gaps cannot answer it either.** The trail's leading space lives
*inside* the trail's own box, so `trail.left - count.right` is zero whether the
space survives or not.

What answers it is a `Range` over one character: the gap between the count box
and the trail's **first visible glyph**, measured against the width of a space
in the label's own font. That is the only form of the question that a person
looking at the screen is asking.

### Post-implementation verification

```
✓ the label's count keeps a space on either side of it
```

The rendered text is `Reflect · 5 changes since 1w`, every part shares one top
edge, and the accessible name is unchanged.

### Falsification

`white-space: pre` → `normal`:

```
✘ the label's count keeps a space on either side of it
1 failed
```

## Completion Checklist (domain agent)

- [x] Reproduced in a browser before any code changed
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
