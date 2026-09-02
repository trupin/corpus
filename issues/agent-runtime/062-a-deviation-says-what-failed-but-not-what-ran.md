# [AGENT-062] A deviation says what was asked and that it failed, never what ran instead

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: `INFRA-034` story 8, which found it; `AGENT-059` (which made the
  *listener* launch state its provenance — this is the *job dispatch* half)

## Spec References

- SPEC.md **§7** — *"the work is still done, at what the orchestrator judges
  best, and **the deviation is stated**: in the job's log while it runs, and in
  the reply the request receives, naming what was asked for, that it could not be
  met, and what was done instead. Silence there would be the app claiming work it
  did not do."* (rider signed 2026-08-06)

## Summary

Found by the rehearsal suite, 2026-09-02, story 8 of the v0.31.0 pass — **2 runs
of 3 breached**:

> no line on `evt_ymunitvajzc2`'s job log names what ran instead — none of the
> declared levels (light, standard, heavy) appears

**§7's deviation is three statements and the skills produce two.** A request
states a weight the workspace does not declare (`colossal`). The work is done —
that part is right, and story 8 confirms it. The log records the ask and that it
could not be met. **What actually ran is never named**, in the log or anywhere an
observer can read it.

So "which model answered this?" is unanswerable for exactly the case §7 wrote the
rule for. §7 says the reason out loud: *"Silence there would be the app claiming
work it did not do."*

## How it was found, and why it was green before

The first full pass graded story 8 **pass**. Its scorer checked only that the
token `colossal` appeared in a server log line and somewhere in the stored
thread — the first two thirds of the promise. The pr-reviewer caught that on
PR #71: *"'What ran instead' is asserted nowhere (a dispatch line naming the
substituted weight is a checkable fact under rule 4's own standard)."* The
assertion was added, and the very next pass found the gap.

**That is the suite working exactly as designed**, and it is worth recording as
such: a story that asserts two thirds of a rule reports green on a system doing
two thirds of it.

## Acceptance Criteria

- [ ] A dispatch whose stated weight could not be honoured logs **what ran
      instead**, naming a level the workspace's own table declares — never a
      model name written into the skill (SHARED-022)
- [ ] The reply the request receives carries the same third statement, which §7
      requires separately from the log and which outlives it — §7 makes the job
      log runtime state reaped with its event
- [ ] The other two statements are unchanged: what was asked, and that it could
      not be met
- [ ] Guarded in `scripts/workspace-template.test.ts`
- [ ] `INFRA-034` story 8 passes 3/3, which is what will prove it

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the deviation grammar,
  beside the dispatch-line grammar `AGENT-059` already established
  (`stated` / `defaulted` for a launch; this is the job-dispatch equivalent)
- `scripts/workspace-template.test.ts` — the guard

### Notes

- **`AGENT-059` is the model to copy, not to merge with.** That issue made a
  *listener launch* state its weight and provenance. This is the *job dispatch*
  case, and the two grammars are deliberately distinct — do not collapse them.
- Run 3 was clean, so the skills sometimes produce all three statements. The
  rule is being followed by inclination rather than by instruction, which is the
  same shape as `AGENT-041`.

## Testing Strategy

The subject is prose executed by a model, so the proof is `INFRA-034` story 8 at
3/3, plus a template guard that the third statement is asked for by name.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix reproduction, 2026-09-02 (rehearsal pass for v0.31.0, runner sonnet):**
story 8, runs 1 and 2 breached, run 3 clean. Scorecard row and the two findings
are in `rehearsals/scorecard.md` as committed for v0.31.0. Raw records:
`rehearsals/out/2026-09-02T04-29-55.690Z/08-unmeetable-weight.run-{1,2}.json`.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
