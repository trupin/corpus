# [SERVER-114] An agent arriving never reaches the console — presence invalidates the wrong key

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-112 (which wired the emitter)
- Related: CONTRACT-045 (whose stated rationale this breaks), UI-098 (which
  measured it), CONTRACT-053

## Spec References

- SPEC.md **§7** — *"Who is running is a **read**, never a push: the roster and
  each lane's liveness are read behind the ordinary invalidate keys (§9.4), like
  any other projection."*
- SPEC.md **§9.4** — invalidate keys

## Summary

`apps/server/src/app.ts:378` binds `onPresenceChanged → invalidate([AGENTS_KEY])`.

Since `CONTRACT-045`, presence is **also** carried on `GET /api/queue/status`,
and the console reads it from there. `useQueueStatus` is `staleTime: Infinity`
with no refetch on focus or reconnect, so an invalidation that names only
`["agents"]` never causes the queue status to be re-read.

**Measured by UI-098 against a real server**: a page showing `agent:
disconnected`, an agent parked underneath it, the server answering
`live: true` — and the pill **still read `disconnected` 150 seconds later**,
with one status request in the whole interval. It corrects on the next read of
the queue for any other reason: a reload, or any queue transition. Both were
observed.

**This makes v0.10.0's headline feature invisible in the ordinary case.** The
whole point of the presence work is that a person can see who is live; an agent
that connects and is not shown until something unrelated happens is the feature
not working. A *departure* is unaffected — the client expires a stale `live` on
its own 960 s window, which is why UI-098's departure test passed and this went
unnoticed.

The sharpest way to put it: `CONTRACT-045`'s own stated rationale for putting
presence on the queue status is that the strip refetches "on every `["queue"]`
invalidation". **The emitter does not honour that premise.**

## Acceptance Criteria

- [x] An agent parking is visible to a console that is already open, without a
      reload and without waiting for an unrelated queue transition
- [x] The fix is on the **emitter**, not in the UI. UI-098 deliberately did not
      work around it by reading the roster instead, because that would put
      `QueueStatus.agent` and `GET /api/agents` on one surface, which
      CONTRACT-053 records can legitimately disagree for a grace window
- [x] A test that fails against the current single-key emit — assert the keys
      emitted, not merely that something was emitted
- [x] **Sweep for the same shape elsewhere**: any other place a fact is carried
      on two routes but invalidated on one key. This one was found by measuring
      a UI, which is not a search. Report what the sweep covered even if it
      finds nothing
- [x] Nothing about presence travels over SSE as data — §7 is explicit that it
      is a read, never a push, and the fix must stay an invalidation

## Technical Design

### Files to Create/Modify

- `apps/server/src/app.ts` — the `onPresenceChanged` binding
- the corresponding test

### Notes

The suggested fix is `invalidate([AGENTS_KEY, QUEUE_KEY])`. Confirm that is
sufficient rather than assuming: check what key `useQueueStatus` actually holds,
and whether any other consumer of presence reads a third key.

## Testing Strategy

Unit on the emitter's key list. If an integration test can observe a parked
agent becoming visible without a reload, that is worth more than the unit test
and should exist too.

## E2E Verification Log

**Model:** opus (claude-opus-5, 1M context). **Server:** real `corpus server start`
in a real `corpus init` workspace (`/tmp/s114/ws`), port 19114 (8765/5173 untouched).

### 1. Reproduction — before any code change

Wire level, `curl -N /events` open, then a real scoped park
(`GET /api/queue/idle?scope=orchestrator&timeout=60`):

```
:connected
event: invalidate
data: {"keys":[["agents"]]}                     <- the park
event: invalidate
data: {"keys":[["agents"]]}                     <- the release
GET /api/queue/status -> {"agent":{"live":true,"since":"2026-08-17T00:57:17Z"}, ...}
```

The fact that changed (`agent.live` false -> true) is served by
`GET /api/queue/status`, which the console caches under `["queue"]` with
`staleTime: Infinity` and no refetch on focus or reconnect
(`packages/kit/src/client/queryClient.ts:38-40`, `useQueueStatus.ts:20`). The
frame names a key nothing holds that fact under.

Client level, the **real** client stack (kit SSE bridge + kit QueryClient
defaults + generated client + a `QueryObserver` on `QUEUE_KEY`, i.e. exactly
what `useQueueStatus` mounts) against the real server, pre-fix emit:

```
[pill] disconnected  (live=false, reads=1)
--- parking an agent (scoped idle), no reload, no user action ---
[wire] invalidate {"keys":[["agents"]]}
--- 3 s later, still no reload ---
[wire] invalidate {"keys":[["agents"]]}
                                          (pill never re-read: reads stayed 1)
```

UI-098's measurement reproduced end to end: server says `live: true`, pill says
`disconnected`, one status request in the whole interval.

### 2. After the fix

Same probe, same server, fixed emit:

```
[pill] disconnected  (live=false, reads=1)
--- parking an agent (scoped idle), no reload, no user action ---
[wire] invalidate {"keys":[["agents"],["queue"]]}
[pill] idle  (live=true, reads=4)
```

The pill flips within the same second, with no reload and no unrelated queue
transition. Park **and** release both emit both keys; `corpus agents` (the CLI
reader of the roster) independently reports `orchestrator · live, parked 3s ago`
— the two presence surfaces still answer separately, so CONTRACT-053's grace
window is untouched. The frame carries key names only: no `live`, no `since`,
nothing about presence as data (§7).

### 3. Checks

- `apps/server/src/app.test.ts` presence block verified **red** against the
  single-key emit (3 failures, e.g. `expected [ [ 'agents' ] ] to deep equally
  contain [ 'queue' ]`) and green after.
