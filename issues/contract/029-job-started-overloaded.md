# [CONTRACT-029] `Job.started` means two different instants

## Domain
contract

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §7 (queue and jobs), §8 (the honest pending indicator)

## Summary
Found by UI-058 (2026-08-04), which had to work around it.

`Job.started` carries the event's `created` instant **until the job writes its
first log line**, after which the server records the log's timestamp. So the
field silently changes meaning partway through a job's life: it is "when this was
enqueued" while queued, and "when the agent started talking" afterwards.

The consequence is visible. UI-058 shows how long an agent request has been
outstanding, measured from `started`. A job that sat in the queue for ten minutes
and then began emitting logs would have its elapsed clock **reset** at the moment
the agent started work — the wait did not restart, and a display that says it did
is exactly the dishonesty §8's indicator exists to avoid.

UI-058 bounds the value with the thread's newest turn (a requesting turn can
never be newer than the request), which is correct but is a heuristic standing in
for a field that should just exist.

## Acceptance Criteria
- [x] A job exposes its **enqueue** instant as its own field, distinct from
      whenever work began
- [x] Existing consumers of `started` keep working, or are updated in the same
      change — decide whether `started` is redefined or joined by a sibling, and
      say why
- [x] `apps/ui/src/thread/outstandingAgentRequest.ts` drops its bounding
      heuristic and reads the real field, with the workaround comment removed
- [x] The generated client and `openapi.json` are regenerated, not hand-edited
- [x] The console's job list still shows whatever it means to show — check
      whether it was relying on the post-log meaning

## Technical Design
### Files to Create/Modify
- `packages/contract/src/schemas/` (the Job schema), regenerated artifacts
- `apps/server/src/` job projection / log-timestamp write path
- `apps/ui/src/thread/outstandingAgentRequest.ts` (drop the workaround)

## Testing Strategy
Contract test pinning both instants; a server test where a job is enqueued,
sits, then logs — asserting the enqueue instant does not move.


**Checklist corrected 2026-08-24 (PR #61 review).** The boxes were left unticked while the issue read `done`. The work was finished — the contract half in `373b07b7` and the server half in SERVER-148 — but a record that disagrees with itself is this release's own defect, so it is fixed here rather than after the merge.

## E2E Verification Log

### Implemented on

opus. **Contract half only** — the server and the UI are handed off below.

### Decision: redefined *and* joined, not merely joined

The issue asked whether `started` is redefined or joined by a sibling. Both, and
the reason is that a sibling alone does not fix the defect:

- `enqueued` (new, required) is the event's `created` — the wait's beginning,
  always known, never moved.
- `started` becomes **nullable** and means the first log line alone. Null while
  the job has not spoken.

Adding `enqueued` and leaving `started` as it was would have left `started` still
meaning two instants, and left every consumer deriving "has it begun?" from
`started === enqueued` — a comparison that is wrong for any job whose first line
lands in the same second as its enqueue. Nothing new is computed for either
field: `events.created` and `jobs.started` are two existing columns, and
`jobs.started` is already NULL for exactly the jobs that must read null.

`updated` is unchanged but now describes itself: the most recent log line, or
`enqueued` for a job that has written none.

### Cost, stated rather than discovered later

`started: string` → `string | null` is breaking for a **reader**, not only for a
constructor. That is deliberate — both UI readers were reading the overloaded
value, so a compile error is how they learn it changed.

### Baseline, measured on a real server before the change

Port **8838**, real workspace. `GET /api/jobs?recent=2` returned rows shaped
`{blockedOn, blockedOnTitle, eventId, lastLine, originId, originTitle, started,
status, type, updated}` — no `enqueued`, and `started` non-null on a job that had
written no log line, carrying the event's `created`. That is the overload.

### The published document after the change

From the generated `openapi.json`:

```
Job.required = ['eventId','type','status','enqueued','started','updated',
                'lastLine','originId','originTitle','blockedOn','blockedOnTitle']
Job.properties.enqueued.type   = "string"            (format date-time)
Job.properties.started.type    = ["string","null"]
```

Both keys required; only `started` nullable, so "silent" is a value and never a
missing field.

### Tests

`packages/contract/src/schemas/job.test.ts` — a silent job round-trips with
`started: null` and `updated` back at its enqueue instant; `enqueued` rejects
`undefined` and `null`; `started` rejects `undefined` and accepts `null`; the
three descriptions are pinned to their distinguishing phrases.
`packages/contract/src/openapi.test.ts` — a CONTRACT-029 block against the
**generated** component, including that the two instants do not share one
sentence. The pre-existing `Job.required` pin was updated with a comment saying
why the key list grew.

### Handoff — server

`apps/server/src/jobs/project.ts`, `toJob` (currently
`const started = row.started ?? row.created ?? UNKNOWN_INSTANT`):

- `enqueued: row.created ?? UNKNOWN_INSTANT` — `e.created`, the enqueue instant.
- `started: row.started` — the `jobs.started` column, unchanged and **not**
  coalesced. It is already NULL for exactly the jobs that have written no line.
- `updated: row.updated ?? row.created ?? UNKNOWN_INSTANT` — no longer falls back
  through `started`.

`SELECT_JOBS` already selects both columns. A server test should enqueue, wait,
then log, and assert `enqueued` does not move.

### Handoff — UI

- `apps/ui/src/thread/outstandingAgentRequest.ts`: `startedAt()` (line 92) should
  sort by `job.enqueued`; `agentWaitSince()` (lines ~305–324) **loses its whole
  body** — it becomes `job.enqueued`, and the long docblock explaining the
  newest-not-newer heuristic goes with it, including the paragraph naming this
  issue as the fix. Its `TurnInstant` parameter and every caller passing `turns`
  can go too.
- `apps/ui/src/console/JobDetail.tsx:51` reads `job.started` for a `started …`
  label. It should say *queued* for a job whose `started` is null and *started*
  otherwise — the console was relying on the post-log meaning, so this is the
  "check whether it was" answer: it was, and for a `pending` row it was showing
  the enqueue instant under the word "started".
- `apps/ui/src/testing/readerFixture.ts:671` needs `enqueued`.

`apps/ui`'s typecheck could **not** be trusted from this worktree: with no
`packages/kit/dist` here, `tsc` resolved `@corpus/*` to the main checkout and
reported a false green. The three sites above were found by reading, not by the
compiler.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0. `npm run typecheck -w
packages/contract` — exit 0. `apps/server` typecheck reports exactly one error
from this issue (`src/jobs/project.ts(152,3)`, `enqueued` missing), which is the
forcing function.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [x] Committed with `[ISSUE-ID]` prefix
