# [INFRA-033] A rehearsal harness: a real model, the real skills, a real workspace

## Domain

infra

## Status

in_progress

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

- [x] `rehearsals/` holds the harness, run by its own script — **not** vitest, and
      never wired into `npm test`, the PR gate, or `CI / validate` (`npm run
      rehearse`; only the harness's own ordinary unit tests run under vitest, per
      Testing Strategy below)
- [x] **It runs once per release, before the bump** (user decision, 2026-09-01, to
      bound the cost), and **before every release rather than only those touching
      `assets/workspace/`**. The subject is the *loop*, which spans the skills,
      the CLI and the server together: `CLI-051` was a CLI defect that changed what
      an agent does with somebody's words, and `AGENT-041`'s gap spanned the skill
      and the mechanism it named. A gate scoped to one of the three would have
      watched the wrong file
- [x] **It cannot run in GitHub Actions**, because the runner spawns agents. So it
      is a local step in `docs/RELEASING.md` that nothing can enforce — which is
      why the scorecard below is **committed**: an unenforceable gate needs a
      durable artifact, or "did we run it?" stops being answerable and the gate is
      skipped in silence
- [x] **Fixture**: a scenario declares a seed, and the harness builds a fresh
      workspace from it — `corpus init` into a temp dir, seeded documents and
      threads, a server on a free port. **Except the `--wait` clause**: the
      product has no workspace or environment knob for `corpus queue idle`'s
      default window, and the two available workarounds each break a rule (an
      operational hint in the prompt breaks rule 1, a CLI shim rehearses a loop
      nobody ships). Filed as **CLI-075** per rule 2's consequence; scenario
      budgets absorb the 480 s worst case until it lands
- [x] Every run starts from a **clean** workspace; no run can observe another's
      state
- [x] **Runner**: spawns one subagent per run whose prompt carries the workspace
      path and the instruction to follow its own orchestrate skill, and **nothing
      else** — a test asserts the prompt contains no scenario name and no
      expectation (`rehearsals/run.test.ts`, against the literal string)
- [x] The run ends on a budget (a wall clock — `claude` 2.1.252 exposes no turn
      cap in print mode), and a run that exceeds it is recorded as `over-budget`
      rather than failed — an exhausted budget is a finding, not an error
- [x] **Observer**: reads only the workspace — git log and authors, thread
      frontmatter, each turn's `model`, job logs, queue state, and file bytes. It
      makes no assertion; it produces a record
- [x] **Scorer**: invariants fail the scenario on a single breach; judgments are
      reported as `k/N` against a declared threshold
- [x] **The three universal invariants** run on every scenario, whatever it is
      about: no event lost or double-worked, every commit authored by the server
      (nothing hand-edited), every thread file still parses
- [x] **Scorecard**: one file per pass, naming every scenario, its grade, the
      release it was run for, and for judgments the ratio — committed, readable by
      a person, and diffable between releases so a judgment that drifts is visible
      without rerunning anything (`rehearsals/scorecard.md`, rewritten per pass)
- [x] One story implemented end to end to prove the harness — *"I asked one
      question and got one answer"* (story 3), chosen because it needs nothing
      from `AGENT-059`. Note the seed had to be a thread **on a document**: a
      standalone ask now designates a resident (measured: it enqueues
      `resident.designated` and `lane.waiting` beside the `comment.created`),
      which is exactly the AGENT-059 path this story was chosen to avoid
- [x] The harness refuses to run against a workspace it did not create, and never
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

Implemented on: **fable** (claude-fable-5). Runner binary: `claude` 2.1.252 at
`/Users/theophanerupin/.local/bin/claude`. Runner model constant: `sonnet`.

### The proving pass — story 3, 3/3

Command (the exact step `docs/RELEASING.md` now names):

```
npm run build
npm run rehearse -- 03-one-question-one-answer
```

