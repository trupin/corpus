# [UI-139] A refusal a keyboard-only or touch user cannot finish reading

## Domain

ui

## Status

todo — the design questions are settled by SHARED-058 (authorized 2026-08-21)

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-058 (the console rider this builds)
- Blocks: —
- Related: UI-132 (which set the floor and named this gap), SHARED-057, UI-125
  (which built the console's tab machinery)

## Spec References

- SPEC.md **§11** — the console's **three tabs**, and the **Notices** paragraph
  (rider authorized 2026-08-21). Read it before coding; it settles every question
  this issue used to leave open.
- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (SHARED-057) and
  its clause on revealing what does not fit
- SPEC.md **§14** — *"a warning on the API response, a server log entry, and
  console visibility"* for a failed workspace hook. No console surface has ever
  delivered the third.

## Summary

Raised by UI-132's implementer as the gap its own fix does not close, after PR
#53's reviewer found the clamp had no reveal at all.

A toast is clamped to two lines (`Toasts.css:93`) and carries its whole text on a
`title` (`Toasts.tsx:246`). That is the same reveal every other clamped surface in
v0.15.0 uses, and it is the right floor. **It reaches a sighted mouse user and
nobody else.**

- A `title` on a non-focusable `<span>` produces no tooltip on focus in any
  browser, so a **keyboard-only** user gets line two and then nothing.
- Touch has no hover, so a **touch** user gets the same.
- A **screen-reader** user is unaffected: the full text is in the DOM inside the
  `aria-live` region, so it is announced whole. The clamp is paint only.

Both blocked groups can dismiss the toast. Neither can read past line two of a
refusal — and a refusal's *reason* is a server string that exists on no other
surface in the product. That is not a truncation, it is a message that cannot be
finished.

## What was decided (SHARED-058, user authorization 2026-08-21)

The user was asked which of two shapes and answered **option 2**: the reason
moves somewhere durable — the console. The rider records the full reasoning and
what it rejected. What the implementer needs from it:

1. **The console gains a third tab, `Notices`.** Not an overlay, not a page of
   its own, and *not* rows appended to the Jobs list — a refusal is not a job and
   must not move the strip's job counts.
2. **The list is browser state, session-scoped.** No contract route, no server
   store, nothing on disk. A reload clears it, and that cost is accepted and
   stated in the rider.
3. **Error toasts still expire on their dwell.** UI-139's other option — an error
   toast that waits to be acknowledged — is rejected. Do not build it.
4. **An error notice marks the console until the tab is opened.** A confirmation
   marks nothing. This is what stops a refusal passing unseen now that toasts
   still expire.
5. **The two-line clamp stays**, and so does the `title`. SHARED-057's geometry
   guarantee does not depend on how the full text is reached, and the tooltip is
   still the fastest path for a pointer user.

## Acceptance Criteria

- [ ] A refusal's full reason is reachable **without a pointer** — by a keyboard
      user and on touch — through the console's Notices tab
- [ ] The tab lists every warning and refusal of the session, newest first, each
      with its whole text, its tone, and when it arrived
- [ ] A notice is still readable after its toast has expired or been dismissed
- [ ] An **error** notice marks the console until Notices has been opened; a
      confirmation does not mark it
- [ ] The list is bounded, and on reaching its bound says how many it dropped
      rather than ending quietly (§11's stated-cap rule)
- [ ] The tab is reachable and operable by keyboard, consistent with the two
      tabs UI-125 already built (`role="tablist"`, `Console.tsx:129`)
- [ ] A toast a person is pointing at still does not move, and the stack's
      geometry is unchanged (UI-132's guarantee, unbroken)
- [ ] Confirmations are not made stickier as a side effect, and error toasts are
      not made stickier either — expiry is unchanged
- [ ] A browser test covers the keyboard path specifically, falsified by
      reverting the fix and watching it fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/Toasts.tsx` — the toast raise is the notice's source. Every
  toast becomes a notice; nothing else may raise one, or the two lists drift.
- `apps/ui/src/console/Console.tsx`, `console.css` — the third tab, beside Jobs
  and Residents. `ConsoleTab` is already a union and the tablist is already
  keyboard-driven — extend them, do not build a second tab mechanism.
- `apps/ui/src/console/ConsoleStrip.tsx` — the attention marker.
- a new `Notices.tsx` beside `Residents.tsx`, which is the closest precedent for
  a simple list body in this drawer.

### Key Implementation Details

- Read UI-132's E2E log first. Its reserved-slot model and its
  overdue-not-paused hold are both load-bearing, and nothing here may disturb
  either.
- The notice store outlives individual toasts, so it cannot live in the toast
  array. It is a sibling of it, fed by the same raise.
- The bound: pick one, state it as a named constant, and make the "dropped N"
  line render from that constant rather than a literal — v0.15.0 lost a CI cycle
  to a reserve expressed as a magic value.

### Edge Cases

- Several refusals at once
- A refusal raised while the console is collapsed, and while it is open on
  another tab
- A refusal whose reason is very long — the tab shows it whole, so the tab's own
  row must not become a second clamp with no reveal
- The identical message raised twice: two notices, not one, with their own times

## Testing Strategy

A browser test driving the keyboard path end to end: raise a refusal, reach its
full text with the keyboard alone, and confirm the stack did not move. The
`title` gap is invisible to jsdom and to a pointer-driven spec alike, which is
why the floor was set without noticing this.

Component tests for the bound, the drop line, and the marker's clear-on-open.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Raise a refusal with a reason longer than two lines
3. Reach its full text using only the keyboard
4. Let the toast expire, then read the reason again
5. Confirm the stack still does not move

## E2E Verification Log

_[Agent fills — state the model]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified
