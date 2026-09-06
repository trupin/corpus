# [SERVER-150] Three tests hold real waits, and one of them nobody has diagnosed

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: INFRA-020
- Blocks: —

## Spec References

- —


## Carried, deliberately (user decision, 2026-08-26)

Surveyed after v0.24.0, having gone untouched through three releases, and kept
open rather than closed or forced into a scope. The reasoning is recorded here so
it is not re-litigated every release: it is real, it is not urgent, and nothing
is blocked by it.

The alternative offered and declined was closing it on the grounds that the
test has never failed. INFRA-020 exists because two things this repository
carried as flakes turned out to be product defects a green suite could not see,
so *it has not failed yet* is exactly the argument that rule refuses.

## Summary

Filed out of INFRA-020, which established the rule and then declined to break it
in the commit that introduced it.

`npm run test:slow` over a full 4675-test `apps/server` run under a load average
of 19–25 reports **one** test at or above half its own budget:

- **`apps/server/src/folders/acts.test.ts:299` — 51%, 2537 ms, undiagnosed.**
  Nobody has named this one before. INFRA-020's rule is *diagnose before sizing*,
  so it was left alone rather than given a number. That is this issue's first job.

Two more were given stopgap budgets and say so in their own comments:

- **`apps/server/src/attachments/serve.real-listener.test.ts:139`** — 4328 ms
  idle, 4570 ms loaded. It is the first in its file to bind a real listener, so
  it pays a one-time warm-up its six siblings (241–266 ms each) do not. **The
  real remedy is a `beforeAll`**, not a larger budget.
- **`apps/server/src/events/sse.test.ts:306`** — 4042 ms idle, 4107 ms loaded.
  **Not warm-up.** It is last in its describe and its neighbours cost 33–110 ms,
  so it holds a real ~4 s wait. Recorded as an unverified hypothesis:
  `SHUTDOWN_GRACE_MS` is 5000. **The remedy is to remove the wait.**

Neither is load-sensitive. Both were re-measured under six added spinners (load
6.3–12.8) and moved 174 ms and 25 ms. They are slow, not contended — which is
exactly the distinction INFRA-020's diagnosis order exists to force, and exactly
what a bigger timeout would have hidden.

## Acceptance Criteria

- [ ] `acts.test.ts:299`'s 2537 ms is **diagnosed** — what the time is spent on —
      before anything is changed. A budget without a diagnosis is the thing
      INFRA-020 forbids
- [ ] `serve.real-listener.test.ts`'s warm-up moves to a `beforeAll`, so the cost
      is paid once rather than billed to whichever test runs first
- [ ] `sse.test.ts:306`'s wait is removed rather than waited out, or the
      hypothesis is disproved and the real cause recorded
- [ ] The stopgap `15_000` budgets come back down to whatever the fixed tests
      actually need, measured
- [ ] `npm run test:slow` reports zero findings afterwards, or the survivors
      carry a diagnosis

## Testing Strategy

No assertion in any of the three should change. If one has to, that is a
finding worth reporting rather than an edit worth making.

## E2E Verification Log

**Model: Opus 5 (1M context)** — matches the issue's recommendation.
**Date: 2026-09-06.** Worktree, uncommitted. Machine shared with two other agents.

### Diagnosis first, per INFRA-020

Nothing was changed until each of the three had a cause named and measured.
Baselines re-measured on this machine before any edit, one scoped run over the
three files: `acts.test.ts:299` 2396 ms, `serve.real-listener.test.ts:139`
4277 ms, `sse.test.ts:306` 4048 ms — all three reproduce the issue's numbers.

**1. `acts.test.ts:299` — 2396 ms, undiagnosed until now.** The time is one
literal statement: `await new Promise((r) => setTimeout(r, SELF_WRITE_TTL_MS + 100))`
at line 308, i.e. **2100 ms of real wall clock**, waiting for the self-write
registry to collect the create's registrations. It slept because
`createSelfWriteRegistry()` was constructed with **no `now`**, so it read
`Date.now` while every other part of the fixture's server read the injected
fixture clock. The remaining ~300 ms is the same real work its siblings do
(400–560 ms each). Confirmed by construction: with the sleep replaced by
`ws.advance(...)` the test measures **257 ms**, a drop of 2139 ms against a
2100 ms sleep.

**2 and 3 share one cause, and both recorded hypotheses are wrong.**

`sse.test.ts:306`'s hypothesis — `SHUTDOWN_GRACE_MS` is 5000 — is **disproved**.
That constant lives in `lifecycle.ts` and is not on `createServer().close()`'s
path at all, and the measurement is 4007 ms, not 5000. Instrumented, the test's
4048 ms splits as: `createServer` 38 ms, `start` 5 ms, `fetch /events` 14 ms,
**`server.close()` 4005 ms**, `readUntil` after it 1 ms.

`serve.real-listener.test.ts:139`'s recorded diagnosis — one-time warm-up billed
to the first test in the file — is **also disproved**, by five measurements:

| variant | `ws.server.close()` |
| --- | --- |
| five copies of the 200 test, positions 1–5 | 4001 · 4004 · 4004 · 4003 · 4004 ms |
| the same request answered 404, first in file | 0 ms |
| the 200, `agent: false` (no pooled socket) | 0 ms |
| the 200, one `setImmediate` before close | 4004 ms |
| the 200, 50 ms sleep before close | 0 ms |

So it is not position and it is not warm-up. It is the **200**: the only test in
that file that gets one. Its six siblings all assert 404, which is why the cost
looked like it belonged to whichever test ran first.

**The shared cause.** `close()` called `closeIdleConnections()` exactly once,
synchronously, in the same tick as `httpServer.close()`. Node sweeps idle
connections once too, and never again. A **streamed** response goes idle a tick
later — the adapter writes it across several turns of the loop, so the
response's `finish`, the event that makes its socket idle, has not run when the
sweep does. An attachment's 200 is a `ReadableStream` body. An SSE stream
`hub.close()` has just ended is the same shape. Both were therefore never swept,
and shutdown waited for the **peer's** keep-alive timeout — 4 s for `fetch`
(undici) and for `node:http`'s pooling global agent. A 404's buffered JSON body
finishes synchronously, which is why it costs 0. The 50 ms row proves it is a
race and not a busy connection.

### Reproduced against the real running server, before the fix

Real workspace (`corpus init`), real daemon on port 8768 started with
`corpus server start`, real HTTP. `curl -N` cannot show the defect — it closes
the moment the response ends — so the client is a small Node script that holds
its pooled socket, which is what a browser's `EventSource` does.

```
===== BEFORE (single sweep) =====
  run 1 attached: attached 200
  run 1 STOP_MS=4495  client saw: stream ended
  run 2 attached: attached 200
  run 2 STOP_MS=4608  client saw: stream ended
```

Against a baseline of **522 ms** for `corpus server stop` with no client
attached at all — which is the CLI's own start-up, not shutdown. So a real
`corpus server stop` with the board open waited about four extra seconds.

### After the fix

`closeConnectionsUntil` in `apps/server/src/app.ts` keeps sweeping idle
connections, every 10 ms, until the listener is closed. It only ever closes
connections Node itself reports as idle, so it cannot cut off a request still
being served.

```
===== AFTER (sweep until closed) =====
  run 1 attached: attached 200
  run 1 STOP_MS=521  client saw: stream ended
  run 2 attached: attached 200
  run 2 STOP_MS=530  client saw: stream ended
```

521/530 ms against the 522 ms no-client baseline: the attached stream now costs
nothing. The client still reports `stream ended`, so the server is still the one
that closes it.

### Measured, before and after

| test | before | after |
| --- | --- | --- |
| `folders/acts.test.ts:299` | 2396 ms | **257 ms** |
| `attachments/serve.real-listener.test.ts:139` | 4277 ms | **270 ms** |
| `events/sse.test.ts:306` | 4048 ms | **54 ms** |
| whole file — `serve.real-listener.test.ts` | 5762 ms | **1762 ms** |
| whole file — `sse.test.ts` | 4527 ms | **529 ms** |
| whole file — `acts.test.ts` | 10864 ms | **8795 ms** |

Both `15_000` stopgap budgets are removed. Neither test declares a budget now,
so both sit on the 5000 ms default at 5.4% and 1.1% of it.

### Checks

- `vitest run` over the three files: **52 passed, 0 failed**.
- Blast radius of the two production changes, run separately:
  `lifecycle`, `docs/write`, `docs/archive`, `docs/key`, `skills/create` —
  **169 passed, 0 failed**. `watcher/`, `events/`, `attachments/` —
  **398 passed, 0 failed**.
- Whole `apps/server` workspace: **4898 passed, 0 failed** (1099 files).
- `npm run test:slow` over that run:
  `test:slow ✓ 4898 tests measured, none above 50% of its own budget.`
- `eslint` and `prettier --check` on the four touched files: clean.
- `tsc --noEmit` in `apps/server`: clean.

### Findings reported rather than implemented

1. **The `beforeAll` criterion rests on a false premise.** There is no warm-up to
   move — five identical 200-serving tests each cost 4.2 s, and a 404 in first
   position costs 0. The fixture is per-test by design (a fresh workspace, a
   fresh git repository), and each test's real work is ~250 ms. A `beforeAll`
   would have hidden the defect rather than fixed it, and left a real
   `corpus server stop` four seconds slow.
2. **One assertion was added, none changed.** `sse.test.ts:306` is named
   "releases attached streams so shutdown does not hang on them" and asserted
   only the first half while measuring 4048 ms. It now also asserts
   `shutdownMs < 1000`. The bound is derived: the defect is 4007 ms and does not
   scale with load (that is why it was called load-indifferent), the fix
   measures 1–8 ms, so 1000 ms sits 4x under what it catches and over 100x above
   what it allows.

_(to be filled by the implementing agent)_
