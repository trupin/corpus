# Evaluation: UI-002

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

`@corpus/kit` data layer — hooks + SSE bridge. 42 criteria (TEST-1 … TEST-42): **41 PASS, 1
DEFERRED → PLUGINS-\* (adjudicated)**. Verified against a real `corpus init` workspace on port
**8985**, a real server process, the real Vite dev server on `CORPUS_UI_PORT=5273` proxying `/api`
and `/events`, and a **real headless Chromium** driven through Playwright's Node API. `8765` was
confirmed unbound before, during and after.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Filled per criterion, TEST-1 … TEST-42, no placeholder text.                                                                                                              |
| Commands are specific and concrete      | PASS   | Exact ports, exact filenames, exact frame payloads, exact timestamps, exact backoff gaps.                                                                                  |
| Real E2E (not mocked)                   | PASS   | Real workspace, real server, real Vite proxy, real browser. The unit half correctly uses the `eventSourceFactory` seam; the loop half (TEST-27…38) is browser-observed.     |
| Scenarios cover acceptance criteria     | PASS   | Every AC maps to a criterion; the one unsatisfiable criterion is marked `DEFERRED` with substitute evidence rather than silently omitted.                                   |
| Application restarted after changes     | PASS   | `packages/kit` rebuilt before `apps/ui` could see new exports; server stopped/restarted by pid inside TEST-32/33.                                                          |
| Actual model recorded (implemented on:) | PASS   | `**implemented on: opus** (claude-opus-5[1m])`, matching the issue's `Model: opus` recommendation.                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | UI-002 is a feature, and the log says so explicitly.                                                                                                                       |

**Deviations disclosed by the agent rather than hidden — all three check out.**

1. **Seven read hooks, not six** (`useHealth` moved into the kit). Adjudicated: `["health"]` is the
   key the SSE bridge invalidates, and leaving the hook in `apps/ui` would have kept a direct
   `@corpus/contract/client` data path there, failing TEST-4. Confirmed in `dist/index.d.ts` and by
   TEST-26 passing in a real browser.
2. **TEST-34 deferred** — no server route can emit an `x/`-namespaced key yet. Substitute evidence
   supplied and named. Legitimate.
3. **A reconnect can outrun the server's boot-time projection** — disclosed voluntarily as a
   negative result the agent hit on 1 of 2 runs. It is now filed as **SERVER-025** and is in
   `issues/PLAN.md`. See OBS-1.

---

## Log Honesty Re-derivation

Every claim below was re-run by me, independently, on my own rig.

