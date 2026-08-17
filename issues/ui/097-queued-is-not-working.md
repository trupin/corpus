# [UI-097] A request nobody has picked up says "agent is working…"

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 1 (rider must be signed first)
- Blocks: —

## Spec References

- SPEC.md §8 line 340 — the honest pending indicator, as amended by SHARED-033
- SPEC.md §7 — queue event lifecycle: `pending` → `in-progress`

## Summary

Post a comment to the agent with no agent running, and the thread says **"agent
is working…"**, escalating to "still working…" and "still working — longer than
usual". Nothing is working. The event is `pending` in the queue and no agent has
ever seen it.

**No contract change is needed** — `pending` and `in-progress` are already
distinct on the wire and already reach the client. This is a UI issue that
conflates them.

## Reproduction (confirmed by inspection)

`packages/kit/src/row/useRowSignals.ts:25`:

```ts
const ACTIVE_JOB_STATUSES: readonly QueueEventStatus[] = ["pending", "in-progress"];
```

under the docblock *"Queue states that mean the agent is working on this row
right now."* `pending` means the opposite: unclaimed.

`apps/ui/src/thread/PendingIndicator.tsx:22` then opens at `"agent is working…"`
for any outstanding request, on a clock measured from the requesting turn.

## Acceptance Criteria

- [x] A `pending` (unclaimed) request reads as **waiting to be picked up**, in
      wording clearly distinct from a request being worked
- [x] An `in-progress` request reads as the agent working, exactly as today
- [x] The transition `pending` → `in-progress` updates live over SSE, without a
      reload
- [x] The **elapsed clock still runs from the requesting turn**, not from the
      claim — per the rider, "the wait is the wait". A request that sat pending
      for ten minutes and is then claimed must not reset to "0m"; the existing
      docblock at `outstandingAgentRequest.ts:222` already warns about exactly
      this reset and must not be undone
- [x] The escalating tiers still apply, and their wording is coherent for a
      request that has been *waiting* rather than *worked* for 15 minutes — "still
      working — longer than usual" is wrong for something never started
- [x] `deferred` keeps its current, separate treatment (`awaitingAgent`) —
      `useRowSignals.ts:20` explains why it is excluded from the active set, and
      that reasoning is untouched by this issue
- [x] Row-level signals (the spinning dot in a list) obey the same split — a
      queue full of unclaimed work must not spin a dot on every row
- [x] Applies everywhere an outstanding request is indicated: thread cards, board
      rows, Attention, and the Ask/Capture "appears immediately with a
      pending-agent indicator" path (§11)

## Technical Design

### Files to Create/Modify

- `packages/kit/src/row/useRowSignals.ts` — split the active set; the name
  `ACTIVE_JOB_STATUSES` becomes a lie the moment it holds only `in-progress`, so
  rename it to say what it means
- `apps/ui/src/thread/PendingIndicator.tsx` — a second wording set for the
  waiting case, alongside `WORKING_TIERS`
- `apps/ui/src/thread/outstandingAgentRequest.ts` — carry the claimed/unclaimed
  distinction out to callers; today it answers one boolean
- the row-signal consumers, wherever the dot is drawn

### Key Implementation Details

`outstandingAgentRequest` currently answers **whether** a response is
outstanding. It now has to answer **which kind**, and its existing docblocks
explain constraints that must survive the change: the status is asked on the
wire once for the thread (line 53), the check must not key off "any outstanding
job in the corpus" (line 105), and a saturated queue transitions constantly so
the row must not thrash (line 194).

The elapsed clock is the subtle part. It is measured from the turn deliberately,
so a reload mid-job does not lie about the wait. Splitting the *wording* must not
split the *clock* — one wait, two descriptions of who is holding it.

### Edge Cases

- A request claimed and then requeued by `reap-stale` — returns to waiting; the
  clock does not restart
- A request whose job is `deferred` — unchanged path
- Several outstanding requests on one thread at different statuses — the row
  reports the one that governs; decide and document which
- A request claimed within the first render — must not flash "waiting" first

## Testing Strategy

Vitest + Testing Library: a `pending` job renders the waiting wording and no
working dot; `in-progress` renders the working wording and the dot; the
transition re-renders without remounting; the elapsed value is computed from the
turn timestamp in both states and does not reset across the transition;
`deferred` takes its existing path.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the server with **no agent running** (`corpus server start`, no
   `claude` session)
