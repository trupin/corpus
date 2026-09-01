# [UI-061] A selection spanning several turns is silently truncated to one

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: —

## Spec References
- SPEC.md §10 Thread view, "Commenting on a selection" (SHARED-009 Amendment 2)

## Summary
Fable review of PR #20, MINOR. `apps/ui/src/thread/useTurnComments.tsx:132` with
`apps/ui/src/anchors/renderedRange.ts:79-87`: when a selection spans several
turns, the range is clamped to whichever `.turn-markdown` root was right-clicked.
Select three turns, right-click the middle one, and the comment anchors to the
whole middle turn — the rest is dropped with no signal.

A comment anchors to one turn by construction, and that is correct: a child
thread has one parent and one anchor. The defect is that the narrowing is
**silent**. The user finds out by noticing the citation in the composer is
shorter than what they highlighted — if they notice at all, and the citation is
the only place it shows.

## Acceptance Criteria
- [x] A cross-turn selection does not silently produce a one-turn anchor
- [x] Either the selection menu declines it with a reason ("a comment anchors to
      one turn"), or the narrowing is stated before the composer opens — decide
      which and say why in the code
- [x] Whatever is chosen, the user learns it **before** writing the comment, not
      by inspecting the citation afterwards
- [x] A selection inside one turn is completely unaffected — no new refusal, no
      new prompt on the common path
- [x] Selecting across a turn boundary and then right-clicking *outside* any turn
      behaves as it does today

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/useTurnComments.tsx`
- `apps/ui/src/menu/SelectionMenuItems.tsx` if the menu carries the message
- tests

### Notes
- Whole-turn 💬 remains the fallback for anything the selection path declines, so
  the user is never without a way to comment.

## Testing Strategy
Component test with a selection spanning two rendered turns; assert the outcome
chosen above rather than the current silent clamp.

## E2E Verification Log

**Model: Opus 5 (1M context), 2026-08-31.**

### Reproduced first, and one reproduction was wrong

The defect is real and the report was accurate: select two turns, right-click one
of them, and the comment quotes that turn with no signal anywhere.

My **first** reproduction said otherwise — a jsdom fixture in which the menu
declined the right-click outright, because a range spanning two turns has the
card as its common ancestor and `selectionMenuTarget` looks for a `.doc-body`
above it. I believed that, and changed `nativeMenu.ts` to fall back to the body
the pointer is in.

Then the browser falsification refused to go red: the cross-turn spec passed with
that change reverted. A probe of the real DOM said why:

```
commonAncestorContainer: DIV.turns
closest(".doc-body"):    doc-body thread-conversation
chain: .turns → .thread-card → .thread-slot → .doc-body.thread-conversation → …
```

The real reader wraps a whole conversation in one `.doc-body`, so the menu opens
and always did. **The `nativeMenu.ts` change was reverted**, its two tests with
it, and the jsdom fixture now carries the wrapper the app has. The lesson is the
SDLC's own order: reproduce against the running app, then build. A fixture that
omits the app's markup reproduces itself.

### The decision, and why

The issue asked for one of two answers and for the reason to be recorded.
**It narrows, and says so** — `NARROWED_TO_ONE_TURN` in `useTurnComments.tsx`:

> A comment anchors to one turn — this one will quote only the part you selected
> in the turn you clicked.

Refusing would cost a re-selection to reach a comment the reader can perfectly
well have, and the turn they opened the menu on is an explicit pointer rather
than a guess. What was wrong was never the narrowing — a child thread has one
parent and one anchor (§6). It was that the only place it showed was the citation
above the composer, which the reader meets *after* deciding what to write.

The notice is emitted when the menu item is **activated**, not when the menu
opens, so opening a menu never toasts.

### "Reaches beyond" is asked of the other bodies, not of the range's ends

A triple-click inside one turn can leave a boundary container on an element above
`.turn-markdown` without the selection covering anything else. Testing the
range's own boundaries would put this sentence in front of the commonest way
people select a paragraph. `reachesBeyond` asks whether the range intersects any
*other* rendered body in the card.

### Real browser

`apps/ui/e2e/turn-comment.spec.ts`, Chromium:

```
✓ a selection that reaches past one turn › offers the comment, says it will quote one turn, and quotes that one
```

Two turns, a real cross-body range, a real right-click inside the first. The
Comment item is offered, the info toast reads *"A comment anchors to one turn"*,
the composer's citation contains `The first turn asks about the rate.` and **not**
`second turn`, and the posted selector's `exact` is the first turn's sentence.

### The common path is untouched

`useTurnComments.test.tsx` asserts that a selection inside one turn produces
**no notice at all** and opens the composer as before, and that a right-click
outside every rendered body offers no Comment item and says nothing — which is
what it did before this issue.

### Gate

- `useTurnComments.test.tsx` 4 passed · full unit suite 16,241 passed ·
  full browser suite 671 passed
- Falsification: deleting the announcement turns 2 jsdom tests red and the
  browser spec red.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [x] Committed with `[ISSUE-ID]` prefix
