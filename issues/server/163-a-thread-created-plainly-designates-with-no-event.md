# [SERVER-163] A plainly created thread gets a resident with no designation event, so its lane can never say what it launched at

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: `UI-186` (which found it), `AGENT-059` (the launch record that never
  gets written here), SHARED-073 (Rider A — a new standalone thread designates a
  general resident)

## Spec References

- SPEC.md **§7** — *"A dispatch says what weight it went out at, and where that
  weight came from"*
- SPEC.md **§7**, rider signed 2026-08-25 — a new standalone thread designates a
  general resident
- SPEC.md **§7**, rider signed 2026-08-27 — *"a lane that cannot be worked says
  so"*, the `lane.waiting` notice

## Summary

Found in `UI-186`'s running-app drill, 2026-09-02, by the implementing agent —
recorded here because it was not anticipated and it is not an edge case:

> a plain `corpus thread create` gives a general resident **with no designation
> event at all**, so a very common lane has never had a launch record

**This is the ordinary path.** Rider A makes every new standalone thread
designate a general resident. If that designation enqueues no
`resident.designated`, then `AGENT-059`'s launch record — the weight the listener
went out at, and whether it was stated or judged — is never written for it, and
there is nothing for any surface to read.

It is the row in the screenshot that prompted `UI-186`: a lane whose weight
column says *"weight set at launch"* and whose launch nobody can name.

## Why it matters

- **It undercuts a promise this release is named for.** v0.32.0 is *"you can find
  out what model did the work"*. For the commonest lane you cannot — not because
  the record was reaped, but because it was never written.
- **The two absences look identical and are not.** A job log is runtime state
  reaped with its event (§7), so "no record" is an expected state for an old
  lane. "No record was ever written" is a different fact, and `UI-186`'s pane
  cannot distinguish them — it reports both as unknown, which is honest and
  unhelpful.
- **A turn still names its model** (§10), so this is not a total blackout. What is
  missing is the *lane's* account of itself, which is what the Residents tab is
  for.

## Acceptance Criteria

- [x] A thread created through the ordinary path either enqueues a
      `resident.designated` for the general resident it designates, **or** the
      absence is deliberate and documented, and the surfaces are told which so
      they can say something truer than "unknown"
- [x] Whichever it is, `UI-186`'s pane can tell "never recorded" from "reaped",
      because they mean different things to the person reading
- [x] No duplicate designation events for a thread that already designates
      explicitly — an event per creation path, not per code path

## The decision, 2026-09-06 (server-dev, Opus 5)

**The absence is deliberate. The ordinary creation path enqueues no
`resident.designated`, and the fix is on the reading side.** The issue's own
"Check before changing" note asked for exactly this call, and the answer is that
the cost is not the one it named.

**1. The event is a launch instruction, not a receipt.** The orchestrate skill
launches a listener on `resident.designated`. Enqueueing one for every created
thread does not cost "a queue item per thread" — it costs **one background agent
per conversation**, which §7's rider A refuses in its own words:

> The designation costs nothing until there is work. A listener is started when
> its lane has something pending and none is running, not when the thread is
> created — so an idle conversation runs no agent, and the number of listeners
> tracks the work outstanding rather than the number of conversations that
> exist.

So the existing gate in `threads/create.ts` — announce the designation only when
the creation also enqueues work for it (SERVER-160) — is rider A's own condition
spelled out, and it stays.

**2. The launch record is not lost by this. It is deferred, and it was
unreachable.** §7's rider signed 2026-08-27 gives a second launch-prompting
event: `lane.waiting`, enqueued on the orchestrator's lane the first time work
lands on a lane whose listener is absent. The orchestrate skill logs its launch
on *whichever* event prompted it — rehearsal scenario 10 already counts launches
on both types. So a plainly created conversation gets its account of itself at
the first moment there is anything to account for.

That record was on the queue and reachable by nobody, which is the real defect
under the reported one. `LaneWaitingPayloadSchema` carries the lane and nothing
else, and `jobs/project.ts`'s `ORIGIN_KEYS` was `["threadId","parentId","docId"]`
— so `lane.waiting` resolved to **no origin**, and `GET /api/jobs?originId=<lane>`
never returned it. `"lane"` is now the last key in that list, so the notice
resolves to the conversation it names. Last on purpose: a lane is *where work
goes* rather than *what it is about*, and the two coincide only for this notice
— every other event carries one of the three keys before it.

**3. The two absences are now different states.**
`apps/ui/src/console/launchRecord.ts` publishes `LaunchAbsence`:

- `never-prompted` — the queue holds no event that would have launched this
  lane. Nothing has ever run here, so there is no record to be missing. This is
  the ordinary state of a plainly created conversation.
- `unrecorded` — such an event is on the queue and its log names no launch:
  reaped with its event (§7), or written by guidance predating AGENT-059.

`residentsModel.ts` says a different sentence for each. `LAUNCH_NEVER_PROMPTED_NOTE`
is *"This lane has not been launched: nothing has been queued on it, so there is
no launch to record. A listener starts when the conversation has work waiting."*
— which is truer than "unknown" and names the one fact a person can act on.

