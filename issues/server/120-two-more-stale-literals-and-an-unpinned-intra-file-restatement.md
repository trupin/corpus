# [SERVER-120] Two leftovers from PR #48's fourth review: a stale literal, and a rule the pin cannot see

## Domain

server (and agent-runtime)

## Status

todo

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

- [ ] `liveness.ts:106` decided and the reasoning recorded
- [ ] The intra-file question answered — with a check if one genuinely fits, and
      with a written reason if not
- [ ] Nothing added that fires on correct text: a pin that cries wolf gets
      baselined away, which is worse than no pin

## Testing Strategy

Whatever is built must be validated against the pre-fix bodies, as AGENT-032's
were — a pin that cannot fail is not a pin.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-120]` prefix
