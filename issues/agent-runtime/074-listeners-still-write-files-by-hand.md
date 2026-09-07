# [AGENT-074] Listeners still write workspace files by hand

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
- Related: AGENT-064 (bound settling to the reply receipt — this is the
  writing half it deliberately did not bind), SERVER-170 (the mechanical
  backstop for hand-moved queue files)

## Spec References

- SPEC.md **§2/§4** — the server is the sole writer; the agent acts through
  the CLI only

## Summary

Found in the v0.34.0 release rehearsal pass (2026-09-06, runner sonnet).
`user`-authored commits — the watcher committing bytes a running agent wrote
directly into workspace files — appear across many runs, including **clean,
scored runs**: scenario 06 run 1 (641s, ended by quiescence) carries
`commit 48c1178065 authored "user <user@corpus.local>"`, and scenario 11
run 10 additionally left the corpus failing `corpus doc check` (exit 6).
AGENT-064's settle gate landed in the same tree, so the residue is the
**writing** path: the gate binds how an event settles, not how an agent
touches files.

## What to build

Reproduce first from the raw records
(`rehearsals/out/2026-09-06T22-28-18.653Z/`, gitignored — read them before
they are lost, or reproduce live): read the flagged commits' diffs to learn
WHAT the agents hand-wrote and in which skill's care they were acting. Then
close the writing path in the skills the way AGENT-064 closed the settling
path — whatever act the agent was attempting has a CLI verb, and the skill
names it where the temptation arises. Mind the INFRA-038 ratchet and the
workspace-template wording pins.

## Acceptance Criteria

- [ ] The flagged commits' content is read and the hand-written acts are
      named in this issue before anything changes
- [ ] The skills close the identified writing paths; additions paid by trims
- [ ] A later full pass shows the `user`-authored-commit universal finding
      only in its excluded (cut-short) form, or not at all

## E2E Verification Log

_Implementing agent fills; state the model._
