# [UI-145] The context menu's ceiling never applies, and the row menu scrolls at five items

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-061
- Related: UI-142 (which recorded the wrong number as latent), UI-143, UI-094 (which measured it)

## Spec References
- SPEC.md **§10** — *"a surface is as large as its place allows"* and *"a bound is derived from the room, not chosen as a number"* (SHARED-061, signed 2026-08-21)
- SPEC.md **§10** — the right-click context menu

## Summary

Measured by UI-094's implementer in Chromium, 2026-08-21, while working on the
row menu.

`apps/ui/src/menu/menu.css` declares:

```css
.ctx-menu { max-height: min(60vh, 420px); }
```

**That rule never applies.** `packages/kit`'s `autocomplete.css` sets
`.ac-menu { max-height: 200px }`, the two selectors tie on specificity at one
class each, and the kit sheet loads last. So the number in force is **200px**,
not 420, and not `60vh`.

Measured on a 720px viewport:

```json
{"items": 5, "clientHeight": 198, "scrollHeight": 253, "maxHeight": "200px"}
```

**The row menu already scrolls at five items**, with 520px of viewport unused.

## Why this is P1 rather than the P2 it looked like

UI-142 audited every surface against SHARED-061 and listed this one as **latent**
— *"the `420` binds above a 700px viewport; measured content 157px, no scrollbar
today"*. That reading was of the **stylesheet**, not of the **cascade**. The
audit's own method says a finding is confirmed by a browser measurement and a
constant bound is only the signal; here the signal was read correctly and the
confirmation measured a rule that was never in force.

So this is a live SHARED-061 breach — *"scrolling is for content that cannot fit,
never for content that was not given room"* — and it is on the surface a person
reaches by right-clicking anything.

**It also generalises, and that is the more valuable half.** Any bound in
`apps/ui` that ties on specificity with a `packages/kit` bound loses silently,
because kit loads last. This is the only one anyone has measured. **Sweep for
others** rather than fixing this one line.

## What to build

1. Fix the ceiling so the menu is bounded by the room it has, per SHARED-061 —
   and derive it, rather than picking a larger number. UI-142's `roomFor()` in
   `packages/kit/src/address/ComposerAddress.tsx` is the worked precedent.
2. **Sweep `apps/ui` and `packages/kit` for other bounds that tie on specificity
   across the two sheets**, and report what you find even where nothing is
   currently reachable.
3. Decide whether `.ctx-menu` and `.ac-menu` should share a selector at all. Two
   different surfaces answering to one class is why this happened, and renaming
   one is cheaper than remembering the cascade.

## Decisions to make and record

- **Whether a completion menu and a context menu want the same bound.** UI-142
  recorded a deliberate reason for the completion menu's 200px: a completion list
  is filtered by typing, so a small window is not a cage. A context menu is not
  filtered by anything. If they differ, they must not share a selector.
- **How to stop this recurring.** A test that asserts the *computed* bound rather
  than the declared one is the only guard that would have caught this — a rule
  read from the stylesheet passes while the cascade overrides it.

## Acceptance Criteria
- [ ] The context menu's bound is the room it has, measured in a browser at two
      viewport sizes
- [ ] Five items do not scroll on a 720px viewport
- [ ] A completion menu keeps whatever bound is right for it, with the reason
      stated
- [ ] The cross-sheet specificity sweep is reported, including "nothing else
      found" if that is the answer
- [ ] A test asserts the **computed** bound, not the declared one

## Testing Strategy
A geometry spec reading `getComputedStyle(...).maxHeight` and `scrollHeight`
against `clientHeight` — the measurement UI-094 used. Asserting the CSS source
would pass today and is exactly the mistake being fixed.

## E2E Verification Log
_[Agent fills — state the model]_
