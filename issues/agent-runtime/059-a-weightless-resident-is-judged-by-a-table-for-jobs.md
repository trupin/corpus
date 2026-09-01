# [AGENT-059] A resident designated with no weight is judged by a table written for jobs, so every conversation lands on Sonnet

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: — (the machinery this needs all shipped)
- Related: AGENT-041 (made a *stated* weight reach the launch — this is the
  unstated case), AGENT-039, SHARED-022 (the tier table is the one declaration),
  CONTRACT-067 / SERVER-129 / CLI-053 (the weight's wire, storage and CLI flag)

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per
  message"*, and it cannot change *"without discarding the conversation it is
  holding, which is the thing a resident exists to keep"* (rider signed
  2026-08-19)
- SPEC.md **§7** — *"Stating no weight means the orchestrator decides"* (rider
  signed 2026-08-06). This is the clause the skill implements, and the gap is
  what "decides" was taken to mean for a **resident** rather than a job.
- SPEC.md **§7** — *"A dispatch says what weight it went out at, and where that
  weight came from"*

## Summary

Reported from live use, 2026-09-01. The operator asked their orchestrator why it
had launched two listeners on Sonnet. The agent's answer was correct in every
particular, which is what makes this a defect in the skill and not in the agent:

> Both designation payloads had `weight: null` … The roster rows also showed no
> "at `<weight>`" qualifier — just "a general resident". Per the skill, null
> weight means I judge. I ran the second pass (difficulty) and landed on Sonnet
> for open-ended conversations.

**Nothing was broken along the way, and that was checked before writing this.**
The weight table parses out of the shipped skill (`parseWeightLevels` returns all
three levels), the UI offers those rows when designating, `corpus thread
designate` takes `--weight`, and the contract, server and CLI all carry the field.
A weight that *is* stated reaches the launch — that is AGENT-041, done. The
person simply designated two general residents without choosing a weight, which
the spec explicitly permits.

**The defect is what the skill does next.** For a listener whose designation chose
no weight it says:

> A row that prints nothing after the resident is a designation that chose no
> weight, and you decide as you decide for a `null`.

which sends the orchestrator to the two-pass judgment written for **dispatching a
job**. Neither pass describes a resident:

- The **first pass** asks *"what would a bad result do that revising the document
  afterwards would not undo"*. A listener has no single output and no document to
  revise, so the question does not apply and the pass answers `no` by default.
- The **second pass** is a table whose middle row reads *"Most comment work: read
  a thread and its parent, decide the wording, edit, reply — multi-step but
  bounded to one or two documents."* An open-ended conversation reads exactly
  like that sentence, so it lands on **Standard → Sonnet**, and the tie-break
  (*"in doubt between two tiers, take the stronger"*) never fires because nothing
  is in doubt.

A table that describes bounded units of work is being asked to weigh a standing
conversation, and its middle row swallows every one of them.

## Why this is P0

**A wrong weight on a job costs one job. A wrong weight on a resident costs every
turn of that conversation, and §7 forbids fixing it in place.** The spec is
explicit that an already-running resident *"cannot change what it is without
discarding the conversation it is holding"*. So this choice is durable by
construction, made once, at the moment there is least information about the
conversation — before a single turn exists.

**It is also silent.** §7 requires a dispatch to say *"what weight it went out at,
and where that weight came from"*. The listener launch has no such requirement in
the skill: for a roster launch the skill notes *"the prompt is the whole record of
what you chose"*, and for a payload launch nothing asks the orchestrator to log
that no weight was chosen and what it picked instead. The operator found this by
asking a question, not by reading a console line — which is the same shape
SHARED-055 was signed to end.

**The default it produces is the wrong direction on the spec's own reasoning.**
§7's consequence-first doctrine and the skill's own tie-break both say: where the
choice is expensive to unwind, take the stronger. A resident's weight is the most
expensive-to-unwind choice the orchestrator makes, and it is currently the one
place a middle tier is taken by default.

## What is **not** wrong, recorded so nobody re-chases it

- `parseWeightLevels` against the shipped skill returns
  `[{light}, {standard}, {heavy}]` — the declaration is found and the composer
  offers it.
- The designation surfaces all accept a weight: `residentActions.ts` renders the
  rows, `corpus thread designate --weight <key>` exists with its three readings.
- `Resident.weight: null` is a legitimate value, not a dropped one
  (`agents.test.ts` pins it), and the roster correctly prints no `at <weight>`
  qualifier for it.

**One adjacent inaccuracy, small and worth stating.** The agent said *"the idle
command … carries no model information"*. That is true of what it **prints** —
`runIdle` emits `${event.id} ${event.type}` per event — and false of what it
**emits as JSON**, which is the whole event including its payload. The skill
documents only the printed form. This did not cause the defect (the agent read the
payload from `claim-all`, where the weight was equally `null`), so it is noted
here rather than filed, and belongs in whatever change touches idle's
documentation next.

## Acceptance Criteria

- [ ] The skill states that the two-pass judgment governs **dispatching a job**
      and does not govern **launching a listener**, in the two places that
      currently redirect to it (the payload launch and the roster launch)
- [ ] The skill states what does govern a listener whose designation chose no
      weight, in one rule, with its reason — the durability of the choice, not a
      preference about models
- [ ] A listener launch logs the weight it went out at **and where it came from**,
      including the case where the designation chose none — §7's dispatch rule
      reaching the one dispatch it does not currently reach
- [ ] A designation that *does* state a weight is untouched: it is honoured, never
      weighed again, exactly as AGENT-041 left it
- [ ] `scripts/workspace-template.test.ts` guards the new rule the way it guards
      the others, so a later edit cannot quietly delete it
- [ ] The change is in `assets/workspace/` only — the product's agent runtime —
      and the dev harness's own `.claude/` is untouched

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch sections
  (~line 687–700) and the Delegation section's table preamble (~line 841)
- `scripts/workspace-template.test.ts` — the guard
- Possibly `assets/workspace/claude/skills/converse/SKILL.md`, if the listener's
  own skill restates the weight rule

### The open question this issue does not settle

Three answers are defensible and they produce different skills. **This is the
user's call and is being put to them rather than assumed:**

1. **Strongest tier.** A conversation is open-ended by construction, the choice is
   durable, and the tie-break already says take the stronger where it matters.
   Cost: a standing conversation about nothing much runs on Opus indefinitely.
2. **Ask, with a form, before launching.** Fits the "ask rather than substitute"
   doctrine — but fights *"Launching a listener is the orchestrator's first work"*,
   because a form means nobody is answering that lane until the person replies.
3. **A listener-specific rule of its own**, judging the conversation rather than a
   job. Most accurate, most to write, and it needs a vocabulary that does not
   exist yet.

A fourth option — make the designation surfaces stop producing `null` — is
recorded and **rejected**: SPEC §7 says in terms that stating no weight is
permitted and means the orchestrator decides, so removing the state would need a
signed rider and would take a choice away from the person.

## Testing Strategy

The subject is prose, so the tests are the template guards plus a read-back: the
rule must be findable by the same means `workspace-template.test.ts` uses for the
other standing rules, and the two redirect sentences must no longer point at the
job table. A drill through a freshly installed workspace confirms the shipped text
is the edited text.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix reproduction, 2026-09-01 (orchestrator, Opus 5):** the operator's own
run, quoted in the Summary — two `resident.designated` payloads with
`weight: null`, two roster rows reading `a general resident` with no qualifier,
two listeners launched on Sonnet, and no console line anywhere recording that a
weight had not been chosen.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
