# [INFRA-034] The rehearsal scenarios: nine user stories, graded

## Domain

infra

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: `INFRA-033` (the harness), `AGENT-059` (stories 1, 2 and 8 assert on
  the launch's weight **and its provenance**, which AGENT-059 creates)
- Related: `UI-185`, AGENT-041, AGENT-056, AGENT-054, AGENT-029, CLI-051,
  SHARED-022

## Spec References

- SPEC.md **§7** — the orchestrator loop, resident designation and weight,
  presence, the no-fallback rule, and the deviation rule for a weight that cannot
  be honoured
- SPEC.md **§10** — a turn names the model that wrote it

## Summary

The scenario set for `INFRA-033`. Each is a **user story in the product's own
terms**, seeded from a fixture, run by a model that knows nothing about the test,
and graded on what the corpus records afterwards.

Seven of the nine are regression tests for defects that reached a release. Two
(8 and 9) are spec promises nothing has ever checked.

## The stories

Every run also carries `INFRA-033`'s three universal invariants.

| # | Story | Seed | Assertion | Grade | Was |
| --- | --- | --- | --- | --- | --- |
| 1 | *I designated a resident at heavy, and it answers at heavy.* | designation `weight: heavy`, one message | the reply turn's `model` is the heavy row's model; the launch record says `stated` | invariant | AGENT-041 |
| 2 | *I designated one and chose no weight.* | designation `weight: null`, one message | the launched model, **as a distribution**; the launch record says `defaulted` and names what it chose | judgment | **AGENT-059** |
| 3 | *I asked one question and got one answer.* | one `comment.created` | exactly one reply turn appended; the event ends `complete` | invariant | — |
| 4 | *Two conversations, two residents, nobody crosses.* | two designated lanes, one message on each | each reply lands in its own thread; exactly one listener per lane | invariant | AGENT-056 |
| 5 | *My agent restarted and my conversations still get answered.* | two designations sitting on threads, no listeners, one pending message | both lanes launch on the first pass; the pending message is answered | invariant | AGENT-054 |
| 6 | *Someone is mid-turn — do not start a second one.* | a lane holding an in-progress event | no second listener launched; the console line reads *standing down*, not a failed launch | invariant | AGENT-029 |
| 7 | *I pasted a terminal transcript and it arrived intact.* | a message whose body carries a line reading `CORPUS_EOF`, backticks, `$(…)` and an apostrophe | the stored document's bytes equal what was sent; no unexpected file anywhere on disk; no command output spliced into the body | invariant | **CLI-051** |
| 8 | *I asked for a weight this workspace does not have.* | message `weight: "colossal"` | the work is still done; the reply **and** the log each name what was asked, that it could not be met, and what ran instead | invariant | §7, untested |
| 9 | *I renamed a tier and everything followed.* | the scenario edits the skill's table — rename a label, add a level | the composer offers the new labels **and** a dispatch goes out at the new row's model | invariant | SHARED-022, half-tested |

## Why these nine

**Story 2 is the one that would have caught what the user hit**, and it would have
read `10/10 Sonnet` — unambiguous, and unmissable in a scorecard.

**Story 7 is a security regression test.** CLI-051 was a command-execution defect
with a working proof of concept, closed in v0.29.0 by `--flag-file`. Nothing
currently re-proves that the fix holds when a *real agent* carries a hostile
value, which is the only path that matters — the mechanism is only as good as the
skill's habit of reaching for it.

**Story 9 is the only check that SHARED-022's two readings agree in practice.**
`parseWeightLevels` proves the composer reads the table. Nothing proves the
dispatcher reads the same rows the same way, and the two drifting apart is the
exact failure that decision was signed to prevent.

**Stories 1 and 8 are §7 promises with no test anywhere.** A stated weight is
*"honoured, not weighed again"*, and one that cannot be honoured must be
*"stated twice"* — in the log and in the reply. Both are prose obligations on an
agent, so only this suite can check them.

## Acceptance Criteria

- [ ] All nine scenarios implemented as `rehearsals/scenarios/*.ts`, each
      declaring its seed, its grade, and for a judgment its threshold and `N`
- [ ] Each scenario's seed is built through **`corpus`** — never by writing
      workspace files directly, which would test a state the product cannot reach
- [ ] Story 2 records the full distribution, not a pass/fail, and the scorecard
      prints it as `k/N`
- [ ] Story 7 compares **bytes**, and additionally asserts that the run created no
      file outside the workspace
- [ ] Story 9 edits the installed skill in its own fixture only, and no scenario
      mutates `assets/workspace/` in the repo
- [ ] Every scenario names the issue it is a regression for, in the file, so a
      failure points at the history rather than at a puzzle
- [ ] A first full pass is run and its scorecard committed, so later passes have a
      baseline to diff — including any story that does **not** pass, recorded as
      the finding it is rather than fixed by weakening the assertion
- [ ] `docs/RELEASING.md` gains the step: run the pass, read the scorecard, commit
      it, **then** `npm run release:prepare`. Placed before the bump so a finding
      is cheap to act on rather than something discovered after a tag exists
- [ ] The step states the known cost of running only at release time: a defect
      introduced early in a cycle is found late. That is the accepted trade at
      ~25 minutes per release, and it is written down so it is a decision rather
      than a surprise

## Technical Design

### Files to Create

- `rehearsals/scenarios/01-stated-weight.ts` … `09-retiered-table.ts`
- `rehearsals/scorecard.md` — the committed baseline from the first pass

### Notes

- **A story that fails on the first pass is a finding, not a broken test.** File
  it. The suite exists because these defects are real, and the first pass is the
  most likely one to surface a new one.
- Keep each seed to a handful of events. These are stories, not workloads, and
  every extra event is agent minutes across every run.

## Testing Strategy

The scenarios *are* the tests. What gets ordinary unit tests is their seeding —
that a seed produces the workspace state it claims — because a scenario that seeds
wrongly grades a system nobody is running.

## E2E Verification Log

_Filled by the implementing agent; state the model. The scorecard from the first
full pass belongs here, in full, including anything that did not pass._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
