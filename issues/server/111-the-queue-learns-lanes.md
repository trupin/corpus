# [SERVER-111] The queue learns lanes

## Domain
server

## Status
done

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
- [x] Lane stored as server-only bookkeeping on the event file (beside `status`/`attempts`, `store.ts:44-51`) and mirrored into the SQLite `events` table; never on the wire event shape
- [x] Lane resolution: explicit `recipient` wins; else walk origin → root; a designated root routes to its lane; everything else (including `doc.edited` on unscoped docs, captures, plugin events) routes to the orchestrator lane — `doc.edited` on a *scoped* doc walks the document's `origin` (SERVER-110's rule) and reaches the resident
- [x] **One type-based exception, owned here:** `resident.designated` always routes to the orchestrator lane, never to the lane it announces — whatever the walk says. Without this, re-designating a live lane delivers the launch instruction to the *old* resident and the new one is never started
- [x] `claimAll({scope})` moves only that lane's pending events; the held report (`held.ts:119-151`) is scoped the same way — a resident never sees the orchestrator's held list and vice versa
- [x] `idle({scope})` parks per lane: `WaiterRegistry` keys settles by lane; `notify(lane)` wakes that lane and the 500ms re-probe checks only the parked lanes' pending sets
- [x] `reapStale` is lane-blind (staleness is staleness) but preserves the lane on requeue; `requeueDeferredFor` likewise
- [x] **Lane fallback**: when a lane's listener is lapsed (SERVER-112 exposes liveness), that lane's pending events are visible to the orchestrator's unscoped claim — the fallback is computed at claim time, not by rewriting events, so a returning listener finds its lane intact
- [x] Halt/resume apply to all lanes (one halt switch, unchanged semantics)
- [x] `recipient: th_…` naming an undesignated thread → 422 at post time (contract's refusal, enforced here)

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

**Model: Opus 5 (1M context).** Not a bug, so there is no pre-fix reproduction.

### Post-Implementation Verification

Real server, real workspace (`corpus init /tmp/s111-e2e`), port moved to **8791** (8765 is the
user's live server, 5173 untouched). Every observation below is off the workspace's own files, its
`.corpus/cache.db`, or an HTTP response.

**Step 0 — designate.** `POST /api/threads/th_no3simhf/resident {"name":"researcher"}` → `200`,
`resident: {name: researcher, docId: doc_researcher111}`.

**Step 1 — the stamp, on the event files the queue wrote.** Four messages posted: a reply in the
designated thread, a reply in an unrelated standalone thread, a **summons** (posted in the
unrelated thread, `recipient: th_no3simhf`), and the designation's own event.

```
comment.created        lane=orchestrator     payload.threadId=th_dzo7vu66
comment.created        lane=th_no3simhf      payload.threadId=th_no3simhf
resident.designated    lane=orchestrator     payload.threadId=th_no3simhf
comment.created        lane=th_no3simhf      payload.threadId=th_dzo7vu66   ← the summons
```

All four §7 clauses at once: the scope's root thread inside the scope, the orchestrator outside it,
the type carve-out (`resident.designated` on the orchestrator's lane though it announces
`th_no3simhf`), and the recipient carve-out — the summons stamped with the recipient's lane while
its payload still names the **host** thread. Routing follows the recipient; filing follows the
conversation.

**Step 2 — the walk, through a document's origin.** The agent created a note with
`job: evt_h5wsnfecblne` (an event on the resident's lane) → `documents.origin = th_no3simhf`. A
person then commented on that note with **no job and no recipient** — pure walk, thread → parent
document → its origin:

```
comment.created|th_no3simhf|th_bye57mlt     (th_bye57mlt.parent = doc_oa5f5vzn, origin th_no3simhf)
```

§7's "a conversation that produces a draft, and a comment left on that draft, reach the same agent".

**Step 3 — disjoint sets over HTTP.** 5 pending, 3 on `th_no3simhf` and 2 on the orchestrator's.

```
POST /api/queue/claim-all?scope=th_no3simhf → claimed 3   pending left: 2
  events.lane after: orchestrator|pending|2   th_no3simhf|in-progress|3
POST /api/queue/claim-all                     → claimed 2
```

**Step 4 — parking is per lane.** With the queue drained, a resident parked
`GET /api/queue/idle?timeout=4&scope=th_no3simhf` and the orchestrator parked the unscoped one; one
comment was then posted on the **orchestrator's** lane:

```
orchestrator idle -> 200   (woken by its own lane)
resident idle     -> 204   (its window expired; another lane's arrival is not its business)
```

**Step 5 — the refusals, with nothing written.**

```
POST /api/threads/th_dzo7vu66/turns {"recipient":"th_dzo7vu66"}   → 422 unknown_recipient, recipient: th_dzo7vu66
POST /api/threads/th_dzo7vu66/turns {"recipient":"th_nosuchthing"} → 422 unknown_recipient  (same body shape — no existence oracle)
POST /api/queue/claim-all?scope=doc_a1b2c3                          → 400 bad_request
```

`GET /api/threads/th_dzo7vu66` still reported **3** turns afterwards — the two refusals wrote
nothing.

**Step 6 — legacy files and a cold boot.** Two hand-written event files with **no `lane` key** were
dropped into `pending/`, the projection deleted, and the server stopped and started. `meta
.schema_version = 17`; both rebuilt as `lane=orchestrator`; a scoped `claim-all` returned `[]` for
them and the unscoped one returned them. `corpus db doctor` → *projection is clean — 14 documents
from 14 files*. Final `events` census: `orchestrator|5`, `th_no3simhf|4`.

**What could NOT be verified end to end, and why.** The issue's step 4 — "kill the scoped shell,
wait out the grace window, the plain shell's claim now returns the event" — needs liveness, which is
**SERVER-112** and does not exist yet. The seam is bound to `NOTHING_LIVE` here, so every thread lane
reads as lapsed and the orchestrator's unscoped claim sees the whole queue: exactly the pre-lane
behaviour, and the safe direction (§7: the cost of a lapse is that the orchestrator does the work,
never that it is silently not done). Both directions of the fallback — including the held report
narrowing to the caller's own lane once a lane is live — are covered by unit tests that inject a
liveness predicate (`service.test.ts` → *lanes › one consumer per lane*).

The server was stopped and port 8791 confirmed free; the workspace was deleted.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, security-sensitive routing)
- [ ] Committed with `[SERVER-111]` prefix
