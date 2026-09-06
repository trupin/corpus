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

**Implementation, 2026-09-06 (infra-dev, Fable 5).**

**Shape chosen: one scenario seeding both lanes in one workspace** —
`rehearsals/scenarios/11-two-lanes-two-weights.ts` (10 was taken by
`a-listener-answers-twice`), registered in `scenarios/index.ts`. The Notes'
cheaper shape was considered first and taken, for three reasons:

1. **It tests the comparison directly, controlled.** Same session, same
   declared table, same runner — a difference between the two launches can
   only come from reading each lane's purpose. Two single-lane scenarios
   compare distributions across different workspaces and different runs, a
   weaker inference.
2. **No cross-scenario grading machinery.** The harness grades one scenario at
   a time (INFRA-033 rule 3). A two-distribution shape needs `score.ts` to
   learn to read two scenarios' results together — new coupling for one
   check. In the chosen shape each run's **label is the comparison**
   (`lookup Haiku ≠ decision Opus 5 · judged/judged`), so the scorecard's own
   distribution section states the finding in one place and TEST-1155 falls
   out of the existing renderer.
3. **Cost.** Either shape adds one N=10 scenario to the pass. This one runs
   two answer cycles per run (budget 20 min vs story 2's 15), but adds no
   second scenario on top for the comparison to read.

**What is asserted per run** (all off the corpus record, rule 2): both lanes'
launches logged `judged`, each logged weight matching its reply's recorded
model, both events `processed`, and the two matched tiers **differ**.
**No tier is named** — only inequality (TEST-1154). **No direction is
asserted** either: "the decision lane lands heavier" would encode the author's
own read of the seeds into the grader, one step from re-imposing a default.
The label keeps the lanes in fixed order, so an inverted read is visible in
the distribution rather than asserted away. Threshold 10/10, matching story 2:
a same-tier run on two deliberately unambiguous seeds is exactly the
landing-not-judging symptom.

**The two seeds.** Lookup lane: *"Last frost"* — one flat factual question,
story 2's register. Decision lane: *"Greenhouse or raised beds"* — two options
with stated trade-offs, asking for a recommendation plus a paragraph the
person will send verbatim to their allotment association: a decision weighed,
wording that will leave the corpus (TEST-1153). Seeding refuses a table with
fewer than two tiers, where the comparison cannot exist.

**Refactor.** Story 2's lane read moved verbatim into
`readLaneLaunch`/`laneJudgedTruthfully` in `scenarios/support.ts`, now shared
by 02 and 11 — one copy, so the two scenarios cannot drift on what "a truthful
judged launch" means. 02's score is behaviourally unchanged (thin wrapper over
the helper, same labels, same pass predicate).

**Verified locally** (scoped, per machine discipline — no model pass run):

- `vitest run rehearsals` — 8 files, 77 tests, all pass (9 new in
  `11-two-lanes-two-weights.test.ts`: 3 seed incl. TEST-1156's both-lanes
  assertion, 6 score covering pass, same-tier, non-judged provenance, lying
  log, missing reply, unsettled event).
- `tsc --noEmit -p rehearsals/tsconfig.json`, `eslint rehearsals`,
  `prettier --check rehearsals` — all clean.

**What the release pass must confirm (orchestrator — this agent deliberately
ran no model pass; N=10 judgment runs are the pass's cost to schedule):**

1. `11-two-lanes-two-weights` runs at N=10 and every run scores (a cut-short
   or over-budget run blocks a pass grade by design).
2. Its distribution shows the two lanes landing **differently**, with
   `judged/judged` provenance — the labels state the comparison per run.
3. **The added pass time, measured** (TEST-1157): read the eleven per-run
   durations off the scorecard and append the measured addition to this log —
   the "roughly nine minutes" in the Notes is an estimate and must not be the
   number of record.
4. Story 2 still grades as before — its scorer was refactored onto the shared
   helper and must show no behaviour change on real runs.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint + prettier + tsc over `rehearsals/`)
- [x] E2E verification log filled (release-pass items remain for the orchestrator)
- [x] Self-review
- [x] Acceptance criteria verified (the distribution itself lands with the release pass)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
