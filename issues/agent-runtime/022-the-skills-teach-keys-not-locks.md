# [AGENT-022] The skills teach keys, and stop teaching locks

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CLI-038

## Spec References

- SPEC.md **§7** "A key, not a lock", and the orchestrator-skill invariants

## Summary

The instructions that made the old mechanism forgettable.
`assets/workspace/claude/skills/orchestrate/SKILL.md` tells the agent to run
`corpus lock acquire` in four places (lines 39, 745, 777, 781). Those verbs will
not exist.

This is product code — the skills `corpus init` installs into a user's workspace —
and it is the half of SHARED-041 that decides whether the agent behaves well or
merely cannot misbehave.

## Acceptance Criteria

- [ ] Every `corpus lock` reference is gone from `assets/workspace/`. Grep, do
      not remember: the SPEC sweep for this rider found four references the plan
      had missed
- [ ] The skill teaches the key discipline as a **loop**, not a rule to recall:
      read → work → write with the key you were given → keep the key the write
      returned. The old text failed because it asked for an extra action; the new
      text should describe the ordinary path, with no extra action in it
- [ ] The skill says what to do on a `409`, concretely: re-read, reconcile what
      changed against what you meant, write again. Not "handle the error"
- [ ] The **advisory signal** is taught as a courtesy with a named response: if a
      person has a session open, prefer to defer the event (`corpus queue defer
      --blocked-on`) over writing beside them. §7 makes this politeness rather
      than a gate — the skill should not imply the write would be refused
- [ ] "Never force a lock" and the `corpus lock reap` recovery advice are removed
      rather than reworded. There is no recovery path because there is nothing to
      wedge
- [ ] The comment skill gets the same pass — it also writes documents

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/comment/SKILL.md`

### Notes

- Existing workspaces get these through `corpus workspace upgrade` (§2.4), which
  three-way merges and **will not overwrite a skill the user edited**. Say in the
  log what an unmerged workspace experiences — an agent following old
  instructions against a CLI that no longer has the verb.

## Testing Strategy

The skills are documents, so the test is the sweep plus a read-through against
the CLI's actual surface: every command the skill names must exist.

## E2E Verification Plan

`corpus init` a scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, and walk the loop the skill
describes, command by command, against a real server on a free port (**never
8765 or 5173**). A skill that names a flag the CLI does not have is a failure.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
