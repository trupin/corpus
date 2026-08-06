# [UI-076] The truncation escalation reads its previous episode's answer

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-075 (which introduced the escalation this narrows)
- Blocks: merging the phase-13 PR

## Spec References

- SPEC.md §8 — the honest pending indicator ("working…", and what it is allowed
  to claim)
- SPEC.md §7 — the queue: non-terminal statuses, and an event as the unit of
  outstanding work
- SPEC.md §11 — live updates: the server announces staleness, the UI refetches

## Summary

Found by the Fable review of UI-075. `useOutstandingAgentJob` escalates to the
exact `?originId=` question while the shared outstanding list reports itself
truncated, and reads the escalation's answer as `exact.data?.jobs ?? …`. That is
correct on the **first** truncation episode, where there is no cached answer to
read. On a second episode there is: TanStack keeps a parked query's last
response, and the app's `staleTime` is `Number.POSITIVE_INFINITY`
(`apps/ui/src/app/queryClient.ts`), so nothing ages it out.

Concretely: the queue saturates, `th_1` escalates and caches "job X outstanding",
the queue drains below the cap (parking the escalation while X is still
unfinished), X finishes, and the queue saturates again — and the card asserts
"working…" for job X, which finished minutes ago, until the re-enable refetch
lands. That is the same class of dishonesty UI-058 and UI-069 were filed to
remove: a pending row asserting work that is not happening.

The docblock made the stronger claim that this is safe —

> "While the escalation is in flight the shared list still answers — the best
> available reading, and never a worse one than the caller had a moment ago."

— which describes only the first episode. UI-075 exists because its predecessor's
docblock asserted something false about the call site, so load-bearing prose that
overstates the guarantee is part of the defect, not a separate tidy-up.

## Acceptance Criteria

- [x] A second truncation episode never re-asserts a job that settled while the
      escalation was parked — proven by a test that inspects **every render**,
      not the settled state, since the lie is one round trip long
      — `outstandingAgentRequest.test.ts`, "never re-asserts a job that finished
      while the escalation was parked"; fails against the old hook with
      `expected [ 'evt_reply', null ] to not include 'evt_reply'`, and the real
      browser showed the same row for 11 ms.
- [x] The escalation still works in the second episode: a job genuinely
      outstanding and buried past the cap is found once the exact answer lands
      — "still escalates in the second episode…", and in the real app the
      `?originId=` requests went 3 → 5 as the queue re-saturated.
- [x] UI-075's guarantees are untouched: the jobs request count stays flat in the
      number of thread cards (`apps/ui/src/anchors/marginJobRequests.test.tsx`),
      and every completeness assertion in
      `apps/ui/src/thread/outstandingAgentRequest.test.ts` still passes
      — both files pass unmodified; no request is added or removed by this change.
