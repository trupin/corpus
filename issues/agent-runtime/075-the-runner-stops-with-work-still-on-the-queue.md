# [AGENT-075] The runner stops with work still on the queue

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: CLI-078 + AGENT-065 (the liveness fix — parked listeners now
  re-park), INFRA-036 (which excludes these runs from scoring), AGENT-074
  (the other family the v0.34.0 pass isolated)

## Spec References

- SPEC.md **§7** — the loop: claim, work, settle, park again

## Summary

The dominant loss in every rehearsal pass since v0.32.0, now cleanly
isolated from the other families: the headless orchestrator session
(`claude -p` running /orchestrate) **ends its own turn while the queue still
holds pending work**. In the v0.34.0 pass's healthy segment, scenario 02
lost 8 of 10 runs to it (each ~165–230s, `ended by exit`), scenario 05 two
of three. The runs that escape it score well — the product behaviors under
test mostly pass when the runner stays alive — so this family is now the
suite's noise floor and the biggest single lever on every k/N.

CLI-078/AGENT-065 fixed the parked listener's liveness. This is the
**orchestrator session's** liveness: the session that should claim or park
instead concludes, and INFRA-036 rightly refuses to score what it cannot
attribute (a skill giving up vs `claude -p` ending its turn).

## What to build

1. Read a sample of cut-short runs' runner transcripts and job state from
   `rehearsals/out/2026-09-06T22-28-18.653Z/` (and the T18 sibling) — where
   in the loop does the session decide it is done? After its first settle?
   Before the first claim?
2. Fix in the orchestrate skill (and/or the CLI's next-step prompts, CLI-078
   style): whatever the session last does, the skill's own loop must make
   "the queue still holds work" the thing it checks before concluding, in
   text that survives the session's context (fresh, near the verbs).
3. Judge on the same instrument: scenario 02's cut-short rate at N=10,
   before and after, same runner model.

## Acceptance Criteria

- [ ] The stopping point is established from real cut-short transcripts and
      named in this issue before anything changes
- [ ] The skill/CLI change lands with the ratchet green
- [ ] A post-fix scenario 02 run at N=10 records its cut-short rate against
      this pass's 8/10, and the issue states what the pair does and does not
      establish

## E2E Verification Log

_Implementing agent fills; state the model._
