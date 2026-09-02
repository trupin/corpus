# [AGENT-063] A weightless resident is judged on the conversation, not defaulted to a tier

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Reverses: `AGENT-059`'s fixed strongest-tier default (shipped in v0.31.0)
- Related: `UI-186` (change a resident's weight from the Residents tab, which is
  what makes a judged pick safe), `AGENT-041`, SHARED-022

## Spec References

- SPEC.md **§7** — *"Stating no weight means the orchestrator decides, exactly as
  it decides today — absence of a choice is the judgment above, **never a fixed
  default**."* (rider signed 2026-08-06)
- SPEC.md **§7** — *"A stated weight is honoured, not weighed again."*

## Summary

**User directive, 2026-09-02:** *"I would like you to default to: orchestrator
picks based on the task. If I set which tier to use, then use that one."*

`AGENT-059` shipped a fixed default — a weightless designation launches at the
strongest tier the table declares. That is reverted. §7 already said the right
thing and this restores it: **absence of a choice is a judgment, never a fixed
default.**

**The unsigned §7 rider is withdrawn.** It existed only to legalise the fixed
default. With the default gone, §7 stands exactly as signed and needs no
amendment. `AGENT-059`'s open-question section goes with it.

## What must not come back with the revert

`AGENT-059` was filed for a real defect and reverting carelessly restores it.
The defect was **not** "Sonnet is the wrong model". It was that the orchestrator
was not judging at all:

- The **first pass** asks *"what would a bad result do that revising the document
  afterwards would not undo"*. A standing conversation has no single document to
  revise, so the pass answers `no` by default.
- The **second pass** is a table whose middle row reads *"Most comment work: read
  a thread and its parent, decide the wording, edit, reply — multi-step but
  bounded to one or two documents."* Every open-ended conversation reads like
  that sentence, so it lands on **Standard**, and the tie-break
  (*"in doubt between two tiers, take the stronger"*) never fires because nothing
  is in doubt.

So every weightless resident landed on the same tier by construction. That is
landing, not judging, and the user asked for judging.

**The work of this issue is therefore the judgment, not the revert.** The
orchestrator needs something it can actually weigh a *conversation* by, in the
skill's own terms, rather than a table describing bounded units of work.

## Why the judgment is safe now, when it was not before

`AGENT-059` argued for a fixed default from **durability**: §7 said a running
resident *"cannot change what it is without discarding the conversation it is
holding"*, so a wrong pick was permanent. That argument no longer holds:

- Re-designation already exists and already works. Changing the weight on a
  designated thread is a write — `resident.released` with reason `replaced`, the
  displaced listener stopped, a new `resident.designated`, a new listener at the
  new weight (`apps/server/src/threads/resident.ts`).
- The **conversation is a document on disk**. A relaunched listener reads it.
  What is actually lost is the listener's in-flight context, not the
  conversation — so §7's sentence overstates the cost. `SHARED-076` carries the
  rider that corrects it.
- `UI-186` puts that change one click away, in the Residents tab the person is
  already looking at.

A judged pick that can be corrected in one click is a different proposition from
one that is permanent. The user's two instructions are one design.

## Acceptance Criteria

- [ ] The fixed strongest-tier rule is gone from the skill — both the payload
      launch and the roster launch
- [ ] A designation stating no weight is **judged**, on the conversation, and the
      skill says what to weigh. Whatever it is, it must not be the two-pass job
      table applied unchanged, because that table lands every conversation on its
      middle row
- [ ] A designation that **does** state a weight is honoured and never weighed
      again — `AGENT-041`, untouched
- [ ] The launch still logs the weight **and where it came from**. The
      provenance word changes from `defaulted` to one that says a judgment was
      made and names what it picked — §7's dispatch rule still applies
- [ ] `scripts/workspace-template.test.ts` guards the new rule, and its negative
      pins reject the strongest-tier wording so the revert cannot silently undo
      itself
- [ ] `assets/workspace/` only; the dev harness's `.claude/` is untouched

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch rule
  (~line 529), the roster launch (~line 718), and the two Delegation carve-outs
  `AGENT-059` added (~868, ~959)
- `scripts/workspace-template.test.ts` — the guards
- `rehearsals/scenarios/02-weightless-designation.ts` — see below

### The scenario changes with the rule

`INFRA-034` story 2 currently pins `10/10` at the strongest tier. Under a
judgment that is the wrong assertion — a judged pick is *allowed* to vary, and
pinning one tier would re-impose the default through the test.

What it should assert instead is what §7 actually promises: the launch **logged a
weight and said it judged it**, and the weight is one the workspace's table
declares. The distribution stays recorded, because a judgment that lands on one
tier 10 times out of 10 is exactly the "landing, not judging" symptom this issue
is about — and the scorecard should make that visible rather than assert it away.

## Testing Strategy

Template guards for the wording, and `INFRA-034` story 2 for the behaviour. The
distribution in the scorecard is the real signal: if it reads 10/10 on one tier
after this lands, the judgment is not judging and that is a finding.

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