**Duplicates.** `threads/create.ts` is the only place a creation announces a
designation and `threads/resident.ts` is the only other door, so a thread created
with an explicit resident announces once. Pinned by name in `resident.test.ts`.
`sameResident`'s churn guard is untouched — SERVER-165 needed a *second* boolean
beside it rather than a term inside it, precisely so a re-designation asking for
the state in force still displaces nobody.

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts` and `apps/server/src/threads/resident.ts` —
  where a creation designates and what it enqueues
- Whatever `UI-186`'s `launchRecord.ts` needs to tell the two absences apart

### Notes

- **Check before changing.** It may be deliberate: enqueueing a designation event
  for every new thread is a queue item per thread, and someone may have decided
  that cost was not worth paying. If so the fix is on the reading side, not the
  writing side, and this issue becomes a documentation and surface change.
- `resident.ts` already guards against churn — `sameResident` deliberately
  excludes `designationId` so a no-op re-designation does not displace a
  listener. Whatever is added must not defeat that.

**What was actually changed** (see the decision above):

- `apps/server/src/threads/create.ts` — the gate is unchanged; the reasoning for
  it is now written down where a later reader will meet it.
- `apps/server/src/jobs/project.ts` — `ORIGIN_KEYS` gains `"lane"`, last, so a
  `lane.waiting` notice resolves to the conversation it names.
- `apps/ui/src/console/launchRecord.ts`, `useLaunchRecord.ts`,
  `residentsModel.ts` — the launch-prompting job is found by either type, and
  the two absences are two states with two sentences.
- `apps/server/src/threads/resident.ts` — unchanged by this issue.

## Testing Strategy

A server test that the ordinary creation path produces (or documentedly does not
produce) the event, and a `UI-186` component test for the two distinguishable
absences. `INFRA-034` story 2 already reads launch records and would catch a
regression that stopped writing them.

## E2E Verification Log

**Pre-fix observation, 2026-09-02 (ui-dev, Opus 5, during UI-186's drill):** a
real workspace, a plain `corpus thread create`, a general resident in the
thread's frontmatter, and no `resident.designated` on the queue for it.

**Post-decision verification, 2026-09-06 (server-dev, Opus 5 —
`claude-opus-5[1m]`).** Same real workspace as SERVER-165's log
(`…/scratchpad/e2e165`, `corpus init`, `corpus server start`, pid 24783, port
8767 — never 8765). Server stopped and port freed afterwards.

**1. The reported state, reproduced and confirmed deliberate:**

```
$ corpus thread create --title "Herb planter" -m "…" --json
{"thread":{"id":"th_w27fmpn6",…,
 "resident":{"name":null,"docId":null,"weight":null,"designationId":"des_n3b5mxycrixc"},…}}

$ corpus queue status --json
{…,"pending":0,"inProgress":0,"deferred":0,"processed":0,"failed":0,"abandoned":0}

$ ls .corpus/queue/pending/
(only .gitkeep)
```

The thread **is** designated and the queue **is** empty. Those two facts
together are the decision.

**2. The lane's account of itself arrives with its first work, and is now
findable.** A second plainly created thread, no listener parked, one plain
follow-up turn:

```
$ corpus thread create --title "Kitchen shelf" -m "How deep should the shelf be?" --json
… "id":"th_owfg5hjt", "agent":"engaged", "resident":{…} … "eventId":null

$ corpus thread reply th_owfg5hjt -m "And what depth for a jar of flour?" --json
… "eventId":"evt_6wj6s7tmgahe" …

$ GET /api/jobs?originId=th_owfg5hjt
lane.waiting     | lane=orchestrator | originId=th_owfg5hjt | originTitle=Kitchen shelf | status=pending
comment.created  | lane=th_owfg5hjt  | originId=th_owfg5hjt | originTitle=Kitchen shelf | status=pending
```

Before the `ORIGIN_KEYS` change that first row read `originId=null`, so
`GET /api/jobs?originId=th_owfg5hjt` returned one row rather than two — and
UI-186's pane could not see the event its launch record is logged on.

**3. No duplicates.** A creation naming a resident explicitly and asking for the
agent enqueues exactly one `resident.designated` (`resident.test.ts`, *"announces
exactly once for a creation that names a resident explicitly"*). A designation
through the route on a thread already designated to the same resident, already
engaged, writes nothing and commits nothing while still announcing — the
re-announce §7 exists for (`resident.test.ts`, *"writes nothing at all when the
thread is already engaged"*).

**4. `corpus db doctor`**: `{"ok":true,"drift":[],"warnings":[]}` over 17
documents.

**Tests.** `apps/server/src/jobs/project.test.ts` gained *"resolves a
`lane.waiting` notice to the conversation it names"* (with the orchestrator-lane
and unresolvable-lane null cases, and that the key is last).
`apps/ui/src/console/launchRecord.test.ts` and `Residents.test.tsx` gained the
two-absence cases and the `lane.waiting`-carried record. All 218 console tests
pass, and `apps/server/src/jobs` is green.

**One note for the orchestrator.** This issue's Technical Design names
`apps/ui/src/console/launchRecord.ts` as a file to change, and no `ui` agent is
in this sprint's spawn table, so server-dev made that change. It is confined to
`console/launchRecord.ts`, `console/useLaunchRecord.ts`, `console/residentsModel.ts`
and their two tests. `npm run typecheck -w apps/ui` cannot be used as evidence in
this worktree: `react-router` and `@tiptap/*` are absent from the shared
`node_modules`, so `vite build` and `tsc --noEmit` fail there on files this issue
never touched. No error is reported under `src/console/`, and the vitest run is
green.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
