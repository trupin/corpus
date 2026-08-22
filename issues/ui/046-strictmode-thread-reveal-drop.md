# [UI-046] Dev-only: thread reveals dropped under StrictMode when the doc is cached at mount

## Domain
ui

## Status
todo

**Retargeted 2026-08-22 by SHARED-065 (Phase 41), and deliberately not closed.**
The bug was *found* by PLUGINS-009's item menu, which was the first caller that
reliably had the document warm in the cache. **The defect is core**, in
`apps/ui/src/reader/useReaderSurface.ts`, and it is unchanged by SHARED-064's
removal of the plugin surface. Only the discovery route was plugin-shaped, and
losing a bug because its witness was a plugin is exactly what this sweep was told
not to do. The plugin attribution below is replaced by the core producers, which
were verified present rather than assumed.

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
First observed 2026-08-02 through a `{kind:"thread"}` reveal into an
already-cached document. `useReaderSurface` resets expanded/flash in a
`[reader.docId]` effect (`useReaderSurface.ts:218-220`) and honours the reveal in
a later one — correct order, but StrictMode replays both effects; the second
reset runs after the honour, and the reveal's identity guard (correctly) refuses
to re-fire, so the expansion is lost. Bites only in `npm run dev` (StrictMode)
AND only when the document is already in the TanStack cache at reader mount.
Production builds unaffected. Proven by removing StrictMode (restored
immediately).

**The core producers of the triggering reveal**, verified present 2026-08-22:

- `apps/ui/src/thread/ThreadCard.tsx:519` — `onOpenDoc(parentId, { kind:
  "thread", threadId })`, the "open the parent at this thread" act. The parent is
  routinely warm, because the card the user clicked was rendered from it.
- `apps/ui/src/board/useBoardLocalState.ts:93` — a persisted nav entry restores a
  `{kind:"thread"}` reveal, so a reload lands the same shape against whatever the
  cache has already refilled.

Neither is a plugin, and neither changed in Phase 41.

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
