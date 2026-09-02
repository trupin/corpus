# [INFRA-035] Nothing proves the listener judgment reads two lanes differently

## Domain

infra

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: `AGENT-063` (the judgment this would test)
- Related: `INFRA-034` story 2, which this sits beside

## Spec References

- SPEC.md **§7** — *"Stating no weight means the orchestrator decides"*

## Summary

Observed in the v0.32.0 rehearsal pass, 2026-09-02. Story 2's ten runs all
judged **Haiku**, and that is the right answer: the seed is a thread titled
*"First vegetables"* asking *"which three vegetables are the most forgiving for a
first-time gardener?"*, which is a fetch-and-relay lane. Under v0.31.0's fixed
default the same lane launched at **Opus 5**, so the change is a real
improvement and the pass demonstrates it.

**But 10/10 on one unambiguous seed proves reliability, not judgment.** A rule
that answered "Haiku" to everything would score identically. `AGENT-063` says
the orchestrator weighs *what the person opened this lane for*, and nothing in
the suite shows it reading two lanes differently.

`INFRA-033`'s own rule 3 is the argument for filing this: a judgment is graded
as a distribution *because the subject is stochastic and the ratio is the
result*. A distribution over a single kind of lane cannot show the thing the
grade exists to show.

## Acceptance Criteria

- [ ] A second judgment scenario seeds a lane that reads as **working something
      out** — a decision being weighed, wording that will leave the corpus — and
      records its distribution
- [ ] The two scenarios are read together: the finding is not "each lands on its
      own tier" but that **the two land differently**. State that in the
      scorecard so a reader does not have to hold both rows in their head
- [ ] Neither scenario asserts a specific tier. Pinning one re-imposes a default
      through the test, which is what `AGENT-063` removed from story 2
- [ ] The seed is as unambiguous in its direction as story 2's is in its own — a
      borderline lane would make a disagreement between the two runs
      uninterpretable

## Technical Design

### Files to Create/Modify

- `rehearsals/scenarios/10-weightless-designation-heavy.ts` (or a second seed
  inside story 2, if the harness's grading can carry two distributions)
- `rehearsals/scenarios/index.ts`

### Notes

- **Cost.** A judgment runs at `N=10`, so this adds ten runs — roughly nine
  minutes at the pass's measured concurrency, on a pass already near 45. That is
  the price of the only check that can tell judging from landing, and
  `INFRA-033`'s note says N is a knob per scenario.
- A cheaper shape worth considering first: one scenario that seeds **both** lanes
  in the same workspace and asserts they were launched at different tiers. It
  costs one N instead of two and tests the comparison directly, at the price of
  a busier fixture.

## Testing Strategy

The scenario is the test. Its own unit coverage is the seed: that the fixture
produces the two lanes it claims.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Observation, 2026-09-02 (orchestrator, Opus 5):** story 2, ten runs, every one
`judged` at Haiku with a read clause naming a quick factual lookup. Correct for
that seed, and silent about every other seed.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
