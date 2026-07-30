# [SERVER-034] Implement `PluginServerContext` atomic mutate under the document mutex

## Domain
server

## Status
todo

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
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
