# [AGENT-067] `orchestrate` costs 42K tokens before it does anything

## Domain

agent-runtime

## Status

todo

## Priority

P0 — raised from P1 on the user's token-consumption directive (2026-09-05): the
skill files are the largest fixed token cost in the product, and this issue is
part of the sequenced plan that removes it.

## Model

fable

## Dependencies

- Depends on: **AGENT-066** (the two extractions, which remove 15% first)
- Related: **INFRA-038** (the budget), **INFRA-039** (the harness that says
  whether the split broke the loop), AGENT-065 (same underlying cause in
  `converse`)

## Spec References

- SPEC.md **§7** — the agent loop
- **INFRA-038** — warn 2K tokens, error 4K, counted as bytes ÷ 4

## Summary

`orchestrate/SKILL.md` is **41,934 tokens**. After AGENT-066 removes the two
inlined procedures it is about **35,500**. INFRA-038's error line is 4,000. The
gap is not a lint fix, and no threshold makes it one.

**Where the mass is**, measured by section:

| Section | Tokens | Share | Read by |
| --- | --- | --- | --- |
| Writing a document | 7,525 | 18% | a minority of dispatches |
| Routing | 7,427 | 17% | every run — partly |
| Delegation | 6,388 | 15% | every run — partly |
| Claiming and batching | 2,233 | 5% | every run |
| Several commands in one invocation | 2,011 | 5% | every run |
| The loop | 1,745 | 4% | every run |
| Worked example | 1,122 | 3% | no run |
| everything else (14 sections) | ~7,000 | 17% | mixed |

The three largest sections are half the file.

**Nothing in it is wrong, and that is the difficulty.** The file grew one
well-argued paragraph at a time, each answering a real objection. What it lacks
is any separation between the instruction and the argument that earned it. A
model reading 42K tokens of uniformly-weighted prose cannot tell a four-word rule
from a four-paragraph justification, which is the same failure AGENT-065
describes in `converse`.

## The split rule, from INFRA-038

> Content every run must read counts toward the budget wherever it lives. Move
> only what a minority of runs reads.

Applied section by section:

- **Writing a document (7,525)** — the orchestrator **never writes a document**.
  Its own first Delegation sentence: *"You never work a job inline — not a
  one-line answer, not a 'quick' edit, no exception."* This section exists to be
  pasted into subagent prompts. After AGENT-066 removes the two procedures that
  needed it, check whether anything still does. **If nothing does, it is not a
  reference file — it is dead weight, and it is deleted.** Establish which before
  moving it.
- **Routing (7,427)** — the table is small and every run reads it. The bulk is
  listener-launch case law: what `live` means in two situations, a carried
  release, a re-designation that only changes the weight, why the rule reversed.
  **The decision stays. The case law goes to `references/launching.md`.**
- **Delegation (6,388)** — the instruction is two sentences and a table: judge the
  weight, pass it as the call's `model` argument. Around it sits litigation of
  cases that fire rarely — a stated weight lighter than the first pass calls for,
  a weight that cannot be honoured, two nulls that are not a match, what a
  composer reads out of the table. **Instruction and table stay. The rest goes to
  `references/weight.md`.**
- **Worked example (1,122)** — read by a person once, by a run never. Reference
  file.

**The tier table is load-bearing and does not move.** Delegation records that a
composer in the app parses that table out of this document, by its header cells,
to offer weights to a person. Moving it changes what the product offers. It stays
in `SKILL.md`, in place, with its header cells spelled as they are.

## Target

**A stated budget, chosen by the implementer and recorded here.** INFRA-038's 4K
error line is the destination for a skill. `orchestrate` is the workspace's core
loop and may earn an exception, and if it does, that exception is written down
with a number rather than left as "it is big because it is important."

Recommended: aim for **under 8K tokens** in `SKILL.md`, and record why the
exception over 4K is justified. That is a 5× reduction and it leaves room for
everything a run genuinely reads.

## What must not happen

- **No stub-and-redirect.** INFRA-038's anti-gaming rule binds this issue
  directly: a `SKILL.md` that shrinks to 900 tokens by opening with *"read
  `references/everything.md` first"* has moved bytes and saved nothing. The check
  reports the sum for exactly this reason, and the sum is what this issue is
  judged on for anything every run reads.
