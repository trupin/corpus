# [SHARED-057] Nothing resizes because of what it holds

## Domain

shared

## Status

done — signed by the user 2026-08-20 (as drafted, in the v0.15.0 go-ahead). Applied 2026-08-20.

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-127 (the blinking picker), UI-128 (the audit)
- Related: SHARED-055 (signed 2026-08-19)

## Spec References

- SPEC.md **§11** — the Shell paragraph, which already carries the global UI rules

## Summary

Reported by the user, 2026-08-20, from two symptoms in one day. The first was a
P0: *"The drop down to pick an agent when commenting is blinking up and down
which makes it impossible to use."* The second was the general case they saw
behind it: *"Elements resize based on their content, which then moves other
elements that are stacked on top of it or aligned right… we should find other
ways like using tool tips, drop downs… We should also figure out ways for sizes
to be enough for most texts to fit."*

Nothing in SPEC.md said a component may not be sized by its content. So the
blinking picker was not a spec violation — it was a defect with no rule to
violate, which is why it shipped. This rider is the rule.

**It is stated before the audit measures anything**, deliberately: an audit run
without it produces one reviewer's taste, and an audit run with it produces
findings a person can check.

## The drafted text — read this back verbatim before applying

Appended to **§11's Shell paragraph**, the one ending *"No sidebar. Vanilla CSS
tokens, light/dark."*:

> **Nothing resizes because of what it holds.** A component's size is a property
> of its place in the layout, never of the text that happens to be in it — so a
> longer name, a count reaching two digits, a preview replacing a sentence, or a
> value that arrives later than the box holding it all move nothing else on the
> screen. The failure this rules out is not cosmetic: an element that grows
> pushes whatever is stacked above it or aligned against it, and where the growth
> is driven by the pointer — a hover preview, a focus statement — the element
> under the cursor moves out from under it, which un-triggers the growth and
> brings it back, and the surface oscillates until the person gives up. **Text
> that does not fit is revealed rather than accommodated**: truncate it in place
> and give the whole of it to a tooltip, a popover, or the detail view that
> already exists for it, and never let the full value decide the box. **And the
> box is sized for the text people actually have**, measured against real content
> rather than a placeholder, so revealing is the uncommon case and not the
> ordinary reading path. Where a surface genuinely cannot be sized ahead — a
> document body, a thread — it grows in one direction only, into space nothing
> else occupies.
> _(Rider signed 2026-08-20.)_

## What the sign-off decides

1. **That size is a layout property, not a content property.** The alternative —
   letting a box fit its text and accepting the movement — is what the product
   does today, and it produced a control a person could not use
2. **That the repair is revealing rather than growing.** A tooltip, a popover or
   an existing detail view carries the full value; the box keeps its size
3. **That boxes are sized against real content.** Otherwise every value is
   truncated and revealing becomes the ordinary reading path, which is a
   different bad outcome
4. **That the exception is one-directional growth into empty space.** A document
   body has no knowable size, and saying so keeps the rule honest rather than
   absolute

## Acceptance Criteria

- [x] The user has signed the drafted text, verbatim
- [x] §11 states that a component's size does not follow its content
- [x] It states what to do with text that does not fit
- [x] It states that boxes are sized against real content
- [x] It names the one exception, and bounds it
- [x] `npm run spec:check` passes

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §11's Shell paragraph

## Testing Strategy

`npm run spec:check` for the citations. The behaviour is UI-127's and UI-128's.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text and nothing else
2. `npm run spec:check` passes

## E2E Verification Log

- 2026-08-20 — the user signed the drafted text in the v0.15.0 go-ahead, quoting
  it back as `SHARED-057 signed as drafted`.
- Applied verbatim to §11's Shell paragraph, dated 2026-08-20.
- `npm run spec:check` passes.

## Completion Checklist (orchestrator)

- [x] Committed with `[SHARED-057]` prefix
