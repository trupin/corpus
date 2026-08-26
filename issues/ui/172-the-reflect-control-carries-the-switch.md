# [UI-172] The Reflect control carries the switch

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-071, CONTRACT-086, SERVER-151
- Blocks: —

## Spec References

- SPEC.md §7 — the `workspace.reflect` paragraph, and SHARED-071's rider
- SPEC.md §10 — the board bar, "nothing resizes because of what it holds"

## Summary

User request, 2026-08-25 — _"I want to be able to disable the auto reflection
entirely from the UI. When auto reflection is off, the only way to make the
agent reflect is by clicking the reflect button."_

The board bar's Reflect control has two elements today: the button that asks,
carrying the corpus count of what is unreflected, and the text beside it saying
when the last reflection landed. This issue adds the third: the switch.

## Acceptance Criteria

- [ ] The Reflect control carries a switch for the automatic path, beside the ask
- [ ] Switching it off `PUT`s `quiet: 0`. Switching it on `PUT`s the default
- [ ] **The control names the window before it writes it.** A person whose config
      carries 45 minutes sees 45 while it is on, and sees the 30 it will restore
      before they switch it back on. SHARED-071 chose showing the number over
      remembering the old one, and this is the half that makes that honest
- [ ] With the automatic path off, the control **says so where it is read** —
      "reflected 2h ago" alone would let a person believe one is still coming
- [ ] **The ask stays enabled with the switch off.** That is the whole point of
      the request: the button becomes the only way a reflection happens
- [ ] **The bar's height never changes**, and neither does anything beside the
      control. §10's rule, and the control's own docblock already commits to it —
      the switch is `flex: none` and reserves its room whether or not it has
      anything to say
- [ ] The switch reflects server state, never local state. A `PUT` that fails
      leaves the switch where the server says it is, and raises a toast
- [ ] Keyboard reachable and labelled, like every other control on the bar

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reflect/ReflectControl.tsx` — the switch
- `apps/ui/src/reflect/ReflectControl.css` — its box
- `apps/ui/src/reflect/useReflectStatus.ts` — the mutation, beside
  `useAskReflection`
- `apps/ui/src/reflect/unreflected.ts` — the label, which must now account for a
  disabled automatic path

### Key Implementation Details

`quiet` already rides on `ReflectStatus`, so the switch's state needs no new
read. `quiet === 0` is off.

The mutation returns the whole `ReflectStatus` (CONTRACT-086), so the query
cache takes the response rather than invalidating and re-fetching.

### Edge Cases

- `status.data` undefined on first paint: the switch renders in its reserved box
  and does nothing until the answer lands. It must not flicker from on to off.
- A reflection pending while the switch goes off: the ask is disabled because one
  is running, and the switch is not. They are different acts.

## Testing Strategy

Unit tests over the three states — on, off, and unanswered — and over the write:
off `PUT`s `0`, on `PUT`s the default, a failed `PUT` leaves the switch alone and
toasts. Falsify by making the switch read local state and watching the
server-state test fail.

## E2E Verification Plan

Against the real app: switch the automatic path off, confirm the control says so,
confirm the ask still works, and confirm the request the browser sent carried
`quiet: 0`. Then measure the bar — the control's box must be the same width
before and after, which is the assertion `reflect.spec.ts` already knows how to
make.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-172]` prefix
