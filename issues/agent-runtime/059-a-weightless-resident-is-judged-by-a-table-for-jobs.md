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

- Depends on: `UI-185` — not for code, but for meaning: until Ask can state a
  weight, `null` is a state the product manufactures rather than one a person
  chose, and any rule written here is a rule about that manufactured state
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

**The chain from a stated weight to a launched listener is intact, and that was
checked before writing this.** The weight table parses out of the shipped skill
(`parseWeightLevels` returns all three levels), `corpus thread designate` takes
`--weight`, the thread menu offers weight rows, and the contract, server and CLI
all carry the field. A weight that *is* stated reaches the launch — AGENT-041,
done.

**But `null` here was not a choice, and that is `UI-185`.** Asked why the
information had not reached the agent, I checked the surface these two
designations actually came from: the global composer's Ask. Its `owner` control
is a bare profile `<select>` and submits `{name}` with no weight — the one
designation surface in the product that cannot state one, and the only one where
a *standalone* thread (the only kind §7 lets designate) is created. Worse, the
overlay's one weight control feeds the **message** weight, which §7 says never
governs a resident's own turn.

So the person did not decline to choose. Nobody asked them, and a weight they may
well have picked went somewhere else. This issue is the second half of the
defect: what the orchestrator should do with a `null` it will still sometimes
receive legitimately, once `UI-185` makes the other case expressible.

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
  `[{light}, {standard}, {heavy}]` — the declaration is found.
- `corpus thread designate --weight <key>` exists with its three readings, and
  `residentActions.ts` renders weight rows on an existing thread.
- `Resident.weight: null` is a legitimate value on the wire, not a dropped one
  (`agents.test.ts` pins it), and the roster correctly prints no `at <weight>`
  qualifier for it.

**`corpus queue idle` is not the hole, and that was checked.** The user asked
whether the information should have arrived through `idle`. `runIdle` emits
`{events, inProgress}` — the **whole** event including its payload — and prints
`${event.id} ${event.type}` only in human mode; the skill documents the printed
form alone. But nothing was lost there: `claim-all` follows immediately with full
payloads, which is where the agent correctly read `weight: null`, and the agent
must claim to take ownership regardless, so carrying payloads on `idle` would save
no round trip. Worth a sentence in the skill so nobody believes `idle` is
information-poor by design; not a defect, and not this one.

## Acceptance Criteria

- [ ] The skill states that the two-pass judgment governs **dispatching a job**
      and does not govern **launching a listener**, in the two places that
      currently redirect to it (the payload launch and the roster launch)
- [ ] The skill states what does govern a listener whose designation chose no
      weight, in one rule, with its reason — the durability of the choice, not a
      preference about models. **The rule is: launch at the strongest tier the
      workspace's own table declares**, read from that table rather than named
- [ ] The rule holds for a workspace that renamed or reordered its tiers, and for
      one that declares a single level — the skill never names a model here
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

### The rule, settled

**User decision, 2026-09-01: a resident whose designation states no weight
launches at the strongest tier the workspace declares.** Not a preference about
models — it follows from the durability of the choice. §7 forbids changing a
running resident's weight without discarding the conversation, so this is the
most expensive-to-unwind call the orchestrator makes, and the skill's own
tie-break already says *"in doubt between two tiers, take the stronger"*. The
current behaviour is the one place that tie-break is inverted by default.

**The strongest tier the workspace declares**, read from the same table
`parseWeightLevels` reads — never a model name written into the skill. A
workspace that renames or reorders its tiers must move this rule with it, which
is exactly what SHARED-022's one-declaration decision is for.

Cost, stated so it is a decision rather than a surprise: a standing conversation
about nothing much runs at the top tier for as long as it lives. That is
accepted. The person can state a lighter weight at designation — which is what
`UI-185` makes possible at the surface where it was not — and a resident nobody
weighted is one nobody has told us is cheap.

Two alternatives were rejected. **Asking with a form before launching** fits the
"ask rather than substitute" doctrine, but fights *"Launching a listener is the
orchestrator's first work"* — a form means nobody answers that lane until the
person replies, so a question about cost becomes a silence about their message.
**A listener-specific judgment rule** would be the most accurate and needs a
vocabulary for weighing a standing conversation that does not exist yet. It stays
available: the rule written here is one sentence, and replacing it later costs
that sentence.

A fourth option — make the designation surfaces stop producing `null` — is
recorded and **rejected**: SPEC §7 says in terms that stating no weight is
permitted and means the orchestrator decides, so removing the state would need a
signed rider and would take a choice away from the person. `UI-185` is not that
option: it makes the choice *expressible* at Ask, including an explicit
"the launcher decides" row, and leaves `null` meaning what §7 says it means.

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
