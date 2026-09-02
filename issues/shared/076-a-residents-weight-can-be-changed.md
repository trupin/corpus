# [SHARED-076] §7 says a resident's weight cannot change. It can, and the cost is smaller than stated

## Domain

shared

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: `UI-186` (the control this rider permits), `AGENT-063` (whose judged
  pick is only safe because the change exists)

## Spec References

- SPEC.md **§7**, rider signed 2026-08-19 — the text this issue amends

## Summary

**User directive, 2026-09-02:** *"maybe we make it possible to change a
resident's model from the residents tab. That would make the mistake less of a
problem."*

§7 currently says:

> **A resident's weight is set when it is designated, not per message.** A
> resident is a running agent, so the model it works at is a property of the
> designation and is chosen there […] This is the one place the weight rider
> above does not reach, and it does not reach it because it cannot: **an agent
> already running cannot change what it is without discarding the conversation it
> is holding**, which is the thing a resident exists to keep.

**The last clause is not true of the built system, and it was load-bearing.** It
is the entire justification `AGENT-059` used for a fixed strongest-tier default:
if a wrong pick is permanent, take the strongest. Remove the premise and the
conclusion goes with it.

**What the code actually does.** Re-designating a thread with a different weight
is an ordinary write (`apps/server/src/threads/resident.ts`): the server emits
`resident.released` with reason `replaced`, the displaced listener stops, a fresh
`resident.designated` goes out, and a new listener launches at the new weight.
The thread menu already offers it — *"Re-designate the general resident"*, shown
exactly when the weight differs.

**And the conversation is not discarded, because the conversation is a
document.** It is on disk, in git, and the new listener reads it. What is
genuinely lost is whatever the stopped listener held that the thread does not
record — its in-flight context. That is a real cost and worth stating. It is not
the conversation.

So the spec forbids in prose what the product already does, and overstates the
price of doing it.

## The drafted rider, for signature

To be appended to the 2026-08-19 rider, replacing its final clause:

> **A resident's weight may be changed after it is designated.** Doing so is a
> re-designation: the running agent is released and a new one launches at the new
> level, on the same conversation. What that costs is the released agent's own
> working context — whatever it was holding that the conversation does not
> record. The conversation itself is not lost, because a conversation is a
> document: it is on disk, and the agent that takes over reads it, exactly as an
> agent restarted for any other reason does. So the earlier claim that a running
> agent cannot change what it is *"without discarding the conversation it is
> holding"* was too strong, and is corrected here — what cannot survive the
> change is the agent's memory of the conversation, not the conversation.
>
> **This does not make weight a per-message property.** A weight stated on a
> message reaching a resident's lane still governs only what the resident hands
> off, and never the resident's own turn. Changing what a resident works at is a
> deliberate act on the designation, taken where the designation is shown, and it
> says what it costs before it is taken. _(Rider signed — date to be filled at
> signature.)_

## Two more riders belong in the same signature pass

Both were raised by the pr-reviewer on PR #72. Neither is a code defect — they
are behaviours that shipped without spec text, which is the failure this issue
exists to stop repeating.

### A: the model a turn may state (`AGENT-061`)

`corpus thread reply --model` now refuses any value the workspace's tier table
does not declare — exit 2, nothing sent. A workspace whose guidance declares no
table refuses **every** `--model`, so §10's *"an agent turn says which model
wrote it"* is unreachable there and turns are recorded with nothing. That is
§10's own answer to an unknown, but the spec never says a vocabulary gate stands
on the write.

Drafted, to follow §10's model-record rider:

> **The model a turn states is one the workspace declares.** A turn's recorded
> model is the word the guidance's own tier table gives it, not a version string
> an agent composed about itself, and a write that names anything else is
> refused rather than recorded — an agent's belief about which model is running
> it is not evidence, and a real-sounding wrong name is the plausible
> attribution this section already says is worth less than nothing. Where the
> workspace declares no levels, no turn states a model, which is the same
> "nothing rather than a guess" this section requires. _(Rider signed — date to
> be filled at signature.)_

### B: what governs a listener's weight, scoped (`AGENT-063`)

§7 says *"Stating no weight means the orchestrator decides … absence of a choice
is the judgment above"*, and "the judgment above" is the two-pass job test. The
skill now says those two passes do not govern a listener launch and installs a
conversation-read in their place. `AGENT-063` cured the *"never a fixed
default"* contradiction; this scoping is the residue.

Drafted, to follow that clause:

> **What it decides a listener by is not what it decides a job by.** The passes
> above weigh one bounded piece of work by what its output touches, and a
> listener has no output to weigh — only a conversation that has not happened
> yet. So a designation stating no weight is judged on the conversation: what it
> was opened for, and what a poor turn would cost there. The guidance states how,
> and states it alone. _(Rider signed — date to be filled at signature.)_

## Why this is P0

- **A signed spec sentence is false about the shipped product.** Someone reading
  §7 to decide what to build will build the wrong thing, and someone reading it
  to review a PR will reject the right thing.
- **It is propping up a rule the user has now reversed.** `AGENT-063` reverts the
  fixed default back to judgment. Leaving this clause standing leaves the
  strongest-tier argument available to whoever next reads §7 alone.
- **`UI-186` is unbuildable while it stands.** A control that does what the spec
  says is impossible cannot be reviewed against the spec.

## Acceptance Criteria

- [ ] The rider above, or the user's revision of it, is applied to SPEC.md §7
      **after the user signs it** — never before
- [ ] `AGENT-059`'s open-question section is removed: the unsigned rider it
      carried was for the fixed default, which `AGENT-063` reverts, and it should
      not be left looking like outstanding work
- [ ] Any other §7 text asserting the weight is unchangeable is found and
      corrected in the same pass — one contradiction left behind is the whole
      problem repeating

## Technical Design

Prose only. The mechanism exists; this issue changes what the spec says about it.

### Notes

- **The rider weakens a constraint rather than adding one**, which is the easier
  kind to sign and the easier kind to get wrong. The thing to keep is the
  *reason* the original clause existed: a resident is meant to hold a
  conversation, and swapping it is not free. The rider preserves that by naming
  the cost rather than by forbidding the act.

## Testing Strategy

`npm run issues:check`, and a read-back of §7 for any surviving sentence that
contradicts the rider.

## E2E Verification Log

_Not applicable — spec text. The behaviour it describes is verified by `UI-186`._

## Completion Checklist (orchestrator)

- [ ] User signature recorded, with the date
- [ ] Committed with `[ISSUE-ID]` prefix
