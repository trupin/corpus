# [AGENT-076] A second listener was launched onto a lane mid-turn

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
- Related: AGENT-029 (the regression scenario 06 guards), AGENT-075 (the
  cut-short family in the same pass)

## Spec References

- SPEC.md **§7**: one listener per lane; a lane with a live listener is not
  launched again

## Summary

The v0.37.0 rehearsal pass (2026-09-24, runner sonnet, machine held awake)
recorded a breach in scenario 06, run 3, on a completed run. The scenario
found two `judged` launch lines for one lane, th_omubn7ht: a second
listener was started onto the lane while a turn was in flight. The
question's event, evt_vlka2zq4jco4, ended **abandoned**, not processed. The
same run also carries two hand-edit commits (the AGENT-074 family).

Earlier cards failed scenario 06 only on hand-edit findings. This is the
first record of a double launch since AGENT-029. Nothing in v0.37.0 touches
launching, but that is an assumption to check against the record, not a
conclusion.

## What to build

1. Read the raw record before it is lost (the directory is gitignored):
   `rehearsals/out/2026-09-24T15-18-50.014Z/06-mid-turn-no-second-listener.run-3.json`.
   Find why the orchestrator judged the lane launchable while a listener
   held it, and why the event was abandoned.
2. Fix whatever path let it through, in the skills or the server.
3. Run scenario 06 again and record the result.

## Acceptance Criteria

- [ ] The cause is named from the raw record before anything changes
- [ ] The path is closed
- [ ] A later pass shows scenario 06 without a double launch

## E2E Verification Log

_Implementing agent fills; state the model._
