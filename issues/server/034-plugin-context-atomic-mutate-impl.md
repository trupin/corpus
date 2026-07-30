# [SERVER-034] Implement `PluginServerContext` atomic mutate under the document mutex

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-019
- Blocks: PLUGINS-004

## Spec References
- SPEC.md §15 — plugins; server is the sole writer
- SPEC.md §9.2 — write-path semantics (per-document serialization, edit-lock refusal)

## Summary
PR #11 review (finding 2, MAJOR): implement the atomic read-modify-write seam
CONTRACT-019 adds to `PluginServerContext`. The current context implementation
(`apps/server/src/plugins/context.ts`) exposes `getDoc` and `updateDoc` separately;
`getDoc` reads outside the per-document mutex, so plugin read→compute→write sequences
race. The new method must run the read, the plugin's callback, and the write inside a
single `mutex.run(docId, …)` lane, preserving everything `updateDoc` already does
(edit-lock guard via `assertWritable`, validation, git auto-commit, projection,
invalidation keys).

## Acceptance Criteria
- [ ] New method implemented per CONTRACT-019's JSDoc contract: read current doc, invoke callback, apply returned update — all inside the same per-document mutex lane the core write paths use
- [ ] Edit-lock refusal identical to `updateDoc` (423 semantics propagate to plugin routes unchanged)
- [ ] Callback throw aborts with nothing written, nothing committed, no invalidation broadcast; the error propagates unwrapped
- [ ] Concurrency regression test proving the reviewer's failure scenario is closed: two interleaved mutations against one document serialize such that the second callback observes the first's result (no lost update). Drive the interleaving deterministically (e.g. gate the first callback on a promise)
- [ ] No behavior change to existing `getDoc`/`updateDoc` callers

## Technical Design

### Files to Create/Modify
- `apps/server/src/plugins/context.ts` — implement the method
- colocated tests

### Key Implementation Details
Reuse the existing internals `updateDoc` is built from rather than duplicating the
write pipeline — the goal is `mutex.run(docId, () => { read; callback; existing update
pipeline })`. Watch nested-mutex re-entrancy: if `updateDoc` itself acquires the lane,
factor its body so the locked section is shared, not re-entered.

### Edge Cases
- Doc deleted between route dispatch and lane entry → same not-found error `getDoc` raises today, from inside the lane.
- Callback returning an empty/no-op update → same semantics as `updateDoc` with that payload (commit-skip path).

## Testing Strategy
Unit/integration tests in apps/server: lost-update regression (deterministic
interleaving), abort-on-throw leaves file + git + projection untouched, lock refusal.
Scoped runs only (`npm test -w apps/server`, VITEST_MAX_THREADS=4).

## E2E Verification Plan

### Verification Steps
1. Rebuild, restart the real server against a scratch workspace (explicit --workspace path, ports 9180+)
2. Exercise via the todos plugin once PLUGINS-004 lands (joint E2E there); for this issue, verify existing plugin routes still work end-to-end and the new method is reachable from a plugin context

## E2E Verification Log

**Implemented on: opus** (server-dev, 2026-07-29).

### What changed
- `apps/server/src/docs/update.ts` — `updateDocument` split into the lane-taking
  wrapper and `updateDocumentLocked`, which holds the *entire* verb (edit-lock
  guard included) and assumes the caller already owns the lane. Same precedent
  and same reason as `deleteDocumentLocked`. Exported through `docs/index.ts`.
