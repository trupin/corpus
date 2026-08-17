# [AGENT-026] Orchestrate learns to share the queue

## Domain
agent-runtime

## Status
done

## Priority
P0

## Model
fable

## Dependencies
- Depends on: [AGENT-025], [CLI-043]
- Blocks: —

## Spec References
- SPEC.md §7 as amended by SHARED-043 — one consumer per lane; the orchestrator's lane

## Summary
Amend the orchestrate skill for a shared queue. Its claim is now the **orchestrator
lane**, not the whole queue: the "only process that claims" language is rewritten to the
per-lane rule, unscoped verbs already mean the orchestrator lane (SERVER-111), and three
new behaviors arrive: route the `resident.designated` event (launch a background subagent
running `/converse th_x` — a long-lived launch, not a job that reports and settles like
comment work); leave live lanes alone; and pick up fallback work from lapsed lanes as
ordinary comment work, with one added courtesy — relaunch the listener.

## Acceptance Criteria
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` routing table gains `resident.designated` → launch a background subagent applying the **converse** skill with the payload's thread id and persona; the event completes when the launch is made (the listener's lifetime is not the job's); a failed launch fails the event with the reason
- [ ] The single-consumer paragraph (SKILL.md:17-27 region) rewritten: one orchestrating session per **orchestrator lane**; residents own their lanes; the console's story is per-lane
- [ ] "Queue state never crosses the boundary" (Delegation) scoped explicitly to the orchestrator's own lane — a resident settling its lane is the design, not a violation
- [ ] Fallback doctrine: an event claimed unscoped that carries a foreign lane stamp (visible in the claim payload per SERVER-111) is worked as ordinary comment work **plus**: log that the lane's listener lapsed, and launch a fresh `/converse` listener for that lane once, not per event
- [ ] Reflection guard extended: the resident's replies are agent turns, so the existing no-self-wake rules (no `--requests-agent`, no `@agent` in bodies) already cover them; state that a resident's `@agent`-quoting hazard lands in the *orchestrator* lane and is triaged there
- [ ] The 10-concurrent-subagents bound restated to exclude resident listeners (they are parked, not working) or adjusted per SHARED-043's decision — whichever the signed rider says, verbatim
- [ ] Skill's `updated` frontmatter bumped; workspace template test still passes

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the amendments
- `scripts/workspace-template.test.ts` — if it asserts on skill content

### Key Implementation Details
Edit surgically — this file is doctrine, and Phase 30's lesson (AGENT-022) applies: the
mechanism works only if the skill text cannot be misread. The launch dispatch line must
state: thread id, the converse skill, the persona from the payload, and that the subagent
is long-lived (the orchestrator never waits on it, never settles for it, and its report —
if one ever comes — is a sign-off, not an outcome to verify). Keep the routing table's
header cells untouched (the composer parses the weight table by them; do not disturb
neighboring parsers).

### Edge Cases
- `resident.designated` for a lane whose listener is already live (re-designation): launch nothing, log why, complete
- Orchestrator restart: designations are frontmatter, listeners are gone — on the first pass, `corpus agents` shows designated-but-lapsed lanes; relaunch each once (this is the recovery path, and it belongs in the loop's opening reap step)

## Testing Strategy
Template test; evaluator runs the behavioral scenarios (designation → listener launched;
lapse → fallback + relaunch; restart recovery).

## E2E Verification Plan

### Verification Steps
1. Real workspace, orchestrator session running `/orchestrate`
2. Designate a standalone thread → within one loop pass a converse listener is live (`corpus agents`)
3. Kill the listener's subagent; post in the thread after the grace window → the orchestrator answers (fallback) and a fresh listener appears
4. Restart the orchestrator session entirely → designated lanes get listeners again on the first pass

## E2E Verification Log

**Model: Opus 5 (1M context)**, agent-runtime-dev, 2026-08-16. Two real workspaces on
free high ports (never 8765 / 5173): `/tmp/corpus-agent026/ws` (9771, mechanism probes)
and `/tmp/corpus-agent026/ws2` (9772, the live drill, scaffolded by `corpus init`
**after** the skill was written so the install path is what put it there). The live loop
was driven by a real Claude Code session (`claude -p`, **claude-fable-5**) given nothing
but the workspace path and "read `.claude/skills/orchestrate/SKILL.md` and follow it".
Transcripts: `/tmp/corpus-agent026/drill.jsonl`, `drill2.jsonl`.

### 1. The `resident.designated` payload, from a real claim

```
$ corpus thread designate th_m6ibx4bd --agent researcher
designated researcher (doc_agentdef9aac2cc9) on th_m6ibx4bd
$ corpus queue claim-all --json
{"events":[{"id":"evt_vakzcgljlpzd","type":"resident.designated","created":"2026-08-17T01:37:29Z","source":"thread","payload":{"threadId":"th_m6ibx4bd","resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9"}}}],"inProgress":{"events":[],"total":0,"truncated":false}}
```

`threadId` and `resident: {name, docId}` — which is what the skill's launch line hands
the listener, and the shape its worked block prints.

### 2. The orchestrator does not take a live lane's work

A listener parked on `th_m6ibx4bd` at 01:37:52. A `@agent` turn posted into that
conversation at 01:37:59, then **both** claims back to back:

```
$ corpus queue claim-all --json          # unscoped — the orchestrator
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
$ corpus queue claim-all --thread th_m6ibx4bd --json
{"events":[{"id":"evt_4ykhvbvursga","type":"comment.created", … "threadId":"th_m6ibx4bd" …}], …}
```

`inProgress` is per-lane, measured the same way: while the resident held
`evt_4ykhvbvursga`, the unscoped claim reported `total: 0`.

### 3. The handover — a lapse, to the second

The listener was killed at **01:38:28** and a message posted into the conversation
immediately after (`evt_lcbwfecjmmko`). A roster poll ran every 20 s alongside an
unscoped claim:

```
01:38:29  th_m6ibx4bd … · live, parked 30s ago      unscoped claim → {"events":[], …}
01:53:54  th_m6ibx4bd … · live, parked 15m ago
01:54:15  th_m6ibx4bd … · lapsed, last parked 16m ago
01:54:15  === roster says lapsed; unscoped claim now ===
{"events":[{"id":"evt_lcbwfecjmmko","type":"comment.created","created":"2026-08-17T01:38:28Z","source":"thread","payload":{"threadId":"th_m6ibx4bd", …}}], …}
```

960 s after the last park, to the poll interval. The same command that returned an empty
batch fifteen minutes running handed the conversation's work over the moment the lane
lapsed — and nothing was written into the event to do it.

### 4. A held row can leave the orchestrator's list mid-flight

With the orchestrator holding `evt_lcbwfecjmmko` (stamped for `th_m6ibx4bd`), a listener
re-parked on that lane:

```
$ corpus queue claim-all --json            # lane still lapsed
{"events":[],"inProgress":{"events":[{"id":"evt_lcbwfecjmmko", … "heldSince":"2026-08-17T01:54:15Z"}],"total":1,"truncated":false}}
$ corpus queue idle --thread th_m6ibx4bd &      # the resident comes back
$ corpus queue claim-all --json            # lane now live
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
$ corpus queue claim-all --thread th_m6ibx4bd --json
{"events":[],"inProgress":{"events":[{"id":"evt_lcbwfecjmmko", …}],"total":1,"truncated":false}}
```

The row moved from the orchestrator's view into the **resident's**, for an event the
resident never claimed — `held.ts` uses the same lane predicate as the claim, deliberately.
Settling still works from either side, so the skill says settlement follows the report and
never the list:

```
$ corpus queue complete evt_lcbwfecjmmko    # from the orchestrator, lane live
event evt_lcbwfecjmmko is complete.   exit 0
```

### 5. The live drill — all four routing outcomes, in one pass

`ws2`: lane A (`th_urc3y6fi`, live, with a pending `@agent` message), lane B
(`th_exycz27r`, lapsed, with a pending `@agent` message), an undesignated thread, and a
`resident.designated` pending for each lane. The session's own roster read at its step 3:

```
orchestrator · waiting for a listener
th_urc3y6fi "Kitchen renovation" · researcher · live, parked 8m ago — idle — last active 8m ago
th_exycz27r "Q3 refinance planning" · researcher · lapsed, last parked 16m ago — idle — last active 16m ago
```

Its unscoped claim took four events — both designations, the undesignated thread's
comment, and **lane B's** comment — and did not take lane A's. Its own settled job log,
read off the server afterwards:

```
$ corpus job list
evt_76o2s7p6obmo processed  completed — replied on th_etfgeirc, created [[doc_qjlsdbod]]
evt_vh3syzafnftg processed  resident.designated on th_urc3y6fi — the roster reads live, so this is a
                            re-designation of a lane already answered; launched nothing