| Claim in log                                                                       | Re-derived? | Actual observation                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dist/index.d.ts` exports exactly the listed 30-odd symbols, seven read hooks       | CONFIRMED   | Read verbatim. Matches the log symbol-for-symbol. No `CorpusApi`, no `paths`/`components`/`operations`, no `createEventStream`/`eventStreamUrl`.               |
| `packages/kit/package.json`: react is a **peer** dep, tanstack + contract are deps  | CONFIRMED   | Exactly so; `dist/index.js` + `dist/index.d.ts` emitted; root `npm run build` green in dependency order.                                                       |
| TEST-4: the only direct `fetch(` in `apps/ui/src` is `apiClient.ts`                 | CONFIRMED   | `apps/ui/src/app/apiClient.ts:51` — the late-bound `globalThis.fetch`, one hit, no `@corpus/contract/client` import anywhere in `apps/ui/src`.                 |
| TEST-3: no workspace deep-imports kit source                                        | CONFIRMED   | One reference, `apps/ui/e2e/tokens.ts:4`, reading `tokens.css` **as a file**; `tokens.css` is a published subpath. `npm run typecheck` exit 0.                 |
| TEST-12: `packages/contract` untouched by UI-002                                    | CONFIRMED   | `git diff 4c3f3af^..4c3f3af -- packages/contract` is empty.                                                                                                    |
| The plural spelling is what is on the wire                                          | CONFIRMED   | Captured live: `{"keys":[["docs"],["docs","doc_qg2fftiy"],["tree"]]}` and `{"keys":[["docs"],["docs","th_xu6zg42v"],["threads","th_xu6zg42v"]]}`.              |
| TEST-28: exactly one `/events` connection with the whole probe mounted              | CONFIRMED   | One `GET /events?token=…` in the browser request log, held open across every subsequent mutation.                                                              |
| TEST-32: bounded, jittered, capped backoff; no hot loop; zero page errors           | CONFIRMED   | My run: **8 attempts in 60 s**, gaps `773, 1638, 2126, 4651, 10649, 19518, 16899 ms`. (Log recorded 5 attempts / different gaps — a different jitter draw of the same schedule, not a contradiction.) `pageerror` count 0 throughout. |
| TEST-42: `packages/kit` branches **91.27 %**                                        | CONFIRMED   | Merged gate at the tip reports `packages/kit … 91.27% 209/229` — the log's number exactly.                                                                     |
| `:connected` / `:hb` are SSE comments, invisible to `EventSource`                   | CONFIRMED   | Independent `curl -N` capture: 1 × `:connected`, 6 × `:hb`, and zero invalidations attributable to them.                                                       |
| TEST-36 reconciliation is by turn timestamp, server's replaces client's             | CONFIRMED   | Provisional `2026-07-28T00:14:04.642Z` (ms precision, client) replaced by `2026-07-28T00:14:09Z` (server). Exactly one copy survived.                          |
| "A reconnect can outrun the boot projection" (the disclosed negative result)        | CONFIRMED as real, NOT reproduced at rate | 3/3 clean rounds on my rig (see OBS-1). The agent disclosed a race it hit; I could not make it fire, which makes the disclosure more credible, not less. |

No claim was contradicted.

---

## Criteria Results

| #       | Criterion                                              | Result       | Notes                                                                                                                                              |
| ------- | ------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-1  | Kit declares the dependencies it now has               | PASS         | Deps/peer verified in `package.json`; `dist/index.js` + `.d.ts` emitted; root build green contract → kit → cli → server → ui.                        |
| TEST-2  | Public surface is deliberate; is the plugin contract   | PASS         | `dist/index.d.ts` read verbatim (reproduced below). Seven read hooks — the adjudicated deviation. Bypass surfaces absent.                            |
| TEST-3  | Importable through the package entry, not source       | PASS         | `npm run typecheck` exit 0 across all workspaces; sole `kit/src` reference is the `tokens.css` file read.                                            |
| TEST-4  | `apps/ui` reaches the server only through the kit      | PASS         | One justified hit (`apiClient.ts:51`), named in the log. `shell/useHealth.ts` deleted; `ConsoleStrip` imports `useHealth` from `@corpus/kit`.        |
| TEST-5  | `App`'s existing test seam survives                    | PASS         | `client?: QueryClient` prop intact; 4 modified shipped tests each listed with a reason; **no test deleted** (`useHealth.test.tsx` moved, not cut). Whole `apps/ui` suite green in the tip run. |
| TEST-6  | Every key built from the contract's exported builders  | PASS         | `keys.test.ts` asserts **referential identity** (`expect(docKey).toBe(contract.docKey)`) for all nine shapes. Corroborated on the wire.              |
| TEST-7  | Adopting the contract's spelling is recorded           | PASS         | Issue Technical Design corrected in place with both spellings quoted; README §"Two spellings that matter" repeats the warning.                       |
| TEST-8  | `useDocs` canonicalizes its filters                    | PASS         | `"issues exactly one request for two logically identical filter objects"` — key-order, explicit `undefined` members and reversed `tag` array.        |
| TEST-9  | Canonicalization is total and documented               | PASS         | Named tests for empty object, only-empty values, nested arrays/objects, sorted encoding, stability. **Unknown filter PRESERVED** and forwarded.      |
| TEST-10 | List key and single-document key do not collide        | PASS         | `"always carries a filter segment, so it never collides with a document key"` + `"a single-document frame reaches the reader and no collection variant"`. |
| TEST-11 | Key scheme documented where a plugin author looks      | PASS         | `packages/kit/README.md` (9.9 K) documents all nine core shapes plus the two kit-owned ones; a test asserts it against `QUERY_KEY_NAMES`.            |
| TEST-12 | `pluginKey` in the kit, not the contract               | PASS         | `["x","todos","board"]`; contract diff empty at UI-002's commit; artifacts check green twice.                                                        |
| TEST-13 | Exactly one EventSource per provider                   | PASS         | `"opens exactly one EventSource however many hooks come and go"`. Corroborated live (TEST-28).                                                        |
| TEST-14 | Bridge testable without a real EventSource             | PASS         | `"survives a runtime with no EventSource at all"`, `"uses the factory the provider was given, token and all"`. Fake ships from `@corpus/kit/testing`. |
| TEST-15 | Wraps the contract's parser, does not replace it       | PASS         | No second `InvalidatePayload` schema and no second `JSON.parse(event.data)` in `packages/kit`.                                                        |
| TEST-16 | Invalidate frame invalidates by prefix                 | PASS         | `"invalidates by prefix: a …"` with a real `QueryClient`.                                                                                             |
| TEST-17 | Multi-key frame dispatches every key                   | PASS         | `"dispatches every key in a multi-key frame, dropping none and inventing none"`.                                                                      |
| TEST-18 | Unknown and plugin keys pass through unchanged         | PASS         | `"passes plugin and unrecognised keys straight through"` — no allowlist.                                                                              |
| TEST-19 | Malformed payload dropped, never thrown                | PASS         | Five shapes covered. **The agent found and fixed a real defect here**: `{"keys":[[]]}` parsed cleanly and, as a zero-length prefix, invalidated the entire cache. Zero-length keys are now dropped. |
| TEST-20 | Heartbeats and greeting are not events                 | PASS         | `"turns no liveness signal into a refetch"`; corroborated on the wire (6 × `:hb`, zero invalidations).                                                |
| TEST-21 | Invalidate storm coalesces                             | PASS         | `"coalesces a storm of frames naming one key into a single invalidation"`. **Window stated: `DEFAULT_BATCH_WINDOW_MS = 50` ms**, exported.            |
| TEST-22 | Coalescing does not lose a distinct key                | PASS         | `"keeps every distinct key in a storm"`.                                                                                                              |
| TEST-23 | Backoff bounded, jittered, capped; never hot-loops     | PASS         | `"grows exponentially, never exceeds the cap and is never zero"`, `"jitters: two draws of the same attempt differ"`, `"floors at half the computed delay"`. **base 500 ms, cap 30 000 ms**, both exported. Measured in the browser: 8 attempts/60 s. |
| TEST-24 | Reconnect refetches active queries; first connect does not | PASS     | `"refetches active queries on a reconnect and never on the first connect"` + `"refetches once per reconnect, not once per failed attempt"`. Live: exactly 1 burst per reconnect, 3/3 rounds. |
| TEST-25 | Connection state exposed, transitions honestly         | PASS         | `"reports connecting → open → reconnecting → open, in order"`. Live: probe showed `open` → `reconnecting` → `open`.                                   |
| TEST-26 | Health key converges without a reload — both directions | PASS        | **Verified in a real browser on the real board route.** Server up → strip reads `corpus 0.0.0`; server killed → converges to `server unreachable`; server restarted → converges back to `corpus 0.0.0`. No reload at any point. `GET /api/health` 1 → 12 → 13. `["health"]` lives in the kit; log states this. |
| TEST-27 | The provider authenticates                             | PASS         | `GET /api/docs` 200 with 6 rows; `/events` opened. Token came from `VITE_CORPUS_TOKEN` (documented in `apps/ui/README.md`), read by `apps/ui`, handed to the kit as configuration. Unauthenticated proxy request returns **401**, so auth is genuinely in play. |
| TEST-28 | Exactly one `/events` with the whole UI mounted        | PASS         | One `GET /events?token=…`, with `useDocs`/`useTree`/`useJobs`/`useLocks`/`useConnectionState` all mounted and reporting `ok`.                         |
| TEST-29 | Out-of-band CLI mutation repaints with no reload       | PASS         | `corpus doc create --type note --title e008-probe-…` → rows **6 → 7** with no reload; frame `{"keys":[["docs"],["docs","doc_qg2fftiy"],["tree"]]}`; follow-up `GET /api/docs` recorded. |
| TEST-30 | A direct file write also repaints (watcher path)       | PASS         | `printf >> data/docs/inbox/e008-probe-….md` on disk → browser issued further `GET /api/docs` with no user action (2 → 4). Frame `{"keys":[["docs"],["docs",id]]}`, no `["tree"]` — the tree did not change. |
| TEST-31 | Thread view updates on a turn appended elsewhere       | PASS         | `corpus thread reply … --from agent` → turns **1 → 2**, no reload; frame named **both** `["threads",id]` and `["docs",id]`; browser refetched `/api/docs` and `/api/threads/{id}`. |
| TEST-32 | Server death survived without a hot loop               | PASS         | State → `reconnecting`; **8 attempts over 60 s**, gaps `773 … 27 098 ms`, all under the 30 s cap; zero uncaught page errors.                          |
| TEST-33 | A change made while disconnected is visible after reconnect | PASS    | **3/3 rounds**: exactly **one** `GET /api/docs` burst per reconnect, and the document written to disk while the server was down was on screen from that refetch alone. See OBS-1 for the disclosed race. |
| TEST-34 | A plugin-namespaced invalidation round-trips           | DEFERRED → PLUGINS-\* | Adjudicated. No server route can emit an `x/` key yet. Substitute supplied: a real `["x","todos","board"]` frame through the **real contract parser** into a **real `QueryClient`**. Named, not omitted. |
| TEST-35 | The user's turn appears synchronously                  | PASS         | Re-verified with the POST **genuinely gated open** via request interception: provisional turn rendered with `data-turn-pending="true"` and a client ms-precision ts `…T00:14:04.642Z`. |
| TEST-36 | Server's turn replaces the provisional one             | PASS         | After settle: exactly **one** copy, carrying the server's `…T00:14:09Z`. Rule stated in the log (unique monotonic ts, SPEC §6).                       |
| TEST-37 | A failed mutation rolls the cache back                 | PASS         | All three shapes present and parameterised: `403`, `423`, transport (`Failed to fetch`); plus `"leaves no cache entry behind when there was none to restore"`. |
| TEST-38 | In-flight SSE invalidation does not eat the optimistic entry | PASS   | **Strongest live result.** With the POST held open, a genuine out-of-band agent reply produced a real `["threads",id]` frame; the refetch landed (the reply appeared) and the provisional entry **survived**; after settle, exactly one copy, zero pending. |
| TEST-39 | Every read hook calls the operation the contract declares | PASS       | Named test per operation, asserted at the wire against the recorded `Request`, not against a stub.                                                    |
| TEST-40 | Types are the contract's, nothing hand-written, no `any` | PASS       | `npm run lint` exit 0, `npm run typecheck` exit 0, `npm run format:check` exit 0 at the tip. `"preserves search snippets on a …"` covers the FTS case for UI-009. |
| TEST-41 | Two providers are two connections; the app asserts one | PASS         | `"two providers are two connections, and the second is reported"`; `mountedCorpusProviders()` is the affordance; constraint documented in the README. |
| TEST-42 | Coverage does not fall off a cliff                     | PASS         | Merged gate at the tip: **`packages/kit` lines 100 % (640/640), functions 100 % (85/85), branches 91.27 % (209/229)`** — up from one covered line. All four ALL-metrics ≥ 90. |

---

## The two artifacts UI-003 / UI-004 / UI-011 were promised (TEST-163)

**Export surface, verbatim from the built `packages/kit/dist/index.d.ts` at `4ea3e4b`:**

```
PACKAGE_NAME
createCorpusClient · CorpusRequestError
  types: AppendTurnInput, CorpusClient, CorpusClientConfig, CorpusEventStreamOptions,
         DocsFilter, JobsParams, RequestOptions
CorpusProvider · mountedCorpusProviders · type CorpusProviderProps
createCorpusQueryClient · useCorpusClient
useDocs · useDoc · useThread · useTree · useJobs · useLocks · useHealth
useAppendTurn · type AppendTurnVariables
isPendingTurn · mergePendingTurns · PendingTurnStore
  types: PendingTurn, ThreadTurn, ThreadView
canonicalFilter · docKey · docsListKey · DOCS_KEY · HEALTH_KEY · jobKey · jobsListKey ·
  JOBS_KEY · lockKey · LOCKS_KEY · PLUGIN_KEY_PREFIX · pluginKey · QUEUE_KEY ·
  threadKey · TREE_KEY
  types: CanonicalFilter, QueryKey, QueryKeySegment
useConnectionState
backoffDelay · DEFAULT_BASE_DELAY_MS · DEFAULT_BATCH_WINDOW_MS · DEFAULT_MAX_DELAY_MS
  types: BridgeLogger, ConnectionState
types only: EventSourceFactory, EventSourceLike (re-exported from @corpus/contract/client)
```

Deliberately **absent**, and confirmed absent: `CorpusApi`, `paths`/`components`/`operations`,
`createEventStream`/`eventStreamUrl`, `uploadTurn`/`uploadCapture`, `QueryClient`/`useQuery`/
`useMutation`. `@corpus/kit/testing` is a **second entry point**, not part of the runtime contract.

**Query-key table, as shipped and as observed on the wire:**

| Key                             | Owner    | Observed live in this evaluation                          |
| ------------------------------- | -------- | --------------------------------------------------------- |
| `["docs"]`                      | contract | yes — every mutation frame                                 |
| `["docs", "<docId\|threadId>"]` | contract | yes — `["docs","doc_qg2fftiy"]`, `["docs","th_xu6zg42v"]`   |
| `["docs", <canonicalFilter>]`   | kit      | collection key; distinct from `docKey` by structure         |
| `["tree"]`                      | contract | yes — on doc-create into a new folder, absent on body edits |
| `["threads", "<threadId>"]`     | contract | yes — `["threads","th_xu6zg42v"]`                           |
| `["queue"]`                     | contract | not exercised here                                          |
| `["jobs"]` / `["jobs", <id>]`   | contract | list hook mounted; no jobs in the fixture                   |
| `["locks"]` / `["locks", <id>]` | contract | list hook mounted; no locks in the fixture                  |
| `["health"]`                    | **kit**  | yes — invalidated on drop **and** on reconnect (TEST-26)    |
| `["x", "<plugin>", …]`          | **kit**  | passed through unfiltered; no server emitter yet (TEST-34)  |

---

## Failures

None.

---

## Observations (not criterion failures)

### OBS-1 — the disclosed reconnect/boot-projection race is real, filed, and did not reproduce for me

The log discloses that on 1 of 2 runs, the stream re-opened and `refetchQueries` fired **before** the
restarted server had finished projecting a file written while it was down; because the boot scan
emits no `invalidate` frame, the row never appeared. I ran the sequence **three more times with a
well-formed document** and got `seen = true` on all three, with exactly one refetch burst each time.

I first recorded a failure here and then found it was **my own fixture error** — my hand-written
"offline" file omitted the required frontmatter (`id`, `created`, `updated`, `status`), so it was
never projectable by anything and the server-side projection did not contain it either. Once I
copied a real server-authored document and changed only `id`/`title`, the criterion passed 3/3.

The underlying race is nonetheless real, correctly diagnosed as server-side, and **filed as
SERVER-025** ("Emit an invalidate when the boot projection completes", P2, in `issues/PLAN.md`). The
kit's behaviour — refetch once, at the only moment it knows about — is correct. Nothing is owed here
by UI-002. The log's line "Not filed; flagged for the orchestrator" is stale: it *was* filed.

### OBS-2 — `apps/ui/README.md` documents the dev token path properly

Open Conflict 3's adjudication (kit config-only; `VITE_CORPUS_TOKEN` in dev; production half is
SERVER-024) is written into `apps/ui/README.md` with the exact `jq`-based command and an explicit
"Production is a different mechanism … that is SERVER-024" paragraph. That is the right place for it.

