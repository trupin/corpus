# [UI-127] The recipient picker oscillates under the pointer

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20)
- Blocks: —
- Related: UI-126 (which shipped the control), UI-128 (the audit this is an instance of)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§11** — the composer's recipient statement

## Summary

Reported by the user, 2026-08-20: *"The drop down to pick an agent when
commenting is blinking up and down which makes it impossible to use."*

**A regression shipped in v0.14.0**, by the issue (UI-126) whose whole purpose
was to make that control honest. An honest control a person cannot click is not
an improvement on the one it replaced.

## The mechanism, from reading — to be confirmed by reproduction first

Hovering a lane row calls `onPreview(row.lane)`, which sets `previewed`, which
changes `shown`, which changes the sentence rendered by `.recipient-says`
(`ComposerAddress.tsx:156`). That sentence has **no fixed height** and wraps
inside the popover's `max-width: min(330px, 86vw)`, so a longer statement adds a
line.

`.address-pop` is `position: absolute; bottom: calc(100% + 6px)` — anchored by
its **bottom** edge and growing **upward**. So one extra line of statement moves
**every row in the popover up**. The row under the cursor leaves the cursor,
`onMouseLeave` fires, `previewed` clears, the statement shrinks, the row returns
under the cursor, `onMouseEnter` fires.

That is a closed loop rather than a slow render, which is why it is unusable
rather than merely ugly.

**Reproduce before fixing.** A diagnosis from reading is not a reproduction, and
if a second cause is present — an SSE roster refresh mid-hover, a focus-driven
scroll — a fix aimed only at the statement will look right and leave the blink.

## Acceptance Criteria

- [ ] The reproduction is recorded first: what was hovered, what moved, and by
      how much
- [ ] Hovering any lane row changes **words only**. The popover's height, and
      every row's position, are unchanged — measured, not asserted by eye
- [ ] The full statement is still readable for every row, including the longest
      (a profile name plus §7's missing-profile note). If it is truncated, the
      whole of it is reachable another way per SHARED-057
- [ ] The same holds for keyboard preview (`onFocus`/`onBlur`), which drives the
      identical state
- [ ] A browser test asserts the geometry: measure a row's bounding box, hover a
      different row, measure again, assert it did not move. **Falsify it** by
      restoring the growing statement and watching it fail
- [ ] §11's composer key contract is untouched, and the existing pins stay green

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx`
- `packages/kit/src/address/address.css`
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

**The rule to satisfy is SHARED-057**, not "make the blink stop": a component's
size is a property of its place, never of its content. A fix that merely damps
the oscillation — a hover delay, a transition — leaves the rule broken and the
symptom timing-dependent.

Reserve the statement's box. Sizing it to the longest real statement is the
straightforward reading of *"the box is sized for the text people actually
have"*; a hard two-line clamp with the full value revealed on the row's existing
`title` is the fallback where the longest statement is unreasonably long.

**Read `composerReach.ts`'s docblock before touching liveness** — the coupling
runs one way and this fix must not become a path between pressing send and a
request leaving.

### Edge Cases

- One lane only: the rows do not render at all (`showRows` needs two)
- A refused lane, which colours the statement and may change its length
- A missing profile, whose note is the longest statement the control has
- Very narrow viewports, where `86vw` binds before `330px`

## Testing Strategy

Unit tests for the model; a real-browser geometry test for the fix itself,
because this defect is a layout loop and jsdom implements no layout.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. A thread with at least two lanes, one with a missing profile
3. Hover each row in turn; measure every row's bounding box before and after
4. Repeat with the keyboard, tabbing between rows
5. Confirm the statement is fully readable for each

## E2E Verification Log

### Reproduction (orchestrator, 2026-08-20, real Chromium on Vite 5283)

Fixture: a standalone thread with a general lane and a **missing-profile**
resident (`{name: "claims-review", docId: null}`), which produces the control's
longest statement. Scratch spec kept at
`scratchpad/ui127-repro.spec.ts`.

**1. Playwright refuses to hover the row at all**, which is the defect in the
tool's own words:

```
Error: locator.hover: Test timeout of 30000ms exceeded.
  - locator resolved to <button … data-recipient-lane="th_solo" …>
  - attempting hover action
    2 × waiting for element to be visible and stable
      - element is not stable
    - retrying hover action
    54 × waiting for element to be visible and stable
      - element is not stable
```

58 stability retries across 30 seconds. Playwright calls an element stable when
its bounding box is unchanged across two consecutive animation frames, so this
is a measurement that the row never stops moving — not an impression.

**2. The amplitude, measured with the pointer parked at coordinates captured
before the popover could move** (so the pointer cannot chase it):

```
pointer away: says_h=85  pop_h=273
on row0     : says_h=34  pop_h=222
away again  : says_h=85  pop_h=273
on row1     : says_h=85  pop_h=273
```

**51 pixels**, and `.recipient-says` accounts for all of it.

**3. What the mechanism actually is — the reading-diagnosis above had the
direction wrong.** The statement does not *grow* on hover; the **resting** state
is the tall one. Effective recipient is the resident lane, whose statement is the
three-line missing-profile note (85px). Previewing the orchestrator lane collapses
it to one line (34px). The popover is bottom-anchored, so 51px vanishes from its
height and its contents shift — the row leaves the cursor, the preview clears,
the statement returns to three lines, the row comes back, and it repeats.

The direction does not change the fix, and the correction is recorded because a
fix aimed at "stop it growing" would have been aimed at the wrong end.

**4. It is content-dependent, which is why it escaped every existing test.** With
two lanes whose statements happen to be the same height, nothing moves — the
first attempt at this reproduction passed for exactly that reason. It takes a
workspace where one lane's statement is longer than another's, which is the
ordinary case with a real profile name and precisely what the user has.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-127]` prefix