evt_jv2ysd36f4np processed  resident.designated on th_exycz27r — the roster read lapsed at step 3 and a
                            converse listener was already launched from it this pass …
evt_dvc2wlalpaz4 pending
```

`evt_dvc2wlalpaz4` is lane A's message: **still pending at the end of the run**, never
claimed, because its lane was live. The launch it did make carried what the skill asks
for — `/converse th_exycz27r`, the persona name **and** `doc_agentdef9aac2cc9`.

### 6. What the drill falsified in my own text

**The loop's ordering was wrong, and the failure was invisible to reading.** The skill as
first written had the roster read *and its launches* at step 3, before the claim. The
session did exactly that: it launched a listener for lapsed lane B, then claimed lane B's
`evt_zucknlm55zov` under the fallback in the same pass. The listener parked, the lane went
live, and its **first** scoped claim printed:

```
$ corpus queue claim-all --thread th_exycz27r
{"events":[],"inProgress":{"events":[{"id":"evt_zucknlm55zov", … "heldSince":"2026-08-17T02:04:40Z"}],"total":1,"truncated":false}}
the server still holds 1 event in-progress — not claimed by this call:
  evt_zucknlm55zov  comment.created  held 18s  Q3 refinance planning
```

— section 4's mechanism, now pointed at live work. The converse skill's reconciliation is
written for a resident recovering its **own** dropped work and cannot tell that from a
dispatch in flight: the listener read the thread, found nothing answering the turn yet,
did the work, and completed the orchestrator's event. The orchestrator then dispatched the
same event to a comment subagent and had to send it a stand-down mid-flight. Two agents
answered one message; no error was reported anywhere, and both were following their skills
correctly.

Fixed by moving the launches **after** the claim and adding the rule the ordering exists
for — *"per lane, per pass: take the work or launch the listener, never both"*, with the
mechanism stated, since a rewrite that keeps "launch for every unattended lane" and drops
the ordering reintroduces it exactly. Pinned by
`never launches into a lane in the pass it took that lane's work`.

