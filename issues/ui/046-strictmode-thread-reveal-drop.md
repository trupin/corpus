# [UI-046] Dev-only: thread reveals dropped under StrictMode when the doc is cached at mount

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

## Spec References
- UI-037 reveal seam

## Summary
Found by PLUGINS-009 (2026-08-02), first real caller of `{kind:"thread"}`
reveals with a cached document. `useReaderSurface` resets expanded/flash in a
`[reader.docId]` effect and honours the reveal in a later one — correct order,
but StrictMode replays both effects; the second reset runs after the honour,
and the reveal's identity guard (correctly) refuses to re-fire, so the
expansion is lost. Bites only in `npm run dev` (StrictMode) AND only when the
document is already in the TanStack cache at reader mount — which the item
menu guarantees. Production builds unaffected. Proven by removing StrictMode
(restored immediately).

Fix so the honour survives the replay without weakening the one-shot guard
(e.g. make the reset effect reveal-aware, or honour idempotently keyed on the
consumed instruction rather than by identity ref). Regression test must run
under StrictMode with a warm cache.

## Acceptance Criteria
- [ ] Thread reveal expands the thread in dev/StrictMode with a cached doc
- [ ] One-shot property intact (no re-fire on Back/reload — UI-037's tests
      stay green, incl. the resurrection regression)
- [ ] StrictMode + warm-cache regression test

## Technical Design
### Files to Create/Modify
- apps/ui/src/reader/useReaderSurface.ts + tests

## Testing Strategy
Component test with StrictMode wrapper + pre-seeded query cache.

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
