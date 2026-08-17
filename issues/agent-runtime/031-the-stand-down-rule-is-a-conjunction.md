# [AGENT-031] The stand-down rule is a conjunction, and the second conjunct throws away the signal

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-029 (which wrote the rule), AGENT-027

## Summary

`assets/workspace/claude/skills/converse/SKILL.md:225-235` fires the stand-down
rule on *"an empty `events` array **and** those same ids sitting in its
`inProgress`"*.

`apps/server/src/queue/waiters.ts:126-127` notifies **every** matching waiter, so
both listeners' parks return naming the same event, and `claimAll` is atomic —
so the loser normally gets a fully empty claim and exits, as designed.

**The conjunction breaks the moment a second message arrives.**

> Any event lands on the lane between the winner's claim and the loser's. The
> two claims are separated by two independent LLM sessions each deciding to
> invoke `corpus queue claim-all` — seconds, not milliseconds — and a person who
> just posted M1 posting M2 is the ordinary case. The loser's claim returns
> `events: [M2]`, **non-empty**, so the rule does not fire. AGENT-027 then tells
> it the winner's M1 in `inProgress` is "not yours", so it works M2 and
> re-parks. **Two listeners survive, answering different messages in one
> conversation.**

That is the split-story failure `AGENT-029` was filed to close, and its
acceptance criterion — *"One conversation ends with one listener"* — is not
guaranteed.

**The sound signal is present and discarded**: an id the loser's own park named
is sitting in someone else's `inProgress`. It is the `events`-is-empty conjunct
that throws it away.

## What the rule should test

The evidence of a peer is **an id your own park named appearing in `inProgress`
you did not claim** — regardless of what else the claim returned. Restate the
rule on that alone, and check whether the `events`-empty clause has any
remaining job; if it does not, removing it is the fix rather than an addition.

`AGENT-029` verified the discriminator's soundness in the other direction and
that finding stands: the orchestrator cannot be the claimant, because the
loser's own park release keeps the lane live for the grace window and an
unscoped claim never sees a live lane's events, and orchestrate never passes
`--thread`. The only other producer is an operator hand-running a scoped
`claim-all`, which would be evicting a healthy resident deliberately.

## Acceptance Criteria

- [ ] The rule fires on the peer-claim evidence alone, and a concurrent second
      message does not suppress it
- [ ] The soundness direction is preserved: nothing but a peer listener can
      produce the state the rule fires on. Re-derive it against the new form
      rather than inheriting AGENT-029's argument for the old one
- [ ] Drilled with **two messages**, not one — that is precisely the case
      AGENT-029's drill did not cover, and its absence is why this shipped
- [ ] An abandoned event still does not trigger a stand-down (AGENT-029 measured
      that direction; keep it measured)

## Testing Strategy

Template assertions for the text. The drill is two live listeners and two
messages posted close together.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-031]` prefix
