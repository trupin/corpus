# [SERVER-137] Reflect on demand and when the dust settles: the event, the clock, the quiet window

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-076
- Blocks: CLI-062 (`corpus reflect`), UI-153, AGENT-044 (the skill handles the event)

## Spec References
- SPEC.md §7 — rider 9 (reflection), lanes, the queue contract, presence and `idle`
- SPEC.md §4 — `.corpus/` state

## Summary
Implements `workspace.reflect`: the ask route enqueues it at once, a scheduler enqueues it when the corpus has been quiet for the configured window after an unreflected change, the clock moves when the job is processed, and the status route reports clock, pending state and the count of changed documents.

## Acceptance Criteria
- [ ] `POST /api/workspace/reflect` enqueues `{ type: "workspace.reflect", payload: { since } }` on the orchestrator's lane; when one is pending or in progress it answers `202` with that event and `pending: true` instead of enqueuing a second.
- [ ] **Quiet window**: after any write **by someone other than the agent** that changes a document's `updated`, a timer (re)starts; an agent write never starts or restarts it (§7: the agent's own writes never count as unreflected). When it fires with an unreflected change present (the `changed` count below > 0 — so an archive alone never starts a reflection, for the reason CONTRACT-076 gives), no reflection pending or in progress, and `reflect.quiet > 0`, one event is enqueued. Config key `reflect.quiet` (minutes, default 30, `0` disables) in the workspace config, read on start and on config change.
- [ ] **Clock**: `.corpus/reflect.json` `{ reflected: ISO | null }`, written when a `workspace.reflect` job reaches `processed`, to that event's `created`; `failed`, `abandoned` and `deferred` leave it; a retried event keeps its `since`.
- [ ] `GET /api/workspace/reflect` returns the shape CONTRACT-076 defines; `changed` is computed from the projection (`updated > reflected AND last_actor <> 'agent'`, not archived — SERVER-138's `last_actor` column); `lastDigest` is the newest `type: thread` whose `origin` names a reflection job.
- [ ] SSE announces clock changes (so the UI's marks clear) and pending-state changes (so the control shows "reflecting…").
- [ ] A server restart with unreflected changes and a quiet corpus enqueues at most one event, after one full window from start (never at the instant of start).

## Technical Design

### Files to Create/Modify
- `apps/server/src/reflect/{routes,clock,scheduler,status}.ts`, tests
- `apps/server/src/queue/*` — the processed hook that moves the clock
- `apps/server/src/config/*` — `reflect.quiet`
- `apps/server/src/events/*` — SSE kinds

### Key Implementation Details
- The scheduler is one debounced timer, not a poll. The write path already has one place every mutation passes (the commit window of §4); hook there.
- The clock file is tiny state like the pidfile, outside git by design (§4: `.corpus/` is derived and local). The digest thread carries the window in git.
- "Pending or in progress" is a queue query (`type = workspace.reflect AND status IN (pending, in-progress, deferred)`).

### Edge Cases
- Agent writes (changelog entries, the digest thread, any edit the agent makes at any time) bump `updated` but never count: `last_actor = 'agent'` keeps them out of the timer and the count, whether or not a reflection is in progress. A document the agent wrote and a person then edited counts again, because its last actor is the person.
- Two people cannot ask twice: the second ask is answered `202` with the pending event and `pending: true`.

## Testing Strategy
Vitest with fake timers over a real temp workspace and queue: the debounce, the three conditions, the clock on each job outcome, the restart rule, the agent-write exemption.

## E2E Verification Plan
### Verification Steps
1. Real server with `reflect.quiet: 1`; edit a document; wait 70s; `corpus queue list` shows one `workspace.reflect` pending; `corpus reflect` → `409` names it.
2. Process it with the agent (or `corpus job done` in a sandbox); `GET /api/workspace/reflect` shows the new clock and `changed: 0`.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-137]` prefix
