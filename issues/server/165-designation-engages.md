# [SERVER-165] Designating a thread engages it

## Domain

server

## Status

done — 2026-09-06, evaluator PASS, committed on phase-58

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-078 (the decision — made 2026-09-06); the §7/§8 rider
  below — **signed by the user 2026-09-06**, quoted verbatim in the release
  /goal, applied to SPEC.md §8 the same day with a §7 cross-reference
- Blocks: AGENT-070

## Spec References

- SPEC.md **§7** — designation; **§8** — participation is opt-in per comment

## Summary

SHARED-078's decision, chosen by the user 2026-09-06: **designation engages.**
Designating a thread sets `agent: engaged` on it, server-side, in the same
write as the designation — so every plain turn thereafter enqueues on the
resident's lane. Release and resolve return the thread to the ordinary opt-in
state. No contract change: `agent` is an existing field and designation is an
existing route.

## The rider — signed 2026-09-06, applied to SPEC.md

To follow §8's opt-in rule (and be cross-referenced from §7's designation
text):

> **Designating a conversation engages it.** §8's opt-in rule is about the
> ordinary agent, where silence is the point. A designation is the person
> saying somebody owns this conversation, and handing it over is the opt-in:
> the server sets the thread engaged in the same act that designates it, so a
> plain message to a designated conversation reaches its resident without a
> mention. Releasing the resident returns the **lane** to ordinary routing and
> reverts nothing on the thread: engagement is already sticky under this
> section's own rule — an engaged thread stays engaged until it is resolved —
> so the conversation keeps being answered, by the ordinary agent now, which
> is what a person releasing a resident but not closing the conversation is
> asking for. Resolving the thread ends both, exactly as it always has. A
> person who wants a silent owner releases the resident and resolves the
> thread, which is the cost this trade accepts and states.
> _(Rider signed 2026-09-06.)_

## Acceptance Criteria

