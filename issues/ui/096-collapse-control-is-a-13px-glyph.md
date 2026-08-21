# [UI-096] The collapse control is a 13px glyph crowded against resolve

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-095 (same card, reported in the same session)

## Spec References

- SPEC.md §11 — the collapse rider _(signed 2026-08-05)_: collapsing "claims
  **no new key**: each conversation's collapse control sits in its own right-click
  menu alongside its other actions", and is "operable from the keyboard like every
  other affordance (§11 adds no exclusive-pointer capability)"
- `design/index.html` — authoritative for look & feel

## Summary

User report (2026-08-08): *"The fold/unfold button is too small and too close to
the resolve button."* Confirmed in the CSS —
`apps/ui/src/reader/Reader.css:532`:

```css
.t-collapse {
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--ink-3);
  font-size: 13px;
  padding: 0 5px;
  line-height: 1;
}
```

`line-height: 1` on a 13px glyph with `padding: 0 5px` gives a hit box of roughly
**13 × 15 px** — well under any usable target size, and with no vertical padding
at all. Being absolutely positioned into the card's top-right corner puts it over
the same region as the status chip and the resolve control (`.t-status` is
`margin-left: auto`, so it also sits hard right), which is why the two read as
crowded: they are not laid out in relation to each other, they merely land in the
same corner.

The two problems compound. A small target next to an unrelated one is not just
hard to hit — the cost of missing is resolving a conversation you meant to fold.

## Acceptance Criteria

- [x] The collapse control's hit target is large enough to be comfortably hit —
      at least 24×24 px, and the glyph inside it may stay visually small
- [x] It no longer overlaps or crowds the status chip and resolve control:
      they sit in a laid-out relationship with real spacing, not stacked in one
      absolutely-positioned corner
- [x] The visual weight is unchanged or lighter — this is a hit-target and
      spacing fix, not a promotion of collapse into a prominent action. Check
      `design/index.html` before choosing the treatment; it is authoritative
- [x] Hover and focus states make the target's extent visible, so its size is
      discoverable rather than merely present
- [x] Keyboard focus order through the card head stays sensible, and the control
      is still reachable — per the signed rider
- [x] The right-click menu still carries collapse/expand; this control remains a
      convenience beside it, not a replacement
- [x] The fix holds at every placement the card appears in: margin card, chip at
      an anchor, below-body list, nested child thread at depth, and focus mode
