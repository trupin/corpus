# [SHARED-070] What else the agent pays for — a measured audit of token cost

## Domain
shared

## Status
todo

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 7 — the agent loop, the queue and parking
- CLAUDE.md, second architecture decision — "The agent interacts with the system
  **only through the CLI**"

## Summary

Phase 39 came from one dogfood report on 2026-08-21. It produced seven findings
and six measurements, and every one of them was something a person **noticed**
while working. That is a good way to find the largest cost and a poor way to find
the total.

This issue asks the other question: **over a real agent loop, where does the
context actually go?** Not "which command prints the most", but "which cost,
multiplied by how often it is paid, dominates the transcript".

The deliverable is a measured report and a set of filed issues, each carrying its
own number. It is deliberately **not** an implementation issue. Nothing here
changes a command.

## Why the ranking matters more than the list

CLI-055 measured a 175× context saving on one read path. CLI-056 measured 7,000
words to read four help topics. Both are real, and neither says how many times a
loop pays them.

A 200-word answer paid 300 times in a session costs more than a 3,500-word answer
paid once, and no one has counted either. An audit that reports per-call costs
without frequencies will re-find CLI-055 and stop.

## Acceptance Criteria

- [ ] A real agent loop is run against a real workspace — the product's own
      `orchestrate` skill in a scratch workspace, not a synthetic script — and
      its whole transcript captured.
- [ ] Every CLI invocation in that transcript is counted: words in (the command,
      its flags, its stdin) and words out (stdout, stderr, exit path).
- [ ] Costs are ranked by **total** — per-call cost times call count — and the
      ranking is published in the report, not only the top entry.
- [ ] The audit covers all five surfaces the agent reads, and says so per
      surface:
      1. command **output**, both human and `--json`
      2. **help** text, at every level
      3. **error** messages and refusals
      4. the **skills the product installs** (`assets/workspace/`), which the
         agent reads every turn before it runs anything
      5. the **queue and job** surface, including what parking and re-arming cost
- [ ] Each opportunity worth acting on becomes an issue file with a PLAN row, a
      measurement, and an estimate of the saving.
- [ ] Anything measured and found **not** worth acting on is written down too,
      with its number. A finding that was checked and dismissed is what stops the
      next audit re-checking it.
- [ ] The report states what it did **not** measure. A coverage claim nobody
      bounded reads as "everything", which is how a second dogfood report
      arrives with findings this audit could have caught.
- [ ] Nothing in this issue changes a command, a flag or an output. Every change
      lands in an issue of its own.

## Technical Design

### Files to Create/Modify
- `issues/evals/` or a sibling — the report, wherever a measured artifact
  belongs. Choose the existing home rather than inventing one.
- `issues/<domain>/NNN-*.md` — one per opportunity found
- `issues/PLAN.md` — their rows

### Key Implementation Details

**Measure, do not read.** Every number in this report comes from a captured
transcript or a run command. A count derived by reading a source file is an
estimate, and Phase 39's value was that six of its seven findings were measured.

**Words, and tokens where they differ.** Phase 39 counted words, so the report
should stay comparable with it. Where a surface is mostly punctuation, JSON or
identifiers, words understate the token cost badly — say so and count both.

**Count the skills.** `assets/workspace/` is the one surface the agent reads on
**every** turn, before any command runs, and no issue in Phase 39 touched it. It
may be the largest fixed cost in the product and nobody has measured it.

**Count the failures.** An agent that gets a refusal reads it, reasons about it,
and retries. A verbose error is paid twice — once to read and once to recover —
and error paths are absent from Phase 39 entirely.

**Do not propose a session mode here.** CLI-058 already holds that question, with
the reasoning for why it is not obviously right. This audit feeds it numbers and
leaves the decision where it is.

**Do not fold findings into existing issues.** If the audit finds more on a path
CLI-056 or CLI-057 already covers, note it against that issue and leave its scope
alone. Widening a filed issue during an audit is how an audit becomes a rewrite.

### Edge Cases
- A loop that fails part-way. Its transcript is still data, and the recovery path
  is one of the five surfaces.
- A workspace with no documents. Costs paid before any work exists are the fixed
  floor, and worth naming separately from the variable cost.
- The `--json` path where no skill uses it. Cheap output nobody reads is not a
  saving.

## Testing Strategy

None — this issue produces a report and issue files. The check is that every
number in the report names the command that produced it, and that a second person
can re-run it.

## E2E Verification Plan

The audit **is** the E2E work: a real workspace, a real agent loop, real
invocations, no mocks and no test clients.

### Verification Steps
1. `corpus init` a scratch workspace
2. Run the product's `orchestrate` skill over a seeded corpus, capturing every
   invocation and its output
3. Produce the ranked table
4. File the issues

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills: the workspace, the loop, the captured counts, the ranking]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
