# [UI-046] Dev-only: thread reveals dropped under StrictMode when the doc is cached at mount

## Domain
ui

## Status
done

**Retargeted 2026-08-22 by SHARED-065 (Phase 41), and deliberately not closed.**
The bug was *found* by PLUGINS-009's item menu, which was the first caller that
reliably had the document warm in the cache. **The defect is core**, in
`apps/ui/src/reader/useReaderSurface.ts`, and it is unchanged by SHARED-067's
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
- [x] Thread reveal expands the thread in dev/StrictMode with a cached doc
- [x] One-shot property intact (no re-fire on Back/reload — UI-037's tests
      stay green, incl. the resurrection regression)
- [x] StrictMode + warm-cache regression test

## Technical Design
### Files to Create/Modify
- apps/ui/src/reader/useReaderSurface.ts + tests

## Testing Strategy
Component test with StrictMode wrapper + pre-seeded query cache.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context), 2026-08-24.

### The mechanism, established before anything changed

Two of `useReaderSurface`'s effects meet here. The first clears the flash on a
document change (`[reader.docId]`); the second honours the reveal and lights one.
The declaration order is right, so within one pass the flash survives. A
`StrictMode` **replay** runs the clear again *after* the honour, and the reveal's
one-shot guard (`revealed.current === reveal`) correctly refuses to fire a second
time. The expansion is left with nothing pointing at it.

What is left today is the **flash** alone: the fold state moved out of this hook
into `ThreadCollapseProvider` since the issue was filed, so the expansion itself
survives. An item reveal survives too — its box is drawn into the DOM and nothing
removes it. Only the conversation flash, which is React state, is dropped.

### Reproduction (jsdom, `StrictMode` + an answered list)

Two tests added to `useReaderSurface.test.tsx` under
*"a thread reveal under StrictMode, with the list already answered"*, run against
the unfixed hook:

```
× keeps the flash the reveal lit, through the replayed effects
  → expected '' to be 'th_1'
× still clears the flash when the reader navigates, and does not re-fire
  → expected '' to be 'th_1'
  Tests  2 failed | 14 passed (16)
```

`data-flash-thread` was exposed on the harness's surface so the hook's
`flashThread` is observable. `StrictMode` is the apparatus, and the answered list
is the condition: a cold list makes the honour land on a later frame, after both
replays, and the flash survives by luck. That is why nothing in the suite caught
it.

### The fix

The clear is keyed on the **transition** rather than on the value: a ref holds
the document it was last cleared for, so a replay is a no-op and a real
navigation is not. It starts on the mounting document, because there is no flash
on a fresh mount to clear. The one-shot guard is untouched, which the second test
pins — navigate away, the flash clears; come back, the instruction stays spent
and `onRevealed` has still fired exactly once.

All 352 tests in `apps/ui/src/reader` pass, UI-037's one-shot suite included.

### What a browser could and could not testify to

`main.tsx` wraps the app in `StrictMode` and the Playwright suite runs against
the Vite **dev server**, so the double invocation is live there. But `StrictMode`
replays effects on **mount** only, and no browser gesture I could find mounts a
reader with a reveal *and* an already-answered conversation list:

- a nav push within a column changes `docId` without remounting, so nothing
  replays;
- every page load starts with an empty TanStack cache, so the list is cold;
- two columns on the same document share the cache key and mount in the same
  frame, so both are cold.

Both of the issue's named producers reach the honour on a later frame in a
browser for that reason. So the falsifiable evidence here is the jsdom pair
above, which reproduces the mechanism exactly and names it.

One browser gap was closed on the way: `comments-tab.spec.ts`'s *"reveals an
anchored row at its anchor"* claimed *"expanded and flashing"* in its own comment
and asserted only the expansion. It now asserts `.thread-card.flash`. That path
is the reveal's **warm** one — the reader is already on the document, so the
honour lands in the same commit the instruction arrives on — but the surface is
already mounted, so it is not a `StrictMode` replay and it passes either way. It
is a real assertion gap regardless, and it guards the warm-honour path.

### Checks

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
