# [UI-180] The composer's foot is crowded, and its two pickers do not match

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
- Related: UI-126 / UI-137 (the address line and its reserved slot), UI-173 (the
  owner picker this row gained last)

## Spec References

- SPEC.md §10 — the global composer, and the rider signed 2026-08-20: "a
  component's size is a property of its place in the layout, never of the text
  that happens to be in it"
- `design/index.html` — `.composer-foot`, which this row is meant to read like

## Summary

**User report, 2026-08-27, with a screenshot:** _"this looks crowded and
ugly."_ And, on the same row: _"The drop downs aren't even consistent."_

The global composer's foot holds seven things in one flexed row — the attach
button, the address line, the owner picker, the keyboard legend, a spacer, and
two submit buttons. In the screenshot:

1. **The legend wraps onto three lines.** `@ agents · / skills · [[ refs · ↵
   newline` is one sentence and it renders as three, which stretches the bar and
   is the whole of what reads as "crowded".
2. **Both pickers are truncated.** The address says `agent will answe…` and the
   owner says `its own ager` — cut mid-word, with no ellipsis on the second.
3. **The two pickers do not look like the same kind of control.** One is a kit
   pill and the other a native `<select>`, and they disagree about font size
   (10.5px against 11px), padding, and how they truncate.

## What is behind each

- The legend has no `white-space` rule, so it is the item with the most give and
  the row spends the shortfall on it. `.compose-actions` also carries
  `flex-wrap: wrap` under a media query, which is meant to stack **whole
  controls** and instead lets this one item wrap inside itself.
- `.composer-address` reserves `17ch + chrome` deliberately (UI-137), and that
  reservation is correct — `agent will answer` is exactly what it is sized for.
  It reads as truncated because the row around it is too tight, not because the
  slot is wrong. **Do not widen it without re-reading UI-137**, which records
  why the number is what it is.
- `.compose-resident select` is `max-width: 16ch` in an 11px mono, styled by
  hand beside a kit component that was styled for the same row at 10.5px.

## Acceptance Criteria

- [x] The legend renders on **one** line at the panel's ordinary width, or not
      at all — never wrapped
- [x] The two pickers share one visual register: same font, same size, same
      padding, same corner radius, same height, same truncation
- [x] Neither picker's reserved width changes as a value arrives (UI-137's rule
      still holds, and its measurement is not re-opened)
- [x] The row is one line at the panel's ordinary width
- [x] Whatever gives when the panel is genuinely too narrow is a **whole
      control**, not a sentence wrapping inside itself
- [x] The two submit buttons keep their places and their chords

## Technical Design

### Files to Create/Modify

- `apps/ui/src/compose/compose.css` — the row, the legend, the owner picker
- `packages/kit/src/address/address.css` — only if the shared register moves;
  read UI-137's measurement first
- `apps/ui/src/compose/ComposeOverlay.test.tsx` — the measurements

### Key Implementation Details

**Measure before changing anything.** The reproduction has to record the row's
height, the legend's line count and each picker's box, or the fix is a guess.

The legend is a hint and the least load-bearing thing in the row: it explains
sigils the placeholder already explains. Whatever it does when space runs short,
it must not be "become three lines tall".

### Edge Cases

- A long resident name in the owner picker
- The address line before its weight clause arrives — the slot is reserved and
  must stay reserved
- The narrow-panel media query, where whole controls are meant to stack

## Testing Strategy

Measure with `getBoundingClientRect()`: the row's height, the legend's height
against one line of its own font, and both pickers' computed font size, padding
and radius. Assert the pickers agree with each other rather than with a literal.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app, open the global composer
2. Expected: one row, one line of legend, two pickers that match
3. Actual: the legend is three lines, both pickers are cut, and they do not match

### Verification Steps

1. Rebuild, reopen the composer
2. Re-measure all of the above

## E2E Verification Log

_Filled in by the implementing agent._

**Implemented on: opus.**

### Reproduction, and the number that explained everything

Every child of the row, rendered width against its own `max-content`, at the
panel's own 640px:

```
row w=638.0 h=81.9  gap=10px  (content available: 606px)
  clip                w=24.0    natural=24.0
  composer-address    w=140.5   natural=140.5
  compose-resident    w=145.1   natural=145.1
  hint                w=83.9    natural=259.2    h=60.9   ← three lines
  btn-capture         w=85.3    natural=127.3    h=53.1   ← three lines
  btn-ask             w=57.3    natural=85.2     h=51.1   ← three lines
```

**The row needed 841px and had 606px.** Not just the legend: both submit labels
were broken across three lines each. "Crowded and ugly" was an understatement.

`design/index.html`'s `.compose-actions` holds **five** things — clip, hint,
spacer, Capture, Ask — and needs 526px. The product then added the address line
(UI-126, 140px) and the owner picker (UI-173, 145px) to that same row without
re-measuring it: 286px into a bar with about 70px of slack.

**The CSS had already recorded the decision that this broke.** A note on the
hint said it "is the item with slack: it wraps to further lines inside the same
bar, so the whole of it is still read", and measured the bar at 74.1px. That
reasoning was sound for a row of six. It stopped being sound when the seventh
arrived, and nothing re-read it.

### The fix

Two rows, split along **what the controls are** rather than along what fits.
The address and the owner say *who answers and who will own this* — settings,
read before pressing. The row below is the send. So the prototype's action row
is restored exactly, and the two controls it never budgeted for get a line of
their own.

After:

```
.compose-settings  h=30.2
   composer-address  w=140.5  natural=140.5
   compose-resident  w=138.8  natural=138.8
.compose-actions   h=51.6
   clip              w=24.0    natural=24.0
   hint              w=259.2   natural=259.2   h=15.2   ← one line, whole
   spacer            w=70.3                             ← slack, at last
   btn-capture       w=127.3   natural=127.3
   btn-ask           w=85.2    natural=85.2
```

Nothing is squeezed and the action row has 70px to spare.

### The pickers

`.compose-resident select` now wears `button.address-line`'s register, value for
value: 10.5px mono, `999px` radius, `2px 9px` padding, `var(--surface)` ground.
They were 11px against 10.5px, a 6px radius against a pill, different padding
and different heights — two different kinds of DOM element that nothing made
agree. The spec asserts them **against each other**, so the day the kit's pill
changes this goes red instead of drifting again.

### Falsification, and the test it corrected

The first version of the squeeze test asserted only "the legend is one line".
Putting all seven controls back in one row **left it green** — `white-space:
nowrap` makes an ellipsised legend one line, and a truncated label in a 640px
panel is the same complaint by another route. The test now measures every
child's rendered width against its own content. Re-falsified:

```
× no control in the row is squeezed below its own content
  + "hint 100.3 of 259.2"
  + "btn-capture 85.3 of 127.3"
  + "btn-ask 57.3 of 85.2"
```

Which names exactly the three controls in the user's screenshot.

## Completion Checklist (domain agent)

- [x] Reproduced with measurements before any code changed
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
