# [UI-167] Designating a resident is reachable only by right-click

## Domain
ui

## Status
todo

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — "Designation is user-only state on the thread, set and
  released like any other thread field"
- SPEC.md Section 10 — "UI — the board", the conversation's menu

## Summary

**Reported by the user, 2026-08-23**, in these words:

> There's no longer a way to attach a resident to a thread (at least not that I
> could find).

**The act still works. It has no visible affordance.** Traced on the branch:
`ThreadPanel` opens the menu carrying `residentActions`, and it is opened from
exactly two places — `CollapsedThread`'s `onContextMenu` and `ThreadCard`'s
`onCardContextMenu`. Both are right-click.

`ThreadCard` renders two visible buttons, `✓ resolve` and collapse. **There is no
⋯ on a thread card**, though the document reader's head has one and the
explorer's rows have one. So every other object in the product exposes its
actions to a left click, and a conversation does not.

The user is the person who signed §7's designation rider and could not find the
control. That is the whole finding.

## This has happened once before, to this exact feature

`residentActions.ts` records it in its own docblock: UI-122 found that "the
feature v0.10.0 is named for was unreachable from the UI" because the
designation sat behind a profile directory that was empty. That was fixed by
making the general designation the first item.

**The feature is now unreachable for a second, unrelated reason.** A capability
that has been undiscoverable twice for different reasons is one nobody is
checking the reachability of.

## Acceptance Criteria

- [ ] A conversation exposes its actions to a **left click**, in the same idiom
      the rest of the product uses.
- [ ] The right-click menu keeps working and offers **exactly the same items**.
      §10 binds the two together and `menuModel.ts` exists so they cannot
      diverge — do not add a second list.
- [ ] The affordance is present wherever a designation is legal: a standalone
      thread in a reader (`host="standalone"`), and a thread on a board.
- [ ] It is **absent or inert where a designation is not legal** — a thread with
      a parent may not have a resident at all (§7), and the menu already knows
      this through `hasParent`. Do not offer a control that opens onto nothing.
- [ ] Keyboard-reachable, like every other affordance (§10 adds no
      exclusive-pointer capability).
- [ ] A test asserts the control is present on a standalone thread and that its
      items equal the context menu's. A test that only opened the context menu
      would have passed throughout this defect.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/thread/ThreadCard.tsx` — the visible trigger
- `apps/ui/src/thread/ThreadPanel.tsx` — wiring, if `openMenu` needs a second
  caller
- `apps/ui/src/thread/CollapsedThread` — the collapsed line, same question
- the tests beside each

### Key Implementation Details

**Reuse `openMenu`.** `ThreadPanel` already builds the item list once and hands
it to the context menu. The new trigger calls the same function with the
button's own box as the anchor. A second list is the drift `menuModel.ts` exists
to prevent.

**Anchor from measured room.** The chip menus in UI-162 and the explorer's row
menus both derive placement from `menuRoom` and `clampToViewport`. A trigger on
a thread card sits inside a scrolling reader, sometimes in a 300px margin card —
placement by preference will put the menu off screen, which is UI-159's lesson
and cost a blocking review finding one release ago.

**Do not widen this into the card's whole action set.** The card's two visible
buttons stay. This adds the way into the menu, not a rearrangement of what a
card shows.

### Edge Cases
- The collapsed line, which is one row and has less room for a control.
- A margin-placed card at 300px.
- A thread on a document, where the designation items are absent — the trigger
  still has resolve, open and the rest to offer, so it should not vanish.
- Two panels for one conversation on one screen, which `DocView` guards against.

## Testing Strategy

Component tests over `ThreadPanel` in `host="standalone"`: the trigger exists,
clicking it opens the menu, and the item ids equal those the context menu opens
with. Then the parent case, asserting the designation items are absent from
both.

**Falsify**: remove the trigger and watch the presence test fail. Then make the
trigger build its own item list and watch the equality test fail — that second
one is what stops the two menus drifting.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a standalone thread in a reader
2. Look for any way to designate a resident without right-clicking
3. Expected: a visible control, as every other object in the product has
4. Actual: nothing — the only route is a right-click on the card

### Verification Steps
1. Repeat, and designate a resident using the left mouse button only
2. Repeat using the keyboard only
3. Right-click the same card and confirm the two menus offer the same items

## E2E Verification Log

### Reproduction (bugs only)
Traced on the branch 2026-08-23 by the orchestrator: `ThreadPanel`'s `openMenu`
has exactly two callers, `CollapsedThread`'s `onContextMenu` and `ThreadCard`'s
`onCardContextMenu`. `ThreadCard`'s only `<button>` elements are `t-resolve` and
`t-collapse`. No menu trigger exists.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
