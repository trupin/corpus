# [INFRA-038] A skill has no size budget, so the instructions grow faster than anything measures

## Domain

infra

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: the shrink work this check turns into lint debt (to be filed per file,
  once the check names the numbers)
- Related: INFRA-020 (`test:slow` — the report-don't-gate precedent, and the
  reason this one *can* gate), INFRA-025 (the rule for where a check belongs),
  INFRA-033 / INFRA-034 (the rehearsal harness — the only thing that tests
  whether a skill *works*, as opposed to how big it is)

## Spec References

- **CLAUDE.md** → *Verification Is On Demand* — *"a check that can run on the
  diff runs locally; a check that needs the whole codebase is CI's"* (user,
  2026-08-07)
- SPEC.md **§7** — the Claude Code roots a workspace carries
- **CLAUDE.md** → *Product vs. dev harness* — `assets/workspace/` is product
  code; `.claude/` is the development harness. The two trees are separate on
  purpose.

## Summary

Reported from live use, 2026-09-03, with measurements. Counted the way this repo
counts: **1 token ≈ 4 bytes**.

Nothing in this repository measures how large an agent's instructions have
grown. So they have grown, unopposed, and nobody had a number until somebody
went looking:

| File | Bytes | ≈ tokens |
| --- | --- | --- |
| `assets/workspace/claude/skills/orchestrate/SKILL.md` | 167,737 | **~41,900** |
| `assets/workspace/claude/skills/converse/SKILL.md` | 64,952 | **~16,200** |
| `assets/workspace/claude/skills/comment/SKILL.md` | 41,132 | **~10,300** |
| `.claude/agents/server-dev.md` | 37,602 | ~9,400 |
| `.claude/agents/agent-runtime-dev.md` | 28,462 | ~7,100 |
| `.claude/agents/contract-dev.md` | 21,084 | ~5,300 |
| `assets/workspace/claude/skills/profile/SKILL.md` | 18,972 | ~4,700 |
| `.claude/agents/infra-dev.md` | 16,488 | ~4,100 |

The product's orchestrate skill is **42,000 tokens the agent reads before it does
anything**. That is not a style problem. It is the largest fixed cost in the
product, it is paid on every run, and it grew there one well-argued paragraph at
a time — because every individual addition was justified and nothing ever
measured the total.

**Add a size check to this repository: a pre-commit check on the diff, and a CI
check over the whole tree.** *(User instruction, 2026-09-03.)*

## Why a check rather than a cleanup

A cleanup fixes the three files and changes nothing about the mechanism that
produced them. The check turns the shrink work into **lint debt with a definition
of done** — a number, a threshold, and a run that says whether today is better
than yesterday. Every one of the eight files above fails on day one at any
proposed threshold. **That is the point**, not an argument against the check.

## Where it runs, and why that is not a judgment call

INFRA-025 settled the rule and this check lands on the easy side of it.

- **Pre-commit, on the staged file list.** A byte count is a `stat` and a read.
  It is the cheapest check in the hook by a wide margin — cheaper than the
  `npm audit` round-trip already there — and it is perfectly diff-scopable: the
  staged list already exists in the hook as `$staged`, and the check reads only
  the files on it. **Do not add a whole-tree scan to the hook.** INFRA-025 exists
  because someone did that before.
- **CI, over the whole tree.** The `validate` job already runs `version:check`,
  `issues:check` and `spec:check` — repo-tooling checks in exactly this shape.
  This joins them. The whole-tree run is what catches a file nobody touched
  drifting past a threshold somebody lowered.

## What the rule is

A `SKILL.md` body, or an agent-profile body, must stay under a token budget,
counted **deterministically as bytes ÷ 4**.

- **Numbers are open.** Aspiration: **1K tokens**. Proposed enforcement: **warn at
  2K, error at 4K**. Settle them against the table above and record what was
  chosen and why.
- **Over budget → split, and there are exactly two ways:**
  1. Extract a reusable piece into a **separate skill**. Invocable in its own
     right, and skills can link to each other.
  2. Extract it into a **reference file** the skill points to. Guidance, not
     invocable on its own.
- **The check also reports each `references/` file's size**, so shrinkage by
  relocation stays visible. A skill that halved by moving 20KB into
  `references/` did something real, and a report that showed only the SKILL.md
  would call it a 50% win.
