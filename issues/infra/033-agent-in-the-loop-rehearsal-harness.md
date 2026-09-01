# [INFRA-033] A rehearsal harness: a real model, the real skills, a real workspace

## Domain

infra

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: `AGENT-059` — stories 1, 2 and 8 in `INFRA-034` assert on the
  launch's weight **and its provenance**, which does not exist until AGENT-059
  puts it there. The harness itself does not need it.
- Blocks: `INFRA-034` (the scenario set)
- Related: SHARED-022 (one declaration of the tier table), AGENT-041, AGENT-056,
  CLI-051 — the defect history this exists to have caught

## Spec References

- SPEC.md **§7** — the orchestrator loop, the resident lifecycle, and *"a dispatch
  says what weight it went out at, and where that weight came from"*
- SPEC.md **§10** — a turn names the model that wrote it, which is the durable
  record this harness reads

## Summary

User directive, 2026-09-01: *"We have been struggling with issues such as these
for a while now."*

**The product's most important component is prose executed by a model, and it has
no execution layer.** The repo tests code to 97% and tests the agent's
instructions not at all: `scripts/workspace-template.test.ts` carries 404 guards
and every one checks **wording** — that a sentence is present, that a prohibition
was not deleted. Nothing checks that a sentence is *true of the machinery*, and
nothing checks what an agent following it actually does.

So the detector of last resort is the operator noticing and asking. That is how
`AGENT-041`, `AGENT-059` and `UI-185` were all found.

This issue builds the harness. `INFRA-034` writes the scenarios.

## Why this is P0

The user's judgment, recorded as theirs: the absence of this validation is the
defect, not any one bug it would have caught. Every issue in the table below
reached a release, and each was found by a person using the app.

| Defect | What it was |
| --- | --- |
| AGENT-041 | prose said *"launch at that row's model"* and named no mechanism |
| AGENT-059 | a rule written for jobs applied to a listener, silently |
| AGENT-056 | reap-first stripped `working` from the busy listener too |
| AGENT-054 | a listener starting onto work already queued |
| AGENT-029 | a resident mid-turn reading as gone |
| CLI-051 | a carried value ending its own heredoc, and running the rest |

## The four rules the harness is built on

These are the design, and a change that breaks one of them makes the suite worth
less than nothing — a green board over an unobserved system.

1. **The runner gets zero test knowledge.** Its prompt names the workspace and
   says to follow the skill installed in it. Nothing about what is being checked,
   no hint of the expected outcome, no scenario name. It reads the *installed*
   skill exactly as a user's agent does. A prompt that leaks the assertion
   invalidates the run.
2. **Assert only what the corpus records.** Never the transcript, never the
   harness's own instrumentation. The product already records what is needed: a
   turn carries the `model` that wrote it (§10), git carries the author, the queue
   carries event state, the job log carries the dispatch. **If something worth
   checking is not recorded, that is a product gap to file — not a reason to
   instrument the harness.** The suite drives observability rather than routing
   around its absence.
3. **Two grades, and they are not the same test.** An **invariant** must hold in
   every run it gets — no event lost, one listener per lane, every commit authored
   by the server — and its `N` is small because repetition is not what it is for.
   A **judgment** is reported as `k/N` against a threshold, and its `N` is large
   because the subject is stochastic and the ratio *is* the result. `AGENT-059`
   would have read `10/10 launched Sonnet`. A rule that produces the right outcome
   6/10 times is a broken rule that a boolean assertion would call green.
4. **Never assert prose.** Not the agent's wording, not a log line's phrasing —
   only what changed on disk, in git, and in the queue. `AGENT-059`'s table reads
   perfectly well and is wrong about a subject it never names; the *outcome* is
   what gives it away.

## Acceptance Criteria

- [ ] `rehearsals/` holds the harness, run by its own script — **not** vitest, and
      never wired into `npm test`, the PR gate, or `CI / validate`
