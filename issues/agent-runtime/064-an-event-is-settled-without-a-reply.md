# [AGENT-064] An event is settled without the reply it was claimed to write

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
- Related: `INFRA-036` (whose noise this was hiding inside), `AGENT-054`

## Spec References

- SPEC.md **§7** — *"Outcomes are never assumed. An event is marked
  `complete`/`fail` only from its subagent's reported outcome"*
- SPEC.md **§7** — *"No path loses a job silently."*

## Summary

Found in the v0.32.0 pre-release pass, 2026-09-02 — story 1, run 3:

- ended by **quiescence**, not by the runner exiting: `pending === 0 &&
  inProgress === 0`, so the queue genuinely drained
- the seeded question's event was **settled**
- and the thread carried **no agent reply at all**

So a `comment.created` asking a question was taken to a settled state without
the question being answered. §7 says an event is settled *"only from its
subagent's reported outcome"* and that *"no path loses a job silently"* — here a
job was settled and the person's question was silently dropped.

## Why this was nearly missed, and why it is filed separately

The same pass produced fourteen breach lines, and almost all of them were
`INFRA-036`'s: runs the harness cut short and scored anyway, which read as
*"ended pending, found 0 replies"*. **This one reads almost identically and is
not the same thing** — its queue drained. It was found only by checking each
failing run's `endedBy` against its queue state.

That is the argument for fixing `INFRA-036`: a suite whose reds are mostly noise
hides the reds that are not.

## What is not yet known

- **How often.** One run in three of story 1's isolation probe was cut short and
  a different run settled without replying; the pass's other stories were too
  noisy to read. The rate is unknown until `INFRA-036` lands and a clean pass is
  read.
- **Whether the tier matters.** Story 1 now seeds a **non-strongest** weight
  (changed on review in v0.32.0), so this run's listener was at the lighter end.
  A lighter listener dropping the reply while still settling the event is a
  plausible shape and is exactly what nobody has measured.
- **Where it settled.** Whether the event was `processed`, `failed` or
  `abandoned` decides whether this is a wrong report or a lost one, and the raw
  record has it.

## Acceptance Criteria

- [ ] The failure is reproduced against a real workspace, with the settled
      event's status named, before anything is changed — bugs are reproduced
      first (SDLC step 1)
- [ ] Either the agent cannot settle an answering event without having posted,
      or it fails the event with a reason a person can read. Silence is the one
      outcome §7 rules out
- [ ] `INFRA-034` story 1 and story 3 both pass a full pass afterwards, on runs
      that were actually scored

## Technical Design

### Files to Create/Modify

Unknown until reproduced. Likely `assets/workspace/claude/skills/converse/` or
`comment/`, wherever the settle verb is reached.

### Notes

- **Do not fix this from the scorecard.** The record names the run
  (`rehearsals/out/2026-09-02T16-29-29.929Z/01-stated-weight.run-3.json`) and it
  carries the job log, the queue state and the thread bytes. Read those first.

## Testing Strategy

`INFRA-034` story 1 is the regression test and already exists. What it needs is
`INFRA-036` landed, so that a red row means the product did something rather
than that the harness stopped watching.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (orchestrator, Opus 5):** story 1 run 3 of the
v0.32.0 pass — 65s, ended by quiescence, event settled, `expected exactly one
agent reply on th_novjybop, found 0`.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