- [x] The docblock states what the code delivers and no more
      — the "never a worse reading than a moment ago" claim is gone, replaced by
      what is true: the shared list answers during the escalation's flight, that
      can under-report, and that is the direction chosen.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/outstandingAgentRequest.ts` — gate the escalation's answer
  on the episode it belongs to; correct the docblock.
- `apps/ui/src/thread/outstandingAgentRequest.test.ts` — the second-episode case,
  driven through the SSE bridge with the production query client.

### Key Implementation Details

The question is not "is this data fresh?" — TanStack's own answer to that
(`isStale`) is the wrong shape here — but "is this data an answer to the
escalation that is asking now?". A `truncated` shared answer is not one
continuous state: saturate → drain → saturate is two separate questions under one
cache key.

So the hook records **when the current escalation began** (`useEscalationStart`,
state adjusted during render so the first render of a new episode already knows
it is a new one — that being the only render on which the parked answer would
otherwise be preferred) and reads `exact.data` only when
`exact.dataUpdatedAt >= escalatedAt`. Until the answer arrives, the shared list
answers, exactly as it does during the first escalation.

Rejected alternative: comparing `exact.dataUpdatedAt` against the *shared*
query's own `dataUpdatedAt`. It needs no state and is wrong — within one episode
both queries refetch on every `["jobs"]` invalidation, so requiring the exact
answer to be the newer of the two would drop the card back to the shared reading
(which is short, that being the premise) on every queue transition, and a
saturated queue transitions constantly. The pending row would flicker on and off
throughout the wait it is reporting.

Also rejected: deleting the escalation. It would remove the stale-cache surface
entirely, but it gives back the completeness UI-069 bought and UI-075 preserved,
and no evidence here says the escalation is not worth its cost.

### Edge Cases

- **Under-reporting during the escalation's flight.** With the guard, a job
  buried past the cap reads as no job at all for one round trip at the start of
  each episode. Deliberate, and identical to what the first escalation has always
  done: a card that has not yet said "working…" is corrected by the next repaint,
  while a card counting up a finished job's wait is a claim the reader cannot
  check.
- **A card mounting mid-episode** starts its clock at mount, so an answer cached
  before it existed is disregarded until the next refetch. Same honest direction.
- **A request outliving a whole drain-and-re-saturate cycle** would be accepted
  by the timestamp comparison. Bounded by that request's own flight, and it is
  the window every query has between asking and being answered.
- No change to request counts: the escalation is still issued only while
  `truncated` holds, still under one cache key per thread, and the ordinary path
  is still the one shared query.

## Testing Strategy

`apps/ui/src/thread/outstandingAgentRequest.test.ts` drives the full episode
sequence — saturate, drain below the cap with the thread's job still outstanding
(this is what parks a *true* answer), settle the job, re-saturate — through the
**production** query client (so the infinite `staleTime` that strands the answer
is the one under test) and real `invalidate` frames over the kit's SSE bridge.
Every render's value is recorded, because a `waitFor` on the settled state cannot
see a one-round-trip lie and would pass against the code being fixed.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a real `corpus` server on a scratch workspace and the real Vite dev
   server against it.
2. Give a thread a real outstanding queue event, and bury it under more than
   `MAX_RECENT_JOBS` unfinished events so the shared list truncates.
3. Complete enough filler events to drop below the cap **while the thread's event
   is still unfinished** — this parks the escalation holding a true answer.
4. Complete the thread's event: the card falls quiet.
5. Saturate again with filler events only.
6. Expected: the card stays quiet. Actual (before the fix): it says "working…"
   again for the completed event until the refetch lands.

### Verification Steps

1. Same sequence against the fix, recording every change of the pending row via a
   `MutationObserver` in the page, plus every `/api/jobs` request.
2. Expected: no `.working` row after step 4, and a new ask in the second episode
   still lights the row once the exact answer lands.

## E2E Verification Log

**Implemented on: opus** (ui-dev). Branch `phase-13-dogfood-wave3`, in place, no
worktree.

### The rig — a real server, a real browser, nothing stubbed

- `corpus init /tmp/ui076-ws` → real workspace, port **8766** (never 8765, which
  holds the user's live server), token from `.corpus/config.json`.
- Real server: `tsx apps/server/src/main.ts --workspace /tmp/ui076-ws`.
- Real Vite dev server on **5273** (`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766`,
  `VITE_CORPUS_TOKEN=…`), so the app runs with its **production** query client —
  `staleTime: Infinity` — and its real SSE bridge against the server's own
  `invalidate` frames.
- Real content over HTTP: `POST /api/docs` → `doc_sxllgwbw`; `POST /api/threads`
  with `requestsAgent: true` on the quote `6.1%` → `th_yyohalhh`, enqueuing the
  real event `evt_2ccaax5ovv2k`.
- Saturation: 260 further events written into `.corpus/queue/pending/` — which is
  what a queue event **is** (SPEC.md §7; `queue/waiters.ts` documents a file
  dropped there as indistinguishable from an in-process enqueue) — with `created`
  stamps newer than the real event, then a server restart so the boot rebuild
  mirrors the directories. Result, checked on the wire:

  ```
  GET /api/jobs?status=pending,in-progress,deferred&recent=200
  rows 200 | first evt_filler0259 | last evt_filler0060 | containsRealEvent false
  ```

  The shared list is **at the cap** and does **not** name the thread's job: the
  card can only be right by escalating.
- Every queue transition below is an HTTP call to the running server
  (`/api/queue/{id}/fail`, `/complete`, `/api/jobs/{id}/retry`), so every repaint
  is driven by that server's real SSE invalidations.
- The pending row is watched by a `MutationObserver` in the page recording every
  appearance/disappearance with its `data-working-since`. The lie is one round
  trip long; polling the settled state cannot see it.

### Reproduction (bugs only)

Driver run with `apps/ui/src/thread/outstandingAgentRequest.ts` restored to the
UI-075 shape (`exact.data?.jobs ?? outstanding.jobs`), everything else identical.

```
== episode 1 — saturated
{"unfinished":261,"workingRow":1,"workingText":"still working — longer than usual",
 "escalationRequests":1,
 "lastJobRequests":[…,{"search":"?recent=200&status=pending,in-progress,deferred"},
                       {"search":"?originId=th_yyohalhh&status=pending,in-progress,deferred"}]}
