# [UI-077] Resolved threads do not collapse in the document view

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md §6, the thread frontmatter table: `status: open | resolved;`
  **`resolved threads collapse in the doc view`**

## Summary

Live report 2026-08-05:

> "I also want resolve threads to be collapsed by default, so I can focus on
> open threads instead"

**This is a bug, not a feature request.** SPEC.md has promised it since the
thread model was written — the frontmatter table states it as a property of
`status`, in the same breath as the values themselves. Nothing implements it.

Grepped `apps/ui/src/reader/DocView.tsx`, `apps/ui/src/anchors/AnchoredThreads.tsx`
and `apps/ui/src/thread/ThreadCard.tsx` for a collapse, hide or filter keyed on
resolved state: **no match**. A resolved thread today occupies exactly as much of
the margin, and exactly as much of the reader's attention, as an open one.

The cost compounds with the very feature that makes threads worth having: a
document that has been worked over for a month carries mostly *settled*
conversation, so the surface is at its least useful exactly when it is at its
fullest — and the open thread, the one thing needing attention, is the hardest to
find on the page.

## Widened 2026-08-05 — do not ship this alone

The user generalised the request minutes after filing it:

> "Right now, only the full screen allows to collapse comments / threads, but I
> want to be able to collapse any comment / thread, wherever they are (within
> other threads, documents in full screen, or document in columns). Just make it
> cohesive. Remember that the goal is for me to be able to focus on what's
> important. So anything should be able to collapse both on-demand, and also
> following certain rules (e.g. resolved threads / comments are collapsed by
> default)."

So there are two halves and only one of them is a bug:

- **By rule** — resolved collapses by default. Already promised by §6 (above).
  This issue.
- **On demand** — anything collapsible, anywhere, by the reader. **Not** in
  SPEC today; drafted as **SHARED-018** and held for sign-off.

**Cohesion is the stated requirement**, so these ship together or the product
gets two collapse behaviours that disagree — the same failure UI-063 and UI-067
were sequenced to avoid (building one surface twice from two angles). Treat the
acceptance criteria below as the by-rule half of one feature, not as a
standalone.

## Acceptance Criteria

- [ ] A resolved thread renders collapsed by default in the document view, in
      both the margin placement and the narrow-column placement §11 describes
- [ ] Collapsed means *reachable*, not hidden: it can be expanded in place, and
      its existence is visible — a resolved conversation is part of the
      document's record, and silently removing it would be a different bug
- [ ] Expanding is per-thread and does not disturb the others
- [ ] An open thread is unaffected
- [ ] Resolving a thread while it is open on screen collapses it, and reopening
      expands it — the state follows the document, not a local toggle
- [ ] Operable from the keyboard, like every other affordance (§11 adds no
      pointer-exclusive capability)
- [ ] A test that a document carrying both resolved and open threads shows the
      open one at full size and the resolved one collapsed

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/AnchoredThreads.tsx` (margin placement), the narrow-column
  chip path, and `apps/ui/src/thread/ThreadCard.tsx` — likely a `host`-aware
  collapsed state rather than a fourth host.

### Notes

- **Do not confuse this with UI-063's comments list.** That is a separate
  surface (a Document/Comments switch with open/resolved × anchored/unanchored
  filters, SHARED-010). This issue is the *document view's own* margin and
  inline placement, which the filter list does not touch. They should agree, and
  neither replaces the other.
- Check whether the anchored highlight in the body should also soften for a
  resolved thread; the spec does not say, so do not invent it — note it if it
  looks wrong in practice.

## Testing Strategy

Component-level over a document carrying one resolved and one open thread, in
both placements; plus a resolve-while-open transition.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
