# [AGENT-073] The skills still call a weight change a discarded conversation

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-076 (the rider — signed 2026-09-06 and applied to §7)
- Related: AGENT-070 (the same defect for the designation-engages rider)

## Spec References

- SPEC.md **§7**, weight-change rider signed 2026-09-06: a resident's weight
  may be changed by re-designation. What it costs is the released agent's own
  working context, and *"the earlier claim that a running agent cannot change
  what it is 'without discarding the conversation it is holding' was too
  strong"*.

## Summary

Found by AGENT-070's audit (2026-09-06). The signed rider corrects §7, and
the skills still teach the old claim: `converse/SKILL.md` says becoming
another model "would mean discarding this conversation", and
`converse/references/leaving.md` plus `orchestrate/references/launching.md`
carry the same overstatement. Skill text now contradicts signed spec text —
the exact failure family AGENT-070 closed for the other rider.

## What to build

Audit the three files (and any other skill text asserting weight
unchangeability) and correct each statement to the rider's semantics: a
weight change is a re-designation, the conversation survives on disk and the
successor reads it, what is lost is the released agent's working context.
Update `scripts/workspace-template.test.ts` guards. INFRA-038 ratchet binds:
pay for additions with in-place trims, run `npm run skills:check`.

## Acceptance Criteria

- [ ] No skill or reference text claims a weight change discards or forbids
      anything the rider permits
- [ ] The cost that is real (working context) is stated where the old claim
      stood, not deleted into silence
- [ ] Net size change per file recorded; ratchet green
- [ ] `workspace-template.test.ts` pins the new statements

## E2E Verification Log

_Implementing agent fills; state the model._
