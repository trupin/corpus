# [UI-132] The toast stack collapses toward its anchor when the oldest expires

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-127 (the same shape, with a hover in place of the timer)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

`.toast-wrap` is `position: fixed; bottom: 18px` — anchored by its **bottom**
edge — and `Toasts.tsx:79` puts the newest toast **first**, which makes the
**oldest** the bottom child. The oldest is also the first to expire, on a 6-second
timer nobody controls. So when a toast goes, every toast above it **drops** toward
the anchor.

Each toast carries a `✕` close button. Aiming at one and hitting the next one
down is the ordinary outcome. This is UI-127's exact geometry — a bottom-anchored
container growing back toward what anchors it — with a timer where UI-127 had a
hover.

## The measurement (UI-128, real Chromium, 2026-08-20)

Three toasts in the real `.toast-wrap`, then the oldest removed:

```
before: 0@y=568 1@y=615 2@y=663
after : 0@y=615 1@y=663
```

**47px, per expiry.** Toast `0` — the newest, the one a person is most likely
reading — moves from 568 to 615.

The second, smaller instance of the same rule: `.toast { max-width: 360px }` with
no height, so a toast's own text height decides where the toasts above it sit. A
two-line notice displaces the stack more than a one-line one.

## Acceptance Criteria

- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec raises three toasts, records each one's bounding box, lets
      the oldest expire (or dismisses it), and asserts **the surviving toasts did
      not move**
- [ ] The same assertion when a toast is dismissed by its `✕` rather than by the
      timer — the person's own click must not move the toast beside the one they
      clicked
- [ ] The same assertion when a **taller** toast is raised beside a short one: one
      toast's text height does not decide another toast's position
- [ ] The newest toast still appears where a person is already looking. Whatever
      anchoring is chosen, arriving and departing must both leave the existing
      stack still
- [ ] `.toast-wrap:empty { display: none }` (`Toasts.css:15-17`) survives — an
      empty wrapper must still not sit over the console strip swallowing clicks
- [ ] `MAX_TOASTS` trimming (`Toasts.tsx:79`) still holds
- [ ] **Falsification**: restore the bottom anchor with the newest-first order and
      watch the spec fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/Toasts.css` — `.toast-wrap`, `.toast`
- `apps/ui/src/shell/Toasts.tsx` — the ordering, if that is what changes
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

The defect has two independent halves and both need answering.

**Half one: the anchor fights the order.** The container is bottom-anchored and
the expiring toast is the bottom child. Three ways out:

1. **Reverse the order.** Put the oldest at the top (`[...current, notice]` with
   `column-reverse`, or keep the array and let CSS order it) so the expiring
   toast is the one nearest the anchor and its removal moves nothing. This is the
   smallest change and it makes the anchor and the lifecycle agree.
2. **Anchor the top.** Give the wrapper a `top` computed from a reserved stack
   height rather than a `bottom`. Costs a reserved height and changes where a
   single toast sits.
3. **Reserve the slot.** Leave the expired toast's box in place, empty, until the
   whole stack drains. Correct, and it makes an empty rectangle hang over the
   console strip — check it against `:empty`'s reasoning before choosing it.

**Prefer 1.** Confirm against `design/index.html`, which is the authority on where
toasts sit and in which direction they stack — `Toasts.css:1` says the whole
component was ported from `.toast-wrap` there. **If the mockup shows newest at the
bottom, that is a look-and-feel constraint and the answer is 2 or 3, not 1.**

**Half two: a toast's height is its text.** `.toast { max-width: 360px }` and no
height, so a long notice wraps. Give the toast a height sized to the notices the
product actually raises — grep every `useToast()` call site for the real copy —
and truncate-with-reveal anything longer, per clause 2. A toast is a transient
notice, so the reveal may legitimately be "it is also on the surface that raised
it" rather than a tooltip.

### Edge Cases

- One toast only — nothing to move, but the spec should cover it
- `MAX_TOASTS` reached, so a new toast displaces an old one in the same frame
- Two toasts expiring in the same frame
- A toast dismissed by `✕` while another is mid-timer
- A notice long enough to wrap to two or three lines
- The console drawer open, which is what `:empty` exists for

## Testing Strategy

Unit tests for the ordering change in `Toasts.tsx`. The defect is layout and a
timer, so the acceptance test is a real-browser geometry spec. Drive the timer
with Playwright's clock control rather than waiting 6 real seconds per assertion.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. Raise three toasts through a real path that raises them
3. Record each toast's bounding box
4. Let the oldest expire
5. Expected: the survivors do not move. Actual: each drops 47px

### Verification Steps

1. Restart the dev server after the change
2. Repeat the reproduction, and repeat it again dismissing by `✕`
3. Expected: the survivors' boxes are identical before and after
4. Compare the resulting stack against `design/index.html`

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-132]` prefix
