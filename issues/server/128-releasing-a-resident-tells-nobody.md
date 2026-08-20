# [SERVER-128] Releasing a resident tells nobody

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: — (needs a `resident.released` event type; file the CONTRACT half
  if the event shape reaches the wire)
- Blocks: —
- Related: SHARED-055, UI-125

## Spec References

- SPEC.md **§7** — designation, lanes, the lapse fallback, release
- SPEC.md **§7** — `resident.designated` as an enqueued event

## Summary

Reported by the user, 2026-08-19: *"Designating a resident sends an event to the
orchestrator agent, but releasing one does not. This means I don't have a way to
stop a resident agent without resolving the thread altogether or waiting for the
orchestrator agent to discover the resident status."*

Confirmed, and the asymmetry is documented as deliberate.
`apps/server/src/threads/resident.ts:112`:

> The `resident.designated` event; **`null` for a release, which enqueues none.**

So designating wakes the orchestrator and releasing tells nobody.

## What is milder than reported, and what is not

**The resident does find out.** `converse/SKILL.md:664` — a release that lands
while the resident is parked is read at the top of its next pass, and a refused
park is *"the same ending, found one step later"*. So a released resident does
exit on its own.

**But the window is the park rearm**, up to ~8 minutes (§7's bound). So *"stop
this agent"* is not an act with an observable end; it is a request that takes
effect at some point in the next eight minutes, with nothing to watch.

**And the orchestrator is never told at all.** A conversation whose resident was
released has no owner and nothing knows to pick it up. Nothing is broken — the
next message enqueues normally — but the gap between release and the next message
is unattended, and no surface reports it.

## What to decide

1. **Should release enqueue `resident.released`?** The draft assumption is yes,
   for symmetry with `resident.designated` and so the orchestrator learns a lane
   returned to it. Weigh against event volume on a workspace that designates and
   releases often
2. **Should release be immediate rather than next-pass?** This is the user's
   actual pain. A parked resident is blocked on an HTTP response — the same
   long-poll that makes parking free — so the server *can* return that request
   the moment a release lands, rather than letting it time out. That is a real
   design question about `queue idle`'s contract, not a bug fix
3. **What does a release event carry?** At minimum the thread and the released
   resident. Whether it carries the reason (released by a person, released by
   resolution, lapsed) decides whether the orchestrator can tell them apart

## Decided by the orchestrator, 2026-08-19

1. **Release enqueues `resident.released`** (CONTRACT-069 defines it), on the orchestrator's lane, payload `{threadId, resident, reason}` with `reason` one of `released | resolved | replaced`. A lapse is not a release and produces nothing. **Volume argument**: one event per release, and a release is a user-only act on one thread, so the bound is one event per designation-release cycle — the same as designation already costs. Nothing automatic releases in a loop.
2. **Release is immediate for a parked resident.** The parked scoped `queue idle` long-poll for that lane returns **at once** when a release lands, so the resident reads the release on its very next line rather than after the rearm. The idle response shape is unchanged — it returns as an ordinary wake, and the resident's own next read of its designation finds it released (converse already handles this). Bound: the HTTP round-trip, under a second. A resident mid-turn is not interrupted; it finds the release when it next parks or claims — events stamped for its lane before the release stay its to settle, unchanged.
3. **`replaced`** covers designating again over a live resident; the old one is released with that reason and the new designation's event follows.

## Acceptance Criteria

- [x] Releasing a resident is observable — the orchestrator learns of it by the
      same mechanism designation uses, or by a stated deliberate alternative
- [x] A release a person performs takes effect in a bounded, stated time, and the
      bound is short enough that "stop this agent" is an act rather than a wish
- [x] Resolution-driven release and person-driven release are distinguishable, or
      the record says why they need not be
- [x] **No event storm**: a workspace that designates and releases in a loop does
      not flood the queue. State the volume argument with a number
- [x] The lapse fallback (§7) is unchanged — a lapsed lane is not a release, and
      conflating them would make a slow agent look like a stopped one

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — the `null` at line 112
- `packages/contract` — the event type, if it reaches the wire
- `apps/server/src/queue/` — if release is made immediate, `queue idle`'s return

### Key Implementation Details

Read `resident.ts:235` first — *"Every call enqueues `resident.designated`,
including one that writes…"* — which is the symmetry this issue is measured
against.

Read `converse/SKILL.md:659-700`. The skill already has a careful account of what
a resident does when it discovers a release mid-park, including that events
stamped for its lane before the release stay its to settle. **Any change here
must keep that true**, or work in flight is orphaned.

### Edge Cases

- A release landing while the resident is mid-work, not parked
- A release landing between claim and settle
- Resolution releasing a resident (§7) — the same path, different trigger
- Designating again immediately: one thread, two residents in succession, which
  `converse/SKILL.md:702` already treats as one lane with two occupants

## Testing Strategy

Route tests for the event, and a real-server test for the timing bound. Falsify
by restoring the `null` and confirming the release-observability tests go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Designate a resident, confirm `resident.designated` is enqueued
3. Release it; confirm the orchestrator learns, and **time how long it takes**
4. Repeat with the resident mid-work rather than parked
5. Confirm events stamped before the release are still settled by the resident
6. Stop the server; confirm the port is free

## E2E Verification Log

**Implemented on: opus.** Verified 2026-08-19 against a real `corpus server` process on port
**8891**, in a throwaway workspace created by `corpus init` at
`…/scratchpad/ws-server-a`. Never the dev repo, never 8765 or 5173.

### Pre-fix state (the reported behaviour)

`threads/resident.ts:112` documented the asymmetry as deliberate — *"the `resident.designated`
event; `null` for a release, which enqueues none"* — and `releaseResident` returned
`eventId: null` unconditionally. Releasing wrote the file, dropped the lane off the roster, and
told nobody. A parked scoped `idle` on that lane went on being held until its window ran out.

### 1. Release announces itself

```
DELETE /api/threads/th_qezon4cg/resident → 200
.corpus/queue/pending/evt_*.json:
  resident.released | lane orchestrator |
    {"threadId":"th_qezon4cg","resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":null},"reason":"released"}
```

On the **orchestrator's** lane, under the same carve-out `resident.designated` has.

### 2. All three reasons, none of them a lapse

One thread, driven through every ending (queue drained between steps):

```
same profile, SAME weight    → resident.designated only          (the existing re-announce)
same profile, DIFFERENT weight → resident.released reason=replaced, then resident.designated
POST .../resolve             → resident.released reason=resolved
DELETE .../resident          → resident.released reason=released
```

The `replaced` payload carries the **displaced** occupant (`weight: "light"`), while the
designation that followed carries the newcomer (`weight: "heavy"`). A lapse writes nothing and
produces no event — §7's fallback is computed at claim time and is untouched.

### 3. The bound: release → parked `idle` returns

Real HTTP, real server, a scoped `idle` with a 60-second window parked for 2 s before the
release:

```
release issued at  T
idle returned      T + 112 ms   (HTTP 204)
```

The 112 ms includes two `node -e` process starts (~30–40 ms each) used to take the timestamps,
so the server-side figure is well under 100 ms. The in-process test measures the same thing
without that overhead: **46–52 ms over four runs** (`resident.test.ts`, *"returns the parked
`idle` as an ordinary 204, well under a second"*, asserted `< 1000 ms`).

Before this issue the same request returned after the full window — up to §7's ~8-minute rearm.

### 4. The response shape is unchanged, and the re-park is what refuses

The parked request answers `204` with no body: an ordinary empty window. The resident's *next*
park is refused by SERVER-118's guard, which the converse skill already reads as its retirement:

```
GET /api/queue/idle?timeout=5&scope=th_qezon4cg
→ 422 {"code":"unknown_recipient","recipient":"th_qezon4cg", …}
```

### 5. The orchestrator's own park is woken, not evicted

Orchestrator parked unscoped, then a resident released elsewhere:

```
GET /api/queue/idle?timeout=30 → 200
  events: [{"type":"resident.released", payload:{…,"reason":"released"}}]
```

So the two parties learn by their own mechanisms: the resident's park **ends**, the
orchestrator's park **finds work**.

### 6. `converse/SKILL.md:659-745` stays true — work in flight is untouched

A turn addressed to the agent, stamped for the lane, then a release:

```
before release:  comment.created | lane th_dtarbizd | pending
after  release:  comment.created | lane th_dtarbizd | pending    ← unmoved
                 resident.released | lane orchestrator | pending
POST /api/queue/claim-all?scope=th_dtarbizd → claimed [ 'comment.created' ]
```

Nothing in `pending/` or `in-progress/` is touched by a release, and the departing listener can
still drain its own lane — which is exactly what the skill's retirement steps depend on.

### 7. Volume

One event per release. A release is a user-only act on one thread, so a designate/release cycle
costs **two** events — the same order designation alone already cost. An idempotent `DELETE` on
a thread with no resident announces nothing and evicts nobody, verified both as a route test and
by the park that stayed parked through an unrelated release.

`corpus db doctor` → `projection is clean — 20 documents from 20 files (8ms)`.

### Falsifications

1. **Disabled the eviction** (commented out `this.evictReleasedLane(event)` in
   `queue/service.ts`). The four timing cases in *"a release ends a parked listener at once"*
   went red, all four as `Test timed out in 5000ms` — the parked request went on being held,
   which is the pre-fix behaviour exactly. Restored, green again.
2. **Restored the `null` at the release site** (`releaseResident` returning
   `releasedEventId: null` and enqueueing nothing). **4 tests red**: *"enqueues
   `resident.released` on the orchestrator's lane, naming who left"*, *"leaves an already-queued
   event on its lane when the resident is released"*, and two of the timing cases (no event ⇒ no
   eviction, which is the same one path). Restored, green again.

### Checks

- `node_modules/.bin/tsc --noEmit` in `apps/server` — clean
- `eslint apps/server/src --max-warnings 0` — clean; `prettier --check` — clean
- `vitest run apps/server` — **193 files, 4306 tests, all passing**
- Server stopped; `lsof -iTCP:8891` → port free

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-128]` prefix
