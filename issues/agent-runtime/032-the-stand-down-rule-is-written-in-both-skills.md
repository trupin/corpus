# [AGENT-032] The stand-down rule is written in both skills, and they now contradict

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-029 (which wrote it into both), AGENT-031 (which fixed one)

## Summary

`AGENT-029` wrote the stand-down rule into **both** skills. `AGENT-031` rewrote
it in `converse/SKILL.md` and left `orchestrate/SKILL.md:345-348` on the
conjunctive form it deleted. The two copies now contradict:

- orchestrate:346 — *"its claim comes back **empty** on work its own park had
  just named, which on a live lane only another listener can cause, and it
  exits."*
- converse:260 — *"**Judge it on that id, and never on the claim being empty.**"*
- converse:287 — *"**An empty `events` is not the signal in either direction**"*

**And it is load-bearing, not commentary.** That paragraph is the justification
for orchestrate's *"Launch, and let the lane settle it"* invariant — so the
orchestrator accepts duplicate launches on the strength of a mechanism it
describes in its superseded, non-firing form.

Failure scenario, the exact two-message case `AGENT-031` measured on a real
server: L1 claims M1; L2's park named M1, its claim returns `events:[M2]`,
`inProgress:[M1]`. Under converse, L2 exits. Under orchestrate's account the
discriminator does not hold, nothing fires, and two listeners answer alternate
messages.

Nothing pins the two files against each other — none of the 278 new lines in
`scripts/workspace-template.test.ts` compares them.

**This is the fourth finding in three review passes caused by one rule written
in two places**, and the third that shipped green. That pattern is the thing to
fix, not just this instance.

## Two further findings from the same review, to fold in

**A fourth shape the three exclusions do not cover** — created by AGENT-030's
own change. It newly instructs a retiring listener to run one scoped
`claim-all`, and converse:455 already contemplates a person re-designating the
thread. So: release → listener A's park refused → thread re-designated on the
same id → listener B parks, its park names E as pending → A's *drain* claim
takes E. B sees E in `inProgress`, its own park named it, B did not claim it —
all three exclusions pass, B exits, A is leaving, and the conversation has no
listener. Narrow, but it is the one producer of the signal that is **not** a
peer listener.

**The worked example understates the rule** (converse:725): in the one scenario
this whole family concerns — a listener's first park, first claim — it gives
only AGENT-027's "leave it where it was" answer with no mention of the exit.
Not wrong; under-stated, in the same paragraph shape whose first draft stood the
*surviving* listener down during AGENT-031's drill.

## Acceptance Criteria

- [ ] `orchestrate/SKILL.md` states the rule as `converse` now states it, or —
      better — **stops restating it** and points at the skill that owns it. A
      rule that only the resident executes does not need a second full account
      in the orchestrator's text; what the orchestrator needs is the invariant
      it relies on, plus where the mechanism lives
- [ ] **The two skills are pinned against each other**, so a future edit to one
      fails a test rather than waiting for a reviewer. This is the criterion
      that matters — the instance is cheap and the class has now cost four
      findings
- [ ] The fourth shape is handled or explicitly declared out of scope with
      reasoning. If a retiring listener's drain claim can evict a healthy
      successor, say what prevents it
- [ ] The worked example carries both answers
- [ ] Drilled: the two-message case, showing one conversation ends with one
      listener, with both skills' text in play rather than converse's alone

## Testing Strategy

Template assertions, including the cross-file pin. The drill is two live
listeners and two messages.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-032]` prefix