2. Post an `@agent` comment in the UI
3. Expected: the thread says the request is waiting to be picked up
4. Actual: "agent is working…", escalating to "still working…"

### Verification Steps

1. Restart the app, still with no agent running; post an `@agent` comment
2. Confirm the thread reads as waiting, and that no row spins a working dot
3. Leave it past 45 s and 3 m — confirm the escalation wording is coherent for
   something that has not started
4. Now start the agent (`corpus queue idle` / the orchestrate loop) and let it
   claim the event
5. Confirm the indicator switches to working **live over SSE**, and that the
   elapsed time **continues** from the original turn rather than resetting
6. Confirm the same behaviour on a board row and in Attention
7. Fill the queue with several unclaimed events — confirm no row shows a working
   dot

## E2E Verification Log

**Model run on: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-16.

### Pre-fix reproduction (by inspection, then confirmed in the code paths)

`packages/kit/src/row/useRowSignals.ts` held
`ACTIVE_JOB_STATUSES = ["pending", "in-progress"]` under the docblock *"Queue
states that mean the agent is working on this row right now"*, and
`apps/ui/src/thread/ThreadCard.tsx` rendered `<PendingIndicator since={…} />`
for **any** outstanding job, whose only vocabulary was `WORKING_TIERS`
(`agent is working…` → `still working…` → `still working — longer than usual`).
A `pending` event therefore produced the working wording and the pulsing dot
with nothing having claimed it. The existing suites encoded the bug: the kit's
own row test was named *"labels a running job with no log line yet"* and seeded
`status: "pending"`, asserting the working dot's title contained `pending`.

### Real workspace, real server, real browser

