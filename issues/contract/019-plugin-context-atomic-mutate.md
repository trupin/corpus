# [CONTRACT-019] Rider: atomic read-modify-write seam on `PluginServerContext`

## Domain
contract

## Status
done

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
- [x] `PluginServerContext` (`packages/contract/src/plugin/server.ts`) gains an atomic mutate method, e.g. `mutateDoc(actor, docId, mutate)` where `mutate` receives the current doc (same shape `getDoc` returns) and returns the update payload (same shape `updateDoc` accepts); the whole read→compute→write runs under the core per-document mutex
- [x] Contract-level docs state the semantics: callback runs under the document lane; it may throw to abort with nothing written (the thrown error propagates to the plugin route handler unchanged); edit-lock refusal behaves exactly as `updateDoc`
- [x] Signature composes with existing types (`Actor`, doc/update payload types) — no new schemas cross the plugin boundary
- [x] Existing `getDoc`/`updateDoc` remain unchanged (non-breaking addition)
- [x] Type-only rider: no openapi.json change expected (plugin context is an in-process interface, not an HTTP surface) — verify and note in the log

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

Implemented on: **opus** (contract-dev, 2026-07-29).

### 1. What landed

`packages/contract/src/plugin/server.ts`:

```ts
export type PluginDocMutation = (doc: Doc) => UpdateDocRequest;

// on PluginServerContext, between updateDoc and broadcastInvalidate:
mutateDoc(actor: Actor, id: string, mutate: PluginDocMutation): Promise<Doc>;
```

Composed entirely from types already crossing the plugin boundary (`Actor`, `Doc`,
`UpdateDocRequest`) — no new schema, no new import for a plugin author. `getDoc`/`updateDoc` are
untouched; the interface docblock now says why both `updateDoc` and `mutateDoc` exist (a patch you
already hold vs. a patch you must derive from the current document).

The JSDoc is the contract SERVER-034 implements against, and states, in order: **lane scope**
(the same per-document lane `updateDoc` takes, held from before the read until after the write,
auto-commit and re-projection included; other documents unaffected); **what the callback sees**
(the value `getDoc` would return at the instant the lane opened, never a pre-queue read);
**abort-on-throw** (nothing written, error propagates to the plugin's route handler **unwrapped**,
so todos' `TodoItemError` arrives as itself and the handler's status mapping still applies, lane
released either way); **edit-lock refusal parity** (identical to `updateDoc`, and because the check
is part of the write the callback may already have run — hence the callback must be a pure
recompute and "it ran" is never evidence anything was written); **patch validation parity**;
**non-re-entrancy** (the callback must not call the context's write methods — being synchronous it
could only float their promises, and a nested same-document write deadlocks the lane it holds;
`getDoc` would not deadlock but is redundant, `logger`/`now` are fine); **broadcast ownership** (core keys
go out through the core write path as with `updateDoc`; the plugin still follows up with
`broadcastInvalidate` for its own keys).

Synchronous callback, per the issue's steer, with the reason recorded on `PluginDocMutation`: a
plugin's mutation is a pure recompute, and a synchronous type makes "read and write see the same
document" a property of the type rather than of caller discipline — a plugin cannot park a
document's lane on a network call. An `async` callback does not type-check.

Exported from `packages/contract/src/plugin/index.ts` (`PluginDocMutation` added to the
`./server.js` type re-export).

### 2. Type-level tests (`plugin/index.test.ts`, 19 → 23 tests)

```
✓ PluginServerContext > derives the atomic mutate from the existing doc and patch types
✓ PluginServerContext > takes the acting party on mutate, exactly as the other write verbs do
✓ PluginServerContext > refuses an asynchronous recompute
✓ PluginServerContext > leaves the existing read and write verbs untouched
```

Pinned with `expectTypeOf`: callback parameter is exactly `Doc`, its return exactly
`UpdateDocRequest`, `mutateDoc`'s parameters exactly `[Actor, string, PluginDocMutation]`, its
return exactly `Promise<Doc>`. The async refusal is a `@ts-expect-error` — it fails
`tsc --noEmit` if the type ever stops catching it. The pre-existing types-only / no-new-dependency
invariants of the subpath still pass unchanged (the addition is `export type` only, all imports
type-only and package-local).

### 3. No HTTP surface change — verified, as the issue asks

The plugin context is an in-process interface, so regeneration must be a no-op. Confirmed by hash
rather than by argument:

```
$ npm run build -w packages/contract   # exit 0
$ shasum -a 256 packages/contract/openapi.json packages/contract/src/client/schema.generated.ts > before
$ npm run generate -w packages/contract
$ shasum -a 256 … > after ; diff before after
Files are identical                 → IDEMPOTENT
51bf8830…  packages/contract/openapi.json          (unchanged from CONTRACT-018's state)
c3a2d668…  packages/contract/src/client/schema.generated.ts
```

`git diff --stat HEAD` over the two artifacts still shows only CONTRACT-018's 12 + 11 lines —
CONTRACT-019 contributed zero.

### 4. Gates

```
$ vitest run packages/contract           → 39 files, 1219 tests passed (exit 0)
$ npm run typecheck -w packages/contract → exit 0
$ npm run typecheck -w apps/cli          → exit 0
$ eslint <changed files>                 → exit 0
$ prettier --check <changed files>       → exit 0
```

### 5. Expected, coordinated typecheck breaks (two consumers, not one)

Landing the member as **required** — deliberately, not optional — breaks exactly the two places
that construct a `PluginServerContext`, each with a single error:

```
$ npm run typecheck -w apps/server   # exit 2
src/plugins/context.ts(102,3): error TS2741: Property 'mutateDoc' is missing in type
  '{ plugin: string; logger: Logger; … }' but required in type 'PluginServerContext'.

$ npm run typecheck -w plugins/todos # exit 2
server/routes.test.ts(78,9): error TS2741: Property 'mutateDoc' is missing in type
  '{ plugin: string; logger: {…}; … }' but required in type 'PluginServerContext'.
```

The first is SERVER-034's implementation site (`createPluginContext`'s annotated return is exactly
the drift guard CONTRACT-015 designed in — it fired as intended). The second is the todos plugin's
**test fake** context, PLUGINS-004's site. Neither is a defect: an optional member would let a
plugin call an atomic seam that silently isn't atomic, which is the bug this rider exists to close.
**These three commits must stay adjacent** — CONTRACT-019, SERVER-034, PLUGINS-004 — or the branch
has a red typecheck between them.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