- [ ] **It runs once per release, before the bump** (user decision, 2026-09-01, to
      bound the cost), and **before every release rather than only those touching
      `assets/workspace/`**. The subject is the *loop*, which spans the skills,
      the CLI and the server together: `CLI-051` was a CLI defect that changed what
      an agent does with somebody's words, and `AGENT-041`'s gap spanned the skill
      and the mechanism it named. A gate scoped to one of the three would have
      watched the wrong file
- [ ] **It cannot run in GitHub Actions**, because the runner spawns agents. So it
      is a local step in `docs/RELEASING.md` that nothing can enforce — which is
      why the scorecard below is **committed**: an unenforceable gate needs a
      durable artifact, or "did we run it?" stops being answerable and the gate is
      skipped in silence
- [ ] **Fixture**: a scenario declares a seed, and the harness builds a fresh
      workspace from it — `corpus init` into a temp dir, seeded documents and
      threads, a server on a free port, `--wait` short enough that a park is
      seconds
- [ ] Every run starts from a **clean** workspace; no run can observe another's
      state
- [ ] **Runner**: spawns one subagent per run whose prompt carries the workspace
      path and the instruction to follow its own orchestrate skill, and **nothing
      else** — a test asserts the prompt contains no scenario name and no
      expectation
- [ ] The run ends on a budget (a turn count or a wall clock), and a run that
      exceeds it is recorded as `over-budget` rather than failed — an exhausted
      budget is a finding, not an error
- [ ] **Observer**: reads only the workspace — git log and authors, thread
      frontmatter, each turn's `model`, job logs, queue state, and file bytes. It
      makes no assertion; it produces a record
- [ ] **Scorer**: invariants fail the scenario on a single breach; judgments are
      reported as `k/N` against a declared threshold
- [ ] **The three universal invariants** run on every scenario, whatever it is
      about: no event lost or double-worked, every commit authored by the server
      (nothing hand-edited), every thread file still parses
- [ ] **Scorecard**: one file per pass, naming every scenario, its grade, the
      release it was run for, and for judgments the ratio — committed, readable by
      a person, and diffable between releases so a judgment that drifts is visible
      without rerunning anything
- [ ] One story implemented end to end to prove the harness — *"I asked one
      question and got one answer"* (story 3), chosen because it needs nothing
      from `AGENT-059`
- [ ] The harness refuses to run against a workspace it did not create, and never
      touches port 8765

## Technical Design

### Files to Create

- `rehearsals/run.ts` — the driver: for each scenario, for each run, seed → spawn
  → wait → observe → score
- `rehearsals/fixture.ts` — workspace construction and seeding, and the teardown
  that guarantees isolation
- `rehearsals/observe.ts` — the workspace reader; returns a plain record
- `rehearsals/score.ts` — invariants and judgments, and the scorecard writer
- `rehearsals/scenarios/` — one file per story; `INFRA-034` fills it
- `rehearsals/README.md` — the four rules above, so the next author does not
  weaken them by accident

### Notes

- **Machine load.** Runs are agents, not workers: cap concurrency low and stagger
  starts. The suite is minutes per run and is not a gate.
- **Cost is real.** N is a knob per scenario. Start at 10 for judgments and 3 for
  pure invariants, which makes a full pass of `INFRA-034`'s nine stories
  **34 runs** — one judgment at 10, eight invariants at 3 — or about 25 minutes
  at four concurrent runs of two to three minutes each.
- **N=3 proves little about intermittency, and that is a cost compromise rather
  than a principle.** So a single invariant failure is investigated, never retried
  away. The three *universal* invariants are the exception that costs nothing:
  they run on every run of every scenario, so they accumulate all 34 samples,
  while a story's own invariant sees only that story's N.
- The runner needs the subagent-spawning tool, because launching listeners is the
  behaviour under test.

## Testing Strategy

The harness is code and gets ordinary unit tests: the fixture isolates, the
observer reads what it claims to, the scorer grades invariants and judgments
differently, and — the important one — **the runner's prompt contains no test
knowledge**, asserted against the literal string it builds.

The harness's own end-to-end proof is story 3 passing 3/3.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