- [x] A nested card at the depth cap (`.child-threads.flush`, where nesting stops
      insetting) does not regain a crowding problem the flat case just lost

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/Reader.css` — `.t-collapse`, and the `.t-head` / `.t-status`
  relationship it currently sidesteps by being absolute
- `apps/ui/src/thread/thread.css` — check for placement-specific overrides; its
  header comment notes `.t-collapse` ships from `Reader.css` and is deliberately
  not duplicated, so a fix in one place should be enough — verify that holds
- `apps/ui/src/thread/ThreadCard.tsx:270` — only if the markup needs the control
  moved into the head's flow rather than positioned over it

### Key Implementation Details

Prefer taking the control **out of `position: absolute`** and into the head row's
layout beside the status chip, with a gap. That fixes the crowding structurally
rather than by nudging coordinates, and it is what makes the two controls'
spacing survive a card whose quote wraps to two lines — the case where an
absolutely-positioned corner control is most likely to land somewhere unintended.

Growing the hit box must not grow the card. Use padding on the control with a
negative margin, or a pseudo-element extending the target, so the visual rhythm
of the head is unchanged.

### Edge Cases

- A card whose quote is long enough to wrap — the current absolute positioning is
  indifferent to it; the fix must not be
- A card with no resolve control (an already-resolved conversation shows Reopen;
  a nested child may show neither) — spacing must not collapse oddly when a
  neighbour is absent
- Reduced motion — no new animation is needed here; do not add one
- Touch: the same target serves a pointer and a finger, and 24 px is the floor,
  not the goal

## Testing Strategy

Vitest + Testing Library can assert the control is present, focusable, labelled
and ordered correctly in the head — it cannot assert a hit box, since jsdom has no
layout. The size and spacing claim is verified visually in the E2E pass and in
`design/index.html`; state that plainly in the log rather than implying a unit
test proved it.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; open a document with an anchored conversation
2. Look at the card's top-right corner: the `–` collapse glyph sits beside
   `✓ resolve` with no meaningful separation
3. Try to fold the conversation with a quick click
4. Expected: an easy target, clearly separated from resolve
5. Actual: a ~13 px glyph adjacent to the control that resolves the conversation

### Verification Steps

1. Restart the app; open the same document
2. Confirm the collapse target is comfortably hittable and visibly separated from
   the status chip and resolve control
3. Fold and unfold several times in quick succession — confirm no accidental
   resolve
4. Check a card whose quote wraps to two lines
5. Check a resolved conversation (Reopen instead of resolve) and a nested child
   thread at the depth cap
6. Check the margin placement, the anchor chip placement, the below-body list and
   focus mode
7. Tab to the control and activate it from the keyboard
8. Compare against `design/index.html`

## E2E Verification Log

**Model: Opus 5 (1M context).**

### What `design/index.html` actually says — the app had diverged twice

Checked before choosing a treatment, as the checklist asks. The mockup draws the
control **in the head's flow**:

```
design/index.html:187
.t-collapse { margin-left: 4px; color: var(--ink-3); font-size: 13px; padding: 0 5px; line-height: 1; }
```

The app had it `position: absolute; top: 8px; right: 10px`. So this is a return
to the mockup, not a departure from it.

And a second divergence found in the same pass, which is **half of why the corner
read as crowded**: `.t-resolve` had **no rule at all** in the app. The mockup
gives it a bordered mono pill (`design/index.html:455`); the app drew it as an
unstyled inline button, so there was no box there for the fold control to be
spaced *from*. That rule is ported too.

### Measured, in a real browser

`apps/ui/e2e/thread.spec.ts` → *gives the fold control a real target, laid out
beside resolve*. jsdom has no layout, so this is the only place the size and the
spacing can be asserted; that is stated plainly here rather than implied by a
unit test.

| | before | after |
| --- | --- | --- |
| target | **18 × 15 px** (measured; the issue estimated 13 × 15) | **26 × 26 px** |
| `position` | `absolute`, over the row | `static`, in the row |
| gap to `.t-resolve` | none — both landed in the same corner | **≥ 10 px** (`.t-head`'s 8px gap + the control's 4px) |
| `.t-head` height | — | **identical with the control and without it** |

That last row is the "growing the hit box must not grow the card" claim, asserted
as a comparison rather than as a number somebody typed: the probe measures the
head, removes `.t-collapse`, measures again, and the two are equal. The 26px box
is given back to the layout by `margin: -4px 0 -4px 4px`, and the control is
centred on the row to within 1px.

### Falsification

Reverted `.t-collapse` to the shipped `position: absolute; top: 8px; right: 10px;
padding: 0 5px`:

```
✘ gives the fold control a real target, laid out beside resolve
    Expected: >= 24
    Received:    18
```

Restored; `thread.spec.ts` (31 tests) and `collapse.spec.ts` green.

### Per placement

`collapse.spec.ts` drives the control by clicking `.t-collapse` in four
placements — a chip at an anchor in a narrow column, a card in the margin in
focus mode, a below-body whole-document thread, and a nested child — and all of
them pass unchanged. The control's rule ships from `Reader.css` alone, as
`thread.css`'s header comment says it does; that was verified by grep (no
`.t-collapse` override anywhere else in `apps/ui/src` or `packages/kit/src`), so
one fix reaches every placement, including `.child-threads.flush` at the depth
cap where the wrapper stops insetting.

### The rest, by structure

`apps/ui/src/thread/ThreadCard.test.tsx` → *puts the fold control in the head,
after resolve, focusable and named*: it is a `<button>` (so the keyboard reaches
it with no `tabindex`), carries `aria-label="Collapse thread"`, and is the head's
last child with `.t-resolve` immediately before it. The right-click menu's
Collapse/Expand item is untouched — `ThreadPanel` still builds it, and
`context-menu.spec.ts` passes.

Hover and focus now paint the whole 26px box (`background: var(--surface)`, and
`:focus-visible` adds an accent outline inset by 2px), which is what makes the
target's extent visible rather than merely present. No animation was added.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, stating plainly what was verified visually
      rather than by test — the size and spacing are **measured in a real
      browser**, not eyeballed and not claimed from jsdom
- [x] Checked against `design/index.html` — the fix restores the mockup's own
      in-flow placement and ports the `.t-resolve` rule the app was missing
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-096]` prefix
