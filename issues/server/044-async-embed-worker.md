# [SERVER-044] Async embed worker: never blocks writes, visible staleness

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-042, SERVER-043
- Blocks: SERVER-045, SERVER-046

## Spec References
- SPEC.md §9.1 asynchronous bullet, §2.2 rule 1 async twist (SHARED-006 Edits 2, 6)

## Summary
Server-internal background worker (NOT the agent-facing job queue): chunk rows whose
embedding is missing/stale are drained in batches through the resolved provider,
debounced behind the write path — no PUT/POST, CLI or out-of-band watcher write ever
waits on embedding. Sources that mark chunks pending: server saves, watcher
reconciliation, `db rebuild` (restores everything else synchronously, queues semantic
re-indexing), identity-mismatch full invalidation (SERVER-043). Staleness accounting
(indexed vs pending counts) maintained transactionally for SERVER-046's status
endpoint. Failure honesty: provider errors back off and retry; a chunk that keeps
failing is counted visibly, never silently dropped. Worker lifecycle tied to the
server's (clean shutdown mid-batch leaves consistent rows — a chunk is indexed or
pending, never half).

## Acceptance Criteria
- [x] Write-path latency unaffected with the worker saturated (test: slow provider stub, save completes immediately)
- [x] All four pending sources enqueue; batch drain updates counts transactionally
- [x] Kill/restart mid-batch: no half-indexed chunk, pending count correct on restart
- [x] Repeated provider failure: backoff + visible failed count; one bad chunk never starves the rest

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/worker.ts` (Open Conflict 7's directory, not `index/`) + `worker.test.ts`
- `apps/server/src/semantic/worker-attach.ts` + `worker-attach.test.ts`
- `apps/server/src/semantic/index.ts` (barrel), `apps/server/src/lifecycle.ts` (+ `lifecycle.test.ts`)

**No hooks were added to the write path, the watcher or `populate.ts`, and that is the design.**
"Pending" is `chunks LEFT JOIN chunk_embeddings` (SERVER-042) — nothing writes a flag. Verified
rather than assumed:

```
$ /usr/bin/grep -rn "insertChunkRows\|deleteDocumentChunks" apps/server/src | /usr/bin/grep -v "\.test\.ts"
apps/server/src/semantic/chunks.ts:39,49                 (definitions)
apps/server/src/semantic/index.ts:30,31                  (barrel re-export)
apps/server/src/projection/project-document.ts:31,32,244,544   ← the only caller

$ /usr/bin/grep -rn "projectDocument(" apps/server/src | /usr/bin/grep -v "\.test\.ts"
apps/server/src/watcher/watcher.ts:285,290    (out-of-band edits)
apps/server/src/docs/write.ts:760             (runMutation — every server-originated save)
apps/server/src/projection/populate.ts:62     (db rebuild + boot catch-up)
apps/server/src/projection/project-document.ts:477  (definition)
```

Three of TEST-853's four sources are therefore one function; the fourth (identity invalidation) is
the worker's own `DELETE FROM chunk_embeddings WHERE identity <> ?`.

## Testing Strategy
apps/server scoped: stubbed provider (slow/failing/flaky), lifecycle tests, counter invariants.

## E2E Verification Plan
Real server, bundled/stub provider: bulk-import docs, watch pending drain via sqlite3 counts while saves stay instant; kill -9 mid-drain, restart, counts converge.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Sprint contract: `issues/sprints/sprint-021.md`.
Its premise corrections and adjudications override this file; **OC1-REVISED** (embedded in-process
engine, no Ollama, no runtime probe) and **OC4** (`indexing` beats `stale`) are the governing
posture. **OC7** applied: the module is `apps/server/src/semantic/worker.ts`, not `src/index/`.
Port **8804** (assigned by the orchestrator at dispatch, narrowing the contract's table); `8765`
was never bound, never killed, never proxied into. Workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s021-server/044-e2e`, created by `corpus init`
from the current build, driven through the real bin (`apps/cli/dist/bin/corpus.js`).

