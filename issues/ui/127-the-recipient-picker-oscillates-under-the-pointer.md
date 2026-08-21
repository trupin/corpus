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

_[Agent fills — the reproduction goes here first]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-127]` prefix