**Re-drilled against the fix** (`drill2.jsonl`) with a discriminating setup: lane A live
*with* pending work, lane D lapsed *with* pending work, lane B lapsed *without*. See §7.

**Two premises in this issue's own acceptance criteria are false, and were measured so:**

- **AC 4 — "a foreign lane stamp (visible in the claim payload per SERVER-111)".** There
  is no lane field on a claimed event and there deliberately never was:
  `packages/contract/src/schemas/queue.ts` says so in as many words (CONTRACT-051) —
  *"Publishing it would put a routing decision in the hands of the party the routing was
  for."* Confirmed against the wire in §1 and §5: every payload above carries `threadId`
  and no lane. So the skill cannot classify an event as foreign, and it must not try:
  the doctrine written instead is **do not audit the claim** — the server already excluded
  every live lane, scope is a walk the agent cannot reproduce, and the courtesy of a
  listener comes from the roster rather than from the batch.
- **AC 6 — "a resident's `@agent`-quoting hazard lands in the *orchestrator* lane".** It
  lands on the lane of the thread it was posted in. An agent turn quoting `@agent` posted
  into a designated conversation:

  ```
  $ corpus thread reply th_m6ibx4bd --from agent --model … -m 'You wrote: "@agent …" — noted.'
  replied to th_m6ibx4bd — turn 2026-08-17T01:38:08Z (queued evt_dyyl6ybhm7te)
  $ corpus queue claim-all --json                        → {"events":[], …}
  $ corpus queue claim-all --thread th_m6ibx4bd --json   → evt_dyyl6ybhm7te
  ```

  It woke the **resident**, invisibly to the orchestrator. The skill says that instead,
  and draws the conclusion the measurement supports: the rule is *write no `@agent`*
  rather than *detect one*, because nothing marks a mention as machine-written.

### 7. Re-drill against the fix

A second live session, same harness, against a setup built to discriminate: `th_urc3y6fi`
**live with pending work**, `th_qwafkh54` **lapsed with pending work** (and a
`resident.designated` of its own in the same batch), `th_exycz27r` **lapsed with none**.
The correct behaviour is now three different answers to three lanes in one pass.