- **Anti-gaming rule, and it is load-bearing.** *Content every run must read
  counts toward the budget wherever it lives.* A stub reading `always read
  references/everything.md first` fails the spirit of the check. **The split
  rule: move only what a minority of runs reads.**

## The hard part: this check cannot mechanically enforce its own anti-gaming rule

Say it here rather than discovering it in review. "Content every run must read"
is a claim about **how a skill is written**, and no byte counter can evaluate it.
A `SKILL.md` that shrinks to 900 tokens by pointing at four reference files is
either a good split or a lie, and the difference is in the prose.

Two honest responses, and the issue should take both:

1. **Report the total as well as the parts.** Print the SKILL.md's own size, each
   reference's size, and their **sum**. A split that moved bytes without reducing
   what a run reads shows up as a flat sum. The check cannot judge it, but it can
   make it impossible to miss.
2. **Do not claim the check enforces the rule.** The rule is for authors and for
   review. The check enforces the number. CLAUDE.md's own note about
   `workspace-template.test.ts` — 404 guards that all check wording and none check
   truth — is the standing warning here. INFRA-033/034's rehearsal is the only
   thing in this repo that tests whether a skill *works*; a size check tests
   whether it is *affordable*, and those are different questions.

## How it lands on day one, when everything fails

The single real decision in this issue.

`test:slow` (INFRA-020) reports and deliberately does not gate, because its
numerator is wall-clock time on a shared machine and a blocking form would go red
for reasons unrelated to the code. **That reasoning does not carry here.**
`bytes ÷ 4` is the same number on every machine, every run. This check *can* gate
honestly. The only obstacle is that eight tracked files already exceed the
budget, and a hook that goes red on every commit is a hook that gets
`--no-verify`d.

**Recommended shape — a ratchet:**

- **Error if a file over budget grows**, measured against a committed baseline of
  current sizes. This gates from day one, blocks nobody, and makes the direction
  of travel the thing that is enforced.
- **Warn while a file is over budget** and not growing, naming the threshold and
  the gap.
- **Error on the absolute threshold** for files that were under budget when the
  baseline was written — a new skill has no excuse.
- Flip the over-budget files from warn to error, one at a time, as each shrink
  lands. The baseline shrinks with them and never grows.

*Rejected, and record why if you choose otherwise:* **report-only**, because the
INFRA-020 reason for it does not apply and a report nothing enforces is how these
files got to 42K tokens; and **absolute error from day one**, because it makes
every commit in this repo red until three large rewrites land, and the
predictable outcome is the hook being disabled rather than the files being cut.

## Acceptance Criteria

- [ ] `npm run skills:check` reports every tracked `SKILL.md` and agent profile
      with its bytes, its token estimate, and its verdict.
- [ ] Each skill's `references/` files are reported with their sizes and **their
      sum with the SKILL.md**.
- [ ] The pre-commit hook runs it **on the staged list only**, and adds **under
      1 second** to a commit. Measure it and record the number — INFRA-025's first
      two attempts guessed and were wrong.
- [ ] CI's `validate` job runs it over the whole tree.
- [ ] Enumeration is by **`git ls-files`**, not `find`. `.claude/worktrees/` is
      gitignored and contains a full second checkout of this repo — a `find`-based
      scan reports every skill twice and blames the wrong file.
- [ ] Both trees are covered: `assets/workspace/claude/` (product) and `.claude/`
      (dev harness).
- [ ] A commit that grows an over-budget file **fails**, and the message names the
      file, its old size, its new size, and the two split options.
- [ ] A commit touching no skill or profile prints a skip line and costs nothing.
- [ ] The thresholds live in one place, alongside the baseline.

## Technical Design

### Files to Create/Modify

Follow the house pattern the four existing checks use — logic in one module with
its own unit tests, a thin runner that reads files, prints, and sets an exit code:

- `scripts/skill-budget.ts` — new. The measurement, the enumeration, the
  thresholds, the baseline comparison, the verdict. Unit-testable with no file
  system beyond what it is handed.
- `scripts/skill-budget.test.ts` — new.
- `scripts/check-skill-budget.ts` — new. The runner. Takes an optional staged
  file list; with none, walks the whole tree. Compare `scripts/check-slow-tests.ts`
  for the shape and for how it documents its own gating posture.
- `scripts/skill-budget-baseline.json` — new, committed. Current sizes.
- `package.json` — `"skills:check": "node --import tsx scripts/check-skill-budget.ts"`.
- `.githooks/pre-commit` — one `step` call, given the existing `$staged` list.
- `.github/workflows/ci.yml` — one step in `validate`, beside `spec:check`.

