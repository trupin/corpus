# [UI-096] The collapse control is a 13px glyph crowded against resolve

## Domain

ui

## Status

todo

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

- [ ] The collapse control's hit target is large enough to be comfortably hit —
      at least 24×24 px, and the glyph inside it may stay visually small
- [ ] It no longer overlaps or crowds the status chip and resolve control:
      they sit in a laid-out relationship with real spacing, not stacked in one
      absolutely-positioned corner
- [ ] The visual weight is unchanged or lighter — this is a hit-target and
      spacing fix, not a promotion of collapse into a prominent action. Check
      `design/index.html` before choosing the treatment; it is authoritative
- [ ] Hover and focus states make the target's extent visible, so its size is
      discoverable rather than merely present
- [ ] Keyboard focus order through the card head stays sensible, and the control
      is still reachable — per the signed rider
- [ ] The right-click menu still carries collapse/expand; this control remains a
      convenience beside it, not a replacement
- [ ] The fix holds at every placement the card appears in: margin card, chip at
      an anchor, below-body list, nested child thread at depth, and focus mode
- [ ] A nested card at the depth cap (`.child-threads.flush`, where nesting stops
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

_[Agent fills: model run on, screenshots or measured target size, observed
behaviour per placement.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, stating plainly what was verified visually
      rather than by test
- [ ] Checked against `design/index.html`
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-096]` prefix
