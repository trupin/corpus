# [CLI-078] The verbs that end a pass read as endings, so the loop stops there

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: AGENT-065 (the converse change that relies on this reminder existing)
- Related: INFRA-039 (the rehearsal scenario that measures whether this worked),
  AGENT-064 (an event settled without the reply it was claimed to write)

## Spec References

- SPEC.md **§7** — the event queue and the agent loop; parking is presence
- SPEC.md **§2.3** — one registry, self-documenting

## Summary

Reported from live use, 2026-09-05: *"subagents keep stopping although the skill
is meant to keep the agent alive."*

**A listener stays alive only because it decides to park again.** A Claude Code
Task subagent lives exactly as long as it keeps calling tools. No runtime loops
it. So a resident running `converse` survives one more pass only if the model
chooses, on that pass, to call `corpus queue idle --thread <id>` once more.

Here is what the model reads immediately before making that choice
(`apps/cli/src/commands/queue/transitions.ts:27`):

```
event evt_7c1d9a is complete.
```

That is the last line a listener sees after finishing a turn and settling. It is
the most terminal string the CLI prints, it arrives exactly at the decision
point, and it says nothing about what comes next. The instruction that should
override it — `Then repeat from step 1` — sits at line 325 of a 1,600-line skill,
roughly 13K tokens back by the time a listener has done real work.

The same holds for the orchestrator's own loop, whose step 9 ends on the same
three verbs.

## What to build

**Every verb that can end a pass names the next step of the loop.**

| Verb | Today | Adds |
| --- | --- | --- |
| `queue complete` | `event evt_x is complete.` | the next step: park |
| `queue fail` | `event evt_x is failed.` | the next step: park |
| `queue defer` | `event evt_x is abandoned.` | the next step: park |
| `queue idle` — timeout or halted | `idle — no events (timeout)` | the next step: park again |
| `queue idle` — events | one line per event | these are pending, not claimed: claim, work, settle, then park |

The loop becomes self-describing **at the point of use**, rather than only at the
top of a document the agent read once.

## Why this belongs in the CLI and not only in the skill

Stated because it is a fair objection. Telling an agent what to do next looks
like skill territory.

1. **The decision point is the only place the reminder can land.** A skill is
   read once, at the start. The tool's output is read at the moment of the
   choice, every time. Nothing else in the system occupies that position.
2. **The CLI already does this.** `queue idle`'s own help says *"so the
   orchestrate skill's loop simply re-invokes it — a timeout is not an error."*
   The registry already names the skills and already describes the loop. This
   moves one sentence from the help, which is read rarely, to the output, which
   is read every pass.
3. **It costs about 15 tokens a pass**, against a 42K-token skill read once and a
   listener whose alternative is dying and being relaunched.

## What it must not become

- **Not a lecture.** One short line. The verb reports an outcome and names the
  next step. It does not restate the loop, and it never grows a second sentence.
- **Not on stdout under `--json`.** The agent loop parses stdout. The line goes
  to **stderr** in human mode and to a field under `--json`, exactly as the
  `inProgress` block already does (`claim-all` and `idle` both).
- **Not a claim that the caller is in a loop.** These verbs are also run by a
  person at a prompt and by scripts. Word it as what the loop's next step is, not
  as an instruction the caller is presumed to be under.
- **Never printed where stopping is correct.** A scoped park on a released lane
  is the server's `422` and exit **5**, not a timeout, so no reminder is reached
  on the retirement path. That falls out of the existing control flow and a test
  must pin it.

## Acceptance Criteria

- [x] `queue complete`, `queue fail` and `queue defer` each print the outcome line
      unchanged on stdout, plus one next-step line on **stderr**.
- [x] `queue idle` prints a next-step line on **stderr** for the timeout, the
      halted and the events outcomes, and the three lines differ: the events one
      says the events are **pending, not claimed**.
