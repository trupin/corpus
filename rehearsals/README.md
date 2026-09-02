# Rehearsals

An agent-in-the-loop rehearsal suite (INFRA-033). Each run seeds a fresh Corpus
workspace, starts a real `claude` session in it, lets that agent follow the
orchestrate skill the workspace installed, and grades what the corpus recorded
afterwards. The subject is the whole loop — the skills, the CLI and the server
together — because that is the layer nothing else in this repository executes.

This is **not** a test suite in the CI sense. It runs once per release, before
the version bump, from `docs/RELEASING.md`. It is never wired into `npm test`,
the PR gate, or `CI / validate`, and it cannot run in GitHub Actions, because
the runner spawns agents. The committed scorecard is what makes the gate
auditable: an unenforceable step needs a durable artifact, or "did we run it?"
stops being answerable.

## How to run a pass

```sh
npm run build                       # the harness runs the tree's own CLI build
npm run rehearse                    # every scenario, full N each
npm run rehearse -- 03-one-question-one-answer          # one scenario
npm run rehearse -- --release v0.31.0                   # label the pass
```

The pass writes `rehearsals/scorecard.md` (committed, one file, rewritten each
pass so `git diff` between releases shows drift) and raw per-run records under
`rehearsals/out/<stamp>/` (gitignored — evidence for investigating a finding,
never something a scorer reads). The command exits non-zero when any scenario
did not pass, so a release script cannot walk past a finding unread.

## The four rules

These are the design. A change that breaks one of them makes the suite worth
less than nothing — a green board over an unobserved system. Do not weaken them
for convenience, and treat any patch that does as a defect.

### 1. The runner knows nothing about the test

The prompt the spawned agent receives carries exactly two things: the workspace
path, and the instruction to follow the orchestrate skill installed in that
workspace. No scenario name, no expected outcome, no hint of what will be read
afterwards. The agent must meet the workspace exactly as a user's agent does —
the moment the prompt leaks what is being measured, the run measures an agent
told what to do rather than a skill doing its job, and every green result from
it is worthless. `run.test.ts` asserts this against the literal string
`runnerPrompt` builds, and the temp directories are deliberately named without
words like "rehearsal" so the path itself does not whisper it either.

### 2. Assert only what the corpus records

The scorer reads what the product wrote: git history and authors, thread
frontmatter and each turn's recorded model, queue event state on disk, job
logs, file bytes. Never the agent's transcript, never anything the harness
instrumented into the run. If something worth checking is not recorded by the
product, that is a product gap — **file an issue that makes the product record
it**; do not teach the harness to see it some other way. The suite exists to
drive observability, not to route around its absence. (The runner's stdout and
stderr are kept in the run record for a human investigating a finding. No
scorer reads them.)

### 3. Invariants and judgments are different tests

An **invariant** must hold on every run it gets. One breach fails the scenario,
and its N is small (default 3) because repetition is not what it is for.
A **judgment** is a ratio: the subject is stochastic, so the result is `k/N`
against a declared threshold, with N large (default 10) because the ratio _is_
the result. Do not convert one into the other. A rule that produces the right
outcome 6/10 times is a broken rule that a boolean assertion would call green —
and a judgment squeezed into a single boolean run hides exactly that.

### 4. Never assert prose

Not the agent's wording, not a log line's phrasing, not a console message. Only
what changed: files, git, queue state, recorded models. Prose can read
perfectly and be wrong about a subject it never names — the outcome is what
gives it away. (Recording prose in the run record is fine. Grading it is not.)

## Universal invariants

Every run of every scenario, whatever it is about, is additionally checked for:

1. **No event lost or double-worked.** Every event that existed at seed time is
   found in exactly one queue status directory afterwards, no event file
   appears in two directories, and no queue file is unreadable.
2. **Every commit is the server's.** Every commit after the seed is authored
   `agent <agent@corpus.local>` and the work tree is clean. A `user`-authored
   commit after the seed is the watcher committing a hand edit; a recovery
   commit is an unclean stop. Both are breaches. One precise exception: the
   server closes a commit window lazily, so the run's first agent write amends
   the seed's own `user` commit into its "editing session" relabel — same
   content, new hash, after the boundary. The scorer excuses exactly that
   shape, a `user` commit whose tree hash equals the seed boundary's tree; a
   real hand edit changes the tree and is still flagged.
