# [SERVER-120] Two leftovers from PR #48's fourth review: a stale literal, and a rule the pin cannot see

## Domain

server (and agent-runtime)

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Related: CONTRACT-060, AGENT-032, UI-120

## Summary

Two MINOR findings from PR #48's fourth review, filed rather than fixed because
neither blocks and both want a moment's design thought.

### 1. A third stale literal in `liveness.ts`

`apps/server/src/queue/liveness.ts:106` — `LanePresence.since` says *"on a live
lane it is never older than one park (the contract's 480 s bound)"*.

Same class as the docblock `CONTRACT-060` just corrected two lines up, and
found by the agent that corrected it, which reported rather than widening its
own change. It differs in kind, though: this is a claim about **evidence age**,
not a derivation, so the fix is not simply "delete the number" — the sentence is
telling a reader how stale the field can be, which is genuinely useful and
genuinely needs a magnitude.

Decide whether to name the constant, restate the property without a figure, or
leave it and accept the staleness. Whichever, say why in the code.

### 2. The ownership registry cannot see an intra-file restatement

`scripts/workspace-template.test.ts`'s `SINGLE_OWNER_RULES` enforces
**cross-skill** ownership only: the owner is treated as one unit, and the check
is that non-owners have zero restatements.

`converse/SKILL.md` now states the stand-down discriminator in **five** separate
sentences — the loop rule, the startup derivation, reconciliation, Retirement,
and the worked example — two of them added by `AGENT-032`'s own commit. The
reviewer read all five and they agree today.

But `AGENT-031` already changed this rule once, and an edit to the canonical
statement that leaves the other four behind keeps the pin green. **The class
PR #48 spent four review rounds closing has an intra-file form that nothing
pins**, in the very file the pins were built for.

Worth thinking about before building: five statements of one rule in one skill
may be *right* — a skill is read in fragments by an agent following a loop, and
a rule stated only once may never be met at the moment it applies. If so, the
answer is not "fail on more than one" but something like: the canonical
statement is registered, and the others must remain consistent with it. Say
which, and if the honest answer is that no mechanical check fits, say that
rather than building one that fires on correct text.

## Acceptance Criteria

- [x] `liveness.ts:106` decided and the reasoning recorded — **name the
      constant**, in the code, beside the sentence it corrects
- [x] The intra-file question answered — **no mechanical check fits**, with the
      two candidate designs and the measurement that rejects each
- [x] Nothing added that fires on correct text: nothing mechanical was added at
      all, which is the finding

## Testing Strategy

Whatever is built must be validated against the pre-fix bodies, as AGENT-032's
were — a pin that cannot fail is not a pin.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24, branch `phase-45-not-so`.

### 1. `liveness.ts` — decided: name the constant

The three options the issue named were *name the constant*, *restate the property
without a figure*, or *leave it*. **Named the constant**, and the reasoning is in
the code where the next reader meets it.

*Leave it* loses on the record: this was the **third** copy of a number the
contract chooses, and the two above it had already gone stale once — CONTRACT-060
found this file arguing the max while the contract computed the default, with
both tests green because the two constants happened to be equal.

*Restate without a figure* loses on the issue's own objection, which is right:
the sentence is telling a reader how stale the field can be, and a reader needs
to know whether that is seconds or hours. Deleting the magnitude deletes the
usefulness.

Naming the constant keeps both. `MAX_IDLE_TIMEOUT_SECONDS` is one hop away and is
always the current value, so the magnitude stays available and the copy that can
be wrong goes. The docblock now says it in one rule the file follows in three
places: **state the property, name the constant, restate no number.**

The figure is gone from the file entirely — including from the sentence
explaining the change, which quotes nothing:

```
$ grep -c 480 apps/server/src/queue/liveness.ts
0
```

**No new pin.** A test asserting the source contains no digit would fire on
correct text, which the third acceptance criterion forbids. The property the
sentence claims is already covered: `liveness.test.ts` asserts that `since` is
set at the park and again at the release and is frozen in between, which is what
bounds it at one park.

### 2. The intra-file restatement — no mechanical check fits

**Answer: no. Nothing was built, and here is what was considered.**

The registry's shape is the reason the question is hard. `SINGLE_OWNER_RULES`
defines a rule's restatements *by vocabulary* — for this rule, `PARK_NAMED &&
HELD_ELSEWHERE` over each prose sentence — and then asserts the owner has at
least one and every non-owner has none. Inside the owner, "every sentence the
detector found carries the detector's vocabulary" is a tautology. So the
detector, as it stands, cannot check intra-file consistency at all.

**Candidate A — register the canonical statement's exact text.** Pin the
canonical sentence verbatim; when somebody edits it, the test fails and the
message says *"you changed the canonical statement of X; four other sentences in
this file restate it — check them."*

Rejected. It fires on every edit to the canonical sentence including a typo fix,
and — the fatal part — **the cheapest way to make it green is to paste the new
text in**. The failure asks for a judgment and accepts a paste, which is exactly
the pin that gets rubber-stamped. Contrast the registry's existing rules, which
fire when a *non-owner* restates something and whose fix is unambiguous: delete
the sentence and point at the owner.

**Candidate B — pin the conclusion vocabulary.** The rule's operative content is:
an id your own park named as pending, coming back held elsewhere ⇒ **exit**. So
require every sentence the detector finds to sit near the conclusion vocabulary
(`exit`, `stand down`). An edit turning one of the five into "carry on" goes red,
and a legitimate rewording that keeps the conclusion stays green.

Rejected **on measurement**. Read against the five statements in
`converse/SKILL.md` as they stand today, two carry the conclusion outright
(*"One such id is the whole of the evidence. Exit."* at the loop rule, and *"the
answer would have been to exit here"* in the worked example) and **one
legitimately does not**: the *Retirement*-adjacent statement says *"the caller
holding it is another listener on your lane, and* The loop *is where that is
answered"* — it delegates to the canonical statement instead of restating the
conclusion, which is the correct thing for that sentence to do. Candidate B fires
on it. Widening the check to accept "points at *The loop*" as a second acceptable
conclusion means the check starts encoding the rule itself, and a check that
encodes the rule is a sixth statement of it.

**So the honest answer is the one the issue anticipated.** Consistency between
five natural-language sentences is not mechanically decidable here. Any check
reduces to exact-text equality — which forces boilerplate and fires the moment an
author varies phrasing for the reading context, which is *the very reason five
statements exist* — or to a similarity threshold, which this codebase ruled off
the table permanently after SERVER-013 measured it wrong in both directions.

**And five statements is right, not a defect.** A skill is read in fragments by
an agent following a loop, and a rule stated only at the loop rule would never be
met at the moment Retirement applies. The registry's cross-skill rule is
untouched and still correct: it is about a *different skill* restating what
`converse` owns, and that has an unambiguous fix.

### What was not done, and why it is not this issue's to do

The check, had one fitted, would live in `scripts/workspace-template.test.ts` —
repo tooling, outside `apps/server`. Nothing there was edited. Since the answer
is *no check*, the boundary costs this issue nothing.

### Checks

```
npm run typecheck -w apps/server                exit 0
eslint apps/server/src                          exit 0   (no rule disabled)
VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 204 passed (204)   Tests 4662 passed (4662)   exit 0
```

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-120]` prefix
