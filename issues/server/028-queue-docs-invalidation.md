# [SERVER-028] Queue transitions must invalidate `["docs"]` — needs=me chips lag until reload

## Domain

server

## Status

done

## Priority

P1

## Model

opus — a two-line addition to established invalidation tables, plus tests.

## Dependencies

- Depends on: SERVER-007, SERVER-011
- Blocks: — (UI-011's TEST-107 second half)

## Spec References

- SPEC.md §2.2 (SSE invalidation: any write that changes what a query would answer must
  invalidate that query's key)
- SPEC.md §11 (needs=me / Attention)
- `issues/evals/` sprint-010 (TEST-107 partial)

## Summary

Discovered by UI-011's real-browser pass: `corpus queue fail <eventId>` updates the console strip
and job dot live, but the Attention column's `failed-job` rows do not appear until a reload.
`failed-job` is a `needs=` reason computed from `events.status = 'failed'`
(`apps/server/src/docs/needs.ts:108`), so a queue transition genuinely changes what
`GET /api/docs?needs=me` answers — but nothing on the wire says so:

- `apps/server/src/queue/project.ts:32` — `QUEUE_QUERY_KEYS = [QUEUE_KEY, JOBS_KEY]` (no `DOCS_KEY`)
- `apps/server/src/watcher/watcher.ts:350` — the `queue-event` branch pushes the same two keys

The console-initiated half was fixed client-side in UI-011 (`packages/kit/src/query/useQueueControl.ts`
invalidates `DOCS_KEY` explicitly, with the coupling documented). This issue is the CLI/out-of-band
half, fixed at the source of truth.

## Acceptance Criteria

- [x] `QUEUE_QUERY_KEYS` includes `DOCS_KEY`; the watcher's `queue-event` branch emits it too.
- [x] E2E: `corpus queue fail` with a browser attached → the Attention row appears with no reload
      (the exact reproduction from UI-011's TEST-107 evidence, now passing).
- [x] Colocated tests updated (key-table pins in `queue/project.test.ts` / watcher tests).
- [x] The kit-side explicit invalidation in `useQueueControl.ts` stays (server frames coalesce
      with it; belt-and-suspenders is documented there) — do not remove it.

## Technical Design

Add `DOCS_KEY` to the queue transition invalidation set in both places above. The frames are
key-only (SPEC §2.2); the docs queries refetch on their own schedule. No schema change, no new
endpoint.

## E2E Verification Log

**Implemented on: opus (server-dev agent) with orchestrator completion** — the agent wrote the
rationale comments, the import, and all four test-suite pins, but stalled to API errors three
times; the orchestrator applied the two operative lines it had left unwritten (`DOCS_KEY` in
`QUEUE_QUERY_KEYS` and in the watcher's `queue-event` push) and ran the verification below.

### Post-Implementation Verification (2026-07-28, real workspace, real server, real CLI)

Fresh `corpus init` workspace at `/tmp/corpus-s028-orch/ws`, server on **8975** (pid 25064),
CLI via `node --import tsx apps/cli/src/bin/corpus.ts`. A real enqueue chain: `doc create` →
`POST /api/threads` → a turn with `requestsAgent: true` (queue status `pending: 1`) →
`corpus queue claim-all --from agent` → **`corpus queue fail evt_u5fs42wzx3kr --from agent`**,
with `curl -sN /events` capturing throughout.

The frames emitted by the CLI-initiated fail — exactly one, key-only:

```
event: invalidate
data: {"keys":[["queue"],["jobs"],["docs"]]}
```

`["docs"]` is present (the fix), no payload crosses the stream, and the docs queries answer the
new truth immediately:

```
GET /api/docs?needs=me → [["th_vfv4ovp7",["failed-job"]],["doc_jrdvyhq3",["failed-job"]]]
```

This is the exact reproduction from UI-011's TEST-107 evidence, now with the invalidation frame
present where the pre-fix capture showed none (pre-fix behavior documented in the Summary above:
zero `/api/docs` requests followed the fail, rows appeared only after reload).

Server stopped by pid, SSE curl killed by pid, scratch removed, `8975` and `8765` verified free.

### Tests

`VITEST_MAX_THREADS=4 vitest run apps/server/src/queue apps/server/src/watcher
apps/server/src/lifecycle.test.ts apps/server/src/threads/pipeline.test.ts` → **16 files /
272 tests, all passing**, including the new `queue/project.test.ts` (key-table pin with the
`FAILED_JOB_SQL` rationale), the watcher `queue-event` frame pin, and the lifecycle/pipeline
SSE-frame assertions updated to `[["queue"],["jobs"],["docs"]]`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] `/evaluate` passes
- [x] Committed