### Key Implementation Details

- **Counting.** `Buffer.byteLength(contents, "utf8") / 4`, rounded consistently.
  Say in the output that it is an estimate and what the ratio is. Do not reach
  for a real tokenizer: it adds a dependency, it is model-specific, and the whole
  value of this number is that anybody can reproduce it with `wc -c`.
- **What counts as a body.** Decide whether YAML frontmatter counts. It is read
  by the harness, so the honest answer is probably yes — but state it, because a
  reader comparing the check's number to `wc -c` must be able to reconcile them.
- **What is in scope.** `**/SKILL.md` under a `skills/` directory, and `*.md`
  under an `agents/` directory. Not `PROVENANCE.md`, not `README.md`, not
  `CLAUDE.md` — those are not what an agent loads to do work. Record the glob.
- **Same budget for both trees?** Decide. An argument each way: the product's
  skills are paid by every user on every run, so they deserve the tighter budget;
  the dev harness's agent profiles are paid by this repo alone. Recommendation:
  **one budget**, because two budgets is a second number to argue about and the
  larger tree is the product's anyway.
- **The baseline is committed and only ever shrinks.** A regeneration command
  (`--update-baseline`) that refuses to raise an entry is what keeps the ratchet a
  ratchet. If it can be raised by running a command, it is not a ratchet.

### Edge Cases

- A **new** skill added over the absolute threshold: errors. It has no baseline
  entry, so the ratchet does not shield it.
- A skill **deleted**: its baseline entry goes. The check should not fail on a
  baseline entry with no file — it should say the baseline is stale and how to
  regenerate.
- A skill **renamed**: reads as a delete plus an add, so the new path errors
  against the absolute threshold even though nothing grew. Decide and document —
  matching on content length, or accepting the false positive with a clear
  message, are both defensible. Silently passing it is not.
- `.claude/worktrees/` and anything else gitignored: excluded by construction via
  `git ls-files`. A test asserts it.
- The hook running **outside a git repo**, or with an empty staged list: skips
  cleanly, exit 0.
- A skill file that is **not valid UTF-8**: report it and fail. A file the check
  could not measure must not be reported as passing — INFRA-015's rule, that a
  gate whose failure mode is silence is a gate that lies.

## Testing Strategy

Vitest, `scripts/skill-budget.test.ts`, against fixture inputs — no reliance on
the repo's real skill files, whose sizes will change.

- Under budget, over warn, over error, and each ratchet case (grew / shrank /
  unchanged while over) produce the right verdict and exit code.
- A skill with references reports each one and the correct sum.
- The enumerator excludes gitignored paths — assert `.claude/worktrees/` is not
  in the result on a fixture repo.
- `--update-baseline` refuses to raise an entry.
- A non-UTF-8 file fails rather than passing.
- One test measures the **real** repo and asserts only that the check runs and
  produces a verdict for every tracked skill — not what the verdict is. That is
  what keeps this test from breaking every time somebody edits a skill.

## E2E Verification Plan

### Verification Steps

1. `npm run skills:check` on the current tree. Record the full output. It should
   name all eight files in the Summary table with those numbers.
2. Append one paragraph to `assets/workspace/claude/skills/comment/SKILL.md`,
   `git add` it, `git commit`. **Confirm the hook blocks it** and that the
   message names the file, both sizes, and the two split options. Revert.
3. Time the hook on that same commit: `time git commit`. Record the delta against
   a commit with nothing staged. Confirm it is under a second.
4. Commit a change to a TypeScript file with no skill staged. Confirm the check
   prints its skip line and adds no measurable time.
5. Push a branch and confirm the CI `validate` step runs and reports.
6. Move 3KB out of a skill into a new `references/` file. Confirm the report
   shows the SKILL.md smaller, the new reference listed, and **the sum
   unchanged** — the anti-gaming visibility working as designed.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: exact commands, the full first report, the blocked commit, the
two timings]_

## Completion Checklist (domain agent)

- [ ] Thresholds settled and the reason recorded in this file
- [ ] The gating posture (ratchet vs. alternatives) settled and recorded
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, including the measured hook cost
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches the hooks and CI — qualifies)
- [ ] The per-file shrink issues are filed once the check names the numbers
- [ ] Committed with `[INFRA-038]` prefix
