# [PLUGINS-004] Todos `mutateItems` uses the atomic mutate seam (lost-update fix)

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-034 (seam implemented), CONTRACT-019 (seam typed)
- Blocks: —

## Spec References
- SPEC.md §12 — todos plugin behavior
- SPEC.md §15 — plugins write only through the core write path

## Summary
PR #11 review (finding 2, MAJOR): `mutateItems`
(`plugins/todos/server/routes.ts:87-116`) is a non-atomic read-modify-write —
`context.getDoc` (line 93) runs outside the document mutex; only the write serializes,
and each write carries a whole `items` array computed from a possibly stale read.
A user toggling checkbox 1 then checkbox 2 inside the first write's git-commit window
(the list deliberately stays interactive while `busy`) lets request B read pre-A state,
pass its per-item `expectedText` guard, and silently revert A's toggle after A returned
200. Same interleaving is reachable agent-CLI vs. browser. Port `mutateItems` to the
atomic seam CONTRACT-019/SERVER-034 add.

## Acceptance Criteria
- [ ] `mutateItems` performs its type check, `readItems` parse, `apply`, and write inside a single `context.mutateDoc(...)` (or the seam's final name) call — no `getDoc` outside the lane
- [ ] `TodoItemError` thrown inside the callback (wrong type, malformed items, per-item guard failure) propagates to the route with its status, exactly as today
- [ ] `broadcastInvalidate` still fires only after a successful write, with the same keys
- [ ] Lost-update regression test: two interleaved item mutations against one list — the second observes the first's result; final frontmatter holds both changes (deterministic interleaving)
- [ ] Existing todos route tests and CLI/browser parity tests stay green unchanged (or updated only where they stubbed `getDoc`/`updateDoc` and now stub the seam)

## Technical Design

### Files to Create/Modify
- `plugins/todos/server/routes.ts` — port `mutateItems`
- colocated tests

### Key Implementation Details
The refactor should be shape-preserving: everything currently between the `getDoc` and
`updateDoc` calls moves into the seam's callback. Keep the "refuse malformed items
rather than overwrite" behavior — it's the point of the parse (routes.ts:100-108).

### Edge Cases
- Doc deleted mid-flight → the seam's not-found surfaces with the same route behavior as today.

## Testing Strategy
plugins/todos scoped tests (VITEST_MAX_THREADS=4): interleaving regression, error-propagation parity, invalidation keys unchanged.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Real server + scratch workspace (explicit --workspace, ports 9180+), todos list with ≥2 items
2. Fire two toggle requests so the second dispatches inside the first's commit window (two quick browser clicks, or curl with the bearer token)
3. Expected: both toggles persist. Actual (pre-fix): second write reverts the first.

### Verification Steps
1. Restart after the fix; repeat step 2 — both toggles persist in the file's frontmatter and the UI
2. `corpus todos` CLI verbs still round-trip

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
