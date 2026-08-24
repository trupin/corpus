# [UI-033] First pointer move after focus-close never activates the column under the cursor

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

## Spec References
- SPEC.md §10 board keyboard/pointer model (hover-follows-active)

## Summary
Found diagnosing the anchor-layer e2e flake during the v0.1.0 release push
(2026-08-02). The UI-031 latch (`keyboardOwns` in
`apps/ui/src/keyboard/useActiveColumn.ts`) is released by a `document`-level
`mousemove` listener, but column activation comes only from `onMouseOver` on the
column section. Chromium dispatches a movement's boundary events **before** its
`mousemove`, so the first real pointer movement after `hold()` always has its
`mouseover` evaluated while the latch is still armed — dropped — and the
`mousemove` that disarms the latch carries no activation of its own. The column
adopts the board only on the **next element-boundary crossing**, contradicting
the rule documented at `useActiveColumn.ts:42` ("released by the same real
`mousemove`").

Benign for users in busy layouts (real motion crosses boundaries within pixels),
but a pointer travelling inside one uniform region (empty `.col-list`, a large
`.row-excerpt`, board background) can move a long way with the column still
inactive — same family as the UI-022 "wiggle the mouse" complaint. The origin
column keeps the board and `esc` keeps working, so nothing is stranded. The
e2e spec (`apps/ui/e2e/anchor-layer.spec.ts`, "keeps the origin column active")
was stabilized with an honest two-move gesture and stays green if this is fixed.

## Proposed fix (from the diagnosing agent — verify, don't assume)
1. `useActiveColumn.ts`: register the `mousemove` release listener with
   `capture: true` (React dispatches at the root container, inside `document`'s
   bubble path, so a bubble-phase release still runs after the column's handler).
2. `Column.tsx`: add `onMouseMove={onActivate}` beside `onMouseOver={onActivate}`
   — `activate` is a `setWanted` no-op after the first call, so no extra renders
   in steady state.
Note: the same swallowing applies to `pin()` (`⇧←`/`⇧→`), where it is arguably
desirable — decide explicitly whether `pin()` keeps the current behavior.

## Acceptance Criteria
- [x] A single post-close pointer move activates the column under the cursor
- [x] `pin()` behavior decided explicitly and tested either way
- [x] Unit test in `useActiveColumn.test.ts` for the event-order race
- [x] E2E: single-move activation asserted; the existing two-move spec still green

## Technical Design
### Files to Create/Modify
- `apps/ui/src/keyboard/useActiveColumn.ts`
- `apps/ui/src/board/Column.tsx`
- `apps/ui/src/keyboard/useActiveColumn.test.ts`
- `apps/ui/e2e/anchor-layer.spec.ts` (additive assertion only)

## Testing Strategy
Unit test simulating mouseover-before-mousemove ordering; e2e single-move case.

## E2E Verification Plan
Real app: close full screen with pointer parked over another column; one small
mouse move activates that column (keyboard nav follows it).

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context), 2026-08-24.

### Reproduction — deterministic, in Chromium

A new test in `anchor-layer.spec.ts` beside the two-move one: close full screen
with the pointer parked over the neighbouring column, wait for the width
transition to **stop** (so nothing can slide under the resting cursor and supply
a crossing the gesture did not make), then move once.

```
✓ keeps the origin column active, and esc keeps working (1.4s)
✘ adopts the board on the very first movement, with no second crossing (6.3s)
    Locator: locator('.col[data-col="doc_view_threads"]')
    Expected pattern: /kactive/
    Received string:  "col qcol"
```

Not a flake and not load-sensitive: it fails every run on an idle machine,
because the mechanism is an event order and not a race with a timer. That is the
INFRA-020 tell applied the other way round — a test that fails without contention
is telling you about the code.

### The fix, and both halves are necessary

The issue proposed two changes and asked for them to be verified rather than
assumed. Both are needed, and each was falsified on its own:

1. **`Column.tsx` activates on `mousemove` as well as `mouseover`.** A movement's
   boundary events are dispatched before its `mousemove`, so the `mouseover` is
   evaluated while the latch is armed and dropped, and the `mousemove` that
   disarms the latch carried no activation of its own.
2. **The release listener moves to the capture phase.** This is the half a
   browser found. React 18 attaches its handlers at the root container, which is
   inside `document`'s bubble path — so a bubble-phase release runs *after* the
   column's own `onMouseMove`, which would therefore still see the latch armed
   and drop the very activation (1) added. Capture on `document` runs first
   either way.

Falsification, each in turn, same command:

```
# `capture: true` removed, `onMouseMove` kept
✘ adopts the board on the very first movement, with no second crossing

# `onMouseMove` removed, `capture: true` kept
✘ adopts the board on the very first movement, with no second crossing
```

Both restored: **2 passed (4.2s)**, and the two-move spec is green throughout —
it was written around the defect, so it never depended on it.

Nothing about UI-031 changes. A re-render that slides a column under a stationary
cursor emits `mouseover` with **no** `mousemove` beside it, so the latch still
survives exactly the event it exists for. The unmount-and-adopt test above proves
that in the same file.

### `pin()` — decided explicitly

**Same latch, same release**: a pinned column hands over on the first real
movement, exactly as `hold` does. The alternative — a pin that outlives a
movement — was rejected. The latch exists to stop a *forged* hover taking the
board (a re-order or an unmount changes what is under a stationary cursor and
Chromium emits `mouseover` alone). A hand that actually moves is not a forgery,
and §10 says the active column follows hover. Making `⇧←`/`⇧→` sticky against
real movement would be a second rule, unwritten, that a person would discover by
finding hover stop working after an arrow press. Tested:
`"hands a pinned column over on the first movement, exactly as `hold` does"`.

### Unit coverage for the event-order race

Two tests in `useActiveColumn.test.ts`:

- **"drops the boundary event that arrives before the movement, as the browser
  sends it"** — the `mouseover` half, in the order Chromium produces.
- **"releases before React's own handlers, not after them"** — the phase half. A
  container element stands in for React's root, with a bubble-phase listener that
  calls `activate` exactly as `Column` does. Falsified by taking `{ capture:
  true }` off the hook: `× releases before React's own handlers, not after them`.

### Checks

- `vitest run apps/ui/src/keyboard apps/ui/src/board`: 529 passed.
- `vitest run packages/kit apps/ui`: 4712 passed.
- `npm run lint`, `npm run format:check`, `npm run typecheck`: clean.
- Full Playwright suite `--workers=2`: 640 passed, 0 failed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