### OBS-3 — the seven-hook deviation is a genuine improvement, not a shortcut

Moving `useHealth` into the kit is what makes TEST-4 satisfiable at all: leaving it in `apps/ui`
would have required that workspace to keep a direct `@corpus/contract/client` query path. The
criterion said "six read hooks"; shipping seven strictly enlarges the plugin contract in the
direction the neighbouring criterion demanded. Recorded here so UI-003 onward treat seven as the
number.

---

## Summary

**41 of 42 criteria PASS; 1 DEFERRED → PLUGINS-\* with substitute evidence and an explicit
statement, exactly as the sprint contract's "deferred verification is recorded, not skipped" rule
requires.**

This is the sprint's only P0 and the one issue whose defects are invisible to the type system, and
it holds up under exactly the probing the contract asked for. The single largest risk the sprint
identified — a kit built to the issue file's wrong `["doc", id]` / `["thread", id]` literals, caching
under keys no `invalidate` frame ever names — is closed not by convention but structurally: the kit
imports the contract's builders and a test asserts **referential identity** with them, so an upstream
rename is a failure rather than a silent cache miss. I confirmed the plural spelling on the wire in
three separate real frames.

The live-update loop is genuinely proven: an out-of-band CLI create, a bare `printf >>` to a file on
disk, and an out-of-band agent reply each repainted a real browser with no reload; server death
produced a bounded, jittered, capped retry schedule with zero uncaught errors; the console strip
converged in **both** directions without a reload; and the optimistic-append path survived a real
mid-flight invalidation with exactly one copy of the turn at the end. The agent found and fixed a
real cache-wiping defect (`{"keys":[[]]}` as a universal prefix) while writing its own tests, and
disclosed a negative result it could have buried.

The log is honest. Twelve specific claims re-derived, twelve confirmed, none contradicted — including
the `packages/kit` branch-coverage figure to two decimal places.
