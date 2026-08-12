# [SERVER-111] The queue learns lanes

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-110], [SERVER-109]
- Blocks: [SERVER-112], [CLI-043], [UI-108]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — lanes; one consumer per lane

## Summary
Partition the queue into lanes at enqueue time. `QueueService.enqueue`
(`apps/server/src/queue/service.ts:325-347`) resolves each event's lane before the file is
written: walk the event's origin to its root thread (origin chain via SERVER-110's
`resolveOrigin` plus thread `origin`/`parent` frontmatter), and if that root is designated
(SERVER-109), stamp `lane: th_…`; otherwise `lane: null` (the orchestrator lane). An
explicit `recipient` on the posting request overrides the walk for that one event.
`claimAll` and `idle` become lane-scoped: today's unscoped calls consume only the
orchestrator lane; `scope: th_…` consumes only that lane. Waiter wake-ups carry the lane so
a scoped park is not woken by another lane's arrival.

## Acceptance Criteria
- [ ] Lane stored as server-only bookkeeping on the event file (beside `status`/`attempts`, `store.ts:44-51`) and mirrored into the SQLite `events` table; never on the wire event shape
- [ ] Lane resolution: explicit `recipient` wins; else walk origin → root; a designated root routes to its lane; everything else (including `doc.edited` on unscoped docs, captures, plugin events) routes to the orchestrator lane — `doc.edited` on a *scoped* doc walks the document's `origin` (SERVER-110's rule) and reaches the resident
- [ ] **One type-based exception, owned here:** `resident.designated` always routes to the orchestrator lane, never to the lane it announces — whatever the walk says. Without this, re-designating a live lane delivers the launch instruction to the *old* resident and the new one is never started
- [ ] `claimAll({scope})` moves only that lane's pending events; the held report (`held.ts:119-151`) is scoped the same way — a resident never sees the orchestrator's held list and vice versa
- [ ] `idle({scope})` parks per lane: `WaiterRegistry` keys settles by lane; `notify(lane)` wakes that lane and the 500ms re-probe checks only the parked lanes' pending sets
- [ ] `reapStale` is lane-blind (staleness is staleness) but preserves the lane on requeue; `requeueDeferredFor` likewise
- [ ] **Lane fallback**: when a lane's listener is lapsed (SERVER-112 exposes liveness), that lane's pending events are visible to the orchestrator's unscoped claim — the fallback is computed at claim time, not by rewriting events, so a returning listener finds its lane intact
- [ ] Halt/resume apply to all lanes (one halt switch, unchanged semantics)
- [ ] `recipient: th_…` naming an undesignated thread → 422 at post time (contract's refusal, enforced here)

## Technical Design

### Files to Create/Modify
- `apps/server/src/queue/service.ts` — lane resolution in `enqueue`; `scope` on `claimAll`/`idle`/`settledWork`/`availablePending`; fallback predicate at claim time
- `apps/server/src/queue/store.ts` — `lane` on the stored shape; keep directory-is-authoritative untouched (lanes are a field, statuses stay directories)
- `apps/server/src/queue/waiters.ts` — lane-keyed registry; `notify(lane)`; probe per parked lane
- `apps/server/src/queue/held.ts` — scoped held report
- `apps/server/src/projection/queue-mirror.ts` + `projection/schema.ts` — `lane` column
- `apps/server/src/queue/routes.ts` — thread `scope` through

### Key Implementation Details
Everything already funnels through `serialize()` (`service.ts:829-836`), so lane logic
adds no new concurrency surface: resolution happens inside the chain, and the fallback
predicate (`lane == null || (lane != null && !live(lane))` for unscoped claims) is
evaluated under the same serialization that moves the files. Scope walking must be cheap:
root resolution reads at most the origin chain's frontmatter via the projection (SQLite),
never the corpus tree. Cache designation per `serialize()` turn, not longer — SERVER-109
invalidates on change.

### Edge Cases
- Event enqueued while its lane's listener is mid-lapse: stamped with the lane regardless; visibility is decided at claim time, so no event is ever stranded by a race between stamp and lapse
- A resident claiming while lapsed (it came back): scoped claim always sees its own lane — fallback widens the orchestrator's view, it never narrows the owner's
- Both the orchestrator and a returning resident racing for a fallback event: ENOENT-tolerant renames already split concurrent claims safely (`service.ts:396-401`)
- Legacy events on disk with no `lane` field: read as `lane: null` (orchestrator), no migration

## Testing Strategy
Unit: lane resolution table (recipient override, designated root, undesignated, doc.edited,
capture). Integration: two-lane claim isolation; scoped idle woken only by its lane;
fallback visibility flips with liveness; defer/requeue/reap preserve lanes; legacy files.

## E2E Verification Plan

### Verification Steps
1. Real server; designate a standalone thread (SERVER-109), park `corpus queue idle --thread th_x` in one shell and plain `corpus queue idle` in another
2. Comment in the designated thread → only the scoped shell unparks; `claim-all` in the plain shell returns an empty batch
3. Comment on an unrelated doc → only the plain shell unparks
4. Kill the scoped shell, wait out the grace window, comment in the thread → the plain shell's claim now returns the event

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, security-sensitive routing)
- [ ] Committed with `[SERVER-111]` prefix
