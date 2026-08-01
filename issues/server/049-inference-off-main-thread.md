# [SERVER-049] Embedded inference must not block the event loop

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-048, SERVER-044
- Blocks: the Phase 8 PR (§9.1's core promise is currently false in practice)

## Spec References
- SPEC.md §9.1 asynchronous bullet: "no save — UI, CLI, or out-of-band — ever waits on indexing"

## Summary
SERVER-046's live finding (2026-07-31): wasm inference is synchronous and its awaits
resolve as microtasks that never yield to the I/O phase — a 660-chunk drain blocked
`GET /api/health` for **13,844 ms**; a PUT in that window waits identically. Invisible
to unit tests because they stub the provider. Fix: run the embedded engine in a
`worker_threads` Worker — model load and inference fully off the main thread, the
main-thread EmbeddedEngine implementation becoming a thin message-passing proxy that
satisfies the existing interface (SERVER-043's seam and SERVER-044's worker must not
change observably; the provider's embed() just resolves off-thread now). Batch
messages, transfer Float32Arrays (transferable, zero-copy); worker lifecycle tied to
the lifecycle disposer chain (clean shutdown mid-batch, no orphan threads); a worker
crash surfaces as provider failure (SERVER-044's outage path), never a server crash.

## Acceptance Criteria
- [x] The SERVER-046 reproduction rerun: during a full drain of ≥600 chunks with the real engine, `GET /api/health` p99 stays under 100 ms and a `PUT` completes normally (measured, before/after numbers in the log)
- [x] Embed throughput within ~10% of the in-thread baseline (45.6 ms/chunk); model loads once in the worker
- [x] Clean shutdown mid-drain: no orphan worker threads (asserted), chunk consistency invariant holds (kill -9 rerun)
- [x] Worker crash → provider-outage backoff path, server stays up (test with a sabotaged worker)
- [x] No interface change visible to SERVER-043/044/045/046 code or tests beyond construction wiring

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/engine/worker-host.ts` + a worker entry module (+ tests); engine.ts construction; lifecycle wiring

### As built
- **`inference.ts` (new)** — the load-and-embed core lifted verbatim out of `engine.ts`:
  `loadInferenceRuntime(spec, sessionFactory?, signal?)` (verified artifacts → tokenizer
  → session → the `EMBED_BATCH_ROWS` loop), plus `packVectors`/`unpackVectors`. One
  implementation, run on either side of the boundary — a second thread-local copy of
  tokenize → forward pass → pool would be a second place for the bug to be true.
- **`inference-worker.ts` (new)** — the protocol, `startInferenceWorker(port, data, load?)`,
  and a two-line dispatch guarded on `workerData`. **It is also the Worker's entry point**,
  spawned with its own `import.meta.url`: that is the only expression naming a loadable
  module both under `node --import tsx …/main.ts` (a source checkout) and inside the single
  esbuild bundle an installed tool ships, where this module has been inlined. Hence the one
  line added to `main.ts` — in a bundle that URL *is* the bundle, so the process entry may
  only boot a server on the main thread. No packaging-script change was needed.
- **`worker-host.ts` (new)** — `createWorkerHost` (spawn, await `ready`, one message +
  one transfer per batch, `terminate()` on close, `error`/`exit` → rejections + one
  `onLost`) and `inProcessHostFactory`, which a supplied `sessionFactory` selects because
  a function cannot cross a `postMessage`.
- **`engine.ts`** — keeps the download/availability policy and loses every tensor. `load()`
  now builds an `InferenceHost`; `close()` awaits its `close()`; `onLost` clears the
  memoised provider so the next resolution spawns a fresh worker.
- **Unchanged**: `provider.ts`, `resolve.ts`, `worker.ts` (SERVER-044), `retrieval.ts`
  (SERVER-045), `maintenance.ts` (SERVER-046), `attach.ts`, `lifecycle.ts`.

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); the health-latency measurement is the E2E centerpiece.

## E2E Verification Plan
Real server, real engine, cold rebuild of a 600+ chunk corpus: health/PUT latency sampled throughout; before/after table.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Ports `8804`/`8805`; `8765` never touched.
Workspace `~/.claude/jobs/4dd0ddef/tmp/s021-server/049-e2e`: `corpus init` + 200 seeded
three-section documents (209 documents, **857–860 distinct chunks**), warm model cache
(`~/Library/Caches/corpus/models/all-MiniLM-L6-v2@751bff37…`, no download in any run).

### The centerpiece: SERVER-046's reproduction, before and after

Both halves are **the same server binary on the same corpus**, booted through
`runServerProcess` with one variable changed — the engine's host. `inprocess` injects
`sessionFactory: createOnnxSession` (the pre-fix shape: inference on the main thread);
`worker` is the shipped default. `GET /api/health` is sampled every 250 ms **from a
separate process**, so a starved server cannot starve the instrument, and one
`PUT /api/docs/{id}` goes out 1 s into the drain.

| | chunks | drain | ms/chunk | health p50 | p95 | **p99** | max | failed probes | PUT at t=1 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **BEFORE** — in-process | 860 | 27,993 ms | 32.6 | 14,144 ms | 26,723 ms | **27,727 ms** | 27,988 ms | 1 (`ETIMEDOUT` — stopped accepting) | **27,056 ms** → 200 |
| **AFTER** — worker thread | 857 | 28,258 ms | 33.0 | 1.3 ms | 3.1 ms | **8.9 ms** | 24.4 ms | 0 | **101 ms** → 200 |
| **AFTER** — real `corpus server start` | 857 | 28,298 ms | 33.0 | 1.3 ms | 2.2 ms | **11.3 ms** | 29.9 ms | 0 | **109 ms** → 200 |

p99 **27,727 ms → 11.3 ms** (~2,450×), against a 100 ms bar. The `PUT` is **27.1 s → 0.11 s**.
The third row is the shipped path end to end — `corpus server start` spawning
`node --import tsx apps/server/src/main.ts`, resolving the worker entry from
`import.meta.url` — not the harness.

Two consequences beyond the bar. `GET /api/index/status` is now observable **live**
mid-drain against the embedded engine (`{"indexed":144,"pending":713,"rebuilding":true,
"state":"indexing"}`), which SERVER-046 recorded as impossible and had to substitute an
HTTP provider for. And the pre-fix run reproduces *harder* than SERVER-046's 13,844 ms
because the backlog is larger — the stall is linear in the backlog, exactly as
"synchronous, never yields" predicts.

### Throughput: 32.6 → 33.0 ms/chunk (**+1.2%**, bar was ~10%)

Model loads **once per host**: the engine memoises the load, and the crash drill's
instance counter reads exactly `2` for the whole run — one worker, plus one respawn after
the deliberate kill.

### The wasm-threads question, answered: **they nest**

Measured against the real model, 96 chunks of 256 wordpieces (the truncation limit),
isolated from the server:

| where | `ort.env.wasm.numThreads` | ms/chunk | process threads seen from inside |
| --- | --- | --- | --- |
| main thread | 4 | 45.1 | 10 (7 base + 3 pthreads) |
| **worker thread** | **4** | **44.8** | **11 (7 base + 1 worker + 3 pthreads)** |
| worker thread | 1 | 155.5 | 8 (7 base + 1 worker, no pool) |

`onnxruntime-web`'s emscripten pthread pool spawns **nested** `worker_threads` from inside
our worker and uses its four threads there: `SharedArrayBuffer` is unconditionally
available in Node (there is no cross-origin-isolation gate to fail), and Node permits a
worker to create workers. The issue's honest-cost fallback — single-threaded wasm at
~155 ms/chunk — is the third row, i.e. exactly what we would have paid had they *not*
nested, and it is 3.5× the price we actually pay. No adjudication needed.

Corroborated on the live server: `ps -M` traced boot 7–8 threads → **15 at 500 ms → 18 at
600 ms** as the model loaded, settling at 17–18 (the inference worker plus its pool), and
per-chunk throughput is within noise of the pre-fix main-thread figure — which single-
threaded wasm could not be.

### Clean shutdown mid-drain — no orphan threads

```
rebuild -> 202 {"indexed":0,"pending":857,"rebuilding":true,"state":"indexing"}
mid-drain: indexed=144 pending=713 rebuilding=true threads=17     # worker + wasm pool live
corpus server stop -> "stopped (pid 62156)" in 500ms
after: server process gone; ps -M threads: 0; pgrep inference-worker: none
```

The unit-level assertion is portable and does not depend on `ps`: the stub worker in
`worker-host.test.ts` appends to a heartbeat file every 2 ms, and after `close()` — issued
with a batch still in flight — the file's size is unchanged over the following 60 ms while
the pending `embed()` rejects with `/shut down/`. `close()` is `await worker.terminate()`,
which measured **7 ms** mid-forward-pass and took the process from 11 threads to 7: the
wasm pool is owned by the worker and dies with it, so there is nothing to drain and no
graceful-shutdown protocol.

### `kill -9` mid-drain — the chunk-consistency invariant

```
mid-drain:      indexed=176 pending=681 failed=0   sum=857   threads=17
kill -9         -> server process gone
after restart:  indexed=256 pending=601 failed=0   sum=857   state=stale
corpus db doctor -> projection is clean — 209 documents from 209 files (12ms)   exit=0
drained:        indexed=857 pending=0   failed=0             state=current
```

`indexed + pending + failed === 857` at every observation; the drain resumed by itself.

### Worker crash → SERVER-044's outage path, server stays up

A real server whose worker is a stub that reports ready, answers two batches and then
`process.exit(9)` on the third (synthetic vectors — what is under test is the outage path,
not the arithmetic: real thread, real exit, real engine, real backoff ladder):

```
{"level":"error","msg":"the all-MiniLM-L6-v2 embedding worker stopped: the embedding worker
  exited unexpectedly (code 9); it will be started again on the next index pass"}
{"level":"error","msg":"semantic index unavailable: the embedded engine reported itself
  available and then failed: the embedding worker exited unexpectedly (code 9)"}
{"level":"info","msg":"semantic index: embedding with local/all-MiniLM-L6-v2@384 (embedded)"}
```

Line 1 is the engine forgetting the dead host; line 2 is `noteProviderFailure` arming the
backoff; line 3 is the next resolution finding nothing memoised and spawning a fresh
worker. `GET /api/health` was **200 on all 45 samples, max 6.1 ms**, throughout and after.
Final state `{"indexed":857,"pending":0,"failed":0,"state":"current"}` — **`failed: 0`**,
so the outage was never mistaken for poisoned chunks. Worker instances spawned: 2.

### Retrieval (SERVER-045) over the boundary

```
GET /api/search?q=postgres -> 200 in 28ms  semanticIndex=current  5 hits
  doc_note010 ("Note 010 › Section 1 of note 010"), doc_note009, doc_note003, …
GET /api/search?q=harbour%20ledger -> 200 in 12ms
```

The query embedding is one round trip and one forward pass on the worker; nothing in
`retrieval.ts` changed.

### Suites

```
apps/server/src/semantic/engine/inference.test.ts         12 tests, pass  (new)
apps/server/src/semantic/engine/inference-worker.test.ts   9 tests, pass  (new)
apps/server/src/semantic/engine/worker-host.test.ts       15 tests, pass  (new, real Workers)
apps/server/src/semantic/engine/engine.test.ts            35 tests, pass  (30 kept + 5 new)
apps/server (whole workspace, one run)   163 files, 3085 passed   (was 160 / 3044)
eslint / prettier / tsc --noEmit (server + cli)   clean
```

Every pre-existing test passes **unmodified** except two construction-wiring lines in
`engine.integration.test.ts`, which now names `sessionFactory: createOnnxSession` to keep
its reference-value comparison in process (see the note in that file: Vitest transforms
TypeScript itself and hands a raw `Worker` no loader, so the shipped entry cannot be
spawned from a test — the boundary is covered against real Workers with stub sources, the
worker body in process against a fake port, and the two meeting over the real model here).

### Not done, deliberately

- **A second esbuild entry point for the worker.** The self-dispatching entry means the
  worker loads the whole server bundle in an installed tool (guarded, so it binds nothing).
  A dedicated entry would trim that, and it is a `scripts/package-staging.ts` change — out
  of this issue's scope, and worth nothing until measured.
- **A graceful drain protocol before `terminate()`.** Measured unnecessary: terminate reaps
  the nested wasm pool in 7 ms mid-pass.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