- `apps/server/src/plugins/context.ts` — `mutateDoc(actor, id, mutate)`:
  `mutex.run(id, …)` → read (`getDoc`'s own reader, extracted as `readDoc`) →
  `mutate(doc)` → `parseWith(UpdateDocRequestSchema, …)` → `updateDocumentLocked`.
  One lane, no second write path, no re-entrancy.
- `apps/server/src/plugins/mutate.test.ts` — new, 14 tests.

### E2E, real server, real workspace
Scratch workspace `~/.claude/jobs/4dd0ddef/tmp/s035-repro` (`corpus init`, git
repo, port 9180), server started with `corpus server start` from source. The new
seam was exercised from a genuine plugin loaded through discovery — a scratch
plugin at `CORPUS_PLUGINS_DIR=~/.claude/jobs/4dd0ddef/tmp/s034-plugins/atomic`
(the repo's `plugins/` was not touched); log confirms
`plugin routes mounted plugin=atomic prefix=/api/x/atomic`.

1. **The defect, still live on the unconverted path.** The todos plugin
   (`getDoc` + `updateDoc`) with three concurrent `POST /api/x/todos/<doc>/items`:
   all three answered `201`, the file holds **two** items
   (`{"open":2,"done":0,"items":[{"text":"item 1"…},{"text":"item 3"…}]}`).
   Item 2 was silently reverted after its own `201`. This is finding 2 verbatim
   and is what PLUGINS-004 will close by adopting the new seam.
2. **The seam.** Eight concurrent `POST /api/x/atomic/<doc>/bump`, each a
   `mutateDoc` doing `counter + 1`: `200 200 200 200 200 200 200 200`, and the
   file on disk holds `counter: 8`. Nothing lost.
3. **Abort on throw.** `POST /api/x/atomic/<doc>/boom` (callback throws):
   the plugin's handler received the error *unwrapped* — its own translator
   reported `{"code":"plugin_error","message":"the plugin changed its mind"}` —
   and `sha256(file)` plus `HEAD` were byte-identical before and after. The next
   bump succeeded (`counter: 9`), so the lane was released.
4. **Edit-lock parity.** With `agent` holding the lease, the same bump answered
   `423` with the core `LockedError` body
   (`"doc_5riai2gm is being edited by agent; the lock was acquired at …"`), file
   unchanged at `counter: 9`. A missing document answered `404 not_found`.
   (The plugin must translate the throw itself — Hono's `app.route()` gives a
   mounted sub-app its own error handler; `plugins/todos/server/errors.ts`
   already does exactly this, which is why the contract says the error arrives
   unwrapped.)
5. **SSE.** One bump produced two frames on `/events`:
   `{"keys":[["docs"],["docs","doc_5riai2gm"]]}` from the core write path, then
   `{"keys":[["x","atomic","counters","doc_5riai2gm"]]}` from the plugin's own
   `broadcastInvalidate` — core keys still the core path's, plugin keys still the
   plugin's.
6. **No regression to existing plugin routes.** `GET /api/x/todos/lists`,
   `POST /api/x/todos/<doc>/items`, `GET /api/x/todos/lists/<doc>` all behaved as
   before (200/201, projection updated, commits authored). `corpus db doctor`:
   `projection is clean — 12 documents from 12 files (2ms)`.

Server stopped by pid; ports 9180–9199 free; `corpus/.corpus` does not exist.

### Tests
`apps/server/src/plugins/mutate.test.ts` — 14 tests, all passing. Proven to be
real regression tests: with `mutateDoc` temporarily reimplemented as the naive
`getDoc` → `updateDoc` pair, **3 fail** (the lost-update test, the
core-write-serialization test, and the lane test) and the rest still pass; the
fix restores all 14. Full `apps/server` suite: **121 files, 2385 tests, all
passing**. `tsc --noEmit` in `apps/server`: clean. ESLint over `apps/server/src`:
clean. Prettier: clean.

### Decisions taken that the issue left open
- **Where the split goes.** `updateDocumentLocked` carries the lock guard rather
  than leaving it to callers, so `mutateDoc` cannot reach the write pipeline
  having skipped it — and the guard lands *after* the callback, which is what
  the contract's "the callback may already have run" clause requires.
- **The read is `getDoc`'s own reader**, not a private one, so "the callback sees
  the document `getDoc` would return" is true by construction. `updateDocumentLocked`
  loads the document a second time inside the same lane; that re-read is free of
  races by definition and keeps the save path byte-identical to `PUT`'s.
- **Non-re-entrancy is documented, not enforced.** The contract states it; a
  runtime guard would cost every call to catch a mistake the type system already
  makes awkward (a synchronous callback can only float a write's promise).

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