Exit code **0**. The scorecard, in full, as committed at
`rehearsals/scorecard.md`:

```
# Rehearsal scorecard

<!-- Generated by `npm run rehearse` (INFRA-033). Do not edit by hand. -->

- Release: unreleased (tree v0.30.0)
- Date: 2026-09-02T00:32:15.982Z
- Tree: v0.30.0 at b5b46442
- Runner model: sonnet

| Scenario | Grade | Result | Detail |
| --- | --- | --- | --- |
| 03-one-question-one-answer | invariant | **pass** | 3/3 runs scored |

## 03-one-question-one-answer

> I asked one question and got one answer.

- Regression for: — (spec promise)
- Declared runs: 3
- Run 1: clean (190s, ended by exit)
- Run 2: clean (95s, ended by quiescence)
- Run 3: clean (180s, ended by exit)
```

Per-run evidence, read out of the raw run records
(`rehearsals/out/2026-09-02T00-28-39.026Z/`, gitignored): every run shows the
seeded thread with exactly two turns — the user question and one `agent` reply
whose recorded model is `claude-sonnet-5` (runs 1–2) / `sonnet` (run 3) — the
seeded `comment.created` in `processed/`, `corpus doc check` exit 0, a clean
work tree, and no universal finding. Each run built a fresh `corpus init`
workspace on its own port (never 8765), spawned headless `claude` with the
two-fact prompt, and tore everything down; a post-pass sweep found no stray
runner, server, or temp workspace.

### What did not pass first, in run order — all findings, none retried away

1. **Pass 1 (before the boundary fixes) graded `fail`, 3/3 runs**, each with the
   same universal finding: a post-seed commit authored
   `user <user@corpus.local>`, subject `editing session: 2 documents by user`.
   Diagnosis from the run records: the server closes a party's commit window
   **lazily** — the agent's first write amends the seed's `user` commit into its
   "editing session" relabel, so the very commit recorded as the seed boundary
   reappears after it under a new hash. A 35 s post-seed settle wait did not
   help (measured — the relabel arrives mid-run, not on a timer). Fix: the
   snapshot records the boundary commit's **tree** hash, and the scorer excuses
   exactly one shape — a `user` commit whose tree equals the boundary's tree.
   The amend changes no content, so a real hand edit still changes the tree and
   is still flagged. In the proving pass all three excusals matched the real
   relabel byte for byte (tree `26d1b4da…`/`ec0765a9…`/`5562d97d…` per run).
2. **Story 3's original seed was wrong about the product.** A standalone thread
   with `--requests-agent true` enqueues `resident.designated` and
   `lane.waiting` beside the `comment.created` — a standalone ask designates a
   resident, which is the AGENT-059 path this story was chosen to avoid. The
   seed became a note plus a thread on it, which enqueues exactly one
   `comment.created` on the orchestrator's lane (verified against the pending
   directory before any runner was spawned).
3. **The fixture criterion's `--wait` clause is unimplementable today** — no
   workspace or environment override exists for the idle window's 480 s
   default, and both workarounds break a rule the suite is built on. Filed as
   **CLI-075** (with a PLAN.md row) rather than instrumented around. One
   observed run did sit a full park (551 s, ended by quiescence) before the
   budget; the shipped budget (15 min) absorbs it.

Also recorded, not asserted (rule 4): run 3's reply named its model `sonnet`
where runs 1–2 wrote `claude-sonnet-5` — §10 records what the writer states,
and the spelling drifts. Noted for a future scenario; no issue filed.

### Harness unit checks

`VITEST_MAX_THREADS=4 npx vitest run rehearsals` — 32 tests, 4 files, all
passing, including the rule-1 test that asserts the runner prompt's literal
string carries the workspace path, the follow-your-skill instruction, and no
test vocabulary. `npx tsc --noEmit -p rehearsals/tsconfig.json` clean.
`npm run lint` clean repo-wide. `prettier --check rehearsals` clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