- **No rule is dropped while shrinking.** Every rule in the file was written
  because something went wrong. This issue moves reasoning and deletes only
  duplication. A rule that looks unnecessary is escalated, not cut.
- **No rewrite of the tier table's structure.**
- **Not done in one pass with no measurement.** See below.

## This is the highest-risk change in this phase, and it needs the harness

`orchestrate` is the workspace's core loop, and its own *If the loop breaks*
section exists because **a broken orchestrate has no running agent to repair it**
— the operator has to restore it by hand from git.

`workspace-template.test.ts` cannot help here. It carries 404 guards and every one
checks wording, never whether an instruction still works. CLAUDE.md says so
directly, and it names this exact class of miss.

**So the rehearsal harness is the gate.** INFRA-033 and INFRA-034 built it — a
real model, the real installed skills, a real workspace, assertions that read only
what the corpus records. Its nine scenarios run **before and after** this change,
and the issue records both scorecards. A scenario that passed before and fails
after is a rule this split lost, and it is restored rather than argued with.

**Do it in reviewable steps, measuring between them.** One section per commit —
Writing a document, then Routing, then Delegation, then the example — with the
rehearsal scorecard recorded at each. A single 30K-token deletion is not
reviewable and its failure would not be attributable.

## Acceptance Criteria

- [ ] `orchestrate/SKILL.md` meets the stated target, and the target is recorded
      in this file with its reason.
- [ ] Every extracted piece lives in `orchestrate/references/`, and each is
      reachable by a named pointer from the section it left.
- [ ] The tier table is unmoved and its header cells unchanged.
- [ ] The nine rehearsal scenarios score **no worse after than before**. Both
      scorecards are in the E2E log.
- [ ] The sum of `SKILL.md` and its references is reported, per INFRA-038.
- [ ] Nothing every run reads was moved out. The issue names, per moved piece, why
      a minority of runs reads it.
- [ ] `workspace-template.test.ts` passes, with guards updated rather than deleted
      where a moved sentence broke one.
- [ ] Four commits or more, one per section, each with its scorecard.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/orchestrate/references/launching.md` — new.
- `assets/workspace/claude/skills/orchestrate/references/weight.md` — new.
- `assets/workspace/claude/skills/orchestrate/references/worked-example.md` — new.
- `scripts/workspace-template.ts` and `.test.ts`.

### Key Implementation Details

**Determine `Writing a document`'s fate first**, because it is the largest single
piece and the answer changes what this issue does. After AGENT-066, search every
remaining dispatch for something that pastes it into a prompt. If one exists, it
is a reference. If none does, it is dead and it goes.

**A pointer must say when to follow it.** *"See `references/weight.md`"* is a
pointer a model follows always or never. *"Where the request stated a weight you
cannot meet, `references/weight.md` has the three causes and the rule"* is a
pointer with a condition. Write the second kind everywhere.

### Edge Cases

- A reference file a subagent needs but cannot see. A subagent inherits nothing,
  so a dispatch that depends on a reference must carry it or name it by path.
  Decide which, and be consistent.
- An upgraded workspace with the old single-file skill. `corpus upgrade` is what
  reconciles it — confirm rather than assume.

## Testing Strategy

- `workspace-template.test.ts` guards for each reference file, and for the tier
  table's header cells surviving verbatim.
- A size assertion on `SKILL.md` at the stated target, so it cannot creep back.
- INFRA-038's own check, once it exists, over the result.
- The rehearsal suite, before and after, per section.

## E2E Verification Plan

### Verification Steps

1. Run the nine rehearsal scenarios on the current tree. Record the scorecard.
2. Make one section's extraction. Re-run. Record. Repeat per section.
3. `corpus init` a scratch workspace and run a real orchestrator loop through at
   least one `comment.created`, one `resident.designated` and one unknown type.
4. Record `SKILL.md`'s size and the sum with its references.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: five scorecards, the real loop run, the sizes]_

## Completion Checklist (domain agent)

- [ ] Before and after rehearsal scorecards for every step
- [ ] The target and its justification recorded in this file
- [ ] `Writing a document`'s fate determined by search, not by assumption
- [ ] `/lint` passes
- [ ] E2E log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (core loop, large — qualifies twice)
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-067]` prefix, one commit per section
