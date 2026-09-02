# [INFRA-036] A run whose runner exited with work still pending is scored as a product breach

## Domain

infra

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: `INFRA-033` (whose `over-budget` category this generalises),
  `INFRA-034`, `AGENT-064`

## Spec References

- None. This is the harness's own scoring, not product behaviour.

## Summary

Found in the v0.32.0 pre-release pass, 2026-09-02. Four of nine stories failed,
and almost every failing run carries the same pair:

> the question's event (evt_…) ended pending, not processed
> expected exactly one agent reply on th_…, found 0

…on a run whose `endedBy` is **`exit`**.

**A headless `claude -p` session ends its turn.** `INFRA-033`'s own notes flagged
it: *"Two runs ended by the runner exiting on its own rather than looping into a
park — headless `-p` sessions end their turn."* When that happens with an event
still `pending`, the listener never got to work the lane, the observer reads an
unanswered question, and the scorer reports it as a **product breach**.

It is not one. The run was cut short.

`INFRA-033` already has the right category for this and it is one condition too
narrow: *"a run that exceeds it is recorded as `over-budget` rather than failed —
an exhausted budget is a finding, not an error."* A runner that simply exited was
given even less of a chance than one that ran out of budget, and it is scored in
full.

## What this does not excuse

**Two different failures were wearing the same shape, and only one is the
harness's.** In the same pass, story 1 run 3 ended by **quiescence** — the queue
genuinely drained, `pending === 0 && inProgress === 0` — and still had no reply.
That run is a real product finding and is filed as `AGENT-064`.

So the fix must separate them exactly, and must not become a blanket excuse:

- ended with work still outstanding → **not scored**, because the product was
  never given its turn
- ended with the queue drained → **scored**, whatever the run did

An implementation that excludes on `endedBy === "exit"` alone would swallow
`AGENT-064`, which is the defect this pass actually found.

## Why this is P0

- **The suite is over-reporting.** Every red row it produces has to be read
  twice, which is exactly the cost the four-rules design was meant to avoid.
- **It hides real findings.** `AGENT-064` was one line among fourteen breach
  lines that were mostly noise, and it nearly went unnoticed.
- **It makes the gate unusable as a release gate**, because a pass's colour now
  depends partly on how many headless sessions happened to end early.

## Acceptance Criteria

- [ ] A run that ends with **pending or in-progress work outstanding** is
      recorded as cut short and **excluded from scoring**, exactly as
      `over-budget` is
- [ ] It is distinguishable from `over-budget` in the record and on the
      scorecard: an exhausted budget and an exited runner are different facts
- [ ] A run that ends with the queue **drained** is scored in full, whatever its
      `endedBy` — so `AGENT-064`'s failure still fails
- [ ] A scenario whose runs were all cut short does not grade `pass`. It grades
      as the inconclusive thing it is, the way `pass-short` already says "not
      every run scored"
- [ ] The scorecard says how many runs were excluded and why, per scenario, so a
      reader can tell a quiet pass from an unobserved one

## Technical Design

### Files to Create/Modify

- `rehearsals/run.ts` — the wait loop already reads the queue each pass; the
  exit branch (`if (exited) return …`) returns before it does. Read the queue on
  exit and carry the answer
- `rehearsals/scenario.ts` — `RunMeta`, beside `overBudget`
- `rehearsals/score.ts` — the exclusion path and the grade
- their tests

### Notes

- **Do not "fix" this by extending the budget or by keeping the runner alive.**
  The runner ending its turn is what headless is; the bug is that the harness
  scores what it cut short. Making the runner immortal would change what is
  being rehearsed.
- **This will turn some current reds green, and that is the thing to be careful
  about.** Every excluded run must be visible on the scorecard, and the first
  pass after this lands must be read with that in mind — a story that goes from
  fail to pass here has not been fixed, it has been *unmeasured*, and the honest
  next step is to get it measured rather than to call it done.

## Testing Strategy

Unit tests over the scorer with both shapes: pending-at-exit is excluded,
drained-at-exit is scored. The suite's own proof is the next full pass, read
against this one.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (orchestrator, Opus 5).** Full pass: stories 1,
2, 4 and 6 failed, with `ended pending` + `found 0` on runs whose `endedBy` was
`exit`. An isolation probe of story 1 alone on an otherwise idle machine: run 1
clean (241s, quiescence), **run 2 breached (170s, exit, event pending)**, run 3
clean (70s, quiescence). Same tree, same seed — the difference is how the run
ended.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
