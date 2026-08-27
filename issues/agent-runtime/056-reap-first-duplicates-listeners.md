# [AGENT-056] Reaping before reading the roster duplicates a working listener

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: AGENT-055 (the `working` field this rule turns on), SERVER-157 (where
  `working` comes from), SERVER-152 (the removal that makes starvation total)

## Spec References

- SPEC.md §7 — lanes, presence, and the orchestrator's launch duty
- SPEC.md §7, rider A — *"a listener is started when its lane has something
  pending and none is running"*

## Summary

**User report, 2026-08-27:** _"Reap does not check for subagents already
running, so it duplicates them."_

The orchestrate skill's loop reaped first and read the roster second, and its own
text said why: *"reap first, and the roster you read afterwards is telling the
truth about what is being done."*

**That is true only for a lane whose listener is gone.** `working` is derived
from held work (`SELECT DISTINCT lane FROM events WHERE status = 'in-progress'`),
so `corpus queue reap-stale` strips it from a resident that is **alive and
mid-turn** exactly as it does from one that died. After the reap that lane reads

```
not live · not working · 1 waiting
```

which is precisely the launch condition — and a second listener starts on a
conversation that already has one thinking. Any turn longer than the stale
window (15 minutes) is duplicated, every pass, for as long as it runs.

## Why the fix is a reordering and not a new field

The skill already has the right field. `AGENT-055` added `working` for this exact
failure and its note says so: *"a resident works its conversation inline and
holds no park while it does, so a turn longer than the grace window reads exactly
like a dead lane."* The loop then destroyed the field one step before consulting
it.

Reading the roster **before** the reap makes every case come out right:

| lane | reads | outcome |
| --- | --- | --- |
| resident alive, mid-turn | `working` | left alone — correct |
| listener died holding work | `working` | left alone **one pass**; reaped below, launched next pass |
| work never claimed (crash before claim, or restart) | `not working · waiting` | launched at once — correct |

The only cost is one pass of delay for a listener that died while holding an
event. By the skill's own asymmetry argument — a wasted session against an
unanswered conversation — that is the cheap side of the trade.

## What this issue does **not** decide

Whether `corpus queue reap-stale` should touch a **resident** lane's held work
at all. Its docblock argues for lane-blindness ("scoping the reaper would leave a
dead resident's work unrecoverable by the one agent still running"), and
answering that is a §7 question about who may recover a resident's work — the
same question the rider signed 2026-08-25 answered for *claiming*. Filed as
`SHARED-074`, not guessed at here.

## Acceptance Criteria

- [x] The loop reads the roster **before** it reaps, and says why
- [x] The batched head runs in the new order
- [x] The paragraph that argued for reap-first is corrected rather than deleted —
      it names the old rule, and what is wrong with it
- [x] The one-pass cost for a crashed listener is stated, not hidden
- [x] `scripts/workspace-template.test.ts` pins the new order and the corrected
      reasoning

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — steps 2 and 3, the
  batch, and the `working`-is-not-presence paragraph
- `scripts/workspace-template.test.ts` — the assertions over all three

## Testing Strategy

The template test asserts the skill's prose. It pinned the old order and the old
reasoning, so both had to move with the text — which is the point of pinning
them.

## E2E Verification Log

**Implemented on: opus.** Prose, so the verification is the reasoning and the
pinned assertions. The mechanism was established by reading, not by waiting 15
minutes for a real duplication:

- `WORKING_BY_LANE_SQL` selects `status = 'in-progress'`, so `working` is exactly
  "this lane holds claimed work".
- `reapStale` moves held events to `pending/` after `DEFAULT_STALE_AFTER_MS`
  (900_000 — fifteen minutes) with no reference to any listener, and its own
  comment says the consequence out loud: *"a lane that was reported as working
  stops being."*
- The skill's launch rule fires on `not live · not working · pending > 0`.

Those three compose into the duplication with no gap in the chain.

## Completion Checklist (domain agent)

- [x] Tests pass
- [x] Lint and typecheck clean