- `vitest run apps/server`: 189 files, 3979 tests, all passing.
- `tsc --noEmit -w apps/server`: exit 0. eslint + prettier on the touched files:
  exit 0.

### 4. Sweep — a fact on two routes, invalidated on one key

Enumerated every read route in the contract (17 `GET`s), the server handler and
data source behind each, then inverted it: for each source (projection table or
column, in-memory tracker, HALT sentinel, index state), which routes expose it
and which key each is cached under; then every server emit site
(`bus.invalidate`, `plan.keys`, `QUEUE_QUERY_KEYS`, `REBUILD_QUERY_KEYS`,
`residentKeys`, the watcher's `documentKeys`, the plugin bus) and the keys it
names. Derived UI keys are prefixed by a core key (`docsListKey` =
`["docs", {…}]`, `searchKey` = `["docs","search",{…}]`), and TanStack matches by
prefix, so naming `["docs"]` covers them.

**Presence itself has no third reader.** The only cached reader of presence in
the whole repo is `useQueueStatus` (`["queue"]`); nothing reads `GET /api/agents`
through a cache — there is no `useAgents` hook, and the roster's only consumer is
the CLI's one-shot `corpus agents`. So `[AGENTS_KEY, QUEUE_KEY]` is exhaustive,
not merely sufficient.

**One other instance is LIVE today**, and it is not about presence: the semantic
index's derived `state` word is carried on **three** routes —
`GET /api/index/status` (`["index"]`), `GET /api/search`
(`semanticIndex: semantic.state`, `search/search.ts:272`, cached under
`searchKey` = `["docs","search",{…}]`) and `GET /api/docs/{id}/related`
(`related.ts:188`, cached under `relatedKey` = `["docs",id,"related"]`) — while
both emitters name `["index"]` alone (`semantic/maintenance.ts:65`,
`semantic/worker.ts:397`). Both consumers are mounted UI readers
(`SearchOverlay.tsx:82,278` renders the degraded-ranking note;
`reader/useReaderDoc.ts:95`), so an open search overlay keeps showing
"semantic ranking unavailable" after the index has caught up, until an unrelated
document mutation invalidates `["docs"]`. **Not fixed here, and it is not a
one-line fix**: the obvious emit (`["index"], ["docs"]`) would make every
throttled progress tick during a backlog drain re-read every board column, so the
right answer is a judgment call about where that word is cached. Needs its own
issue.

**Same shape found elsewhere — all AGENTS_KEY, all latent** (they would go live
the moment a UI surface reads the roster, i.e. UI-097/UI-109):

| Fact | Routes carrying it | Emitted on | Missing |
| --- | --- | --- | --- |
| `events.status` / in-progress work | `/api/queue/status`, `/api/jobs`, `/api/agents` (`summary`, via `LANE_WORK_SQL`, `agents/roster.ts:78`) | `QUEUE_QUERY_KEYS` = `["queue"],["jobs"],["docs"]` (`queue/project.ts:39`) | `["agents"]` |
| `jobs.last_line` | `/api/jobs/{id}/log`, `/api/jobs`, `/api/agents` (`summary`'s first choice, `roster.ts:148`) | `["jobs"], ["jobs", id]` (`watcher/watcher.ts:463`) | `["agents"]` |
| `documents.title` of a designated root thread | `/api/docs*`, `/api/tree`, `/api/agents` (`origin.title`, `DESIGNATED_LANES_SQL`) | doc-update keys (`docs/write.ts:1195`) | `["agents"]` |
| `threads.resident_name` after a projection rebuild | `/api/threads/{id}`, `/api/agents` | `REBUILD_QUERY_KEYS` (`projection/routes.ts:52`) | `["agents"]` |
| `threads.resident_name` / title changed **out of band** | `/api/threads/{id}`, `/api/docs*`, `/api/agents` | `documentKeys` = `["docs"], ["docs",id], ["threads",id]` (`watcher/watcher.ts:291`) | `["agents"]` |
| a queue event file transitioning **out of band** | `/api/queue/status`, `/api/jobs`, `/api/agents` | `["queue"],["jobs"],["docs"]` written out as a literal (`watcher/watcher.ts:457`) | `["agents"]` — and note this is a *second copy* of `QUEUE_QUERY_KEYS`, so fixing the constant would not fix this line |
| deletion of a designated root thread (the lane disappears) | `/api/agents` | `["docs"], ["docs",id], ["threads",id]` (`docs/delete.ts:104`, and `docs/bulk.ts`) | `["agents"]` |

None is fixed here: adding `["agents"]` to `QUEUE_QUERY_KEYS` changes the frame
of every queue transition and contradicts the contract's published `emittedBy`
text for that key, so it is a contract-coordinated change. Recommended as a
follow-up issue.

**Checked and clean:** mark-seen (emits both `["docs"]` and the thread key),
resident designate/release (`residentKeys` already carries `["agents"]`), thread
resolve releasing a resident (`threads/status.ts:76`), halted state (one route
only), queue counts vs. the job list (always emitted together), and every
document-content fact on `/api/docs*`, `/api/search`, `/api/docs/{id}/related`
and `/api/tree` (prefix-covered by `["docs"]`; `["tree"]` is measured per
SERVER-018).

**Why this one hid**: the departure direction self-corrects — the client expires
a stale `live` on its own 960 s window (`isAgentPresent`) — so only the arrival
direction was ever observable, and only by watching a pill.

## Completion Checklist (domain agent)

- [x] Reproduction logged before the fix
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-114]` prefix
