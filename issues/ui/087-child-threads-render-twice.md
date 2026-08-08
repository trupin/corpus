# [UI-087] Child threads render twice in a thread reader — per turn and again below the body

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

- SPEC.md **§11** Thread view — "**Child threads shown per-turn.**" That is the
  placement for a thread's children; §11 states no second listing for them
- SPEC.md **§11** Document view — "Whole-document comments and orphaned threads
  remain listed below the body." The below-body list is for threads that have
  **no place in the body**, not for every thread
- SPEC.md **§6** — recursion: commenting on a turn creates a child thread

## Summary

**Reported by the user, 2026-08-07**: in a thread, sub-threads appear twice —
once as sub-threads and once at the end of the document. With and without full
screen.

Confirmed by reading, and the cause is exact.

`apps/ui/src/reader/DocView.tsx:244` computes

```
const anchorsHost = doc !== undefined && !reader.isThread && PluginView === null && editorHandlesType(...)
```

so `anchorsHost` is **false for every thread**. The `else` branch at
`DocView.tsx:513-526` then renders **`reader.threads` in full** — every child
thread on the document — as `ThreadPanel`s below the body. Meanwhile
`ThreadCard` has already placed every one of them: `placeChildThreads` splits
them into `byTurn` (rendered under their turn, `ThreadCard.tsx:351`) and
`unanchored` (rendered after the last turn, `ThreadCard.tsx:375`). The two sets
are exhaustive and mutually exclusive, so the below-body list is a **second,
complete** rendering of the same conversations.

**How it happened** — the comment above that branch says so plainly:

> A document the editor does not own has no anchors to place, so every thread on
> it stays below the body, where UI-005 put them.

True when written. Child threads later gained per-turn placement inside
`ThreadCard`, and the fallback was never revisited. It is a stale catch-all, not
a wrong decision.

**Documents are not affected**, and the issue should not "fix" them: a document
takes the `anchorsHost` branch, where anchored threads become chips or margin
cards and `DetachedThreads` lists only `wholeDocument`, `orphaned` and
`unplaced` — which is exactly what §11 specifies. A plugin-view or
non-markdown-typed document also falls to the catch-all, but nothing else
renders its threads there, so that listing is the **only** render and must
stay.

## Acceptance Criteria

- [ ] In a thread reader, each child thread renders **once** — under its turn,
      or after the last turn when it belongs to no single turn
- [ ] True in a column and in full screen (the report names both), since the
      duplicate is above the placement split and not a width behaviour
- [ ] A child thread whose anchor is **orphaned** still renders exactly once and
      is still reachable — `placeChildThreads` already routes it to `unanchored`;
      the fix must not drop it on the way to removing the duplicate
- [ ] **A plugin-view or non-markdown document still lists its threads below the
      body.** The catch-all is load-bearing there. A fix that removes the branch
      outright silently drops every thread on those documents
- [ ] A regression test pins the count, not just the presence — the defect is a
      *second* render, so an assertion that a thread "is shown" passes both
      before and after and proves nothing
- [ ] The stale comment at `DocView.tsx:486-493` is corrected rather than left
      describing behaviour that no longer holds

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/DocView.tsx` — the `anchorsHost` false branch.

### Notes

- The narrow fix is to make the below-body catch-all skip **threads**
  specifically (`reader.isThread`), rather than to widen `anchorsHost` — a
  thread genuinely has no anchor host in the document sense, and conflating the
  two would be reasoning about the wrong property. But check whether
  `reader.isThread` is the honest predicate, or whether the real question is
  "has something else already placed these", which is what actually differs
  between a thread and a plugin view.
- **Do not fix this inside `ThreadCard` by suppressing its per-turn placement.**
  §11 makes per-turn the specified placement for a thread's children; the
  duplicate is the below-body copy.

## Testing Strategy

A thread with children on two different turns plus one whole-thread child,
rendered in a reader: assert each appears exactly once, and that the
whole-thread child appears after the last turn. Plus a plugin-view document
asserting its threads still list below the body — the guard against fixing this
by deletion.

## E2E Verification Plan

Against the real app: open a thread that has sub-threads, in a column and in
full screen, and confirm each sub-thread appears once. Then a document with
anchored and whole-document comments, confirming the document behaviour is
unchanged.

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
