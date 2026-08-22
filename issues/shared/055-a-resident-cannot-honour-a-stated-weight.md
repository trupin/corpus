# [SHARED-055] A resident cannot honour a stated weight, and §7 says it must

## Domain

shared

## Status

done — signed by the user 2026-08-19 (as drafted, via the v0.14.0 `/goal`). Applied 2026-08-19.

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CONTRACT-067, UI-126, AGENT-038 — all three depend on which way this
  resolves
- Related: SHARED-051, SHARED-050 (both signed 2026-08-19)

## Spec References

- SPEC.md **§7** — the weight rider (signed 2026-08-06): a stated weight is
  *"honoured, not weighed again"*, *"never quietly substitutes another — in
  either direction"*, and *"travels to whatever actually does the work"*
- SPEC.md **§7** — the resident rider (signed 2026-08-13): *"a resident works its
  conversation inline"*
- SPEC.md **§10** — the composer's weight control, *"live exactly when the
  composer says sending will reach the agent"*

## Summary

**Two signed riders contradict each other, and residents are where they meet.**
Found by the user on 2026-08-19, from the symptom rather than the text.

The weight rider was signed on 2026-08-06. The resident rider was signed on
2026-08-13. Neither mentions the other, and together they require something no
running agent can do.

A **resident is a running session on a fixed model.** It cannot change its own
model mid-conversation — and if it could, it would discard the context that is
the entire reason a resident exists (see the serial-inline rule the user
confirmed as intended, AGENT-038).

Yet `converse/SKILL.md:415-420` instructs it:

> **A stated weight is a directive here too.** Where the event's payload carries a
> `weight`, it governs the work you are about to do — **including your own** — and
> any stage you hand off. You honour it rather than weighing it again, in either
> direction, and where you cannot honour it you do the work anyway and say so
> twice: in the job's log while it runs, and in the reply the person receives.

**"Including your own" is unsatisfiable by construction.**

## Why the escape clause does not save it

The skill has a failure path — *"where you cannot honour it… say so twice"* — and
it **cannot fire reliably**, because the resident has no signal that it failed.

It simply *is* whatever model it is. §7 tells it to report the model it is
actually running as, so it reports one, the report looks correct, and nobody
learns the choice was ignored. A failure clause that depends on noticing a
failure the agent cannot perceive is decoration.

**That is the silence the user observed**: pick a model when addressing a
designated agent, and the designated agent uses whichever model it is on, without
saying so.

## The three symptoms this one contradiction produces

1. **The composer offers a control that does nothing.** `WeightPicker` is live
   whenever the composer reaches the agent (`packages/kit/src/weight/composerReach.ts`),
   and reaching a resident's lane is reaching the agent. So the control is live
   and inert at once
2. **A shipped skill instructs an impossibility**, with a failure clause that
   cannot detect its own failure
3. **There is nowhere to say what a resident's model should be.**
   `DesignateResidentRequestSchema` carries one field, `name`

Patching any one of them separately leaves the other two.

## The resolution the drafted text takes, and the one it rejects

**A resident's model belongs to the designation, not to the message.**

That is the user's own framing (2026-08-19) and it dissolves all three symptoms
at once: pick the model when you designate, and the per-message control is
answered in advance rather than ignored.

**Rejected: make the resident honour the weight by delegating.** It could hand
each message to a subagent of the stated model. That is exactly the design the
resident exists to replace — it is what the orchestrator already does — and it
destroys the continuous context that makes a conversation feel synchronous. The
user asked explicitly for the opposite.

**Rejected: restart the resident on the new model.** A designation is a lane with
a running listener. Restarting it discards the conversation's context, which is
the same loss by another route, and it makes one message silently end and replace
an agent.

## The drafted text — read this back verbatim before applying

Two edits.

**Edit 1 — §7, appended to the resident rider** (the paragraph signed
2026-08-13, which currently ends *"…nothing rewritten."*):

> **A resident's weight is set when it is designated, not per message.** A
> resident is a running agent, so the model it works at is a property of the
> designation and is chosen there; a weight stated on a message that reaches a
> resident's lane governs any stage the resident **hands off**, and never the
> resident's own turn. This is the one place the weight rider above does not
> reach, and it does not reach it because it cannot: an agent already running
> cannot change what it is without discarding the conversation it is holding,
> which is the thing a resident exists to keep. Surfaces follow: a composer
> addressing a resident's lane offers no weight for that turn and says why, rather
> than offering a control whose choice is discarded in silence.
> _(Rider signed 2026-08-\_\_.)_

**Edit 2 — §10, appended to the composer's weight paragraph** (the one signed
2026-08-06, ending *"…the composer key contract is untouched."*):

> Where the composer's recipient is a **resident's lane** (§7), the control is not
> live: that conversation's weight was set at designation, and offering a choice
> that will be discarded is worse than offering none. The composer says so where
> the control would be, naming the resident's weight, so a person learns the
> answer rather than losing the question. _(Rider signed 2026-08-\_\_.)_

## What the sign-off decides

1. **Whether a resident's model is fixed at designation.** The alternative is
   that it stays per-message and residents delegate, which is the design the user
   rejected by name
2. Whether a stated weight still governs a resident's **hand-offs**. The draft
   keeps it — a side task the resident delegates is ordinary delegated work, and
   §7's rules bind it
3. Whether the composer **says the resident's weight** or merely goes quiet. The
   draft says it, on the grounds that a person who reached for that control wants
   the answer, not silence

## Acceptance Criteria

- [x] The user has signed the drafted text, verbatim, on its own
- [x] §7 states that a resident's weight is set at designation
- [x] §10 states that the composer's weight control is not live for a resident's
      lane, and says what it shows instead
- [x] Neither the weight rider nor the resident rider is reworded — the new text
      names the boundary between them rather than editing either
- [x] `npm run spec:check` passes

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §7's resident rider, §10's weight paragraph

### Key Implementation Details

Quote rather than paraphrase when reading it back (SHARED-045).

**Read `converse/SKILL.md:415-420` and `packages/kit/src/weight/composerReach.ts`
before drafting any revision.** SHARED-051's draft was wrong twice for being
written from the finding rather than from the code.

## Testing Strategy

`npm run spec:check` for the citations. The behaviour is CONTRACT-067's,
UI-126's and AGENT-038's, each with its own pins.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text and nothing else
2. `npm run spec:check` passes

## E2E Verification Log

- 2026-08-19 — the user signed both edits as drafted, in the `/goal` that started v0.14.0.
- Applied verbatim, dated 2026-08-19. `git diff SPEC.md`: 3 insertions, 1 line extended.
- **Placement call.** The draft's §7 anchor (*"…nothing rewritten."*) does not exist in SPEC.md. The resident rider (§7, the *"Three rules of this section are per lane"* paragraph) sits before the weight rider (the *"Orchestrator skill"* paragraph), and the drafted text says *"the weight rider above"*. So the §7 text stands as its own paragraph after the Orchestrator-skill block, where both riders are above it and neither is reworded. The §10 text is appended to the weight paragraph, as drafted.
- `npm run spec:check` — 5863 citations, pass.

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [x] Committed with `[SHARED-055]` prefix
