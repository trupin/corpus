# [AGENT-059] A resident designated with no weight is judged by a table written for jobs, so every conversation lands on Sonnet

## Domain

agent-runtime

## Status

done

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

- [x] The skill states that the two-pass judgment governs **dispatching a job**
      and does not govern **launching a listener**, in the two places that
      currently redirect to it (the payload launch and the roster launch)
- [x] The skill states what does govern a listener whose designation chose no
      weight, in one rule, with its reason — the durability of the choice, not a
      preference about models. **The rule is: launch at the strongest tier the
      workspace's own table declares**, read from that table rather than named
- [x] The rule holds for a workspace that renamed or reordered its tiers, and for
      one that declares a single level — the skill never names a model here
- [x] A listener launch logs the weight it went out at **and where it came from**,
      including the case where the designation chose none — §7's dispatch rule
      reaching the one dispatch it does not currently reach
- [x] A designation that *does* state a weight is untouched: it is honoured, never
      weighed again, exactly as AGENT-041 left it
- [x] `scripts/workspace-template.test.ts` guards the new rule the way it guards
      the others, so a later edit cannot quietly delete it
- [x] The change is in `assets/workspace/` only — the product's agent runtime —
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

## Open: the §7 rider is drafted and unsigned

**Raised by the pr-reviewer on PR #71, and it is right.** SPEC.md §7 says, in the
rider signed 2026-08-06:

> Stating no weight means the orchestrator decides, exactly as it decides today —
> absence of a choice is the judgment above, never a fixed default.

This issue installs exactly a fixed default. Either that clause binds listener
launches, in which case the shipped skill contradicts the spec, or it is scoped
to jobs, in which case the listener rule — which model answers your conversation
when you chose nothing, the most durable model choice the product makes — is
behaviour the source of truth does not describe. `INFRA-034` story 2 now asserts
the rule on every release, so the suite polices behaviour §7 reads against.

**The user decided the behaviour on 2026-09-01 and has not signed spec text.**
`SPEC.md` is therefore untouched, and v0.31.0 ships the code with this recorded
rather than holding the release for a paragraph. The drafted rider, for
signature:

> **That clause governs a job the orchestrator dispatches, and not a listener it
> launches.** A resident's weight is set when it is designated, and a designation
> that states none launches at **the strongest level the workspace's own guidance
> declares**. This is a fixed default, deliberately, and the reason is durability
> rather than a preference about models: an agent already running cannot change
> what it is without discarding the conversation it is holding, so a resident's
> weight is the most expensive choice the orchestrator makes to unwind, and it is
> made at the moment least is known about the conversation. The consequence test
> above asks what a bad result would do that revising the document afterwards
> would not undo — a standing conversation has no single document to revise, so
> the test does not reach it, and the tie-break it carries, in doubt between two
> levels take the stronger, is what settles it instead. **Strongest is read from
> the guidance, never named here**: a workspace that renames or reorders its
> levels moves this rule with it, and a workspace declaring one level has a
> strongest level all the same. The cost is accepted and stated: a conversation
> about nothing much runs at the top level for as long as it lives, and a person
> who knows a lane is cheap says so by stating a lighter weight when they
> designate it.

**The risk of leaving it unsigned, stated plainly:** a future agent reading §7
alone finds *"never a fixed default"* and reverts this rule with the source of
truth behind it — which is the AGENT-059 defect returning, and every wording
guard in `workspace-template.test.ts` would be satisfied by the rewrite.

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

**Implementation and verification, 2026-09-01 (agent-runtime-dev, Fable 5):**

- **The rule, written and guarded.** The owner sentence — *"A designation that
  chose no weight launches at the strongest tier the table declares."* — lives
  in the payload-launch bullet of `orchestrate/SKILL.md`, with the reason
  (durability, not model preference), the table-relative reading (*its last row,
  because the table is written lightest first* — never a model name), the
  rename/reorder/one-level cases, and the accepted cost. The roster launch and
  both Delegation spots (the two-pass preamble, and the "Stating no weight"
  paragraph) now scope the two passes to **dispatching a job** and point at the
  launch rule. The redirect sentences (*"judge it the way Delegation says"*,
  *"you decide as you decide for a `null`"*) are gone — grep over the installed
  workspace returns zero hits.
- **Provenance.** Every listener launch logs, on the designation's own event,
  the weight it went out at and one of two words: `stated` (a key the
  designation carried) or `defaulted` (none chosen — names the tier the rule
  picked). Both literal shapes are in the skill. A roster launch logs the same
  line on the `lane.waiting` (or carried designation) event in hand; only an
  event-less launch falls back to the prompt as the record, and the prompt
  always carries weight plus provenance in words. This is what INFRA-034's
  stories 1 and 2 will read off `.corpus/jobs/<event-id>.jsonl`.
- **Stated weight untouched.** The `stated` chain (AGENT-041) is unmodified:
  *"Find the row whose Key cell holds it, and launch the listener at that
  row's model"*, the `model` argument mechanism, honour-never-reweigh, and the
  unmeetable-weight rule all still pass their pre-existing guards unchanged.
- **Guards.** `scripts/workspace-template.test.ts` gained *"launches a
  weightless designation at the strongest declared tier, by rule"* and *"logs
  every listener launch with its weight and that weight's provenance"*, plus
  scoping pins in the Delegation tests. Suite: **508/508 pass**
  (`VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts`).
- **Falsification.** Deleted the owner sentence from the skill: exactly one
  test went red — *"launches a weightless designation at the strongest declared
  tier, by rule"*, failing on the deleted sentence's regex (507/508). Restored;
  508/508 green again.
- **Fresh-workspace drill.** `corpus init` (run from source, tsx) into a
  scratch dir installed 26 template files; the installed
  `.claude/skills/orchestrate/SKILL.md` is byte-identical to the edited
  template (diff clean), carries the owner sentence and all three `defaulted`
  occurrences, and has zero hits for the old redirect. `readWeightLevels`
  against the installed file returns the three levels with last row
  `{key: "heavy", model: "Opus 5"}` — the strongest-tier reading resolves off a
  real install.
- **Converse skill checked, deliberately unchanged.** Its weight rule already
  defers: *"Where the designation carries no weight, the launcher chose one and
  said which"* — true under the new rule, and it never restates how the
  launcher decides.
- **Lint.** ESLint and Prettier clean on both touched files (5 pre-existing
  warnings on this branch belong to in-flight UI-185 files, untouched here).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
