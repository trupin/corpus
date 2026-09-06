# [UI-192] The designation popover is broken four ways

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: UI-191 (the Select/Chip primitives this rebuild uses),
  UI-193 (the overlay primitives — Popover/ScrollArea — this rebuilds on)
- Related: UI-185/SHARED-011 (the designation controls this popover carries)

## Spec References

- SPEC.md **§6** — the composer chooses who owns the conversation; **§10**

## Summary

User report, 2026-09-06, two screenshots of the Ask composer's
"agent will answer" popover (`packages/kit/src/address/ComposerAddress.tsx`,
opened from `apps/ui/src/compose/ComposeOverlay.tsx`): *"this whole modal
looks broken."* Four defects, each independently real:

1. **The scroll region is unusable.** "4 lanes · scroll for the rest" sits in
   a region so short it is nearly impossible to scroll — or to see that it
   scrolls at all. The file's own comments document the fight (a "nine-lane
   roster behind a scrollbar with 502px of window") and lost it.
2. **No exit affordance.** No close button, and the file states "Escape is
   deliberately not handled" (line 66) — the user has to *guess* that
   clicking outside dismisses. Whatever argument earned that deliberate
   choice, the outcome is a modal the user cannot see how to leave, and the
   choice is reversed.
3. **The popover duplicates its parent's controls.** It carries a WEIGHT
   picker while the composer row beside it carries the "at" dropdown asking
   the same thing — and the same for the owner agent. Two controls, one
   meaning, adjacent.
4. **The help text documents the confusion instead of fixing it.** The
   trigger's tooltip reads "…the resident being designated takes its own
   level from the owner control, not from here. Open to change either." A
   tooltip that has to disambiguate two same-meaning controls is the defect
   stating itself.

## What to build

Redesign, not patch:

- **One control per meaning.** Decide the single home for weight and for
  owner — recommendation: the composer row's controls (UI-191's pill
  dropdowns) are the single source, and the popover shrinks to the one thing
  the row cannot do: choosing the recipient lane from the roster. If the
  popover keeps a summary of weight/owner, it is read-only text linking
  focus to the row control, never a second editor. Record the decision and
  the rejected direction.
- **The roster gets room.** Size the popover to its content up to a sane
  viewport fraction; the scroll region, where one is still needed, meets
  UI-193's minimum-usable-height rule and shows its affordance (the "N more"
  line stays, the invisible scrollbar does not).
- **A visible close button, and Escape closes.** Focus returns to the
  trigger. Click-outside stays as a *third* path, not the only one.
- The tooltip is rewritten to describe one control doing one thing — if it
  still needs a disambiguating clause, the redesign is not done.

## Acceptance Criteria

- [ ] One editor per meaning across composer row + popover — asserted by an
      e2e that changes weight in the single place and finds no second editor
- [ ] Close button present, Escape closes, focus returns — e2e
- [ ] The roster shows ≥ the UI-193 minimum of usable scroll height with 9
      lanes seeded, and its overflow affordance is visible — e2e
- [ ] The trigger tooltip contains no cross-control disambiguation
- [ ] Full e2e suite green

## E2E Verification Log

_Implementing agent fills; state the model._
