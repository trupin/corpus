# [UI-193] Overlays correct by construction, and a battery that proves it

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: UI-191 (joins its primitive set), INFRA-040 (rides its
  enforcement mechanism)
- Blocks: UI-192 (rebuilds on these primitives)

## Spec References

- SPEC.md **§10**; CLAUDE.md → Verification Is On Demand

## Summary

The second half of the 2026-09-06 report: *"find checks that can catch those
types of things before they land."* The types, from the broken designation
popover: a cramped modal, a scroll region too small to use or notice, no
exit affordance, and duplicated controls.

**What a static check can catch, it catches by construction; what needs a
running browser, a Playwright battery catches; what needs judgment is named
honestly as review territory.** Three tiers:

### 1. Primitives that cannot be built wrong (kit)

- **`Popover` / `Modal`**: always render a close affordance, always handle
  Escape (with focus return), always trap focus while open, always dismiss
  on outside click. These are not props — they are unconditional, so an
  overlay without an exit cannot be expressed.
- **`ScrollArea`**: when content overflows, the affordance is visible
  (indicator + optional "N more" line) and the visible region never drops
  below a stated minimum usable height (a token, recorded — recommendation
  ~120px); a ScrollArea that would render shorter throws in dev and clamps
  in production.
- Enforcement rides INFRA-040's ESLint mechanism: raw
  `role="dialog"`/`position: fixed` overlay implementations outside kit are
  banned the way raw `<select>` is, message naming the primitive.

### 2. The overlay battery (Playwright)

One shared spec helper, run against **every** overlay the product can open
(enumerated in one registry so a new overlay must register or fail a test):

- fits inside the viewport at the default window size, nothing interactive
  clipped;
- close button visible; Escape dismisses; focus returns to the opener;
- every scrollable region inside meets the minimum usable height and shows
  its affordance when overflowing;
- opens over seeded *long* content (9+ lanes, long labels) — the battery
  runs against the crowded case, because the empty case is how these
  shipped.

### 3. Named honestly: what no check catches

**Semantic duplication — two controls meaning the same thing — is not
statically decidable.** The battery cannot know "at" and WEIGHT are one
concept. That class belongs to review: the evaluator's checklist gains one
item ("open every overlay; for each control, name what it edits; two
answers the same is a finding"), and `.claude/agents/evaluator.md` is
amended in this issue. Claiming a lint rule catches this would be the check
lying about its coverage.

## Acceptance Criteria

- [ ] The three primitives exist with the unconditional behaviours above;
      unit + e2e coverage for each guarantee
- [ ] The ESLint extension bans raw overlays outside kit; zero violations,
      zero inline disables
- [ ] The battery runs over the overlay registry; unregistered overlay =
      failing test; the designation popover's pre-UI-192 state would fail
      at least three battery assertions (demonstrated against the old
      component before it is deleted, recorded in the log)
- [ ] The evaluator checklist item lands in `.claude/agents/evaluator.md`
- [ ] The minimum-usable-height token recorded and spent from tokens.css

## E2E Verification Log

_Implementing agent fills; state the model._
