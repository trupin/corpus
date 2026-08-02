# [UI-037] Reveal-target seam: open a document at an item/thread via one discriminated payload

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
- Blocks: PLUGINS-010, PLUGINS-009

## Spec References
- SPEC.md §10 plugin surfaces (kit seam); §11 reader

## Summary
Sprint-023 OC5 ruling. PLUGINS-010 (click a todo item → open the doc revealed
at that item) cannot be built today: the open path is docId-only at four seams
(`ColumnComponentProps.onOpen`, `Column.tsx:45`, `OpenTarget`, `NavEntry`), the
reader has no way to scroll-to/flash arbitrary body text (the only transient
flashes are `.thread-card.flash` and `.col.flash`; `.anchor-hl` is a persistent
decoration keyed on a thread id), and `jumpToThread` is reader-internal. Build
the seam ONCE as a discriminated reveal payload — e.g.
`{docId} | {docId, reveal: {kind: "item", exact, prefix?, suffix?}} |
{docId, reveal: {kind: "thread", threadId}}` — threaded through kit's open
path and honored by the reader (scroll + transient flash, reusing the existing
flash visual language), so PLUGINS-010's "reveal item" and PLUGINS-009's "open
thread" are one field, not two mechanisms fighting `useReaderSurface`'s
restoration.

## Acceptance Criteria
- [ ] Kit's open seam accepts the discriminated payload; plain docId opens
      keep byte-identical behavior
- [ ] Reader honors `kind: "item"`: scrolls the first match of exact (with
      prefix/suffix disambiguation, sprint-023 OC4) into view with a transient
      flash consistent with existing flash styling
- [ ] Reader honors `kind: "thread"` by delegating to the existing
      `jumpToThread` path
- [ ] Works in column reader and full-screen focus; survives
      `useReaderSurface` restoration without re-triggering
- [ ] No plugin-facing breaking change: the payload is additive

## Technical Design
### Files to Create/Modify
- `packages/kit` open/OpenTarget/NavEntry types (additive)
- `apps/ui` reader: reveal handling + flash css; `Column.tsx` passthrough

## Testing Strategy
Kit type tests + reader component tests; e2e deferred to PLUGINS-010 (OC6).

## E2E Verification Plan
Covered by PLUGINS-010 once it consumes the seam.

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
