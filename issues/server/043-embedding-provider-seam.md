# [SERVER-043] Embedding provider seam: local-first, sticky identity

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-042
- Blocks: SERVER-044, INFRA-012

## Spec References
- SPEC.md §9.1 local-first + one-index-one-model bullets (SHARED-006 Edit 6); user decision 2026-07-30 (local tool, zero-key)

## Summary
A narrow `EmbeddingProvider` interface (embed batch of strings → vectors + a stable
identity string `provider/model@dim`) with three implementations: local runtime
(Ollama-style HTTP on its default port — probe, never install), bundled local model
(works with zero config and no network; the model artifact itself is INFRA-012's
packaging problem — this issue defines the loading seam and uses a small test double
until the artifact lands), and explicit external provider from `.corpus/config.json`.
Resolution at index-creation time only: config wins; else local runtime if reachable;
else bundled. **Sticky**: the chosen identity is recorded in index metadata and reused
on every subsequent run regardless of environment changes; identity changes only via
config edit or `corpus index rebuild` (which re-picks the current default). Identity
mismatch at startup = the index is invalid → full rebuild queued (SERVER-044/046 wire
the behavior; this issue exposes the check).

## Revision — OC1 as the user ruled it (2026-07-31), superseding the Summary above
There is **no bundled model, no bundled runtime, and no runtime probe of any kind**.
Ollama-style daemons can pull third-party models over the network and are
unapprovable in many environments; an in-process model file is not. The provider
set is therefore:
1. an explicitly configured provider in `.corpus/config.json` (loud error when it
   fails — unchanged);
2. the **embedded engine** — an in-process embedding library over a model artifact
   downloaded once into a per-user cache. The engine itself is SERVER-048; this
   issue defines the seam it plugs into and ships the contract plus a static
   reference implementation;
3. `disabled` — a first-class state, not an error.
Nothing in the resolution path opens a socket except a configured provider dialling
the endpoint its operator named. Read the criteria below with "local runtime"
replaced by "embedded engine" and "bundled" by "disabled".

## Acceptance Criteria
- [x] Zero-config resolution order proven by tests (config > embedded engine > disabled); an unavailable engine falls through silently
- [x] Identity recorded on first index write; later runs reuse it even when a "better" model appears (stickiness test)
- [x] Config-declared provider with unreachable endpoint: explicit index error state, never a silent fallback (a configured choice failing loudly ≠ zero-config falling back)
- [x] No network access on any leg but a configured provider; no key material ever logged

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/` (`provider.ts`, `identity.ts`, `embedded-engine.ts`,
  `http-provider.ts`, `settings.ts`, `resolve.ts`, `embeddings.ts`, `attach.ts`,
  all with colocated tests), the `embedding` block in `config.ts`, and the
  `attachSemanticFn` boot hook in `lifecycle.ts`.
  (`src/index/` is not used: `src/index.ts` is the package barrel — sprint-021 OC7.)

## Testing Strategy
apps/server scoped: resolution/stickiness/failure tables with stubbed probes; config parse cases.

## E2E Verification Plan
Real server, zero config: `index status`-level metadata (via sqlite3 until SERVER-046) records the bundled identity; add a config provider pointing nowhere → loud error state.

## E2E Verification Log

**implemented on: opus** (Claude Opus 5). Port **8805** for the server, **8804** for a
fake embedding endpoint. `8765` never bound, never killed. Workspace:
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s021-server/043-e2e/ws`, created by
`corpus init` through `apps/cli/src/bin/corpus.ts` and rebuilt first per the
sprint's rebuild-first rule.

