# [CONTRACT-019] Rider: atomic read-modify-write seam on `PluginServerContext`

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-015 (plugin-facing types live in @corpus/contract)
- Blocks: SERVER-034, PLUGINS-004

## Spec References
- SPEC.md §15 — plugins; server remains the sole writer
- SPEC.md §9.2 — write-path semantics (single-writer, per-document serialization)

## Summary
PR #11 review (finding 2, MAJOR): the todos plugin's `mutateItems` is a non-atomic
read-modify-write — `context.getDoc` runs outside the per-document mutex, only the
`context.updateDoc` write serializes, and each write carries a whole `items` array
computed from a possibly stale read. Two interleaved toggles (browser vs. agent-CLI,
or two quick browser clicks inside the first write's git-commit window) let request B
read pre-A state and silently revert A's toggle after A returned 200. The
`PluginServerContext` type offers no atomic seam, so no plugin can do this correctly.
This rider adds one; SERVER-034 implements it, PLUGINS-004 consumes it.

## Acceptance Criteria
- [ ] `PluginServerContext` (`packages/contract/src/plugin/server.ts`) gains an atomic mutate method, e.g. `mutateDoc(actor, docId, mutate)` where `mutate` receives the current doc (same shape `getDoc` returns) and returns the update payload (same shape `updateDoc` accepts); the whole read→compute→write runs under the core per-document mutex
- [ ] Contract-level docs state the semantics: callback runs under the document lane; it may throw to abort with nothing written (the thrown error propagates to the plugin route handler unchanged); edit-lock refusal behaves exactly as `updateDoc`
- [ ] Signature composes with existing types (`Actor`, doc/update payload types) — no new schemas cross the plugin boundary
- [ ] Existing `getDoc`/`updateDoc` remain unchanged (non-breaking addition)
- [ ] Type-only rider: no openapi.json change expected (plugin context is an in-process interface, not an HTTP surface) — verify and note in the log

## Technical Design

### Files to Create/Modify
- `packages/contract/src/plugin/server.ts` — add the method to the interface + JSDoc contract
- `packages/contract/src/plugin/index.ts` / `index.test.ts` — exports + type tests as the package's conventions require

### Key Implementation Details
Follow the naming/JSDoc style of the existing `PluginServerContext` members. The JSDoc
is the behavioral contract SERVER-034 implements against — be precise about: mutex scope,
abort-on-throw, lock refusal parity with `updateDoc`, and that the callback must be
synchronous or async per whatever `updateDoc`'s payload flow already supports (pick the
simplest shape that lets `mutateItems` port cleanly; a synchronous callback suffices).

### Edge Cases
- Callback throwing a plugin-defined error (e.g. todos' `TodoItemError`) must surface unwrapped.

## Testing Strategy
Type-level tests per the package's existing pattern for plugin-facing types.

## E2E Verification Plan

### Verification Steps
1. `npm run build -w packages/contract`; typecheck across workspaces (server will not implement it yet — interface addition must not break the existing context implementation; if the implementation object is typed against the interface, coordinate: this rider may land as a required member only together with SERVER-034's implementation. If so, note it and keep the two commits adjacent.)

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
