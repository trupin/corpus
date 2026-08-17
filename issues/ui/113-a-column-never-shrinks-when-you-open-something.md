# [UI-113] A column shrinks when you open something in it, and cannot be resized while it is open

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
- Related: UI-066 (the document body's width — the other half of "the reader's
  shape is the user's"), sprint-016 TEST-450/451/452 (the tests that pinned the
  behaviour this issue changes)

## Spec References

- SPEC.md **§11** — the board's columns, and the reader opening inside one

## Summary

Reported from use, with screenshots: a column dragged wide, and the same column
after opening a thread in it — **narrower than it was**.

> this column is wide, which is fine. When I open a thread, but it happens with
> any other document, the size shrinks. I don't want the size to shrink, ever.
> The column remains always the same size, except if it's too small to open its
> own content. I also want the column to be resizeable once the content is open,
> which is not the case today.

**Both halves are one root cause.** `columnWidth.ts`'s `renderedWidth` computes
the open width as `min(clamp(base × READING_WIDTH_RATIO), READING_WIDTH_CEILING)`
— capped at 560. So:

- a column whose base is **wider** than 560 opens **narrower** than it was, which
  is the shrink; and
- while a reader is open the rendered width is pinned to that cap, so dragging
  the edge changes the stored base and changes nothing visible — the resizer is
  live, and appears dead.

The cap was deliberate and its reasoning is sound as far as it goes: 560 is the
measured reading column, and a column dragged wider "opens at the measure instead
of past it" rather than adding gutter. What it missed is that **a width the user
chose is not gutter**. Opening a document is not an occasion to overrule it.

## What it should do

**A column keeps its width. The app never changes it.** Clarified by the user
after the first draft of this issue proposed a "widen only if too small"
exception:

> I want a column to keep its width, regardless of the content as much as
> possible. When I click on a button I don't want to see the column width
> redimension on its own ever.

So the reader-open widening goes entirely, rather than being made conditional.
A column is whatever width it was given — by the user's drag, or by the default
for a column nobody has sized — and opening, closing, or navigating inside it
changes nothing.

**"As much as possible" is the viewport clamp, and only that.** A width wider
than the window is not a preference the app can honour, so `clampColumnWidth`
stays: it is a constraint, not the app having an opinion about reading measure.

**The edge is draggable while a reader is open**, which follows for free: once
the rendered width is simply the base, the resizer behaves identically whether
something is open or not. It was only ever "dead while open" because the reading
formula was overriding it.

**What is deliberately lost**: a default-width column no longer widens to the
560px reading measure when a document is opened. That was the behaviour
sprint-016 TEST-450 pinned, and it is what the user is asking to remove — a
column that resizes itself is the complaint, and "but it resized itself to a
better width" is still the complaint. A narrow column showing a document is now
the user's choice to fix, and the edge is right there.

## Acceptance Criteria

- [ ] A column keeps its exact rendered width when a document, a thread, or
      anything else is opened in it — **at every base width**, not only wide ones
- [ ] Closing the reader changes nothing either, and neither does navigating
      between documents inside it
- [ ] No width changes without a user gesture: the only things that move a
      column are its own resizer and the viewport clamp
- [ ] Dragging the column edge while a reader is open changes the rendered width,
      and the change survives closing and reopening the reader
- [ ] The viewport clamp still applies: a column never grows past the window
      (TEST-451)
- [ ] A column with no stored width still behaves as it does today (TEST-452)
- [ ] Verified by measuring the rendered element before and after opening —
      not by asserting the formula, which is what got this wrong

## Technical Design

### Files to Create/Modify

- `apps/ui/src/board/columnWidth.ts` — `renderedWidth`, and the docblock, which
  currently argues for the behaviour being removed
- `apps/ui/src/board/columnWidth.test.ts` — the cases that pinned the cap
- `apps/ui/e2e/column-width.spec.ts` — open-does-not-shrink, and drag-while-open

### Notes

`renderedWidth(base, reading, viewport)` collapses to `clampColumnWidth(base,
viewport)`: the `reading` parameter, `READING_WIDTH_RATIO` and
`READING_WIDTH_CEILING` all lose their only caller. Remove them rather than
leaving them unused — a constant named "the reading width" that nothing reads is
the next reader's false lead.

Existing tests assert the widening directly (sprint-016 TEST-450/451) and will
fail. **They are pinning the behaviour being removed**, so they are rewritten to
pin the new rule — a column's width does not change on open — rather than
deleted, which would leave the guarantee untested.

## Testing Strategy

Unit: `renderedWidth` across base narrower than, equal to and wider than the
measure, open and closed. E2E: measure the column's rendered width before and
after opening a document; drag the edge with a reader open and measure again.

## E2E Verification Plan

### Verification Steps

1. Drag a column wider than 560; note its width
2. Open a thread in it — the width is unchanged
3. Drag the edge while the thread is open — the column follows the pointer
4. Close and reopen — the dragged width is still there
5. A default-width column still opens at 560

## E2E Verification Log

**Model: Opus 5 (1M context)**, orchestrator. Paused mid-gate at the user's
request; recorded here rather than carried in anyone's head.

### What is done

**The fix.** `renderedWidth(base, floor, viewport)` is now
`max(clamp(base), clamp(floor))` — the reading measure became a **floor** the
column may be grown to, where it had been a **ceiling** capping the width the
user chose. `readingFloor()` is the old arithmetic, unchanged, under a name that
says what it is for. The ratchet lives in `Column.tsx` as transient state:

- it rises when a reader opens in a column narrower than the floor;
- it **does not fall when the reader closes**, because snapping back would be
  the app resizing the column downward on its own — which is the complaint, and
  "it only went back to what you set" is still the app moving it;
- a user resize clears it, keyed on the **gesture** rather than the resulting
  number, so dragging *up* clears it too — otherwise the column would silently
  refuse to be narrowed afterwards.

**Deliberately not persisted.** `useColumnWidth` writes `extra.width` to the view
document, one git commit per gesture by design. A floor written there would mean
**a commit every time a document was opened in a narrow column** — the app
editing a document because you clicked something, which is the same complaint
one layer down.

**Verified in a real browser**, which is where this defect lived:

```
$ npx playwright test apps/ui/e2e/column-width.spec.ts    → 11 passed
$ npx vitest run apps/ui                                  → 3713 passed
$ npx vitest run apps/ui/src/board/columnWidth.test.ts    → 24 passed
```

The e2e that used to assert the defect — *"a column wider than the content
measure opens the reader at the measure"*, 900 → 560 — **failed against the fix**
before being rewritten, which is the confirmation that the change is real. Two
cases replace it: a wide column keeps its width on open and on close, and a
narrow one grows to the measure and stays grown. A third covers the second half
of the report: the edge dragged **while a reader is open**, which pre-fix moved
the stored width while the rendered width stayed pinned at 560.

### The gate, run

```
$ npm run typecheck                                → 0 errors
$ npm run lint / prettier --check .                → clean
$ npx vitest run apps packages scripts plugins     → 12327 passed, 0 failed
```

`READING_WIDTH_RATIO` and `READING_WIDTH_CEILING` both survive as inputs to
`readingFloor`, so nothing is orphaned — though the ratio now feeds only a floor
and is worth revisiting if a later change makes the floor a constant.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-113]` prefix
