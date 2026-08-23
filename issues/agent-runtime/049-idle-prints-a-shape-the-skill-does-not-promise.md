# [AGENT-049] The orchestrate skill promises idle a shape the CLI prints only under --json

## Domain
agent-runtime

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — parking and the idle verb
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

`assets/workspace/claude/skills/orchestrate/SKILL.md` states, in "The loop":
*"When its ~8-minute window expires with nothing pending it prints
`{"idle":true,"reason":"timeout"}`"* and *"prints `{"idle":true,"reason":"halted"}`"*
while halted. Measured against the shipping CLI (SHARED-070 audit, 2026-08-23):

- human mode prints `idle — no events (timeout)` and `idle — no events (halted)`
- only `--json` prints `{"idle":true,"reason":"timeout"}`

The skill's examples run `corpus queue idle` bare, so the loop it teaches will
never see the string the skill tells it to expect. An agent branching on the
promised shape misreads a normal timeout. (`claim-all` is different and fine:
it really does print one JSON payload in both modes, as its skill text says —
verified.)

## Acceptance Criteria
- [ ] The skill's two idle-output claims match what the shipping CLI prints in
      the mode the skill's own examples use. Either quote the human strings, or
      have the examples pass `--json` — one of the two, consistently.
- [ ] The arrival-notification return (`evt_… comment.created`) is described
      accurately too if the section is touched.
- [ ] No CLI change — this is skill text. If the fix is judged to belong on the
      CLI side instead (print JSON in both modes like `claim-all`), escalate to
      the orchestrator rather than widening this issue.

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — "The loop" and HALT
  sections

### Key Implementation Details
Measured outputs to quote: `idle — no events (timeout)`,
`idle — no events (halted)`, and on arrival `evt_rwjm6utsiqpc comment.created`
(one line per pending event).

### Edge Cases
- The converse skill may carry the same promise for its scoped idle — check and
  fix in the same pass if it does.

## Testing Strategy
None beyond re-reading — prose fix. The workspace-template drift test (AGENT-059's
class) covers verb existence, not output shapes.

## E2E Verification Plan
Run `corpus queue idle --wait 3` bare and with `--json` in a scratch workspace;
compare against the revised text.

### Verification Steps
1. Scratch workspace, server up, empty queue
2. `corpus queue idle --wait 3` → `idle — no events (timeout)`
3. `corpus queue idle --wait 3 --json` → `{"idle":true,"reason":"timeout"}`
4. Expected: the skill text quotes whichever the loop actually runs

## E2E Verification Log
_Filled in by the implementing agent._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