3. **Every document still parses.** `corpus doc check` (the product's own
   validator) exits clean, and every thread file yields frontmatter and turns.

Because they run on every run, they accumulate samples across the whole pass
even though each scenario's own N is small.

## How a run is bounded

A run ends the first of three ways:

- **Quiescence** — the queue holds nothing pending and nothing in progress,
  some event has reached a settled state, and that has held for a grace period.
  The runner is then stopped; a parked agent loses nothing by being stopped.
- **Budget** — the scenario's wall-clock budget expires. The run is recorded
  `over-budget` and still observed and reported. An exhausted budget is a
  finding, not an error, and never a retry.
- **Exit** — the runner ends on its own.

There is no turn budget: `claude` 2.1.252 offers no `--max-turns` in print
mode, so wall clock is the budget the issue names.

Expect a run to take minutes. `corpus queue idle` parks for its default 480 s
window and nothing in the product lets a workspace shorten that default, so a
run that settles after its park can sit most of that window. The harness will
not put an operational hint in the prompt (rule 1) and will not shim the CLI
(rule 2's spirit) — the missing knob is filed as a product gap (CLI-075).

## The runner

`run.ts` starts `claude` headless as an ordinary child process:

- `-p <prompt>` — the two-fact prompt described by rule 1, passed as one argv
  entry, never through a shell.
- `--output-format json` — the result document lands in the run record for
  humans; nothing grades it.
- `--dangerously-skip-permissions` — the run is unattended, and nothing else
  could let it act. **Read the caveat under Safety before running a pass**: this
  flag grants the agent the operator's own reach, and does not confine it to the
  workspace.
- `--setting-sources project` — the run reads the workspace's own `.claude/`
  and nothing of the developer's user-level configuration, so what the agent
  does is a function of the workspace alone.
- `--model` from `RUNNER_MODEL` — an operational constant, not a subject:
  scenario assertions about models read the _dispatched_ work's recorded
  models, which the skill chooses explicitly per launch.

The child's environment is scrubbed of every `CORPUS_*` variable, and a `corpus`
shim directory is prepended to `PATH` so the agent finds the tree's own CLI
build the way an installed user would.

## Safety

- The harness refuses to act on any workspace it did not create: every
  operation verifies the nonce marker the fixture wrote beside the workspace.
- It never touches port 8765 — that is the operator's live server. The port
  allocator will not hand it out, and the workspace's own server is started,
  health-checked and stopped through the workspace's own CLI only.
- Runs are agents, not workers: concurrency is capped low and starts are
  staggered. Every child the harness starts is stopped before the pass ends.

**What is not achieved, stated plainly.** The runs are isolated from each other
by ignorance, not by confinement. `--dangerously-skip-permissions` gives the
child the operator's own reach: an errant run can read or write anything that
account can — another run's temp workspace, this repository, `$HOME` — and
nothing stops the _agent_ addressing port 8765 over HTTP, because the refusals
above bind the harness's operations and not the agent's. What the harness does
achieve is a fresh workspace per run, a scrubbed environment, project-only
settings, a neutral temp prefix, and an agent told only its own path.

This matters because story 7 deliberately hands hostile input to that
unconfined agent. Nobody has been harmed by it and the design does not rely on
luck — the point of the story is that the CLI's `--flag-file` keeps the value
out of a shell — but a person deciding whether to run a pass should know what
they are granting. Run it on a machine you would run an agent on.

## Writing a scenario (INFRA-034)

A scenario is one small declarative file in `scenarios/`: id, the user story in
the product's own terms, the issue it is a regression for, grade, N (and
threshold for a judgment), a wall-clock budget, a `seed` that builds workspace
state **through the `corpus` CLI only**, and a pure `score` over the run
record. Seeding through the CLI is load-bearing: a hand-written seed tests a
state the product cannot reach. Register the scenario in `scenarios/index.ts`.