== drained under the cap — escalation parks
{"unfinished":199,"workingRow":1,"escalationRequests":3}
== thread's job completed — card quiet
{"unfinished":198,"workingRow":0}
== episode 2 — saturated again
{"unfinished":201,"escalationRequestsBefore":3,"escalationRequestsAfter":6,
 "pendingRowEventsAfterItWentQuiet":[
   {"at":1785977487319,"working":true,"since":"2026-08-06T00:45:29Z"},
   {"at":1785977487330,"working":false,"since":""}]}
```

The card went quiet at `…487246` when the real event completed. **73 ms later, at
`…487319`, the pending row came back** — `data-working-since="2026-08-06T00:45:29Z"`,
the completed event's own wait instant — and stayed up for **11 ms** until the
re-enable refetch landed at `…487330`. A completed job, re-asserted as
outstanding, in the real app. Bug confirmed.

### Post-Implementation Verification

Fix restored, queue directories reset from a pre-run snapshot, server restarted
(261 pending again), the **same** driver re-run:

```
== episode 1 — saturated
{"unfinished":261,"workingRow":1,"workingText":"still working — longer than usual",
 "escalationRequests":1, … "?originId=th_yyohalhh&status=pending,in-progress,deferred"}
== drained under the cap — escalation parks
{"unfinished":199,"workingRow":1,"escalationRequests":3}
== thread's job completed — card quiet
{"unfinished":198,"workingRow":0}
== episode 2 — saturated again
{"unfinished":201,"escalationRequestsBefore":3,"escalationRequestsAfter":5,
 "workingRowNow":0,
 "pendingRowEventsAfterItWentQuiet":[]}
== episode 2 — a genuine new ask
{"unfinished":202,"workingRow":1,"workingText":"agent is working…","escalationRequests":6}
```

- **The row never returned** for the completed job: `pendingRowEventsAfterItWentQuiet`
  is empty where the previous run had two entries.
- **The escalation still fires in episode 2** — `?originId=th_yyohalhh` requests
  went 3 → 5 as the queue re-saturated — so the guard parks nothing permanently.
- **Completeness holds.** A real new ask (`POST /api/threads/th_yyohalhh/turns`,
  `requestsAgent: true`, `201`) lit the row again within the same episode, with
  `data-working-since="2026-08-06T00:52:26Z"` — the new turn, not the old one.
- Full recorded timeline for the fixed run: `working` → quiet at `…540012` →
  `working` again only at `…546214`, with the new turn's instant.

### Suites

- `VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit` — **170 files, 2818
  tests, 0 failures**.
- The new second-episode test, run against the reverted hook, fails exactly on
  the render the browser showed:
  `AssertionError: expected [ 'evt_reply', null ] to not include 'evt_reply'`.
- `eslint` on both touched files — clean. `prettier --check` on both files and
  this issue — clean. `tsc --noEmit` in `apps/ui` — clean.
- UI-075's guarantees re-run unchanged: `apps/ui/src/anchors/marginJobRequests.test.tsx`
  (3 threads → 1 request, 30 threads → 1 request) and every completeness
  assertion in `outstandingAgentRequest.test.ts` pass.

### Teardown

Server (`:8766`) and Vite (`:5273`) killed and both ports confirmed free;
`/tmp/ui076-ws` and the scratch driver under `test-results/` removed. Nothing was
run on 5173 or 8765.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + `tsc --noEmit` over the touched files)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