- [x] Under `--json`, stdout is **byte-identical to today** plus one additive
      field. No existing key changes name, type or value.
- [x] `{"idle":true,"reason":"timeout"}` keeps those two keys exactly — `idle.ts`
      records that the converse loop depends on that shape being stable.
- [x] A `--thread` park refused with `422` prints **no** next-step line and exits
      5.
- [x] Every next-step line is one line and at most 120 characters. Measured: 102,
      107, 110 and 106.
- [x] `docs/cli.md` regenerates cleanly.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/queue/next-step.ts` — new. The lines, in one place, so
  the five call sites cannot drift into five wordings.
- `apps/cli/src/commands/queue/next-step.test.ts` — new.
- `apps/cli/src/commands/queue/transitions.ts` — the three settling verbs.
- `apps/cli/src/commands/queue/idle.ts` — the three outcomes.
- `docs/cli.md` — regenerated.

### Key Implementation Details

**The scoped and unscoped forms need different lines.** A listener's next park is
`corpus queue idle --thread <id>` and the orchestrator's is `corpus queue idle`.
The settling verbs take an event id and **no lane** (`transitions.ts`), so at the
moment of settling the verb does not know which loop it is in. Decide how to
resolve that and record it. Three options, in order of preference:

1. Word the line so it is true of both — name the verb without the flag, and let
   the caller supply its own lane. Cheapest, and it cannot be wrong.
2. Read the event's lane from the response the verb already has.
3. A flag the caller passes. Rejected unless the first two fail: a reminder that
   depends on the caller already remembering is not a reminder.

**Decision recorded 2026-09-05 (implemented on opus): option 1.** The settling
line is

> `next step in the loop: park for the next event with `corpus queue idle`, on
> the lane you claimed from.`

It names the verb without a flag and says _the lane you claimed from_, which is
true of the resident's loop and of the orchestrator's and cannot be wrong under
either. Option 2 was declined as more machinery than a fifteen-token reminder
earns, and it would still have needed a wording for the orchestrator's unscoped
case. Option 3 was declined outright, on the issue's own reasoning.

**Second decision: `--wait 0` gets no line, on either stream and in `--json`.**
The recommendation is taken. A probe is a single non-blocking question a script
asks, not a park, and its caller is not in the loop these lines describe. So the
probe's payload stays exactly `{"idle":true,"reason":"timeout"}` — one fewer
shape for the converse loop's readers to account for — and a script polling in a
tight loop pays nothing for prose it cannot use.

**Third decision: the additive field is one key on the value already emitted**,
named `nextStep`. The settling verbs emit the `QueueEvent` verbatim, so the key
lands on the event object rather than in a new envelope: an envelope would move
`.id`, which is what every existing caller reads. The key is appended last, so
the emitted JSON is the previous bytes with one key added before the closing
brace.

**Fourth decision: the three settling verbs share one constant.** What follows a
settle is the same park whichever way the work ended, and three wordings of one
step is exactly how three call sites drift. `queue defer` takes the same line:
deferring ends a pass as much as settling does, and the event returns by itself,
so nothing is owed to it.

### Edge Cases

- `--no-color`, and stderr not being a TTY. The line is plain text either way.
- A settling verb that **fails** (unknown event, wrong state). No next-step line —
  the caller has an error to deal with first.
- `queue idle --wait 0`, the non-blocking probe. It is not a park, so decide
  whether it gets a line. Recommendation: no. A probe is a script's verb.
- `corpus batch` entries. The settling verbs are ordinary entries, so the line
  appears per entry on stderr. Confirm that does not corrupt the batch report.

## Testing Strategy

Vitest, colocated, against the stub server.

- Each of the five call sites emits its line on stderr and nothing extra on
  stdout.
- A snapshot of `--json` stdout for all five, asserted against the current shape
  plus the one new field.
- The `422` park emits no line — assert the **absence** on stderr, not just the
  exit code.
- The five lines all come from `next-step.ts`, asserted by a test that imports the
  constants rather than re-typing them.

## E2E Verification Plan

### Reproduction Steps

1. Start a real workspace and designate a resident on a standalone thread.
2. Post two messages to that conversation, several minutes apart.
3. Watch `corpus agents` across the gap.
4. Expected: the lane reads `live` throughout, one listener answers both.
5. Actual (as reported): the lane stops reading `live` after the first answer, and
   the second message waits for the orchestrator to relaunch a listener.

**Record this before changing anything.** The issue is a behaviour claim about a
model's choices, and a fix with no before is a fix with no evidence.

### Verification Steps

1. `npm run build && corpus server restart`.
2. `corpus queue complete <id> 2>/dev/null` — stdout unchanged.
3. `corpus queue complete <id> 1>/dev/null` — the next-step line alone.
4. `corpus queue idle --wait 5 --json` — the additive field present, the two
   existing keys unchanged.
5. Repeat the reproduction above and record what happened.

**State honestly what step 5 proves.** This is prose in a tool's output, and prose
raises the odds rather than guaranteeing an outcome. One good run is not evidence
the defect is gone. INFRA-039 is where it gets measured over repeated runs, and
this log should say so rather than claiming more than one run can carry.

## E2E Verification Log

Implemented on: **opus**.

### Reproduction (bugs only)

**What was reproduced, and what was not — stated plainly, because the two are
different claims.**

The **stimulus** was reproduced exactly. On a real scratch server (port 8972), a
settle prints one line on stdout and, before this change, nothing at all on
stderr:

```
$ corpus queue complete evt_dcbbwatfdpxo --from agent 2>/dev/null
event evt_dcbbwatfdpxo is complete.
```

That is byte for byte what a listener read at its decision point in 0.32.0 — the
stdout half is unchanged by this issue, and the empty stderr half is what the
pre-change `transitions.ts` produced, since it made no `out.note` call at all.
The repository's own pre-existing tests pin both halves
(`transitions.test.ts`'s `expect(harness.stdout()).toBe("event evt_1111 is
complete.\n")`, with no stderr assertion because there was nothing to assert).

The **behaviour** — a Claude Code Task subagent choosing to stop rather than park
again — was **not** reproduced, and no scratch workspace can reproduce it on
demand. It is a claim about what a model decides after reading a string, it needs
a live resident and a real conversation with a gap in it, and one run either way
would prove nothing. INFRA-039 is the rehearsal that measures it over repeated
runs. This log does not claim more than it saw.

### Post-Implementation Verification

Real binary (`node apps/cli/dist/bin/corpus.js`, built from this branch) against
a real server: scratch workspace on port **8972**, `corpus init` then
`corpus server start` (pid 14297), stopped at the end with the port confirmed
free. The user's server on 8765 was never touched. Events were produced the way
the product produces them — an agent-requesting comment on a real thread — then
claimed with `corpus queue claim-all --from agent`.

**1. The stream separation, shown by redirecting one stream at a time.**

```
$ corpus queue idle --wait 1 2>/dev/null
idle — no events (timeout)

$ corpus queue idle --wait 1 1>/dev/null
next step in the loop: nothing arrived, so park again with `corpus queue idle` — a timeout is not an error.
```

Stdout carries the outcome and nothing else. Stderr carries the line and nothing
else.

**2. All three settling verbs, each on a freshly claimed event.**

```
$ corpus queue complete evt_… --from agent 2>/dev/null
event evt_… is complete.
$ corpus queue complete evt_… --from agent 1>/dev/null
next step in the loop: park for the next event with `corpus queue idle`, on the lane you claimed from.

$ corpus queue fail evt_… --from agent --reason "the rate sheet was unreachable" 2>/dev/null
event evt_… is failed.
$ corpus queue fail evt_… --from agent --reason "…" 1>/dev/null
next step in the loop: park for the next event with `corpus queue idle`, on the lane you claimed from.

$ corpus queue defer evt_… --from agent --blocked-on doc_xm62f3jc 2>/dev/null
event evt_… is deferred on doc_xm62f3jc.
$ corpus queue defer evt_… --from agent --blocked-on doc_xm62f3jc 1>/dev/null
next step in the loop: park for the next event with `corpus queue idle`, on the lane you claimed from.
```

**3. `queue idle` returning work says the events are pending, not claimed.**

```
$ corpus queue idle --wait 2 2>/dev/null
evt_dcbbwatfdpxo comment.created
$ corpus queue idle --wait 2 1>/dev/null
next step in the loop: these are pending, not claimed — `corpus queue claim-all`, work, settle, then park.
```

**4. `--json`: one additive key, and the two keys the converse loop depends on
unchanged.**

```
$ corpus queue idle --wait 1 --json
{"idle":true,"reason":"timeout","nextStep":"next step in the loop: nothing arrived, so park again with `corpus queue idle` — a timeout is not an error."}

$ corpus queue complete evt_e4et6ulz6idw --from agent --json
{"id":"evt_e4et6ulz6idw","type":"comment.created","created":"2026-09-05T21:04:44Z","source":"thread","payload":{…},"nextStep":"next step in the loop: park for the next event with `corpus queue idle`, on the lane you claimed from."}
```

`{"idle":true,"reason":…` opens both timeout payloads exactly as before, and the
event's own keys are untouched with `nextStep` appended last.

**5. The `--wait 0` probe prints no line, on either stream.**

```
$ corpus queue idle --wait 0 2>/dev/null
idle — no events (timeout)
$ corpus queue idle --wait 0 1>/dev/null      # nothing at all
$ corpus queue idle --wait 0 --json
{"idle":true,"reason":"timeout"}
```

**6. Where stopping is correct, nothing tells the caller to park.** A scoped park
on a thread that designates nobody:

```
$ corpus queue idle --thread th_xx5spuft --wait 1 --from agent 1>/dev/null
corpus: 422 unknown_recipient: `th_xx5spuft` names no lane to consume: …
$ echo $?
5
```

The error is the only thing on stderr. Asserted as an **absence** in
`idle.test.ts` too, not merely by the exit code.

**7. A refused settle prints no line either.**

```
$ corpus queue complete evt_dcbbwatfdpxo --from agent 1>/dev/null
corpus: 409 conflict: queue event evt_dcbbwatfdpxo is already processed
$ echo $?
5

$ corpus queue fail evt_… 1>/dev/null
corpus: `corpus queue fail` requires --reason <text>.
  Say why the work could not be done — …
$ echo $?
2
```

**What one run proves, and what it does not.** Everything above is a mechanical
claim about output and streams, and it is proved: the lines exist, they are on
stderr, stdout is unchanged, `--json` gained exactly one key, and the two paths
where stopping is correct print nothing. The issue's *motivating* claim — that a
listener is more likely to park again — is prose in a tool's output, and prose
raises odds rather than guaranteeing an outcome. No run in this log is evidence
that the reported defect is gone. **INFRA-039 is where that is measured, over
repeated runs**, and this log claims nothing that a single run cannot carry.

**Batch.** The line rides `out.note`, which a nested output forwards to the
parent's stderr and never into the entry's captured value or lines. A test in
`next-step.test.ts` drives `createNestedOutput` directly and pins that the batch
report is byte-identical with the note present.

**Docs.** `npm run docs:cli -w apps/cli` regenerated `docs/cli.md`; a second run
produces an identical file and `npx prettier --check docs/cli.md` passes.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E log carries a **pre-fix reproduction**, per the SDLC's bug rule — of the
      stimulus, with the behavioural half explicitly marked as not reproducible
      on demand
- [x] The log states what one run does and does not prove
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0 — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-078]` prefix
