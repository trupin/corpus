# Evaluation: SERVER-049

**Date**: 2026-08-01
**Sprint**: sprint-021 (filed mid-sprint, P0, blocks the phase PR)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

The bar was `GET /api/health` p99 under 100 ms during a full drain of ≥ 600 chunks with the real
engine. Measured independently: **p99 = 7 ms** over 577 samples during a 561-chunk drain, 0 failed
probes, and a concurrent `PUT` completing in 0.11–0.20 s.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Before/after table, three rows including the shipped `corpus server start` path |
| Commands are specific and concrete | PASS | Percentile tables, thread counts from `ps -M`, named pids |
| Real E2E (not mocked) | PASS | Real server, real engine, health sampled **from a separate process** — the right instrument design |
| Scenarios cover acceptance criteria | PASS | All five |
| Application restarted after changes | PASS | Both halves are the same binary with one variable changed |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| **Reproduction logged before fix** | **PASS** | This is a bug issue and the pre-fix state is measured, not asserted: the `inprocess` row (p99 27,727 ms, one `ETIMEDOUT`) is the reproduction, and it reproduces *harder* than SERVER-046's original 13,844 ms because the backlog is larger — the log says so and explains why |

The before/after methodology is the strongest in the batch: same binary, same corpus, one injected
variable (`sessionFactory` vs. the shipped worker host), instrument in its own process so a starved
server cannot starve the measurement. I replicated the "after" half independently.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Health p99 < 100 ms and a normal `PUT` during a ≥ 600-chunk drain | PASS | p99 = **7 ms** over 577 samples; 12 PUTs at 0.113–0.203 s |
| 2 | Throughput within ~10% of the in-thread baseline; model loads once | PASS | ~29 ms/chunk measured (561 chunks in 16.3 s), against the log's 33.0 and the pre-fix 32.6 |
| 3 | Clean shutdown mid-drain: no orphan worker threads; kill -9 invariant holds | PASS | 18 threads → 0 in 0.65 s, no orphan processes, port free |
| 4 | Worker crash → provider-outage backoff, server stays up | NOT REPRODUCED | No public way to crash the inference worker; covered by the log's sabotaged-worker run and unit tests |
| 5 | No interface change visible to 043/044/045/046 | PASS | Every one of those issues' behaviours re-verified in this evaluation against the worker-thread build |

### Criterion 1 — the reproduction rerun, independently

Instrument: a separate Node process polling `GET /api/health` every 100 ms for 60 s. Load:
`POST /api/index/rebuild` over 561 chunks with the real embedded engine, plus 12 real `PUT`s and a
second poller hitting `/api/index/status` every 250 ms.

```
=== HEALTH LATENCY during drain (ms) ===
{ "samples": 577, "failed": 0, "p50": 2, "p95": 4, "p99": 7, "max": 37 }

=== PUTs during the drain ===
PUT#1  200 0.113589s   PUT#5  200 0.187461s   PUT#9  200 0.133328s
PUT#2  200 0.190683s   PUT#6  200 0.122043s   PUT#10 200 0.135573s
PUT#3  200 0.202901s   PUT#7  200 0.126186s   PUT#11 200 0.125933s
PUT#4  200 0.203348s   PUT#8  200 0.129312s   PUT#12 200 0.126719s
```

Against the pre-fix figure SERVER-046 recorded on this same code path (`GET /api/health -> 200 in
13844ms`), this is the difference between a server that is up and one that is only nominally up.
Zero failed probes; worst single sample 37 ms.

A second, independent run under the same drain gave `p50 2 / p95 4 / p99 6 / max 37` over 719 samples
— the result is stable, not a lucky window.

### Criterion 1, corollary — status is now observable live against the embedded engine

SERVER-046 recorded this as impossible and had to substitute an HTTP provider. It is possible now; I
sampled the full trajectory against the embedded engine with no substitution
(`indexed 16 → 80 → 176 → 240 → 304 → 399 → 495 → 561`).

### Criterion 3 — shutdown mid-drain, no orphans

```
mid-drain: {"indexed":144,"pending":417,"failed":0,"rebuilding":true,"state":"indexing"}
threads on the server process (ps -M): 18            ← inference worker + its nested wasm pool
$ corpus server stop
stopped (pid 76974)                                   stop wall time: 0.65s
server process gone;  ps -M threads: 1;  pgrep -f inference-worker: none;  8808 free
```

Prompt exit, whole thread tree reaped, nothing orphaned. Restart mid-drain resumed the drain by
itself and converged with `indexed + pending + failed == 561` throughout.

### Criterion 5 — nothing else moved

Every behaviour I tested for SERVER-043/044/045/046 in this evaluation ran against the worker-thread
build: the paraphrase pair, `both`, all four state words, the doctor matrix, `rebuild && doctor`,
identity stickiness, the degraded CLI note. None of them showed a seam.

## Failures

None.

## Observations (not failures)

- **O-1.** Criterion 4 is unverified by me: crashing the inference worker requires substituting a
  sabotaged worker, which is not reachable through any public interface. The log's evidence for it is
  a real thread doing a real `process.exit(9)` on a real server with the backoff ladder and 45 health
  samples pasted, which is as close to E2E as this can get.
- **O-2.** Thread count on the server process at rest is 7–8 and rises to 17–18 while embedding,
  matching the log's `ps -M` trace. Threads return to the process baseline when the drain ends.

## Summary

4 of 5 criteria verified directly, 1 requiring a sabotaged worker and covered in the log by a real
crash on a real server. §9.1's core promise — "no save ever waits on indexing" — was false in
practice before this issue and is true now, by a factor of roughly 2,500× on the health p99 and 250×
on a concurrent save. This was the right P0 to block the phase PR on.
