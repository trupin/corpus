# [UI-012] DocMenu's Still current / Archive / Resolve never toast — callbacks dropped on unmount

## Domain

ui

## Status

done

## Priority

P2

## Model

opus — a menu-close timing change with a known mechanism; care, not judgment.

## Dependencies

- Depends on: UI-005
- Blocks: —

## Spec References

- SPEC.md §10 (reader/menu affordances)
- `apps/ui/src/shell/Toasts.tsx` docblock (no silent committed writes)

## Summary

Found by the sprint-010 fix pass (2026-07-28), verified in a real browser: the ⋯ menu's
**Still current**, **Archive** and **Resolve** call `onClose()` synchronously after `mutate()`,
unmounting `DocMenu` before the request settles. TanStack Query v5 drops per-call
`onSuccess`/`onError` callbacks on observer teardown, so none of the three ever toasts — the
write commits (observed: `PUT /api/docs/... {"reviewed":"…"}` fired, `.toast` count stayed 0
across ~3 s) with zero user feedback. **Delete is unaffected** (it closes inside `onSuccess` —
which is also the shape of the fix).

## Acceptance Criteria

- [x] All three actions toast on success and on error, with the menu closing at a timing that
      doesn't regress keyboard focus return.
- [x] A test pins the teardown path: mutation settling after unmount must still surface feedback.
- [x] Delete's behavior unchanged.

## Technical Design

Either close inside `onSuccess`/`onError` (Delete's pattern), or move the toast to the mutation
hook's own callbacks (which survive observer teardown), or fire the toast before close from the
mutation promise. Pick one, apply to all three actions consistently.

## E2E Verification Log

**Implemented on: opus** (ui-dev, 2026-07-29).

### Design chosen

**Hook-level callbacks** — the second of the issue's three options, applied to all three actions.
The other two were rejected on evidence: closing inside `onSuccess` keeps the toast only while the
menu happens to still be mounted, so a menu dismissed for *any other* reason (Escape, navigation,
the reader popping) still commits in silence — and the acceptance criterion asks for feedback when
the mutation settles **after** unmount, which only a callback that does not ride the observer can
give. New: `packages/kit/src/query/settledCallbacks.ts` (`SettledCallbacks`), an optional
argument on `useUpdateDoc`, `useSetThreadStatus` and `useCreateThread`. `useRowActions` now holds
three mutations rather than one shared `useUpdateDoc`, because a hook-level callback is bound to
the hook and one shared mutation would have to sniff its own patch to know which verb it was
reporting. **The menu still closes immediately** — measured below — so focus return is unchanged.
**Delete is untouched**: it still closes inside `onSuccess` because it must also `onGone()`.

### Environment

Real stack, no mocks: workspace `/tmp/corpus-s014-uihard-ws` created by the from-source CLI
(`node --import tsx apps/cli/src/bin/corpus.ts init --port 9150`), workspace server on `9150`
(pid 96900), Vite dev server on `5286` proxying `/api` to it, Chromium via Playwright 1.62.

### Reproduction (pre-fix)

`packages/kit/src/row/useRowActions.ts` reverted to the pre-fix shape (one shared `useUpdateDoc`,
notice on the per-call `mutate(…, { onSuccess })`), kit rebuilt, same browser, same document:

```
review on doc_657k4jp6: menu detached +31ms | toast +8033ms "(NO TOAST)" | writes ["PUT /api/docs/doc_657k4jp6"]
resolve on th_go37y77z: menu detached +31ms | toast  +105ms "Thread resolved — committed. Replying reopens it."
```

The write commits and **no `.toast` node ever appears** — polled for 8 s. Resolve still toasted in
this run because only `useRowActions` was reverted, which isolates the mechanism to the dropped
per-call callback rather than to anything about the request.

### After the fix

Same script, same workspace, kit rebuilt with the fix:

```
review  on doc_657k4jp6: menu detached +32ms | toast +110ms "✓ \"Mortgage options\" marked still current — reviewed: now (committed). ✕" | writes ["PUT /api/docs/doc_657k4jp6"]
resolve on th_go37y77z : menu detached +30ms | toast +112ms "✓ Thread reopened — committed. ✕"                                         | writes ["POST …/seen","POST /api/threads/th_go37y77z/reopen"]
resolve on th_go37y77z : menu detached +31ms | toast +109ms "✓ Thread resolved — committed. Replying reopens it. ✕"                    | writes ["POST …/seen","POST /api/threads/th_go37y77z/resolve"]
archive on doc_twe53hyp: menu detached +30ms | toast +108ms "✓ Archived \"Unknown type doc\" — committed. Archiving is reversible. ✕"  | writes ["PUT /api/docs/doc_twe53hyp"]
```

The menu detaches at ~30 ms in every case — i.e. it closes **before** the request settles, exactly
the teardown the bug was about — and the toast still arrives ~80 ms later. The Resolve/Reopen wording
comes from the mutation's own `variables.resolved`, so the flip's direction is reported from what was
sent rather than from a captured render's `resolved`.

### The mechanism, pinned

`packages/kit/src/query/writeHooks.test.tsx` → "callbacks and observer teardown" is a
characterization test of TanStack Query v5 itself: one mutation, a hook-level `onSuccess` **and** a
per-call `onSuccess`, the component unmounted while the request is held open, then released. The
hook-level callback fires (`["th_1"]`); the per-call one does not (`[]`). That is the library
behaviour the whole design rests on, asserted rather than remembered.

### Tests

- `packages/kit/src/query/writeHooks.test.tsx` — the teardown characterization above.
- `packages/kit/src/row/useRowActions.test.tsx` — "a result that outlives the surface": all three
  actions, success and refusal, with the write held open and the surface `cleanup()`ed mid-flight
  (6 cases). A `holdWrites` gate was added to the fixture.
- `apps/ui/src/reader/DocMenu.test.tsx` — "reporting a write the closed menu started": Still
  current, Archive, Resolve and a refused Reopen, each asserting `onClose` fired first and the
  notice still arrived.
- Scoped run: `apps/ui packages/kit` → **119 files, 1773 tests, all passing**. lint, prettier and
  `tsc --noEmit` clean across every workspace.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