It claimed **before** launching anything, and the claim took lane D's two events and not
lane A's:

```
$ corpus queue claim-all
{"events":[{"id":"evt_incs63u6ui7g","type":"resident.designated", … "threadId":"th_qwafkh54" …},
           {"id":"evt_iymqy7s7b7yr","type":"comment.created", … "threadId":"th_qwafkh54" …}],
 "inProgress":{"events":[],"total":0,"truncated":false}}
```

Then two launches and no third: a comment subagent for `evt_iymqy7s7b7yr`, and a listener
for **`th_exycz27r` only**. Its own job logs, read off the server:

```
evt_iymqy7s7b7yr processed  completed — replied on th_qwafkh54, created [[doc_ngjvih4a]]
evt_incs63u6ui7g processed  no listener launched this pass — this batch took th_qwafkh54's work under
                            the fallback, and per lane per pass it is take the work or launch, never
                            both; the designation stays on the thread and the roster launches it on a
                            later pass
```

The listener it *did* launch shows the collision is gone at its source. Its first scoped
claim — the call that in drill 1 handed it the orchestrator's in-flight event:

```
$ corpus queue claim-all --thread th_exycz27r
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
```

Empty on both lists. No stand-down was sent anywhere in the run, and lane A's
`evt_dvc2wlalpaz4` is **still pending** after two full drills — the orchestrator has now
declined a live lane's work twice, once per session.

The fallback reply itself is the doctrine working: it answered the question, filed
`doc_ngjvih4a`, closed with its trace line, and said nothing about a missing resident —
the lapse is in the job log where the operator is looking, and not in the person's
conversation.

### 8. Tests, lint, typecheck

`scripts/workspace-template.test.ts` — **290 passed** (276 before this issue; 14 added).
The negative guard that carries the change is proved to fire rather than pass vacuously:
run against `git show HEAD:…/orchestrate/SKILL.md` the "only process that claims" pattern
matches (`true`), against the new body it does not.

`prettier --check` clean on both changed files; `eslint` clean; `tsc --noEmit -p
scripts/tsconfig.json` **exit 0** (read from a redirected run, not from the proxy's
stdout). Section structure re-checked with a real CommonMark parser
(`mdast-util-from-markdown`): 16 top-level `##` headings — agreeing with the template
test's own walker — and 20 code nodes, **0** left unterminated.

### 9. What belongs to another issue

- **The converse side of the collision in §6 is not fully closed, and cannot be closed
  here.** This issue's rule stops the *orchestrator* from creating the race. It does not
  stop the other two ways in: a person re-designating a lane, or an operator starting a
  listener by hand, while the orchestrator holds that lane's work under the fallback. In
  both cases the new listener's first claim reports rows it never claimed and its
  reconciliation — *"If nothing answers it, the work did not happen: do it now"* — tells it
  to work them. The converse skill needs a startup rule of its own: a held row older than
  your first claim on this lane is not yours, and reconciliation begins from the first
  claim you actually made. Filed as agent-runtime work; it is a change to
  `converse/SKILL.md`, not to this one.
- **SPEC.md §7 does not say whether a parked resident listener counts against the
  10-concurrent-subagent bound.** SHARED-043's rider makes three rules per lane and says
  nothing about the bound, so there was no signed text to restate verbatim. The skill takes
  the only reading that works — the bound counts subagents *working events*, since counting
  parked listeners would leave a workspace with ten designated conversations unable to
  dispatch at all — and states the reasoning rather than asserting the spec. §7 should
  settle it either way.

### Post-Implementation Verification

Both servers stopped (`stopped (pid 7115)`, `stopped (pid 96396)`); ports 9771 and 9772
confirmed free; every backgrounded park and poller killed and confirmed gone. Nothing was
run on 8765 or 5173 and nothing was written under `/Users/theophanerupin/cos`. The user's
own server (pid 35736) was never touched.

`corpus doc check` clean in both workspaces (18 and 12 documents, no findings), and the
skill installed by `corpus init` is byte-identical to the source in `assets/workspace/`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (AC 4 and AC 6 met against the *measured* behaviour;
      both criteria stated a premise the running server falsified — see E2E §6)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[AGENT-026]` prefix
