# [INFRA-034] The rehearsal scenarios: nine user stories, graded

## Domain

infra

## Status

done

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

- [x] All nine scenarios implemented as `rehearsals/scenarios/*.ts`, each
      declaring its seed, its grade, and for a judgment its threshold and `N`
- [x] Each scenario's seed is built through **`corpus`** — never by writing
      workspace files directly, which would test a state the product cannot reach
- [x] Story 2 records the full distribution, not a pass/fail, and the scorecard
      prints it as `k/N`
- [x] Story 7 compares **bytes**, and additionally asserts that the run created no
      file outside the workspace
- [x] Story 9 edits the installed skill in its own fixture only, and no scenario
      mutates `assets/workspace/` in the repo
- [x] Every scenario names the issue it is a regression for, in the file, so a
      failure points at the history rather than at a puzzle
- [x] A first full pass is run and its scorecard committed, so later passes have a
      baseline to diff — including any story that does **not** pass, recorded as
      the finding it is rather than fixed by weakening the assertion
- [x] `docs/RELEASING.md` gains the step: run the pass, read the scorecard, commit
      it, **then** `npm run release:prepare`. Placed before the bump so a finding
      is cheap to act on rather than something discovered after a tag exists
- [x] The step states the known cost of running only at release time: a defect
      introduced early in a cycle is found late. That is the accepted trade at
      ~25 minutes per release, and it is written down so it is a decision rather
      than a surprise

**On the scorecard criterion, as at 2026-09-02:** the first full pass ran and is recorded
in the E2E log below, story 5's `fail` included rather than argued away — it became
`AGENT-060`. Two pr-reviewer findings then changed both the skills and the scorer, so the
committed `rehearsals/scorecard.md` must be regenerated against the tree v0.31.0 actually
ships. That pass is the release step, not this issue's.

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

**Model: Fable 5 (`claude-fable-5`).** Nine scenarios implemented as
`rehearsals/scenarios/*.ts`, registered in `scenarios/index.ts`. Runner model
`sonnet` (the harness constant). Every seed goes through the product: the CLI
for a plain Ask, and the workspace server's own composer request
(`SeedContext.composer`) for the two acts the CLI has no spelling for — a message
that states a `weight`, and a creation that carries a `resident` designation
(SHARED-022 Q5 keeps those off the CLI). The weight-tier assertions read the
tier from the **workspace's own served table** (`rehearsals/weight-table.ts`),
never a hardcoded model name, so story 9's rename and story 1/2 agree.

Harness unit tests: `npm run … vitest run rehearsals/` — 50 pass (new:
`weight-table.test.ts` pins the reader against the shipped skill and the kit's
own `parseWeightLevels`; `scenarios/support.test.ts` covers the scoring
helpers). `eslint rehearsals/` clean, `prettier --check` clean, `tsc -p
rehearsals/tsconfig.json` clean.

### First full pass — `npm run rehearse -- --release v0.31.0`

34 runs, concurrency 3, ~48 minutes wall. The committed scorecard is
`rehearsals/scorecard.md`; its full text follows, verbatim.

```
# Rehearsal scorecard

<!-- Generated by `npm run rehearse` (INFRA-033). Do not edit by hand. -->

- Release: v0.31.0
- Date: 2026-09-02T02:18:35.280Z
- Tree: v0.30.0 at 3f88da39
- Runner model: sonnet

| Scenario | Grade | Result | Detail |
| --- | --- | --- | --- |
| 01-stated-weight | invariant | **pass** | 3/3 runs scored |
| 02-weightless-designation | judgment | **pass** | 10/10 against ≥10 of 10 |
| 03-one-question-one-answer | invariant | **pass** | 3/3 runs scored |
| 04-two-lanes-no-crossing | invariant | **pass** | 2/3 runs scored |
| 05-restart-recovery | invariant | **fail** | 3/3 runs scored |
| 06-mid-turn-no-second-listener | invariant | **pass** | 3/3 runs scored |
| 07-hostile-transcript | invariant | **pass** | 3/3 runs scored |
| 08-unmeetable-weight | invariant | **pass** | 3/3 runs scored |
| 09-retiered-table | invariant | **pass** | 3/3 runs scored |
```

