# [AGENT-038] A resident works serially and inline, and nothing proves it

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **SHARED-055** — for the weight half
- Blocks: —
- Related: AGENT-025 (the converse skill), UI-126

## Spec References

- SPEC.md **§7** — *"a resident works its conversation inline"*
- SPEC.md **§7** — the weight rider

## Summary

The user asked on 2026-08-19: *"I want designated agents to take events and
process them serially, without using more subagents. The goal is for them to keep
a full conversation in their context without jumping back and forth from subagent
to subagent. **Make sure that is how it is working today.**"*

**It is how it works today**, by the skill's own text. Verified by reading
`assets/workspace/claude/skills/converse/SKILL.md`:

| the user's requirement | where it is stated |
| --- | --- |
| inline, not delegated | `:95` — *"You work your conversation inline. The orchestrate skill hands every event it claims to a subagent and never works one itself. **You do the opposite**"* |
| serial | `:256` — *"Work each claimed event, in claim order, **one at a time**"* |
| one continuous context | `:795` — a subagent *"would [not] do better than the agent that has been in the conversation since the first"* |

The escape hatch is scoped correctly: a heavy **side** task may go to a subagent,
which *"reports, and you record"* (`:442`), and *"a subagent you launch never runs
a claim, a park, or a terminal call"*. The conversation never leaves the
resident's context — the subagent is a tool call, not a handoff.

**So this issue is not "make it work". It is "make it provable, and fix the one
sentence that contradicts it."**

## 1. Nothing enforces any of it

Every guarantee above is prose in a skill file. `scripts/workspace-template.test.ts`
pins a great deal of that file, but nothing pins the three properties the user
just asked to rely on.

This repository has been bitten four times in one week by a skill sentence that
was true when written and false later, and by claims about another component's
behaviour written from belief. The rule adopted after the fourth: **a claim worth
relying on gets a pin.**

## 2. One sentence instructs an impossibility

`:415-420` tells the resident a stated weight governs *"the work you are about to
do — **including your own**"*.

A resident is a running session on a fixed model. It cannot change what it is
without discarding the conversation, which is the thing the user just asked to
protect. So that clause is unsatisfiable, and its failure path — *"where you
cannot honour it… say so twice"* — cannot fire, because the resident has no
signal that it failed. It reports the model it is running as, the report looks
right, and the discarded choice is invisible.

SHARED-055 is the spec rider that settles this. **This issue applies whatever is
signed** and must not guess ahead of it.

## Acceptance Criteria

- [ ] Pins for all three properties, each falsified individually: inline by
      default, serial claim order, and a launched subagent that never claims,
      parks, or settles
- [ ] The weight clause no longer instructs the impossible — per SHARED-055,
      a stated weight governs what the resident **hands off** and not its own turn
- [ ] The skill says where a resident's own weight *does* come from, once
      CONTRACT-067 lands
- [ ] **No claim about another component's internal refusals is added** — the rule
      this file adopted after being corrected four times
- [ ] Every transcript touched is re-derived by running the command, not read

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Read `converse/SKILL.md:659-745` before editing anything near the park loop.**
It carries a careful account of release, of events stamped before a release, and
of a refused park being *"the same ending, found one step later"*. SERVER-128 may
change the timing there, and these two must not part company.

Pin the **consequence**, not the mechanism. The `profile` skill's *"resolves to
nobody"* sentence survived a change of mechanism precisely because it stated a
consequence (AGENT-036), and the pin that guards it forbids naming a mechanism
beside it.

### Edge Cases

- A resident mid-work when a release lands
- A subagent still running when the resident is released
- A weight stated on a message to a lane whose resident has lapsed — the
  orchestrator answers, and the weight does apply to it

## Testing Strategy

Pins in `scripts/workspace-template.test.ts`, each falsified by deleting the
sentence it covers and confirming that pin alone goes red.

The behavioural half — that a real resident actually claims one at a time and
does not delegate the conversation — needs a **drill against a real Claude Code
session**, not a reading. AGENT-034 and AGENT-035 both found defects that way
that reading had missed.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Designate a resident and run `/converse` against it in a real session
3. Post three messages in quick succession; confirm they are worked in claim
   order, one at a time, in one context
4. Confirm the resident's own turns name the model it is actually running as
5. Confirm a side task it delegates never claims, parks, or settles
6. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-038]` prefix
