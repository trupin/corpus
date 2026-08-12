# [SERVER-112] Presence is a parked request — liveness and the roster

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [SERVER-111]
- Blocks: [CLI-043], [UI-108], [UI-109]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — liveness, the roster, fallback

## Summary
A lane's listener is **live** when a scoped `idle` is parked on it, and for a grace window
after the park releases (the listener is mid-work between parks). Track that in-memory —
the same shape as the edit-session tracker (`apps/server/src/edit/sessions.ts`: map, sweep
timer, synchronous end hook), not persisted, rebuilt by the next park after a restart.
Liveness drives two consumers: SERVER-111's fallback predicate, and the new
`GET /api/agents` roster, whose rows carry a derived one-line summary of what each lane is
doing.

## Acceptance Criteria
- [ ] A scoped `idle` parking marks its lane seen; release re-arms a grace timer (default 900_000 ms, one server constant beside `DEFAULT_STALE_AFTER_MS`, `service.ts:35-36`); `live(lane)` = parked now, or within grace
- [ ] Lapse (grace expiry) fires one synchronous hook: notify the orchestrator lane's waiters (`notify(null)`) so a parked orchestrator wakes and its next claim sees the fallen-back events — mirror of `onSessionEnded → requeueDeferredFor` (`app.ts:481-495`)
- [ ] A listener returning after lapse (next scoped park) restores liveness; nothing to migrate — fallback was computed at claim time
- [ ] `GET /api/agents` implemented: one row for the orchestrator lane (live = an unscoped idle is parked or within grace) plus one per designated thread; `resident` from designation, `origin` `{id, title}` from the projection, `since` from the tracker
- [ ] `summary` derived, in order: latest `corpus job log` line of the lane's newest in-progress event (`.corpus/jobs/<eventId>.jsonl`, `apps/server/src/jobs/store.ts`); else `"working <origin title>"` from the held report; else `"idle — last active <relative>"`; else null; capped at the contract's 200 chars
- [ ] Roster changes invalidate `["agents"]`: park, release, lapse, designation change — through the existing bus, keys only, no data over SSE
- [ ] Liveness changes never touch event files (pure read-side state)

## Technical Design

### Files to Create/Modify
- `apps/server/src/queue/liveness.ts` — new: `LaneTracker` (map lane → {parkedCount, lastSeen, graceTimer}), modeled on `EditSessionTracker`'s sweep discipline
- `apps/server/src/queue/waiters.ts` — park/release callbacks into the tracker (SERVER-111 already lane-keyed it)
- `apps/server/src/agents/roster.ts` + `apps/server/src/agents/routes.ts` — new: roster assembly and route
- `apps/server/src/app.ts` — wire tracker → notify + invalidate

### Key Implementation Details
Parked-count, not boolean: a lane can briefly hold two parks during a rearm overlap. The
orchestrator lane gets liveness for free from the same tracker (`lane: null` rows).
`agent.done` (§7's reserved event type) stays reserved — the lapse hook wakes the
orchestrator via the waiter registry, not by enqueueing an event, so nothing new enters the
queue's vocabulary. Roster assembly is a read: designation list from the projection,
liveness from the tracker, summary from jobs — no caching beyond the request.

### Edge Cases
- Server restart with a resident mid-work: tracker is empty, lane reads lapsed, orchestrator may claim fallback work the resident still holds in its context — the same double-work window `reap-stale` already accepts; the resident's next scoped park restores the lane and its scoped claim reports held events as always
- Grace window vs. a resident legitimately thinking for >15 min between parks: it comes back to an intact lane (fallback moved nothing); only *new* events may have gone to the orchestrator — spec'd as acceptable in SHARED-043
- Designated thread with no listener ever started: `live: false, since: null` — the roster shows it waiting, which is UI-109's cue

## Testing Strategy
Unit: tracker park/release/grace/parked-count; summary derivation precedence. Integration:
roster shape over the real route; `["agents"]` invalidations on each transition; lapse hook
wakes a parked unscoped idle.

## E2E Verification Plan

### Verification Steps
1. Real server; designate th_x; `curl /api/agents` → orchestrator row + th_x row, `live: false`
2. Park `corpus queue idle --thread th_x` → roster flips `live: true`, `since` set
3. `corpus job log <evt> "reading the mortgage docs"` on a held scoped event → roster summary shows that line
4. Kill the scoped idle; within grace roster stays live; after grace flips false and a parked plain `idle` in another shell wakes

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
- [ ] `/audit` run (P0)
- [ ] Committed with `[SERVER-112]` prefix
