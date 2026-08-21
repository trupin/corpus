# [UI-139] A refusal a keyboard-only or touch user cannot finish reading

## Domain

ui

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-132 (which set the floor and named this gap), SHARED-057

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20), and its clause on revealing what does not fit
- SPEC.md **§14** — warnings and refusals

## Summary

Raised by UI-132's implementer as the gap its own fix does not close, after PR
#53's reviewer found the clamp had no reveal at all.

A toast is clamped to two lines and carries its whole text on a `title`. That is
the same reveal every other clamped surface in this release uses, and it is the
right floor. **It reaches a sighted mouse user and nobody else.**

- A `title` on a non-focusable `<span>` produces no tooltip in any browser, so a
  **keyboard-only** user gets line two and then nothing.
- Touch has no hover, so a **touch** user gets the same.

Both can dismiss the toast. Neither can read past line two of a refusal — and a
refusal's *reason* is a server string that exists on no other surface in the
product. That is not a truncation, it is a message that cannot be finished.

## Why UI-132 did not fix it

Stated by its implementer rather than reconstructed. The stronger repair is that
an **error** toast is not dismissed on its dwell until it is acknowledged. That
changes how a refusal ends, which is a product decision rather than a repair to a
clamp, and shipping it inside a review fix would have been deciding it by
convenience.

## What has to be decided

1. **Does an error toast wait to be acknowledged?** The implementer recommends
   yes, scoped to the **error tone only** — an unacknowledged confirmation piling
   up on the board would be a worse surface than the one we have
2. **Or does the reason move somewhere durable** — the console, which already
   holds job failures, so a refusal is readable after the toast has gone. This is
   the alternative and it may be better: it also survives a person who missed the
   toast entirely
3. **Whichever it is, does the two-line clamp stay?** It should — SHARED-057's
   geometry guarantee does not depend on how the full text is reached

## Acceptance Criteria

- [ ] A refusal's full reason is reachable **without a pointer**, by a keyboard
      user and on touch
- [ ] Whatever changes, a toast a person is pointing at still does not move
      (UI-132's guarantee) and the stack's geometry is unchanged
- [ ] If error toasts wait for acknowledgement, they cannot accumulate without
      bound — state the cap and what happens at it
- [ ] Confirmations are not made stickier as a side effect
- [ ] A browser test covers the keyboard path specifically, falsified by reverting

## Technical Design

### Files to Create/Modify

- `apps/ui/src/shell/Toasts.tsx`, `Toasts.css`
- possibly the console, if decision 2 is taken

### Key Implementation Details

Read UI-132's E2E log first — the reserved-slot model and the overdue-not-paused
hold are both load-bearing, and a change here must not disturb either.

### Edge Cases

- Several refusals at once
- A refusal raised while the console is closed
- A refusal whose reason is very long

## Testing Strategy

A browser test driving the keyboard path. The `title` gap is invisible to jsdom
and to a pointer-driven spec alike.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Raise a refusal with a reason longer than two lines
3. Reach its full text using only the keyboard
4. Confirm the stack still does not move

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-139]` prefix