### 0. The real model, downloaded once (the permitted download)

The cache was **cold** — `~/Library/Caches/corpus` did not exist, and SERVER-048's own run had
used a scratch directory. This run used `CORPUS_MODEL_CACHE_DIR=…/044-modelcache` (23 MiB after).
The download was triggered by the worker, not by boot, exactly as SERVER-048's `requestModel()`
was designed for — server log, in order:

```
semantic index disabled: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded
  yet; it downloads on the first index run and search is lexical until then     ← boot resolution
semantic index: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet…
  ← the worker's first pass, having found pending chunks
downloading the all-MiniLM-L6-v2 embedding model (22.6 MiB) into …/all-MiniLM-L6-v2@751bff37… —
  this happens once per machine
the all-MiniLM-L6-v2 embedding model is cached in …; semantic indexing can start
semantic index: embedding with local/all-MiniLM-L6-v2@384 (embedded)
```

Real vectors landed — 384 dimensions, 1536 bytes each (`384 × 4`, float32 LE):

```
$ sqlite3 .corpus/cache.db "SELECT chunk_id, state, dim, length(vec) FROM chunk_embeddings LIMIT 3;"
079f426b6def7d1ffd79f0968c6d4523|ready|384|1536
0af1997cc6597ab059afead48e5284c1|ready|384|1536
0c8dac23a47afb687640bef9ca7801fc|ready|384|1536
$ sqlite3 … "SELECT DISTINCT identity FROM chunk_embeddings;"   →  local/all-MiniLM-L6-v2@384
```

The whole session produced **6** `semantic index` log lines. No spam, no per-attempt logging.

### 1. `corpus db rebuild` first (the rebuild-first rule, C1)

Ran before every measurement; `corpus db doctor` clean throughout.

### 2. Bulk import drains while saves stay instant (TEST-866, TEST-852, TEST-862)

200 documents (4 heading sections each) dropped **on disk, out of band** — the watcher source.
800 chunks became pending by construction. While the drain ran, 25 real
`PUT /api/docs/{id}` saves went through the real write path (real git auto-commit):

```
dropped 200 files
projected: {"total":864,"indexed":64,"failed":0,"pending":800}
save latencies ms: 93,91,90,92,95,94,97,94,97,93,96,95,97,96,96,94,94,95,99,93,96,95,97,99,95
max 99  mean 94.9
```

Baseline for comparison, the same endpoint with the worker **idle**:

```
idle-worker save latencies ms: 98,130,128,156,155,151,148,150,153,152   max 156
```

A save during a saturated drain was **not slower** than a save with nothing running — it was
faster, which is measurement noise on `git commit`, and that is the point: embedding is not on the
request path at any latency.

Count trajectory, polled every 250 ms from a **second** connection:

```
  +     0ms  total=868 indexed=64  pending=804 failed=0
  +  1508ms  total=868 indexed=64  pending=804 failed=0
  +  3016ms  total=868 indexed=64  pending=804 failed=0
  +  4530ms  total=868 indexed=128 pending=740 failed=0
  +  6044ms  total=868 indexed=336 pending=532 failed=0
  +  7558ms  total=868 indexed=560 pending=308 failed=0
  +  9068ms  total=868 indexed=768 pending=100 failed=0
  +  9572ms  total=868 indexed=832 pending=36  failed=0
final: {"total":868,"indexed":868,"failed":0,"pending":0}
```

`indexed + pending + failed == total` at every observation. Progress is visible mid-drain, not
only at the end (TEST-862). **The first four seconds are the debounce and its livelock guard doing
their job in the wild**: 25 saves 40 ms apart kept extending the quiet period, and
`EMBED_MAX_DEFER_MS = 5000` is what made the drain start anyway (TEST-864).

### 3. `kill -9` mid-drain, restart, converge (TEST-855)

200 files rewritten out of band, then `SIGKILL` (not a graceful close) while the drain was in
flight:

```
MID-DRAIN {"total":872,"indexed":136,"failed":0,"pending":736} peak 800
KILLED -9 pid=17292
port free

=== rows immediately after SIGKILL ===
counts: {"total":872,"indexed":136,"failed":0,"pending":736}
half-written rows (ready with no vector, or empty identity, or length(vec) <> dim*4): {"bad":0}
identities: {"n":1,"one":"local/all-MiniLM-L6-v2@384"}
```

Restarted; the pending count was re-derived from rows, not recovered from a counter:

```
=== counts right after restart ===   {"total":872,"indexed":344,"failed":0,"pending":528}
=== converge ===                     {"total":872,"indexed":872,"failed":0,"pending":0}
half-written rows: {"bad":0}
```

### 4. `db rebuild` queues nothing (Open Conflict 5) and `db doctor` stays clean

```
$ corpus db rebuild
rebuilt the projection in 77ms — 212 documents, 0 threads, …
$ sqlite3 … "SELECT pending, rows"   →  0|2508      ← a rebuild on an unchanged corpus re-queues nothing
$ corpus db doctor
projection is clean — 212 documents from 212 files (8ms)     exit=0
```

### 5. Identity invalidation, on the real server (TEST-853's fourth source)

Two cases, both with **no pending work**, so both prove the startup identity check runs on its own:

**(a) sticky-model-unavailable — nothing is touched.** Every row's identity rewritten to
`local/some-other-model@768` and the server restarted. Resolution reports
`sticky-model-unavailable`, no provider is adopted, **no vector is deleted**, nothing embeds, and
the process does not hot-loop (one `resolve` per ladder ceiling). Row count unchanged at 2508 with
the foreign identity. This is §9.1's "never as a surprise background rebuild", verified live.

**(b) mixed index — the foreign rows go.** 1500 rows restored to the real identity, 1008 left
foreign, server restarted:

```
error: semantic index holds vectors from more than one model:
       local/all-MiniLM-L6-v2@384, local/some-other-model@768
info:  semantic index: discarded 1008 vectors from another model;
       re-indexing with local/all-MiniLM-L6-v2@384   {"discarded":1008}

immediately after restart:  local/all-MiniLM-L6-v2@384|1628
after converge:             local/all-MiniLM-L6-v2@384|1882   (872 live chunks + orphans)
```

### 6. Suites

```
apps/server/src/semantic/worker.test.ts          30 tests, pass
apps/server/src/semantic/worker-attach.test.ts    5 tests, pass
apps/server/src/lifecycle.test.ts                38 tests, pass (order test extended)
apps/server (whole workspace, one run)   151 files, 2897 passed | 2 skipped
npm run lint / format:check / typecheck  clean
```

### Deferred / not executed

- **A `failed` chunk on a real server** is `DEFERRED → no way to make the real MiniLM engine refuse
  one passage and accept another`. Substitute evidence: the four failure-honesty unit tests
  (permanently-failing chunk counted with `failed == 1`, bad chunk first in queue order not
  starving 20 others, the retry ladder walked rung by rung to `MAX_CHUNK_FAILURES`, and a
  refuse-everything provider classified as an outage that leaves chunks pending).
- **`SIGTERM` grace-window timing** is measured in `worker-attach.test.ts` (`< 2 s` against
  `SHUTDOWN_GRACE_MS = 5000`) with a provider that never returns, not on the real server — a real
  provider has no way to hang.

### Notes for the next issue

- `indexCounts(db)` (exported from `semantic/worker.ts`, re-exported by the barrel) is SERVER-046's
  status surface: one statement, `{total, indexed, pending, failed}`, `indexed + pending + failed
  === total` by construction because it counts outwards from `chunks` (orphaned embeddings are in
  none of the three).
- The worker exposes no "rebuild in flight" flag, so OC4's `indexing` vs `stale` remains
  SERVER-046's to decide from its own rebuild verb.
- A workspace whose only recorded identity is a model the engine cannot offer reports
  `indexed == total` while every vector is from the wrong model — honest for the worker (it
  refuses to touch them), and exactly the `mixed`/foreign-identity case §14 asks `db doctor` to
  fail on. Flagged for SERVER-046.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
