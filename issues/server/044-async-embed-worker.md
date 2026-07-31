# [SERVER-044] Async embed worker: never blocks writes, visible staleness

## Domain
server

## Status
todo

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
- [ ] Write-path latency unaffected with the worker saturated (test: slow provider stub, save completes immediately)
- [ ] All four pending sources enqueue; batch drain updates counts transactionally
- [ ] Kill/restart mid-batch: no half-indexed chunk, pending count correct on restart
- [ ] Repeated provider failure: backoff + visible failed count; one bad chunk never starves the rest

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/worker.ts` (new + tests), hooks in the write path / watcher / rebuild, staleness counters in the projection

## Testing Strategy
apps/server scoped: stubbed provider (slow/failing/flaky), lifecycle tests, counter invariants.

## E2E Verification Plan
Real server, bundled/stub provider: bulk-import docs, watch pending drain via sqlite3 counts while saves stay instant; kill -9 mid-drain, restart, counts converge.

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
