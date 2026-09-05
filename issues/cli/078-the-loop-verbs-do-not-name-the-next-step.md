# [CLI-078] The verbs that end a pass read as endings, so the loop stops there

## Domain

cli

## Status

todo

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

- [ ] `queue complete`, `queue fail` and `queue defer` each print the outcome line
      unchanged on stdout, plus one next-step line on **stderr**.
- [ ] `queue idle` prints a next-step line on **stderr** for the timeout, the
      halted and the events outcomes, and the three lines differ: the events one
      says the events are **pending, not claimed**.
- [ ] Under `--json`, stdout is **byte-identical to today** plus one additive
      field. No existing key changes name, type or value.
- [ ] `{"idle":true,"reason":"timeout"}` keeps those two keys exactly — `idle.ts`
      records that the converse loop depends on that shape being stable.
- [ ] A `--thread` park refused with `422` prints **no** next-step line and exits
      5.
- [ ] Every next-step line is one line and at most 120 characters.
- [ ] `docs/cli.md` regenerates cleanly.

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

_Filled in by the implementing agent. State which model it ran on._

### Reproduction (bugs only)

_[Agent fills: the before, with `corpus agents` output across the gap]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E log carries a **pre-fix reproduction**, per the SDLC's bug rule
- [ ] The log states what one run does and does not prove
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0 — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-078]` prefix
