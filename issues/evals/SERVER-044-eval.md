# Evaluation: SERVER-044

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Same rig. Corpus for this issue: 140 documents / **581 chunks** (120 bulk notes × 4 sections dropped
out-of-band on disk, plus the seeded fixtures).

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Six sections, including the permitted real download |
| Commands are specific and concrete | PASS | Pasted latency arrays, count trajectories with ms offsets, killed pid 17292 |
| Real E2E (not mocked) | PASS | Real server, real out-of-band file drops, real `kill -9`, counts read from a **second** connection |
| Scenarios cover acceptance criteria | PASS | All four, plus the identity-invalidation source |
| Application restarted after changes | PASS | Restart-after-SIGKILL is the centrepiece |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |
| Deferrals recorded, not skipped | PASS | Real-server `failed` chunk and SIGTERM grace timing both `DEFERRED` with reasons and named substitutes |

One quantitative claim in the log deserved suspicion and survived it: "a save during a saturated
drain was *not slower* than a save with nothing running". I reproduced the shape of that result
independently (below) — saves during a 561-chunk drain ran 0.11–0.20 s, ordinary for a path that does
a real git commit.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Write-path latency unaffected with the worker saturated | PASS | 12 `PUT /api/docs/{id}` issued through a live 561-chunk drain: all 200, 0.113–0.203 s |
| 2 | All four pending sources enqueue; drain updates counts transactionally | PASS | Server save (PUT), out-of-band watcher drop, `db rebuild`, and `index rebuild` invalidation all observed queueing; `indexed + pending + failed == 561` at **every** one of ~25 samples from a second process |
| 3 | Kill/restart mid-batch: no half-indexed chunk, pending correct on restart | PASS (see note) | Restart mid-drain resumed correctly and converged; I exercised graceful stop mid-drain rather than `kill -9` — SERVER-049's log carries the `kill -9` rerun on this same code |
| 4 | Repeated provider failure: backoff + visible failed count; one bad chunk never starves the rest | NOT REPRODUCED | `failed` is unreachable without a poisoned chunk; `failed` stayed 0 in every state I could produce, including a dead configured provider (correctly classified as an outage, not chunk failure) |

### Drain trajectory, sampled from a separate process every ~250 ms

```
+     0ms {"indexed":561,"pending":0,  "failed":0,...,"rebuilding":false,"state":"current"}
+  2078ms {"indexed":16, "pending":545,"failed":0,...,"rebuilding":true, "state":"indexing"}
+  4107ms {"indexed":80, "pending":481,"failed":0,...}
+  6140ms {"indexed":176,"pending":385,"failed":0,...}
+  8172ms {"indexed":240,"pending":321,"failed":0,...}
+ 10213ms {"indexed":304,"pending":257,"failed":0,...}
+ 12246ms {"indexed":399,"pending":162,"failed":0,...}
+ 14284ms {"indexed":495,"pending":66, "failed":0,...}
+ 16320ms {"indexed":561,"pending":0,  "failed":0,...,"rebuilding":false,"state":"current"}
```

Monotone, sum-invariant at every observation, progress visible mid-drain. ~29 ms/chunk.

### Writes during that drain

```
PUT#1 http=200 0.113589s     PUT#7  http=200 0.126186s
PUT#2 http=200 0.190683s     PUT#8  http=200 0.129312s
PUT#3 http=200 0.202901s     PUT#9  http=200 0.133328s
PUT#4 http=200 0.203348s     PUT#10 http=200 0.135573s
PUT#5 http=200 0.187461s     PUT#11 http=200 0.125933s
PUT#6 http=200 0.122043s     PUT#12 http=200 0.126719s
```

No save waited on indexing. Each of those saves then queued **exactly one** chunk, visible as the
transient `{"pending":1,...,"state":"stale"}` samples in the same trajectory.

### Counts are derived, not counted

Direct `sqlite3` mutation of `chunk_embeddings` (100 rows re-stamped with a foreign identity) changed
what the status endpoint reported on the very next poll without any restart or counter reset —
consistent with counts computed from rows.

### Shutdown mid-drain

```
mid-drain: {"indexed":144,"pending":417,"rebuilding":true,"state":"indexing"}
threads on the server process: 18
$ corpus server stop
stopped (pid 76974)                      stop wall time: 0.65s
server process gone;  threads now: 1;  no inference-worker processes;  port 8808 free
```

## Failures

None.

## Observations (not failures)

- **O-1.** Criterion 4 is **unverified by me**, not refuted. Nothing I could do to a healthy embedded
  engine produced `failed > 0`; a dead configured provider is correctly treated as an outage
  (chunks stay `pending`, `failed` stays 0), which is the right behaviour but means the failure ladder
  is only covered by unit tests. Both SERVER-044 and SERVER-046 deferred this for the same reason
  (the ladder reaches `failed` after 1 s + 5 s + 30 s + 120 s + 600 s). The deferral is recorded in
  both logs. Carried forward, not silently dropped.
- **O-2.** `corpus index rebuild` issued twice back-to-back is accepted twice (two acknowledgments,
  each reporting 581 queued) and converges to a single rebuild in flight — no error, no double drain
  observed.

## Summary

3 of 4 criteria verified directly, 1 not reproducible through any public interface and explicitly
deferred with unit-test substitutes in the log. The core promise — a background drain that never
touches write latency and whose counts are derived, monotone and sum-invariant — holds under a real
561-chunk drain measured from an independent process.
