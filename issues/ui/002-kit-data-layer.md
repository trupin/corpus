# [UI-002] @corpus/kit data layer: hooks + SSE bridge

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — contract shapes are pinned by `packages/contract`, the invalidation pattern is specified in SPEC.md §2/§11, and the query-key scheme is prescribed below; this is careful plumbing, not architecture.

## Dependencies

- Depends on: CONTRACT-002, SERVER-007, UI-001
- Blocks: UI-003, UI-004, UI-011

## Spec References

- SPEC.md §2 — "Architecture overview", rules 2 and 3 (the UI never talks to the agent directly; the server never pushes data over SSE — only `invalidate` events carrying query keys; the UI refetches over plain HTTP)
- SPEC.md §9.2 — "HTTP API" (the endpoints these hooks wrap, notably the single `GET /api/docs` collection query)
- SPEC.md §10 — "Plugin system" ("The UI contract is `@corpus/kit`"; plugin query keys namespaced `x/<plugin>/…`)
- SPEC.md §11 — "UI — the board", live updates bullet (single resilient SSE connection; `invalidate` → TanStack Query key invalidation; optimistic append of the user's own turn, reconciled on refetch)
- `design/index.html` — **authoritative look & feel** (this issue ships no chrome, but any dev/debug surface it adds must use kit tokens and the prototype's visual language)

## Summary

Build the data layer that every other UI issue consumes: `@corpus/kit` exports a configured typed client (over the generated `@corpus/contract/client`), a documented and stable TanStack Query key scheme, the core read hooks (`useDocs`, `useDoc`, `useThread`, `useTree`, `useJobs`, `useLocks`), and **one** resilient `EventSource` on `/events` that maps server `invalidate` payloads onto `queryClient.invalidateQueries`. It also owns the optimistic-append helper for the user's own turn and the reconnect-and-refetch behavior that recovers invalidations missed while disconnected. The kit is the plugin boundary — from UI-003 onward, no component reaches for `fetch` or the generated client directly.

## Acceptance Criteria

- [ ] `@corpus/kit` exports a `createCorpusClient({ baseUrl, token })` factory built on `@corpus/contract/client`, plus a `CorpusProvider` that puts the client and the shared `QueryClient` on React context.
- [ ] Read hooks exist and are fully typed from the contract (no hand-written response types, no `any`): `useDocs(query)`, `useDoc(id)`, `useThread(id)`, `useTree()`, `useJobs(params)`, `useLocks()`.
- [ ] `useDocs(query)` accepts the full `GET /api/docs` filter set (`q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort`) as a typed object; a filter object with the same values in a different key order produces the **same** query key (keys are canonicalized).
- [ ] The query-key scheme is implemented as key-builder functions (not string literals scattered in components), documented in `packages/kit/README.md` with the exact shape of every key, and exported so plugins can build compatible keys.
- [ ] Exactly one `EventSource` on `/events` exists per app instance regardless of how many hooks are mounted; mounting/unmounting hooks never opens or closes additional connections.
- [ ] An `invalidate` event carrying query keys results in `queryClient.invalidateQueries` for each key, using prefix matching so `["docs"]` invalidates every `useDocs` variant.
- [ ] **Health key is explicitly covered** _(pr-reviewer #8 handoff, 2026-07-26)_: UI-001's console strip uses `staleTime: Infinity` with no refetch triggers, so its server status is frozen at the boot-time probe until something invalidates it — "server unreachable" persists after the server comes back and vice versa. The SSE bridge's connect/disconnect transitions must invalidate the health key (reconnect ⇒ refetch health; connection loss ⇒ reflect unreachable), so the strip converges without a manual reload.
- [ ] The SSE connection auto-reconnects with exponential backoff (jittered, capped) after a drop, and on successful reconnect **refetches all active queries** to recover invalidations missed while disconnected.
- [ ] Connection state (`connecting | open | reconnecting`) is exposed via a `useConnectionState()` hook so UI-011's console strip and UI-001's shell can surface it.
- [ ] An `useAppendTurn()` mutation optimistically appends the user's own turn to the cached thread, and the optimistic entry is reconciled (replaced, not duplicated) when the server refetch lands; a failed mutation rolls the cache back.
- [ ] SSE heartbeats (SPEC.md §9.2, 25 s) are consumed without triggering refetches or being mistaken for invalidations.
- [ ] The plugin key-namespace convention `x/<plugin>/…` is documented and enforced by an exported `pluginKey(plugin, ...parts)` helper; keys built with it round-trip through the same invalidation path as core keys.
- [ ] Vitest coverage for the key builders, the invalidation mapping, the reconnect/backoff logic, and optimistic append/reconcile/rollback.

## Technical Design

### Files to Create/Modify

- `packages/kit/src/client/createCorpusClient.ts` — thin wrapper over `@corpus/contract/client` (base URL, bearer token, typed error surface)
- `packages/kit/src/client/CorpusProvider.tsx` — context provider holding client + `QueryClient` + SSE bridge lifecycle
- `packages/kit/src/query/keys.ts` (+ `keys.test.ts`) — key builders and canonicalization
- `packages/kit/src/query/useDocs.ts`, `useDoc.ts`, `useThread.ts`, `useTree.ts`, `useJobs.ts`, `useLocks.ts` (+ colocated tests)
- `packages/kit/src/query/useAppendTurn.ts` (+ test) — optimistic turn append
- `packages/kit/src/events/sseBridge.ts` (+ `sseBridge.test.ts`) — single EventSource, backoff, invalidation dispatch
- `packages/kit/src/events/useConnectionState.ts` — exposes connection status
- `packages/kit/src/index.ts` — public exports (the plugin contract surface)
- `packages/kit/README.md` — the query-key scheme, the plugin namespace convention, and the "kit is the only data path" rule
- `packages/kit/package.json` — deps on `@tanstack/react-query`, `@corpus/contract`; peer dep on `react`
- `apps/ui/src/app/App.tsx` — mount `CorpusProvider`; replace UI-001's local `QueryClient` wiring with the kit's

### Key Implementation Details

**Query-key scheme (stable, hierarchical, prefix-invalidatable).**

> **Corrected (orchestrator, 2026-07-27, sprint-008 Open Conflict 1):** the literals originally listed here (`["doc", id]`, `["thread", id]`) do NOT match what the server emits — the shipped vocabulary is `["docs", id]` / `["threads", id]`, exported from `@corpus/contract` (re-exported via the server's `events/keys.ts`). A kit built to the old literals caches under keys no `invalidate` frame ever names: every unit test passes and every reader goes permanently stale. **The kit must call the contract's exported key builders — never write key literals** — so drift is a type/test error, not a silent cache miss.

- `["docs", canonicalQuery]` — a collection query; `canonicalQuery` is the filter object with `undefined`/empty values dropped and keys sorted, so key identity is value-based
- the contract's single-document and thread key builders (shipped shapes: `["docs", id]`, `["threads", id]`)
- `["tree"]` — the folder tree
- `["jobs", params]` — console rows
- `["locks"]` — the lock projection
- `["x", plugin, ...parts]` — the plugin namespace, built via `pluginKey()`

Prefix matching is the whole point: an `invalidate` naming `["docs"]` must invalidate every cached collection query. Use TanStack Query's default prefix semantics (`queryClient.invalidateQueries({ queryKey })`) rather than exact matching.

**Canonicalization.** `canonicalQuery` must be deterministic: drop `undefined`, `null`, and `""`; sort object keys; sort array-valued filters (e.g. `tag`). Two calls with logically identical filters must share a cache entry — otherwise a column re-render silently doubles the request rate.

**SSE bridge.** One `EventSource` created by `CorpusProvider` on mount, torn down on unmount. Parse the event payload with a Zod schema (Zod-at-boundaries per `docs/TS_GUIDELINES.md`) — a malformed payload is logged and dropped, never thrown. Distinguish three inbound shapes: `invalidate` (dispatch), heartbeat/comment lines (ignore), and anything unknown (log at debug, ignore).

**Reconnect + missed invalidations.** `EventSource` retries on its own, but its schedule is not ours: manage reconnection explicitly (close on `error`, reconnect after `min(cap, base * 2^n)` with jitter). On every **successful (re)connect after a drop**, call `queryClient.refetchQueries({ type: "active" })` — while disconnected we cannot know which keys changed, so the only correct recovery is to refetch what is on screen. Do **not** do this on the very first connect (nothing is stale yet). Expose the state so the console can show a "reconnecting" indicator instead of silently serving stale data.

**Optimistic turn append (SPEC.md §11).** `useAppendTurn` writes a provisional turn into the `["thread", id]` cache immediately with a client-side marker (e.g. `pending: true`), fires the POST, and on success invalidates the thread key. Reconciliation must be by **turn timestamp** — the CLI guarantees unique monotonic turn timestamps within a thread (SPEC.md §6), so the server's turn replaces the provisional one rather than appearing beside it. On error, restore the pre-mutation snapshot and surface the error to the caller.

**The boundary rule.** `packages/kit/src/index.ts` is the plugin contract. Everything UI-003 and later consume goes through it; a component reaching past the kit into the generated client is a review-blocking defect (and, per SPEC.md §10, lint-forbidden for plugins). Keep the export surface deliberate — export hooks, the provider, the key builders, and types; do not re-export the raw client's internals.

**Auth.** The bearer token comes from the workspace config surfaced by the server/dev proxy per CLAUDE.md Architecture Decision 5. The kit takes it as configuration — it never reads files or env directly.

> **Adjudicated (orchestrator, 2026-07-27, sprint-008 Open Conflict 3):** nothing currently provisions that token to the browser — no injection in `mountStaticUi`, no `/api/config` endpoint. Split: the **kit** stays config-only (this issue's ACs unchanged — it receives `{ baseUrl, token }` and never sources them); **apps/ui in dev** reads a `VITE_CORPUS_TOKEN` env var (documented in its README/dev script); the **production provisioning half** (server surfaces the token to the served UI) is SERVER-024, filed and scheduled this phase. UI-002's own E2E may use the dev env var path.

### Edge Cases

- **Multiple `CorpusProvider`s mounted** (tests, Storybook-like harnesses) — each owns its own EventSource; assert in the app that exactly one provider is mounted, and document the constraint.
- **Server restarts** — `EventSource` sees an error; backoff must not hot-loop, and the post-reconnect refetch must fire exactly once per reconnect.
- **Tab backgrounded for a long time** — connection may be dropped by the browser; on resume, the reconnect path (not `refetchOnWindowFocus`) is what restores correctness.
- **Invalidate storm** — the agent editing many files produces many events; batch/coalesce invalidations within a short window (e.g. one animation frame or ~50 ms) so a burst causes one refetch per key, not dozens.
- **Unknown/plugin keys in an invalidate payload** — pass them through to `invalidateQueries` unchanged; the kit must not allowlist core keys only, or plugin live-updates break.
- **`useDocs` with `q` (FTS)** — the response carries snippet highlights; the hook must not strip them, and typing must preserve them for UI-009.
- **Thread append while the same thread is being invalidated by SSE** — the optimistic entry must survive an in-flight invalidation until its own mutation settles (use TanStack Query's mutation-aware cancellation: `cancelQueries` before writing the optimistic value).
- **`EventSource` and the Vite proxy** — the dev-server proxy must not buffer (established in UI-001); if the bridge sees a connection that opens but never delivers, that is a proxy problem, not a bridge bug — surface it clearly in logs.

## Testing Strategy

Vitest in `packages/kit` (jsdom, React Testing Library where hooks need a renderer):

- **Key builders**: canonicalization drops empty values and sorts keys; logically identical filters produce deeply equal keys; `pluginKey("todos", "board")` yields `["x", "todos", "board"]`.
- **Invalidation mapping**: with a real `QueryClient` and a fake `EventSource`, dispatch an `invalidate` for `["docs"]` and assert every cached `useDocs` variant is marked stale, while `["thread", id]` entries are untouched; a malformed payload is dropped without throwing.
- **Single connection**: mounting several hooks under one provider constructs exactly one `EventSource`.
- **Backoff/reconnect**: with fake timers, simulate drops and assert the delay schedule is bounded, jittered, and capped; assert `refetchQueries({ type: "active" })` fires on reconnect but not on first connect.
- **Coalescing**: 20 invalidate events for the same key within the batch window produce a single refetch.
- **Optimistic append**: cache shows the provisional turn synchronously; a server refetch with the same timestamp replaces (does not duplicate) it; a rejected mutation restores the prior cache.
- **Hooks**: each read hook calls the expected contract operation with the expected params (assert against a stubbed client, typed by the contract).

## E2E Verification Plan

Against the **real running application** — real server, real files, real SSE. Per SPEC.md §15 M2/M3 the live-update loop is the thing being proven.

### Verification Steps

1. Start the Corpus server on `:8765` against a real workspace and `npm run dev -w apps/ui`.
2. Mount a temporary dev route (or the board placeholder from UI-001) that renders `useDocs({})` results plus `useConnectionState()`.
3. In the browser devtools Network tab, confirm exactly **one** open `/events` connection while several hooks are mounted.
4. Create a document out-of-band — `corpus doc create …` (or `curl -X POST /api/docs`) — and observe the list update **without a page reload**; capture the invalidate event payload and the follow-up `GET /api/docs` request.
5. Touch a file on disk directly (`echo >> data/docs/…`) and confirm the watcher → SSE → refetch path also updates the UI (proves the projection path, not just the write path).
6. Kill the server; observe the connection state flip to `reconnecting` and the backoff delays in the console logs (no hot loop). Restart the server; observe reconnection, exactly one burst of refetches, and the UI reflecting a change made **while the server was down**.
7. Post a turn through the UI's append mutation (or a dev button calling `useAppendTurn`); observe the turn appear instantly, then confirm after the server refetch there is exactly one copy of it and its timestamp is the server's.
8. Verify a plugin-namespaced invalidation: `curl` a plugin route (or have the server broadcast `["x","todos","board"]`) and assert the corresponding cached query refetches.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable") — the audit trail for recalibrating Model recommendations. The
evaluator will reject issues without credible proof._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, cross-domain — this is the plugin contract surface)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-002]` prefix
