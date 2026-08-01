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
- [ ] The SERVER-046 reproduction rerun: during a full drain of ≥600 chunks with the real engine, `GET /api/health` p99 stays under 100 ms and a `PUT` completes normally (measured, before/after numbers in the log)
- [ ] Embed throughput within ~10% of the in-thread baseline (45.6 ms/chunk); model loads once in the worker
- [ ] Clean shutdown mid-drain: no orphan worker threads (asserted), chunk consistency invariant holds (kill -9 rerun)
- [ ] Worker crash → provider-outage backoff path, server stays up (test with a sabotaged worker)
- [ ] No interface change visible to SERVER-043/044/045/046 code or tests beyond construction wiring

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/engine/worker-host.ts` + a worker entry module (+ tests); engine.ts construction; lifecycle wiring

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); the health-latency measurement is the E2E centerpiece.

## E2E Verification Plan
Real server, real engine, cold rebuild of a 600+ chunk corpus: health/PUT latency sampled throughout; before/after table.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
