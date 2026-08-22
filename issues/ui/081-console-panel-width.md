# [UI-081] The console's job list cannot be resized

## Domain

ui

## Status

blocked — needs the one-line SPEC amendment below signed off first.

## Priority

P2

## Model

opus

## Dependencies

- Depends on: a signed SPEC line (drafted below)
- Related: UI-066 (the reader's resizable width — same capability, same
  persistence question, and they should agree)

## Spec References

- SPEC.md §10 Console — the bottom drawer, "job list + selected job's log detail"

## Summary

**User, verbatim (2026-08-06):**

> "In the console, I want to be able to resize the width of the left pannel."

The console is a master-detail: the job list on the left, the selected job's log
on the right. The split is fixed. A long `originTitle` or a wide log line has no
give in either direction.

**Two precedents already exist, and this is the odd one out.** SPEC §10 makes the
console's own **height** resizable and sticky — *"the drawer height persists after
drag-resize"* — and column widths resizable *"within sane min/max bounds"*. The
console's internal split is the one dimension of the board that cannot be
adjusted.

## The amendment this needs — one sentence, held for sign-off

The console bullet describes the drawer's contents but not this split, so
building it would be behaviour ahead of spec — the defect review has raised on
this branch twice. APPEND to §10's **Console** bullet:

> The split between the job list and the log detail is **draggable**, within sane
> min/max bounds, and the chosen width persists the way the drawer's height and
> the reader's width already do.

Deliberately short: it names no control, states the bound, and ties persistence to
the two behaviours that already exist rather than inventing a third rule.

## Acceptance Criteria

- [ ] The split between the job list and the log detail can be dragged
- [ ] Bounded at both ends — neither pane can be driven to nothing
- [ ] The chosen width persists across reload, the way the drawer's height does
- [ ] Operable from the keyboard (§10 adds no exclusive-pointer capability), the
      same requirement UI-066 carries
- [ ] Consistent with UI-066: **one way to hold a chosen width in this app**, not
      two conventions in adjacent components

## Technical Design

### Notes

- **Do not invent a second persistence scheme.** UI-077 landed a per-surface,
  browser-local store keyed and status-stamped
  (`apps/ui/src/thread/threadCollapse.ts`), and the drawer's height already
  persists somehow — find which convention the console uses and follow it. UI-066
  faces exactly this question for the reader's width; if these two land near each
  other they should share, and whichever goes first sets the pattern.
- The reasoning UI-077 recorded for keeping such state browser-local is worth
  reusing rather than rediscovering: every write auto-commits, so persisting a
  view preference server-side would mean *looking at something produces git
  commits*.

## Testing Strategy

Component-level drag with the bounds asserted at both ends, plus a persistence
check across a remount. A browser test only if the drag cannot be exercised
otherwise.

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