Ports: workspace server **8837**, Vite **5477** (`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8837`).
8765 (the user's live server) and 5173 (an ssh tunnel) were never bound; verified
free before and after with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

```
$ corpus init /tmp/ui097-ws --port 8837
$ corpus server start --workspace /tmp/ui097-ws
  corpus 0.9.0 listening on http://127.0.0.1:8837 (pid 10378)
$ curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8837/api/queue/status
  {"agent":{"live":false,"since":null},"halted":false,"pending":0,"inProgress":0,…}
$ corpus doc create --type note --title "Insurance quotes" -m "…"
  created doc_qfsiuq6y
$ corpus thread create --parent doc_qfsiuq6y -m "Which of these should I file?"
  created th_fqgf3q2t
```

**1 · An unclaimed request reads as waiting, and no dot pulses.** A headless
Chromium (`/tmp/ui097-drill.mjs`) opened the board, clicked the thread row and
posted `@agent which one should I file?` through the real composer with the
`◉ ask agent` toggle — the real enqueue path, `POST /api/threads/{id}/turns` →
`comment.created` in `.corpus/queue/pending/`:

```
23:28:41 thread row visible. dots before ask: working=0 queued=0
23:28:42 PENDING ROW state= waiting | since= 2026-08-16T23:28:42Z
         | text= "queued — waiting to be picked up"
23:28:42 dots in card: working=0 queued=1
```

**2 · `pending` → `in-progress` live over SSE, no reload.** With the browser
untouched, a separate process claimed the event exactly as an agent does:

```
$ corpus queue claim-all
{"events":[{"id":"evt_vora5uyj3ihn","type":"comment.created",
  "created":"2026-08-16T23:28:42Z","payload":{"threadId":"th_fqgf3q2t",…}}],…}
```

and the page — polled every 250 ms, never reloaded, never clicked — reported:

```
23:29:08 FLIPPED
23:29:08 PENDING ROW state= working | since= 2026-08-16T23:28:42Z
         | text= "agent is working…"
23:29:08 dots in card: working=1 queued=0
23:29:08 navigations (should be 1, the initial goto): 1
23:29:08 dots on row after claim: working=1 queued=0
```

`data-working-since` is **byte-identical before and after the claim**
(`2026-08-16T23:28:42Z`), so the clock did not restart — criteria 3 and 4
together. `performance.getEntriesByType("navigation").length === 1` is the proof
that no reload was involved.

**3 · The escalation is coherent for something that never started.** A second
thread (`th_u2o2famy`) was asked and left unclaimed with no agent running
(`agent.live: false` on the wire, above):

```
23:29:51 T0       | elapsed   0s | waiting | "queued — waiting to be picked up"
23:30:43 T+52s    | elapsed  52s | waiting | "queued — waiting to be picked up"
23:33:03 T+3m12s  | elapsed 192s | waiting | "still waiting — no agent is connected"
```

The T+52s sample is the row's own 15 s tick, not a missed tier: `now` was last
taken at the 45 s tick, when elapsed was 44.x s. Pinned by a third thread
(`th_uhgrs5pc`) sampled past the tick boundary, which shows the middle tier
plainly:

```
23:34:58 T0    | since= 2026-08-16T23:34:57Z | elapsed  1s | "queued — waiting to be picked up"
23:36:04 T+66s | since= 2026-08-16T23:34:57Z | elapsed 67s | "still waiting to be picked up"
```

(A headless timer probe in the same browser confirmed the interval is not
throttled: 3 ticks of a 15 s interval in 52 s, `visibilityState: "visible"`.)

**4 · A queue of unclaimed work spins nothing.** With the real queue holding two
`pending` events and one `in-progress`, the Open threads column reported, row by
row:

```
[{"doc":"th_uhgrs5pc","working":0,"queued":1,"label":"Queued — waiting to be picked up"},
 {"doc":"th_u2o2famy","working":0,"queued":1,"label":"Queued — waiting to be picked up"},
 {"doc":"th_fqgf3q2t","working":1,"queued":0,"label":"Agent is working on this document"}]
$ curl …/api/queue/status
  {"agent":{"live":false,…},"pending":2,"inProgress":1,"deferred":0,…}
```

One pulsing dot for the one claimed event, and two still rings for the two
nobody has taken. Screenshots: `/tmp/ui097-waiting.png`, `/tmp/ui097-working.png`,
`/tmp/ui097-escalated.png`, `/tmp/ui097-board.png`.

Teardown: `corpus server stop` (stopped pid 10378), Vite killed, 8837 and 5477
verified free; 8765 left untouched and still held by the user's own server.

### Automated

- `apps/ui/e2e/pending-claim.spec.ts` (new) drives the same transition in a real
  browser over a real `text/event-stream`: `queued — waiting to be picked up` →
  `claimJob` behind the page's back → `invalidate` frame → `agent is working…`,
  with `data-working-since` unchanged, plus the computed style of the queued dot
  (7 px, 50 %, `animation-name: none`, transparent fill).
- `npx playwright test e2e/pending-claim.spec.ts e2e/forms.spec.ts e2e/thread.spec.ts e2e/console.spec.ts e2e/smoke.spec.ts`
  (`CORPUS_UI_PORT=5477`, `CORPUS_SERVER_ORIGIN` pinned): **55 passed**. An
  earlier run of the same set had one flake in `smoke.spec.ts` *"focus rings
  match the prototype"* (a three-`Tab` focus race under `fullyParallel`); it
  passed alone and passed on the re-run of the full set.
- `VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit plugins`: 4257 passed
  after the pinned-surface list was updated for the two new kit exports.
- `tsc --noEmit` clean in `apps/ui`, `packages/kit` and `plugins/todos`;
  `eslint` and `prettier` clean over every touched file.

### Tests checked red before being trusted green

Each mutation was applied to source, the affected suite run, then reverted:

| Mutation | Killed |
| --- | --- |
| `useRowSignals`: working matches any non-`deferred` status | *does not pulse for a queued event nobody has claimed*, *pulses when any of the row's events has actually been claimed* |
| `useRowSignals`: `awaitingAgent` → `working` (kit rebuilt so the plugin saw it) | *marks a row as waiting while the agent owes the thread a reply*, and the todos plugin's *keeps the row's own signals* |
| `pendingLabel` ignores `state` and always returns `workingLabel` | 7 tests across `PendingIndicator.test.tsx` and `ThreadCard.test.tsx` |
| `agentPresent = true` (the queue-status read removed) | *escalates a wait into the reason for it when nobody is parked*, *lets a stale presence verdict expire on its own tick* |
| `pickOutstandingRequest`: `working = true` | 3 unit + 3 ThreadCard tests |
| `pickOutstandingRequest`: `working = false` | the **e2e** post-claim assertion (`data-pending-state` never reaches `working`), which is the SSE half |

## Completion Checklist (domain agent)

- [x] Pre-fix reproduction logged
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-097]` prefix
