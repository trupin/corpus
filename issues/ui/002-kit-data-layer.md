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

- [x] `@corpus/kit` exports a `createCorpusClient({ baseUrl, token })` factory built on `@corpus/contract/client`, plus a `CorpusProvider` that puts the client and the shared `QueryClient` on React context.
- [x] Read hooks exist and are fully typed from the contract (no hand-written response types, no `any`): `useDocs(query)`, `useDoc(id)`, `useThread(id)`, `useTree()`, `useJobs(params)`, `useLocks()`.
- [x] `useDocs(query)` accepts the full `GET /api/docs` filter set (`q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort`) as a typed object; a filter object with the same values in a different key order produces the **same** query key (keys are canonicalized).
- [x] The query-key scheme is implemented as key-builder functions (not string literals scattered in components), documented in `packages/kit/README.md` with the exact shape of every key, and exported so plugins can build compatible keys.
- [x] Exactly one `EventSource` on `/events` exists per app instance regardless of how many hooks are mounted; mounting/unmounting hooks never opens or closes additional connections.
- [x] An `invalidate` event carrying query keys results in `queryClient.invalidateQueries` for each key, using prefix matching so `["docs"]` invalidates every `useDocs` variant.
- [x] **Health key is explicitly covered** _(pr-reviewer #8 handoff, 2026-07-26)_: UI-001's console strip uses `staleTime: Infinity` with no refetch triggers, so its server status is frozen at the boot-time probe until something invalidates it — "server unreachable" persists after the server comes back and vice versa. The SSE bridge's connect/disconnect transitions must invalidate the health key (reconnect ⇒ refetch health; connection loss ⇒ reflect unreachable), so the strip converges without a manual reload.
- [x] The SSE connection auto-reconnects with exponential backoff (jittered, capped) after a drop, and on successful reconnect **refetches all active queries** to recover invalidations missed while disconnected.
- [x] Connection state (`connecting | open | reconnecting`) is exposed via a `useConnectionState()` hook so UI-011's console strip and UI-001's shell can surface it.
- [x] An `useAppendTurn()` mutation optimistically appends the user's own turn to the cached thread, and the optimistic entry is reconciled (replaced, not duplicated) when the server refetch lands; a failed mutation rolls the cache back.
- [x] SSE heartbeats (SPEC.md §9.2, 25 s) are consumed without triggering refetches or being mistaken for invalidations.
- [x] The plugin key-namespace convention `x/<plugin>/…` is documented and enforced by an exported `pluginKey(plugin, ...parts)` helper; keys built with it round-trip through the same invalidation path as core keys.
- [x] Vitest coverage for the key builders, the invalidation mapping, the reconnect/backoff logic, and optimistic append/reconcile/rollback.

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

**Corrected in place (ui-dev, 2026-07-27) — this is the scheme that shipped:**

- `["docs", canonicalQuery]` — a collection query, built by `docsListKey(filter)`; `canonicalQuery` is the filter object with `undefined`/`null`/`""`/empty values dropped, keys sorted and array values sorted, so key identity is value-based
- `docKey(id)` → `["docs", id]` and `threadKey(id)` → `["threads", id]` — **the contract's builders, re-exported by the kit, never spelled here**. The singular `["doc", id]` / `["thread", id]` in this file's first draft was wrong (sprint-008 Open Conflict 1)
- `TREE_KEY` → `["tree"]` — the folder tree
- `jobsListKey(params)` → `["jobs", params]` — console rows; `jobKey(eventId)` → `["jobs", eventId]`
- `LOCKS_KEY` → `["locks"]` — the lock projection; `lockKey(docId)` → `["locks", docId]`
- `QUEUE_KEY` → `["queue"]` — queue depth and halted state
- `HEALTH_KEY` → `["health"]` — **kit-owned**; the contract's set is closed at nine shapes and no server mutation emits it. The SSE bridge invalidates it on every drop and every reconnect (sprint-008 Open Conflict 2)
- `pluginKey(plugin, ...parts)` → `["x", plugin, ...parts]` — **kit-owned**, same reason

Prefix matching is the whole point: an `invalidate` naming `["docs"]` must invalidate every cached collection query. Use TanStack Query's default prefix semantics (`queryClient.invalidateQueries({ queryKey })`) rather than exact matching.

**Canonicalization.** `canonicalQuery` must be deterministic: drop `undefined`, `null`, and `""`; sort object keys; sort array-valued filters (e.g. `tag`). Two calls with logically identical filters must share a cache entry — otherwise a column re-render silently doubles the request rate.

**SSE bridge.** One `EventSource` created by `CorpusProvider` on mount, torn down on unmount. Parse the event payload with a Zod schema (Zod-at-boundaries per `docs/TS_GUIDELINES.md`) — a malformed payload is logged and dropped, never thrown. Distinguish three inbound shapes: `invalidate` (dispatch), heartbeat/comment lines (ignore), and anything unknown (log at debug, ignore).

**Reconnect + missed invalidations.** `EventSource` retries on its own, but its schedule is not ours: manage reconnection explicitly (close on `error`, reconnect after `min(cap, base * 2^n)` with jitter). On every **successful (re)connect after a drop**, call `queryClient.refetchQueries({ type: "active" })` — while disconnected we cannot know which keys changed, so the only correct recovery is to refetch what is on screen. Do **not** do this on the very first connect (nothing is stale yet). Expose the state so the console can show a "reconnecting" indicator instead of silently serving stale data.

**Optimistic turn append (SPEC.md §11).** `useAppendTurn` writes a provisional turn into the `["threads", id]` cache immediately with a client-side marker (e.g. `pending: true`), fires the POST, and on success invalidates the thread key. Reconciliation must be by **turn timestamp** — the CLI guarantees unique monotonic turn timestamps within a thread (SPEC.md §6), so the server's turn replaces the provisional one rather than appearing beside it. On error, restore the pre-mutation snapshot and surface the error to the caller.

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

N/A — UI-002 is a feature, not a bug fix.

### Post-Implementation Verification

**implemented on: opus** (`claude-opus-5[1m]`), in the worktree
`.claude/worktrees/ui-002`.

#### Environment

- Workspace: `corpus init /tmp/corpus-u002-ydvG7b --port 8905` — a real git repo,
  seeded with the standard 8 template documents.
- Server: `corpus server start` → `corpus 0.0.0 listening on http://127.0.0.1:8905`.
- UI: the real Vite dev server, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8905
  VITE_CORPUS_TOKEN=<from .corpus/config.json> npx vite --port 5273 --strictPort`.
- Browser: real headless Chromium driven through Playwright's Node API.
- `8765` was checked free before and after (`lsof -nP -iTCP:8765 -sTCP:LISTEN`
  empty both times); nothing was ever bound there.
- Teardown: server stopped by pid, Vite killed by pid, workspace and scratch
  scripts removed. `8905`/`5273`/`8765` all confirmed free afterwards.

#### The package and its boundary

- **TEST-1** — `packages/kit/package.json` now declares `@corpus/contract` and
  `@tanstack/react-query` as dependencies, `react` as a **peer** dependency, and
  React/RTL as devDependencies. `npm run build` from the root succeeds in
  dependency order and emits `dist/index.js` + `dist/index.d.ts` (plus
  `dist/testing/`).
- **TEST-2** — the built `dist/index.d.ts` exports exactly:
  `PACKAGE_NAME` · `createCorpusClient` · `CorpusRequestError` · `CorpusProvider`
  · `mountedCorpusProviders` · `createCorpusQueryClient` · `useCorpusClient` ·
  `useDocs` · `useDoc` · `useThread` · `useTree` · `useJobs` · `useLocks` ·
  `useHealth` · `useAppendTurn` · `isPendingTurn` · `mergePendingTurns` ·
  `PendingTurnStore` · `canonicalFilter` · `docKey` · `docsListKey` · `DOCS_KEY`
  · `HEALTH_KEY` · `jobKey` · `jobsListKey` · `JOBS_KEY` · `lockKey` ·
  `LOCKS_KEY` · `PLUGIN_KEY_PREFIX` · `pluginKey` · `QUEUE_KEY` · `threadKey` ·
  `TREE_KEY` · `useConnectionState` · `backoffDelay` ·
  `DEFAULT_BASE_DELAY_MS` / `DEFAULT_BATCH_WINDOW_MS` / `DEFAULT_MAX_DELAY_MS`,
  plus the types those need. `packages/kit/src/index.test.ts` pins that list and
  asserts the absences: no `CorpusApi`, no `paths`/`components`/`operations`, no
  `createEventStream`/`eventStreamUrl`, no `uploadTurn`/`uploadCapture`, no
  `QueryClient`/`useQuery`/`useMutation`.
  **Deviation from the criterion, stated deliberately:** the surface is
  *seven* read hooks, not six. `useHealth` moved into the kit because
  `["health"]` is the key the SSE bridge invalidates (TEST-26) and because
  leaving it in `apps/ui` would have kept a direct `@corpus/contract/client`
  data path there, failing TEST-4. `mountedCorpusProviders` is the TEST-41
  affordance. `@corpus/kit/testing` is a **second entry point**, not part of the
  runtime contract: `FakeEventSource`, `fakeEventSourceFactory`,
  `failingEventSourceFactory`, `createCorpusTestHarness`.
- **TEST-3** — `npm run typecheck` passes across all workspaces with the kit
  resolved through its `exports` map into `dist/`. The only reference to
  `packages/kit/src/**` anywhere outside the kit is `apps/ui/e2e/tokens.ts`,
  UI-001's helper that reads `tokens.css` **as a file** off disk (the stylesheet
  is a published subpath, `./tokens.css` → `./src/tokens.css`); no workspace
  deep-imports kit *source*.
- **TEST-4** — searching `apps/ui/src` for `fetch(` and `@corpus/contract/client`
  returns exactly one hit: `apps/ui/src/app/apiClient.ts:51`, the late-bound
  `globalThis.fetch` the kit client is constructed with. That file **is** the
  provider wiring and is the justified exception; it no longer imports from
  `@corpus/contract/client` at all. `shell/useHealth.ts` was deleted and
  `ConsoleStrip` now imports `useHealth` from `@corpus/kit`.
- **TEST-5** — `App`'s `client?: QueryClient` prop survives unchanged; two new
  optional props (`corpusClient`, `eventSourceFactory`) were added beside it.
  **Every modification to a shipped `apps/ui` test, with its reason:**
  1. `app/App.test.tsx` — passes `eventSourceFactory`. `App` now mounts
     `CorpusProvider`, which opens the stream; neither Node nor jsdom has an
     `EventSource`, so without the injection every test would sit in the
     bridge's backoff loop. The three original assertions are untouched; two
     tests were added.
  2. `main.test.tsx` — one added `vi.stubGlobal("EventSource", FakeEventSource)`.
     `main.tsx` renders `App` with no props, so the kit reaches for the global.
     Assertions unchanged.
  3. `app/apiClient.test.ts` — the two cases that called `uiClient.api.GET(...)`
     now call `uiClient.getHealth()`. The kit's client exposes one method per
     operation rather than the generated `api` object; that is the boundary
     working as intended. Three cases were added.
  4. `shell/ConsoleStrip.test.tsx` and `shell/Shell.test.tsx` — render inside
     `createCorpusTestHarness().Wrapper` instead of a bare `QueryClientProvider`,
     because the health probe is a kit hook now. Every original assertion kept
     verbatim; one test added to `ConsoleStrip`.
  **No test was deleted.** `shell/useHealth.test.tsx` was *moved*: its cases live
  in `packages/kit/src/query/hooks.test.tsx` alongside the hook they now test.

#### The query keys

- **TEST-6** — `packages/kit/src/query/keys.test.ts` asserts referential identity
  with the contract's own builders (`expect(docKey).toBe(contract.docKey)` for
  all nine shapes), so a rename upstream is a failure here rather than a silent
  cache miss. `hooks.test.tsx` asserts each hook's cache entry lands under the
  contract's key: `useDoc("doc_a")` → `["docs","doc_a"]`, `useThread("th_a")` →
  `["threads","th_a"]`, and explicitly that `["doc","doc_a"]` / `["thread","th_a"]`
  are **not** populated.
- **TEST-7** — recorded. The issue's Technical Design above is corrected in place.
  Both spellings, for the record: the first draft said `["doc", id]` /
  `["thread", id]`; **what shipped is `["docs", id]` / `["threads", id]`**, taken
  from `@corpus/contract`'s exported builders and never written as a literal in
  `packages/kit`. Confirmed on the wire below (TEST-29/31).
- **TEST-8** — two `useDocs` calls with the same filters in different key order,
  one carrying explicit `undefined` members and a `tag` array in the opposite
  order, produce a deeply equal key, one cache entry and **exactly one** network
  request (`hooks.test.tsx` → "issues exactly one request for two logically
  identical filter objects"; the transport is asserted to have been called once).
- **TEST-9** — `canonicalFilter` is total: empty object → `{}`; only-empty values
  → `{}`; `undefined`/`null`/`""`/empty arrays/empty nested objects dropped;
  nested arrays and nested objects canonicalised recursively; array members
  sorted by JSON encoding; output stable across calls. **An unknown filter is
  PRESERVED** and forwarded to the server (`createCorpusClient.test.ts` →
  "forwards a filter the kit does not know about" asserts `somethingNew=yes`
  reaches the query string) — the contract can grow a parameter without a kit
  release.
- **TEST-10** — `docsListKey({})` is `["docs", {}]`; a frame naming
  `["docs","doc_a"]` invalidates the reader and **neither** `useDocs` variant; a
  frame naming `["docs"]` invalidates both shapes. Asserted in
  `sseBridge.test.ts` with a real `QueryClient`.
- **TEST-11** — `packages/kit/README.md` documents every key's literal shape,
  what emits it, what refetches on it, the `x/<plugin>/…` convention, the
  "kit is the only data path" rule and the one-provider constraint. A test reads
  the README off disk and asserts it contains each shape string **exactly as
  `QUERY_KEY_VOCABULARY` publishes it** (`it.each(contract.QUERY_KEY_NAMES)`), so
  a divergence from the contract's published vocabulary is a test failure.
- **TEST-12** — `pluginKey("todos","board")` → `["x","todos","board"]`, and
  `HEALTH_KEY` → `["health"]`, both defined in the kit. **`packages/contract` is
  untouched by this issue** — no file under `packages/contract` was modified, and
  `QUERY_KEY_NAMES` is asserted not to contain `"health"`.

#### The SSE bridge (unit)

`packages/kit/src/events/sseBridge.test.ts`, 31 tests.

- **TEST-13** — six hooks mounted, three unmounted, two more mounted: the
  injected factory was called **once** and `close()` was never called
  (`CorpusProvider.test.tsx` → "opens exactly one EventSource however many hooks
  come and go").
- **TEST-14** — `"EventSource" in globalThis` is asserted `false` in the suite,
  and every SSE test injects a fake through `createEventStream`'s existing
  `eventSourceFactory` seam, forwarded from `CorpusProvider`'s props. No test
  constructs a real `EventSource`; no flag is set. The fake lives in
  `@corpus/kit/testing` so every downstream consumer gets the same seam.
- **TEST-15** — the bridge calls `client.connectEvents(...)` →
  `createEventStream`. `grep` confirms there is no second `InvalidatePayload`
  schema and no second `JSON.parse(event.data)` anywhere in `packages/kit`.
- **TEST-16** — `{"keys":[["docs"]]}` marks both `useDocs` variants **and**
  `["docs","doc_a"]` stale, leaving `["threads","th_a"]` and `["tree"]` untouched.
- **TEST-17** — the real multi-key frame
  `{"keys":[["docs"],["docs","th_x"],["threads","th_x"],["tree"]]}` dispatches all
  four, in order, none dropped and none invented.
- **TEST-18** — `["x","todos","board"]` and a shape the kit has never seen both
  reach `invalidateQueries` verbatim and invalidate their cached queries. There
  is no allowlist.
- **TEST-19** — five malformed payloads (invalid JSON, `{"keys":[]}`,
  `{"keys":"docs"}`, `{"keys":[[]]}`, and an object with no `keys`) are each
  logged and dropped, nothing throws, the source stays open, no reconnect is
  triggered, and a subsequent valid frame still dispatches.
  **Defect found and fixed while writing this test:** the contract's
  `QueryKeySchema` accepts an *empty* array, and TanStack treats `[]` as a prefix
  of every key — so `{"keys":[[]]}` parsed cleanly and invalidated the entire
  cache. The bridge now drops zero-length keys explicitly
  (`sseBridge.ts` → `enqueue`).
- **TEST-20** — an `open` event, a `message` event and a `ping` event produce
  zero invalidations over a simulated 60 s. Observed on the wire too: the real
  stream's `:connected` and `:hb` frames are SSE *comments* and never reach an
  `EventSource` listener (captured below).
- **TEST-21** — 20 frames naming one key inside the window produce **one**
  `invalidateQueries` call. **Window: `DEFAULT_BATCH_WINDOW_MS = 50` ms.**
- **TEST-22** — 20 frames naming three different keys inside one window produce
  exactly three calls, one per key, in first-seen order.

#### Reconnect (unit)

- **TEST-23** — `backoffDelay(n)` = `min(cap, base·2ⁿ)` scaled by half-to-full
  jitter. **`base = 500 ms`, `cap = 30 000 ms`.** Asserted monotonic, never zero,
  never above the cap, and different for different jitter draws. With a factory
  that fails on every connect, 60 s of simulated time yields ≤ 10 attempts —
  where ten immediate retries would take no time at all.
- **TEST-24** — `refetchQueries({type:"active"})` is **not** called on the first
  connect, and is called **exactly once** per reconnect — not once per failed
  attempt (asserted across three failed retries followed by one success). The
  assertion filters the spy for the unkeyed sweep, because `invalidateQueries`
  calls `refetchQueries` internally.
- **TEST-25** — a subscribed component observes `connecting → open →
  reconnecting → open`, in that order.
- **TEST-26** — a drop invalidates `HEALTH_KEY`, and so does the following
  reconnect. **`["health"]` lives in the kit** (`packages/kit/src/query/keys.ts`),
  not in `apps/ui` and not in the contract, and the bridge reaches it directly.
  Verified in a real browser below.

#### The loop, in a real browser against a real server

- **TEST-27** — the board at `http://localhost:5273/__probe` issued
  `GET /api/docs`, `GET /api/tree`, `GET /api/jobs`, `GET /api/locks`, all
  answered, all four hooks reporting `ok`, and `/events` opened
  (`connection state: open`). **The token came from `VITE_CORPUS_TOKEN`, read in
  `apps/ui/src/app/apiClient.ts` from the workspace's `.corpus/config.json` by
  the shell that started Vite.** The kit itself read no file and no env var — it
  received `{ baseUrl, token }` as configuration. Proof that auth is genuinely in
  play: a `fetch("/api/docs")` executed *inside the page* without the kit's
  client returned **401**, while the kit's own request returned data.
- **TEST-28** — with `useDocs`, `useTree`, `useJobs`, `useLocks` and
  `useConnectionState` all mounted, the captured request log contains **exactly
  one** `/events` request (`events requests: 1`), and it stays one across every
  subsequent mutation in the run.
- **TEST-29** — with the board open,
  `node --import tsx apps/cli/src/bin/corpus.ts doc create --type note --title
  probe-unique-1785191435461` in a separate process. The row appeared **without a
  page reload**: `rows 8 -> 9`. The frame that carried it, captured verbatim from
  a concurrent `curl -N /events`:
  `event: invalidate` / `data: {"keys":[["docs"],["docs","doc_wh3xubev"],["tree"]]}`
  — the plural spelling, exactly the keys the kit caches under. A follow-up
  `GET /api/docs` was recorded in the browser's request log.
- **TEST-30** — `printf '\nappended out of band\n' >>
  data/docs/inbox/sprint008-probe-2.md` written straight to disk. The browser
  issued further `GET /api/docs` requests without any user action
  (`before=2 after=4`), proving watcher → projection → SSE → refetch, a different
  path from TEST-29's.
- **TEST-31** — with `useThread(th_xpbigptf)` open,
  `corpus thread reply th_xpbigptf -m "agent reply …" --from agent` in another
  process. The turn appeared without a reload (`turns: 1 -> 2`), and the requests
  the browser made in response were exactly `GET /api/docs` and
  `GET /api/threads/th_xpbigptf` — the frame named **both** keys.
- **TEST-32** — the server was stopped by pid (`stopped (pid 46714)`).
  Connection state flipped to `reconnecting`. Over the following **60 s the
  browser made 5 `/events` attempts**, with inter-attempt gaps of
  **817, 3980, 5969, 12097, 27098 ms** — a clean jittered doubling under the
  30 s cap, and nothing like a per-second storm. Zero page errors throughout.
- **TEST-33** — with the server down, `corpus doc create` failed as expected
  (`{"error":{"code":"server_unreachable",…}}`), and a document was then written
  **straight to disk** while nothing was listening. The server was restarted; the
  connection returned to `open`; the reconnect burst was **1 `GET /api/docs` in
  the 4 s after reconnect**, and the document created while the board was
  disconnected was **on screen from that refetch alone**. A document created
  immediately after the restart also appeared. Final rows:
  `["offline-b-1785191680827","after-restart-1785191680827", …]`.
- **TEST-34 — DEFERRED → PLUGINS-\*, with a substitute.** No server route can
  emit an `x/`-namespaced key today: `apps/server` contains no reference to
  `pluginKey` or the `x` prefix, and its event bus has no HTTP entry point for an
  arbitrary key. The most direct real means available was therefore used: a real
  `["x","todos","board"]` frame is fed through the **real contract parser**
  (`createEventStream` + `InvalidatePayloadSchema`) into a **real `QueryClient`**
  holding a query registered under `pluginKey("todos","board")`, and that query
  is invalidated (`sseBridge.test.ts` → "passes plugin and unrecognised keys
  straight through"). The browser half waits for a plugin that can emit one.

#### Optimistic append, in the real browser

- **TEST-35** — clicking the probe's append button rendered the provisional turn
  immediately, marked `data-turn-pending="true"`, while the POST was still gated
  open. Client-side timestamp observed: `2026-07-27T22:30:41.684Z`.
- **TEST-36** — after the POST resolved and the refetch landed, the thread showed
  **exactly one** copy of the turn (`copies=1 pendingLeft=0`), carrying the
  **server's** timestamp `2026-07-27T22:30:42Z` — not the client's
  `…41.684Z`. The server's own view agreed:
  `["…09Z opening turn","…41Z agent reply …","…42Z user turn …"]`.
  **The reconciliation rule:** turn timestamps are unique and monotonic within a
  thread (SPEC.md §6), so a *confirmed* turn by the same author whose `ts` is at
  or after the provisional's **is** the provisional one and the provisional is
  dropped; the pending entry is additionally removed the moment its own mutation
  settles.
- **TEST-37** — three failure shapes, each asserted in
  `useAppendTurn.test.tsx`: `403`, `423` and a transport failure. In every case
  the cache is restored to the pre-mutation snapshot (`toEqual(before)`), no
  pending turn survives, and the error reaches the caller (`mutateAsync` rejects
  **and** `mutation.error` is set). A failure with no prior cache entry leaves no
  entry behind.
- **TEST-38** — with the POST held open, a `{"keys":[["threads","th_a"]]}` frame
  was delivered and the refetch it triggered landed; the provisional entry
  **survived** it, and after the mutation settled there was exactly one copy.
  Two mechanisms make that true: `cancelQueries` runs inside `onMutate`, and the
  pending turn also lives in a provider-level store that `useThread`'s `queryFn`
  re-merges into any refetch.

#### Hooks, types, constraints

- **TEST-39** — asserted at the wire, not against a stub: `createCorpusClient.test.ts`
  drives each operation through the generated client into an injected `fetch` and
  checks the recorded `Request`. `GET /api/docs` (with `q`, `type`, `sort`, and
  comma-joined array filters), `GET /api/docs/doc_a`, `GET /api/threads/th_a`,
  `GET /api/tree`, `GET /api/jobs?recent=25`, `GET /api/locks`, `GET /api/health`,
  `POST /api/threads/th_a/turns`. `hooks.test.tsx` then asserts each hook issues
  exactly that one path.
- **TEST-40** — `npm run lint` and `npm run typecheck` are clean, with **zero**
  `no-explicit-any` warnings from `packages/kit`. No response interface is
  hand-written; every one is `z.infer`red through `@corpus/contract`. `useDocs`
  with `q` preserves the FTS snippets, asserted structurally
  (`items[0].snippets` → `[{field:"body",segments:[{text:"bud",match:true}]}]`).
- **TEST-41** — two providers mounted together construct two factories
  (`first.eventSource.sources` and `second.eventSource.sources` both length 1),
  `mountedCorpusProviders()` returns `2`, and the second mount is reported through
  the provider's logger ("…must mount exactly one"). `apps/ui` mounts exactly one,
  in `App`. The constraint is documented in `packages/kit/README.md`.
- **TEST-42** — `npm run test:coverage`: **209 test files, 3558 tests, all
  passing**; the 90 % gate passes on all four metrics
  (**lines 98.79 %, statements 98.79 %, functions 98.60 %, branches 94.59 %**).
  Per workspace after this change: **`packages/kit` lines 100 %, functions 100 %,
  branches 91.27 %** (up from one covered line); **`apps/ui` lines 100 %,
  functions 100 %, branches 97.89 %** (unchanged at 100 % lines). Key builders,
  invalidation mapping, backoff/reconnect, coalescing and
  append/reconcile/rollback each have direct tests.

#### Two things the orchestrator should know

1. **A reconnect can outrun the server's boot-time projection.** On one of two
   runs of the TEST-33 sequence, the stream re-opened and the kit's
   `refetchQueries` fired *before* the restarted server had finished projecting
   the file written while it was down; the row then never appeared, because the
   boot scan emits no `invalidate` frame. The second run (recorded above) landed
   after projection and passed. The kit's behaviour is correct — it refetches
   once, at the only moment it knows about — so the durable fix belongs on the
   server side: emit an `invalidate` when the boot projection completes.
   Not filed; flagged for the orchestrator.
2. **`apps/server` has load-flaky tests.** Under the full suite on this machine
   (six agents running), `apps/server/src/anchors/reconcile.test.ts` →
   "reconciles 50 anchors over a ~1 MB body in under a second" and two
   concurrency tests in `apps/server/src/docs/update.test.ts` time out
   intermittently, including in isolation. They are untouched by this issue —
   `packages/kit` and `apps/ui` passed three consecutive clean runs — and the
   full suite is green with `--retry=2`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, cross-domain — this is the plugin contract surface)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-002]` prefix