Per-run detail (times and end reasons) is in the committed scorecard body. The
two scenarios that did not come back a clean 3/3 are recorded below as the
findings they are — no assertion was weakened.

### Story 2 reads the strongest tier, not `10/10 Sonnet`

The judgment the issue names. Its distribution is **`10/10 Opus 5 · defaulted`**:
every weightless designation launched its listener at the strongest tier the
workspace's table declares, logged `defaulted`. Before AGENT-059 this same
scorecard would have read `10/10 Sonnet` — the bug the user hit. The check is
now green for the right reason, and the distribution is what makes that legible.

### Finding — story 5 (`05-restart-recovery`), run 1: a shared flag-file path

**Recorded as `fail`, not fixed by weakening the assertion.** Run 1's lane A
ended with **two** agent turns. The listener's own job log says why:

> the reply body file at `/tmp/corpus-reply.md` differed at read time from what I
> wrote to it. … posted a correction turn naming the dangling ref and the real
> id …

The skills tell an agent to write a value to a **fixed** temp path
(`/tmp/corpus-reply.md`, `/tmp/corpus-title.txt`) and pass it with `--flag-file`.
The orchestrate skill dispatches the claimed batch **in parallel**, so two
subagents write and read the same file and one clobbers the other. The agent
caught its own collision and self-corrected with a second turn, which the
invariant (exactly one agent reply) flagged. **Filed as AGENT-060** (P1), with a
PLAN.md row. Runs 2 and 3 were clean, so the scenario is sound — the collision is
real and is the product's, not the test's.

### Finding — story 4 (`04-two-lanes-no-crossing`), run 1: over-budget

Run 1 hit the 15-minute budget (`over-budget`, excused by the harness; the
scenario grades `pass` on the two clean runs). Both lanes' listeners were
launched — the job logs show both — and lane B was answered, but lane A's
`comment.created` stayed `pending` and was never claimed within the budget. A
listener was launched for it (logged) yet never claimed its message, so either
the background listener did not sustain its loop or the two concurrent listeners
starved under the sonnet runner. Recorded as the over-budget finding it is; it is
adjacent to CLI-075 (no way to shorten the park window makes a stalled lane
expensive to observe) and may share a cause with AGENT-060. Not separately filed
pending a second occurrence — one over-budget run out of three is a watch item,
not yet a confirmed defect.

### The other seven

- **01 stated-weight** 3/3: `resident.designated weight: heavy` → launch logged
  `stated at designation: heavy`, reply model `claude-opus-5` — the stated tier
  honoured, never re-judged.
- **02 weightless-designation** 10/10 `Opus 5 · defaulted` (above).
- **03 one-question-one-answer** 3/3 clean (INFRA-033's baseline, unchanged).
- **06 mid-turn-no-second-listener** 3/3: exactly one launch recorded per lane —
  no second listener onto a lane being worked.
- **07 hostile-transcript** 3/3: the pasted body (a `CORPUS_EOF` line, backticks,
  `$(…)`, an apostrophe) stored byte-for-byte, no file created outside the
  workspace, no command spliced in — CLI-051's fix holds with a real agent
  carrying the value.
- **08 unmeetable-weight** 3/3: `weight: colossal` — work still done, the server
  logged `weight stated by the request: colossal`, and the reply named the
  weight it could not meet.
- **09 retiered-table** 3/3: the edited skill's served table offered
  `Featherweight` (rename) and `Deliberative` (added level), and a message
  stating `deliberative` dispatched at that new row's Opus — the composer's read
  and the dispatcher's agree (SHARED-022).

### Acceptance criteria

- Nine scenarios, each declaring seed/grade/N (and story 2's threshold) — done.
- Seeds built through the product (CLI + the workspace's own composer) — done.
- Story 2 records the full distribution, printed `k/N` — done.
- Story 7 compares bytes and asserts no file outside the workspace — done.
- Story 9 edits only its fixture's skill; no scenario mutates `assets/workspace/`
  in the repo — done.
- Every scenario names its regression issue in the file — done.
- First full pass run, scorecard committed including the non-passing story — done.
- `docs/RELEASING.md` gains the pass-before-bump step and the accepted-trade
  paragraph (~25 min, defects found late) — done.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
