# [INFRA-039] Nothing measures whether a listener stays alive

## Domain

infra

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-078**, **AGENT-065** (this measures whether they worked)
- Related: INFRA-033 / INFRA-034 (the harness and its nine scenarios), AGENT-067
  (which uses this suite as its gate)

## Spec References

- SPEC.md **§7** — a resident is present exactly while it holds a parked scoped
  `idle`

## Summary

A listener stopping after one answer is the defect reported on 2026-09-05.
CLI-078 and AGENT-065 are the two halves of the fix, and **both are prose** — a
line in a tool's output and a rebalanced skill. Neither can be proved by a unit
test, because what they change is a model's choice.

The rehearsal harness exists for exactly this. It has nine scenarios and **none of
them tests liveness**:

| Scenario | What it covers |
| --- | --- |
| 01 stated-weight | dispatch honours a stated weight |
| 02 weightless-designation | a judged launch |
| 03 one-question-one-answer | **one** message, one answer |
| 04 two-lanes-no-crossing | lane isolation |
| 05 restart-recovery | the orchestrator after a restart |
| 06 mid-turn-no-second-listener | no duplicate launch onto a busy lane |
| 07 hostile-transcript | untrusted content |
| 08 unmeetable-weight | a weight that cannot be honoured |
| 09 retiered-table | the table is the source of levels |

`03` is the closest and it is a single pass. Nothing anywhere asks a listener to
answer a second message **without being relaunched**, which is the whole of the
reported failure.

## What to build

**Scenario 10 — a listener answers twice.**

1. Designate a resident on a standalone thread.
2. Post a message. Let the listener answer it.
3. Wait past a settle, and **post a second message**.
4. Assert the second message is answered.
5. Assert it was answered by **the same listener** — the orchestrator launched
   nothing in between.

Step 5 is the assertion that matters. A relaunch produces the same reply and hides
the defect completely, which is exactly why the operator saw slow answers rather
than missing ones and had to notice it by hand.

**Assert from the corpus, never from the transcript.** That is INFRA-033's rule
and it holds here: the evidence is the thread's turns, the job logs, and the
lane's state across the gap.

**Score it `k/N`, not as a boolean.** INFRA-033's fourth rule. This is a
stochastic subject and a single green run proves nothing — which is the same
caution CLI-078's own verification log is required to state. The scenario reports
how many of N runs kept the listener alive, and **that number is the measurement
CLI-078 and AGENT-065 are judged on.**

## Baseline first

**Run it against the tree before either fix lands, and record the number.**
Without a before, a passing after is not evidence of anything. This is the
reproduction the SDLC requires for a bug, in the only form this defect has one.

## Acceptance Criteria

- [ ] Scenario 10 exists in `rehearsals/scenarios/` and is in the index.
- [ ] It asserts the second answer **and** that no relaunch happened between.
- [ ] Every assertion reads the corpus. None reads a transcript.
- [ ] It scores `k/N` and the scorecard shows the fraction.
- [ ] A **pre-fix baseline** is recorded in this issue.
- [ ] A post-fix number is recorded, over the same N.
- [ ] The issue states plainly what the two numbers do and do not establish.

## Technical Design

### Files to Create/Modify

- `rehearsals/scenarios/10-a-listener-answers-twice.ts` — new.
- `rehearsals/scenarios/index.ts` — register it.
- `rehearsals/scorecard.md` — the row.

### Key Implementation Details

Read `rehearsals/README.md` and copy `06-mid-turn-no-second-listener.ts`, which is
the closest existing shape: it already reasons about a listener's presence across
time, and about launches that should not happen.

**The gap between the two messages is the hard part.** It must be long enough that
the listener has settled and re-parked, and short enough that the run is
affordable. Derive it from the settle rather than from a fixed sleep, and say in
the scenario how it was chosen.

**Distinguishing "same listener" from "a relaunch" needs evidence in the corpus.**
The job log a launch writes is the candidate — `orchestrate` requires a log line
naming the weight and its provenance on every launch. Two launches means two
lines. Confirm that holds before relying on it, and if it does not, say so and
find another marker rather than asserting from absence.

### Edge Cases

- The listener answers the second message **after** a relaunch. That is a **fail**,
  not a pass. The conversation was still answered, which is precisely why this has
  gone unnoticed.
- The run times out with the second message unanswered. Fail, and the scorecard
  distinguishes it from an answered-after-relaunch.
- A flaky model run. That is what `k/N` is for, and it is not a reason to retry
  until green.

## Testing Strategy

The scenario is the test. Its own support code gets unit coverage the way the
other nine do, and the runner gets **zero test knowledge** — INFRA-033's first
rule.

## E2E Verification Plan

This issue is E2E by construction: a real model, the real installed skills, a real
workspace.

### Verification Steps

1. Run scenario 10 at N ≥ 5 against the current tree. Record `k/N`.
2. Land CLI-078 and AGENT-065.
3. Re-run at the same N. Record `k/N`.
4. Record both in this issue and in the scorecard.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Reproduction (bugs only)

_[Agent fills: the pre-fix k/N, and the N]_

### Post-Implementation Verification

_[Agent fills: the post-fix k/N, and what the pair establishes]_

## Completion Checklist (domain agent)

- [ ] Pre-fix baseline recorded
- [ ] Post-fix number recorded at the same N
- [ ] Assertions read the corpus only
- [ ] `/lint` passes
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run
- [ ] Committed with `[INFRA-039]` prefix
