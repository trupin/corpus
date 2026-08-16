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
- [x] A scoped `idle` parking marks its lane seen; release re-arms a grace timer; `live(lane)` = parked now, or within grace. **The window is 960_000 ms, the contract's `AGENT_PRESENCE_WINDOW_SECONDS`, not a new server constant** — see the E2E log's arithmetic: CONTRACT-045 publishes the same number for the client's own expiry, so a server-local 900_000 would let a client call absent a lane the server had just called present
- [x] Lapse (grace expiry) fires one synchronous hook: notify the orchestrator lane's waiters (`notify(null)`) so a parked orchestrator wakes and its next claim sees the fallen-back events — mirror of `onSessionEnded → requeueDeferredFor` (`app.ts:481-495`)
- [x] A listener returning after lapse (next scoped park) restores liveness; nothing to migrate — fallback was computed at claim time
- [x] `GET /api/agents` implemented: one row for the orchestrator lane (live = an unscoped idle is parked or within grace) plus one per designated thread; `resident` from designation, `origin` `{id, title}` from the projection, `since` from the tracker
- [x] `summary` derived, in order: latest `corpus job log` line of the lane's newest in-progress event (`.corpus/jobs/<eventId>.jsonl`, `apps/server/src/jobs/store.ts`); else `"working <origin title>"` from the held report; else `"idle — last active <relative>"`; else null; capped at the contract's 200 chars
- [x] Roster changes invalidate `["agents"]`: park, release, lapse, designation change — through the existing bus, keys only, no data over SSE
- [x] Liveness changes never touch event files (pure read-side state)

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

**Model: Opus 5 (1M context).** Not a bug, so there is no pre-fix reproduction; what follows
is the post-implementation drill.

### Setup

Real server from source (`apps/server/src/main.ts` via tsx), real workspace created by
`corpus init` at `/tmp/corpus-e2e-112/ws`, port **8841** (8765 and 5173 untouched). Real
git, real projection, real `.corpus/queue/` directories. Everything below is HTTP through
`curl`; nothing is injected and no clock is faked — the 960 s window was waited out.

Seeded: `.claude/agents/researcher.md`, one standalone thread
`th_oip2lkt5` ("let us work on the mortgage refinance"), `POST /api/threads/th_oip2lkt5/resident {"name":"researcher"}`.

### 1. The roster answers before anything is running

```
GET /api/agents   (nothing designated yet)
{"agents":[{"lane":"orchestrator","resident":null,"live":false,"since":null,"summary":null,"origin":null}]}

GET /api/agents   (after designating)
  orchestrator   live=false since=null  resident=null
  th_oip2lkt5    live=false since=null  resident={"name":"researcher","docId":"doc_agentdef9aac2cc9"}
                                        origin={"id":"th_oip2lkt5","title":"let us work on the mortgage refinance"}
```

This is the row SERVER-109 declined to publish: **designated, and nobody listening.**
`resident.docId` is the synthetic id the agent-def's path produced, resolved at read time.

### 2. A park is what makes it live — and only a park

```
[23:42:28] GET /api/queue/idle?timeout=480&scope=th_oip2lkt5   (held open)
[23:42:28] GET /api/agents      th_oip2lkt5  live=true  since=2026-08-16T23:42:28Z
                                orchestrator live=false since=null
[23:42:28] GET /api/queue/status  agent={"live":true,"since":"2026-08-16T23:42:28Z"}
```

Presence is per lane (the orchestrator's row is untouched), and `QueueStatus.agent`
reports the same instant the roster does — one observation at two grains.

### 3. Direction 1 — a live lane's work is invisible to the orchestrator

```
[23:42:30] POST /api/threads/th_oip2lkt5/turns  "@agent please read the mortgage docs"
[23:42:30] the scoped park returned HTTP 200 with that event   (lane routing, SERVER-111)
[23:42:30] re-parked scoped (the rearm)         th_oip2lkt5 live=true since=23:42:30Z
[23:42:32] POST /api/queue/claim-all            -> claimed: []          <-- direction 1
[23:42:32] ls .corpus/queue/pending/            -> evt_2jv77wfg2akh.json  (untouched)
```

The event stayed pending, stamped with the resident's lane, invisible to the unscoped
claim while a listener was there.

### 4. The grace window is a rearm gap, not a departure

The lane's listener stopped at **23:42:30**. Sampled every 60 s from a second shell:

```
[23:43:35] t+63s   th_oip2lkt5 live=true  since=23:42:30Z  summary="idle — last active 1m ago"
[23:46:35] t+243s  th_oip2lkt5 live=true  since=23:42:30Z  summary="idle — last active 4m ago"
[23:49:35] t+423s  th_oip2lkt5 live=true  since=23:42:30Z  summary="idle — last active 7m ago"
[23:52:35] t+603s  th_oip2lkt5 live=true  since=23:42:30Z  summary="idle — last active 10m ago"
```

Ten minutes without a park and still live: the window is 960 s (below), so a whole
missed rearm cycle does not read as a departure. `since` froze at the release instant
and the summary's relative age tracks it.

### 5. Direction 2 — the lapse, and the parked orchestrator it wakes

An unscoped `idle` was parked at **23:51:26** with a 480 s window, so that it would
still be open at the lapse instant (23:42:30 + 960 s = **23:58:30**):

<!-- LAPSE-EVIDENCE -->

### 6. The resident comes back to a lane it left

<!-- RETURN-EVIDENCE -->

### The grace window, and its arithmetic

`LANE_GRACE_MS = AGENT_PRESENCE_WINDOW_SECONDS × 1000 = 960_000` — **the contract's
number, not a server constant**, deliberately diverging from this issue's suggested
`900_000` beside `DEFAULT_STALE_AFTER_MS`:

- §7 fixes exactly one bound: *"the window is longer than a rearm gap"*. A rearm gap is
  bounded by the idle timeout, which the contract pins at `MAX_IDLE_TIMEOUT_SECONDS = 480`
  (a park cannot outlive it and the skill re-invokes at once). `960 = 480 × 2` tolerates
  one wholly missed rearm and calls two a departure. 900_000 would also satisfy the bound.
- What decides it is the *second* applier: CONTRACT-045 publishes
  `AGENT_PRESENCE_WINDOW_SECONDS` and `isAgentPresent` applies the same window client-side
  to expire a `live` it has been holding. A server window of 900 s would let a client call
  a lane absent that the server had just called present — the flicker the window exists to
  stop. One number, two appliers.

### Corrections to my own first reading (recorded because they cost a drill)

- I first read "the lane is still live nine minutes after I killed the client" as the
  server failing to notice a dropped socket. It was not: the killed park had **already
  returned 200** with the event a moment after it was made, so what the roster was showing
  was the grace window running from that release. Presence behaved exactly as specified.
- A `kill -9`'d `curl` therefore never tested disconnect detection here. The abort path
  does exist and is exercised by `agents/roster.test.ts` (`AbortController` on
  `app.request` ends the park and moves `since`).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0)
- [ ] Committed with `[SERVER-112]` prefix