- [x] The rider above (or the user's revision) is signed and applied before
      the behaviour lands — never after (signed and applied 2026-09-06)
- [x] Designating (any surface: Ask, thread control, re-designation) sets
      `agent: engaged` in the same server write and same commit
- [x] Release reverts nothing on the thread — `agent: engaged` persists under
      §8's ordinary stickiness and plain turns route to the orchestrator's
      lane; resolve ends engagement via its existing cascade (settled at
      review 2026-09-06, PR #74 finding 3: the pre-designation-restore
      reading loses the edge where a thread was engaged before designation)
- [x] A plain user turn on a designated thread enqueues on the resident's
      lane — verified E2E with a real listener answering an unmentioned message
- [x] `resident.designated` / `resident.released` payloads unchanged (the
      lane semantics carry it; nothing new travels)
- [x] Rehearsal scenario 10's seeding no longer needs the `@agent` workaround
      its E2E logs record — update it to a plain follow-up and note the change
      (**answered by O1 below**: the follow-up was already plain and stays so;
      the seed's `--requests-agent true` stays, and the file now records why)

## Open question O1 — does designation-engages make the *creating* turn enqueue?

**Answer: no.** The creating turn does not enqueue on the strength of the
designation. It enqueues exactly when §8's existing opt-in signals say so —
`requestsAgent: true`, an `@agent` or `@<subagent>` mention, or a `/<skill>`
directive.

**The ordering, stated explicitly**, since the question asks for it:

1. `designationFor()` resolves the designation the request makes.
2. `decideParticipation({ thread: null, … })` decides the enqueue. `thread` is
   `null` because the thread does not exist yet, and `shouldEnqueue` returns
   `false` for `thread === null` **before** §8's engaged clause is reached.
3. The thread file is written with `resident:` and `agent: engaged` in one
   frontmatter, one commit.
4. `resident.designated` is enqueued, only when the creation also enqueues work.
5. `comment.created` is enqueued, per step 2's decision.

So the designation is written **with** the turn, and the turn's enqueue decision
never reads it. The reading is not a preference — two of the spec's own rules
break under the other one:

- **§8's opening line.** *"A plain comment is a passive note: it appends a turn
  and does not enqueue an event. Human-only threads are normal."* §7's rider A
  designates a general resident on **every** new standalone thread. If the
  creating turn enqueued because of that designation, every `corpus thread
  create` would enqueue, and §8's opening line would hold for no standalone
  thread in the workspace.
- **§7's rider A, laziness clause.** *"The designation costs nothing until there
  is work. A listener is started when its lane has something pending and none is
  running, not when the thread is created."* An enqueue per creation is a
  listener per conversation, which is the cost that clause exists to refuse.

The rider's own words agree: it says *"a plain message **to a designated
conversation**"*, and §8's clause it rides on says *"every **later** turn"*. The
first message is posted with the conversation, not to one that already exists.

**Consequence for the sixth criterion.** Rehearsal scenario 10's create keeps
`--requests-agent true` and its `thread.eventId !== null` assertion still holds.
What the scenario gains is that its follow-up's omitted `requestsAgent` no
longer depends on the agent having replied first — the thread is engaged from
its designation. Both facts are now written into the file.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), server-dev, 2026-09-06.**

Real workspace at `…/scratchpad/e2e165`, created with `corpus init`, server
started with `corpus server start` (pid 24783, port 8767 — never 8765), driven
with the real CLI and real HTTP. Server stopped and port freed afterwards.

**1. A plain `corpus thread create` engages the thread and enqueues nothing**
(O1's answer, on a real server):

```
$ corpus thread create --title "Herb planter" -m "Which herbs grow well together in one planter box?" --json
{"thread":{"id":"th_w27fmpn6",…,"agent":"engaged",
 "resident":{"name":null,"docId":null,"weight":null,"designationId":"des_n3b5mxycrixc"},…},
 "anchorId":null,"eventId":null,"warnings":[]}

$ corpus queue status --json
{"agent":{"live":false,…},"halted":false,"pending":0,…}
```

The file on disk carries both keys:

```
agent: engaged
origin: null
resident:
  name: null
  docId: null
  designationId: des_n3b5mxycrixc
```

**2. A real listener answers an unmentioned message on the designated lane**
(the mandatory proof). A listener parked on the lane first:

```
$ corpus agents --json
… {"lane":"th_w27fmpn6","resident":{…},"live":true,"since":"2026-09-06T15:41:35Z",…}
```

Then the person posted a turn with **no mention, no skill directive and no
`requestsAgent`**:

```
$ corpus thread reply th_w27fmpn6 -m "And which of those should be kept out of full afternoon sun?" --json
… "eventId":"evt_4hgopdyhokc4" …
```

The parked `queue idle --thread th_w27fmpn6` returned at once with that event,
and the event file on disk is stamped with the resident's lane:

```
{"id":"evt_4hgopdyhokc4","type":"comment.created",…,
 "payload":{"threadId":"th_w27fmpn6",…,"mentions":[],"skills":[],"unresolved":[]},
 "lane":"th_w27fmpn6","seq":1788709307432}
```

The listener claimed it on its own lane and answered in the thread:

```
$ corpus queue claim-all --thread th_w27fmpn6 --json
{"events":[{"id":"evt_4hgopdyhokc4","type":"comment.created",…}],…}

$ corpus --from agent thread reply th_w27fmpn6 -m "Keep the basil and the mint out of full afternoon sun. …"
```

`data/threads/th_w27fmpn6.md` afterwards:

```
## user · 2026-09-06T15:41:10Z
Which herbs grow well together in one planter box?

## user · 2026-09-06T15:41:47Z
And which of those should be kept out of full afternoon sun?

## agent · 2026-09-06T15:42:04Z
Keep the basil and the mint out of full afternoon sun. Rosemary and thyme want all of it.
```

_The listener here is the real CLI loop — park, claim, reply — against the real
server, not a Claude Code subagent. The model half of the loop is rehearsal
scenario 10's and AGENT-070's._

**3. The designate route: both keys, one commit.** A thread created with
`resident: null` (`agent: none`), then designated through
`corpus thread designate`:

```
$ git show --name-only --format="%s" HEAD
resident designate: general resident on Escrow (th_gi4glulz) by user

data/threads/th_gi4glulz.md

$ git show --format= -U0 HEAD
-updated: 2026-09-06T15:42:47Z
+updated: 2026-09-06T15:43:03Z
-agent: none
+agent: engaged
+resident:
+  name: null
+  docId: null
+  designationId: des_c4ahbktlj6jc
```

One commit, one file, both keys inside it.

**4. Release reverts nothing, and the next plain turn routes to the
orchestrator:**

```
$ corpus thread release th_gi4glulz --json
{"thread":{…,"agent":"engaged","resident":null,…},"warnings":[]}

$ corpus thread reply th_gi4glulz -m "Carrying on with no mention at all." --json
… "eventId":"evt_bsc2kb2qyr6c" …

evt_bsc2kb2qyr6c.json:  "type": "comment.created"   "lane": "orchestrator"
```

**5. Payloads unchanged.** The queue holds `resident.designated` and
`resident.released`, both on `"lane": "orchestrator"`, with the same
`{threadId, resident}` and `{threadId, resident, reason}` payloads as before.
No contract file was touched.

**6. `corpus db doctor`** after the run: `{"ok":true,"drift":[],"warnings":[]}`
over 17 documents.

**Tests.** `apps/server/src/threads`, `src/agents`, `src/jobs`, `src/queue` —
40 files, 1104 tests, all passing. `apps/ui/src/console` — 9 files, 218 tests,
all passing. `npm run typecheck -w apps/server` clean. ESLint and Prettier clean
on every touched file.

**Four existing tests changed, each because the behaviour they pinned is the
behaviour this issue changes** — all four used a *standalone* thread as an
incidental fixture for "a thread the agent is not engaged in", which §7's rider
A plus this rider makes unconstructible there:

- `turns.test.ts` — three cases in the §8 matrix now comment on a document,
  which is where the `none` cell still lives.
- `agents/staleness.test.ts` — its plain turn on a designated conversation is
  now "note only", so it stays a turn and nothing else.
- `resident.test.ts` — a legacy hand-written designation re-designated now
  writes, because the engagement is part of the state a designation puts in
  force. Its subject (the `designationId` does not move) is unchanged and still
  asserted, and a new case pins that a designation already in force writes
  nothing at all.

**One discrepancy with the sprint contract, recorded rather than resolved
silently.** TEST-1128 ends *"a plain turn afterwards enqueues nothing until the
thread is reopened"*. That is not what the server does, and it was not what it
did before this issue either: §8's reopen rider (signed 2026-08-05) makes a
**person's** turn on a resolved thread reopen it, after which §8's ordinary
rules apply and an engaged thread re-triggers. The test written here asserts the
true cascade — an **agent's** turn leaves the conversation closed and enqueues
nothing, a person's reply reopens it and enqueues on the **orchestrator's** lane
because resolution released the resident. No new code path was added for
resolution, which is what the criterion is actually about.

## Files changed

- `apps/server/src/threads/resident.ts` — `writeResident` writes
  `agent: engaged` beside `resident:` in one `setFrontmatterFields` call, and
  writes no `agent` at all on a release. `designateResident` splits the old
  `unchanged` into `sameDesignation` (the churn guard, untouched) and
  `alreadyEngaged` (whether the write is needed), so a re-designation of an
  un-engaged thread writes the engagement without displacing its own listener.
- `apps/server/src/threads/create.ts` — a creation that designates writes
  `agent: engaged` in the thread's own frontmatter, and the O1 answer is
  recorded beside the `decideParticipation` call.
- `apps/server/src/threads/participation.ts` — comments only: the third writer
  of `agent`, and why `thread: null` is where O1's answer is enforced.
- `rehearsals/scenarios/10-a-listener-answers-twice.ts` — comments only: why the
  seed keeps `--requests-agent true`, and why the follow-up's omitted flag now
  holds for a stronger reason. No behaviour change, no other file under
  `rehearsals/` touched.
- Tests: `threads/resident.test.ts` (new SERVER-165 block, 11 cases, plus one in
  the SERVER-147 block), `threads/turns.test.ts` and `agents/staleness.test.ts`
  (four existing cases re-based, listed above).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