### Voided criteria (OC1-REVISED, user ruling 2026-07-31)
- **TEST-841** (a *probe* failure falls through silently) — **VOID → OC1-REVISED**.
  There is no probe. The property it protected is asserted instead as: an engine
  that cannot answer its availability question falls through with one `info` line
  and no error level (`resolve.test.ts` "treats an engine that cannot answer as
  unavailable, quietly"; `attach.test.ts` asserts zero `"level":"error"` lines).
- **TEST-842** (a reachable runtime with only chat models also falls through) —
  **VOID → OC1-REVISED**. Substituted by the same distinction one layer in: an
  engine that is *present but has no downloaded model* falls through exactly like
  an absent one and says which it was (`reason: "model-not-downloaded"` vs
  `"engine-not-installed"`).
- **TEST-848** (the bundled path performs no network access) — **VOID →
  OC1-REVISED**; there is no bundled path. Replaced by a strictly stronger
  assertion: every leg except a configured provider runs with `fetch` rigged to
  throw and all of them resolve (`resolve.test.ts` "never touches the network on
  any leg but a configured provider").
- The **live Ollama probe-negative fixture** the brief originally called for is
  moot for the same reason. Recorded for the file: `ollama` is installed on this
  machine but **was not running** (`lsof -nP -iTCP:11434 -sTCP:LISTEN` empty,
  `curl http://127.0.0.1:11434/api/tags` returned nothing), and no `ollama`
  process was started, no model pulled, nothing mutated.

### 1. Zero config, real server → `disabled`, with the honest reason (TEST-851)
`tsx apps/server/src/main.ts --workspace …/ws` (pid 66883):
```
{"level":"info","msg":"semantic index disabled: no embedding provider is configured and this build has no embedded engine; search is lexical only"}
{"level":"info","msg":"listening on http://127.0.0.1:8805", …}
```
`corpus db rebuild` → `9 documents`; `corpus db doctor` → `projection is clean`.
`sqlite3 .corpus/cache.db`: `SELECT COUNT(*) FROM chunks` → **60**,
`SELECT COUNT(*) FROM chunk_embeddings` → **0**, `SELECT DISTINCT identity …` →
empty. That is the contract's distinction on disk: `identity` null ("nothing
indexed yet") is not the same claim as `state: disabled`.

### 2. Configured provider pointing nowhere → loud error state (TEST-843)
`.corpus/config.json` gains
`{"provider":"ollama","endpoint":"http://127.0.0.1:8899","model":"nomic-embed-text","apiKey":"sk-live-e2e-secret-9999"}`
(nothing listens on 8899). Restart (pid 67463):
```
{"level":"info","msg":"listening on http://127.0.0.1:8805", …}
{"level":"error","msg":"semantic index unavailable: ollama endpoint http://127.0.0.1:8899/api/embed is unreachable: fetch failed"}
```
Both halves of the criterion: the error state is present **and** nothing else
resolved — no `local/…` line, no fallback. Note the ordering: the socket was bound
*before* the resolution finished, which is the "beside the boot, never in front of
it" property. Lexical search kept working throughout:
`GET /api/search?q=corpus&limit=2` → 2 hits.

An unusable block behaves the same way, plus a boot warning through the existing
`config.warnings` channel (`{"provider":"magic-embed"}`, pid 67757):
```
{"level":"info","msg":"warning: the \"embedding\" block in …/config.json is not usable: this version of corpus does not know the provider \"magic-embed\" — use one of none, ollama, openai, or remove the block to use the embedded engine — semantic indexing reports an error until it is corrected, and search stays lexical", "configPath": "…"}
{"level":"error","msg":"semantic index unavailable: this version of corpus does not know the provider \"magic-embed\" — …"}
```

### 3. No key material anywhere in the logs (TEST-849)
`/usr/bin/grep -c "sk-live-e2e-secret-9999" *.log` → `0` in every boot log, on the
path that failed *and* on the path that succeeded (§5 below), including the run
where the fake endpoint echoed a `401` body back. The fake provider's own log
confirms the header was actually sent: `AUTH-HEADER-SEEN: yes`.

### 4. Engine available → identity resolves and sticks (TEST-844/845/846)
Real server booted through the documented `attachSemanticFn` seam with a static
embedded engine registered (`boot-with-engine.ts`, the shape SERVER-048 will
implement). Engine `all-MiniLM-L6-v2`, 384 dims:
```
{"level":"info","msg":"semantic index: local/all-MiniLM-L6-v2@384 (embedded)"}
{"level":"debug","msg":"semantic index identity checked","check":"no-index"}
```
Standing in for SERVER-044's first index write (no worker exists yet), one row was
inserted with `sqlite3` under that identity. Then:
- **restart, same engine** → `semantic index: local/all-MiniLM-L6-v2@384 (embedded)`,
  `check: "match"`.
- **a different, "better" model appears** (`bge-large-en-v1.5`, 1024 dims) →
  ```
  {"level":"info","msg":"semantic index disabled: the index was built by local/all-MiniLM-L6-v2@384 and the embedded engine offers local/bge-large-en-v1.5; keeping the recorded model — `corpus index rebuild` re-picks"}
  {"level":"info","msg":"semantic index recorded local/all-MiniLM-L6-v2@384; nothing can embed right now, so the existing vectors stay as they are"}
  ```
  and the row afterwards is byte-identical: `079f426b…|local/all-MiniLM-L6-v2@384|384|ready`.
  Nothing queued, nothing invalidated — §9.1's "never as a surprise background rebuild".
- **`corpus db rebuild`** (against the running server) → the row survives the
  ATTACH-copy unchanged, and `db doctor` is clean. A rebuild is not an explicit act.
- **engine present, model not downloaded** →
  `semantic index disabled: the all-MiniLM-L6-v2 model has not been downloaded into the cache yet`
  — the honest distinction from "nothing configured", live.

### 5. Config wins over an available engine, and the mismatch is reported, not acted on (TEST-840/847)
A fake ollama-shaped endpoint on **8804** (python, returns 4-dim vectors) plus the
static engine still registered:
```
{"level":"info","msg":"semantic index: ollama/e2e-model@4 (config)"}
{"level":"info","msg":"semantic index identity changed: recorded local/all-MiniLM-L6-v2@384, resolved ollama/e2e-model@4 — the index is invalid until it is rebuilt"}
```
The engine was never opened; the dimension `@4` came from the endpoint's own
response, not from any table. `chunk_embeddings` after this boot is unchanged
(`079f426b…|local/all-MiniLM-L6-v2@384|ready`) — SERVER-043 reports the invalid
index and leaves the acting to SERVER-044/046.

### Cleanup
All pids (66883, 67463, 67757, 68802, 69003) stopped by pid;
`lsof -nP -iTCP:8804 -sTCP:LISTEN` and `:8805` → empty. No `pkill`. Nothing was
installed; no dependency added to any manifest.

### Checks
`eslint` (changed files) clean, `prettier --check` clean, `tsc --noEmit` clean in
`apps/server`, and the workspace-scoped run: **140 files, 2759 tests, all passing**
(`VITEST_MAX_THREADS=4 vitest run apps/server`; a later `embedded-engine.test.ts`
added 2 more, run scoped). 101 of those tests are new here: 94 across the eight new
`semantic/*.test.ts` files, 5 in `config.test.ts`, 2 in `lifecycle.test.ts`.

### PR #17 review — three MINOR fixes (retrieval cooldown race, cache override, URL credentials)

**Implemented on: opus** (Opus 5, 1M context). Date 2026-08-01. Ports **8804** only.

**1. `retrieval.ts` — an in-flight resolution could re-arm a cooldown that had just been
invalidated.** `invalidateResolution()` set `retryAfterMs = 0`, but a resolution that
started *before* it and settled *after* it wrote `retryAfterMs = now() + cooldownMs` from a
fact (the model was still downloading) that had stopped being true mid-call — LEDGER-1's
symptom reached by a race instead of by the clock. Fixed with a generation counter:
`invalidateResolution()` (and `modelWatch()`'s find-the-model-present path, the same event
reached by asking rather than by being told) bumps `generation`; a resolution captures it at
start and skips the failure writes if it moved. A *successful* resolution is still adopted
regardless of generation, because `invalidateResolution`'s own contract says it clears only
the timer and there is nothing to invalidate about a working answer.
Tests: `retrieval.test.ts` › "resolution invalidation" — a gated resolver holds the first
resolution open, the invalidation lands mid-flight, and the next `forQuery` resolves fresh
and ranks with a frozen clock (verified failing with the guard disabled); plus a companion
test that an *uninvalidated* failure still costs one resolution per cooldown, so the counter
did not disarm the ordinary case.

**2. `engine/cache.ts` — a relative `CORPUS_MODEL_CACHE_DIR` was silently discarded.** The
fallback is the *shared* per-user cache, so an E2E run that set it to start cold started
warm and said nothing. `modelCacheRoot` now returns a `ModelCacheRoot` union
(`root | unset | unusable`) and refuses a present-but-relative override with the sentence to
publish; `engine.ts` decides the cache directory once and hands that sentence to
`availability()`. An empty value is still an absence (that is what an unset variable looks
like in a shell profile). Tests: `cache.test.ts` (refusal on every platform by that
platform's rules — `C:\models` is a root on win32 and unusable on linux; empty stays unset)
and `engine.test.ts` (the refusal reaches `availability()` with `HOME` present, i.e. exactly
where the fallback would have succeeded).
Live: server restarted with `CORPUS_MODEL_CACHE_DIR=relative/models` →
`corpus index status` reports `state disabled` with
`"CORPUS_MODEL_CACHE_DIR is set to the relative path relative/models; it must be absolute, …"`.
Pre-fix this run reported `current` off the warm shared cache.

**3. `provider.ts` / `http-provider.ts` — `redactSecrets` missed URL-embedded credentials.**
An operator writes `https://user:pass@host` into `endpoint`, never into `apiKey`, so the
secret list could not see it — and the endpoint is quoted verbatim by all four error paths.
`redactSecrets` now rewrites `scheme://userinfo@` to `scheme://***@` (whole userinfo, so a
username that *is* the token does not survive) before applying the secret list, and
`createConfiguredProvider` computes one `shownUrl = clean(url)` used by every message while
the request still dials the real `url`. `settings.ts`'s "must be an http(s) URL, got …"
refusal goes through the same function, since a rejected value is still a value someone may
have written credentials into. Tests: `provider.test.ts` (five cases incl. bare userinfo, any
scheme, no false positives on `nobody@example.com` or a credential-free URL, and the secret
list still applying on top) and `http-provider.test.ts` (each of the four error paths
separately, plus "still dials the real URL").
Live: an `embedding` block with `endpoint: https://alice:hunter2@127.0.0.1:9` →
`corpus index status --json` detail reads
`openai endpoint https://***@127.0.0.1:9/v1/embeddings is unreachable: … https://***@…` and
`corpus server logs | grep -c hunter2` → **0**.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
