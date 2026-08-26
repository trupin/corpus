# [SHARED-072] A conversation gets its own agent, and keeps it

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
- Blocks: the domain issues `/decompose` files once the riders are signed

## Spec References

- SPEC.md §7 — "A conversation may have a resident", "A resident need not have a
  profile", "The queue is partitioned into lanes", "Presence is the parked
  request, and nothing else", the Orchestrator skill paragraph
- SPEC.md §8 — the reopening sentence, which depends on the fallback
- SPEC.md §10 — the global composer, Ask and Capture

## Summary

User request, 2026-08-25, in four parts:

> I want new threads to use a dedicated resident agent by default. I want to be
> able to pick "new resident agent" as an option when clicking ask / capture
> button. I want comments that are directed to a resident agent to actually go
> to the resident agent queue, not to the orchestrator as fallback, unless I
> detach the resident agent and its queue isn't empty. Only then the messages
> should be treated by the orchestrator. I want the orchestrator skill to be
> VERY clear around starting resident agents. It should treat start resident
> agents with the HIGHEST priority, as not starting one is blocking an entire
> workflow most of the time.

**Parts three and four are one design and cannot ship apart.** Today a lapsed
lane's pending work becomes visible to the orchestrator's unscoped claim, and
§7 states the trade outright: *"The cost of a lapse is that the work is done by
the orchestrator instead — slower, and without the conversation's warmth — and
never that it is silently not done."* Removing the fallback buys the resident's
warmth and pays for it with exactly the outcome that sentence rules out. The
only thing that keeps the bargain honest is a listener that reliably starts,
which is part four. Shipping part three alone would make the product worse in a
way a green test suite cannot see.

## The reproduction, observed 2026-08-25

The user pasted an orchestrator's own words, produced by following the skill
correctly:

> Your designated resident on that thread is not running, and I am the reason.
> The skill forbids launching a listener in the same pass I take that lane's
> work, because a listener would read my in-progress events as abandoned and
> answer the same turns twice. You have kept posting there, so I have kept
> claiming, so the launch keeps deferring. It goes out on the first pass where
> that lane's queue is clear.

**That is a livelock, and it is reachable by ordinary use.** A conversation
somebody is actively using never has a clear pass, so its listener never
launches, so the fallback keeps taking the work, so the lane is never clear. The
busier the conversation, the more certain it is that the agent that owns it never
starts.

**The rule is correct and its cause is the fallback.** From
`orchestrate/SKILL.md`:

> **But never in the same pass you took that lane's work.** This is why launching
> happens after the claim rather than at the roster read, and **it is the one
> collision the fallback can actually produce.** … So per lane, per pass: take
> the work or launch the listener, never both. Prefer taking the work.

The collision is real: events claimed under the fallback sit in `in-progress/`
still stamped for that lane, and a listener launched now reads them in its own
held list as work it has no memory of claiming, reconciles them, and answers the
same turn twice.

**Rider C deletes the cause, so the rule goes with it.** If the orchestrator
never claims a resident lane's events, no such event is ever in flight when a
listener launches, and there is nothing to collide with. The user named the same
fix in the same message — *"it should start the resident agent, then let the
agent pull the messages from its queue"* — which is rider C's behaviour stated
from the other end. The deferral rule is not patched, tuned, or given an
exception. It is removed, because what it guards against cannot happen.

**This is why rider C is the load-bearing one.** It was drafted to buy the
resident's warmth. It turns out to also be the only fix for a starvation bug
that a green test suite cannot see and that gets worse the more the product is
used.

## What is already true, so nothing is rebuilt

- **A resident with no profile is the ordinary case.** §7: *"Naming none is the
  ordinary case and requires nothing to exist first."* So "a dedicated agent" is
  a general resident, and no persona document has to be authored first.
- **Designation already enqueues `resident.designated`** on the orchestrator's
  lane, and the orchestrate skill already launches a listener from it.
- **The composer already picks a recipient** from the live roster. What it
  cannot do is designate.
- **Scope is computed, never stored**, so a thread designated at creation owns
  everything that grows out of it with no extra bookkeeping.

## The riders, drafted and unsigned

**This issue does not edit SPEC.md.** Four riders, because they are four
decisions and the user should be able to refuse one without refusing the rest.

### Rider A — a new conversation gets its own resident

Appended to §7's *"A conversation may have a resident"* paragraph:

> **A new standalone thread designates a general resident, unless the person
> chose otherwise.** A conversation is a thing an agent owns, so owning it is
> the default rather than an act a person has to remember. The designation is
> made when the thread is created and is the ordinary designation in every other
> respect — releasable, single-valued, released by resolution. Choosing
> otherwise is offered where the thread is created and nowhere else, because a
> conversation that started without a resident can be given one at any time by
> the control that already does it. A thread on a document designates nothing,
> as before: a resident owns a conversation rather than a passage.

### Rider B — the composer offers it

Appended to §10's global composer text:

> **The composer chooses who will own the conversation, not only who hears this
> message.** Beside the recipient the roster offers, Ask and Capture both offer
> **a new resident** — a general one, or a named profile — and the thread is
> created with that designation already made. The two choices are different
> acts and are not collapsed: naming a recipient routes one message and rewires
> nothing, while designating hands over the conversation and everything that
> grows out of it. Capture offers designation although it carries no recipient,
> because the reason it carries none — that a capture is in no scope by
> construction — is a statement about routing and not about ownership.

### Rider C — a resident's work waits for it, and nobody else does it

**Sharpened by the user, 2026-08-25**, after the first draft left the fallback in
place for a lapse:

> I do not want messages to go to the orchestrator when they are meant to go to
> a resident agent. If the resident agent isn't started, then the orchestrator
> should be working on starting it. That is the only viable way to recover a
> situation. Making the orchestrator agent treat another agent's messages is
> unacceptable and should be avoided at all cost.

**Replaces** §7's *"A lapsed lane falls back to the orchestrator, at claim
time"* sentence and the three sentences after it:

> **A lane's work is done by that lane's agent, and by nobody else.** A listener
> that is absent — crashed, killed, or not yet started — does not surrender its
> pending events, and no amount of absence makes them somebody else's. There is
> no fallback and no timer: an unscoped claim never sees another lane's events,
> whether that lane is live or not. The reason a conversation has a resident is
> that the same agent answers it, and an answer from somebody else arriving
> sooner is not the thing that was asked for — it is a different agent with none
> of the conversation writing in its name.
>
> **The recovery for an absent listener is to start it, never to take its work.**
> That is stated as the rule and not as a preference, because the alternative is
> available at every moment and looks like helping.
>
> **Release is the one thing that returns work, and a person does it on
> purpose.** When a person releases a resident, or a thread is resolved and
> releases its own, that lane's pending events become the orchestrator's. They
> are no longer a resident's messages, because the person removed the resident.
> Nothing else has this effect, and in particular no duration does.
>
> **The cost is stated rather than hidden**: work addressed to a resident whose
> listener never starts is not done until it starts or the resident is released.
> The board is where a person sees that, and §7 owes them a signal that says it
> in those words rather than leaving them to infer it from a lane that is merely
> not live.

### Rider D — starting a listener outranks everything else

Appended to §7's Orchestrator skill paragraph:

> **Launching a listener is the orchestrator's first work, ahead of every job it
> claimed.** A conversation whose listener has not started is a conversation
> nothing will answer, so the delay is not one turn's latency but a whole line
> of work stopped. The orchestrator reconciles the roster before it dispatches,
> not after, and a batch is never the reason a listener waits.
>
> **It is told which lanes are waiting, rather than guessing.** A roster row
> says whether its lane is live and **how much work is pending on it**, so
> "somebody is waiting and nobody is listening" is a fact the orchestrator reads
> rather than a state it infers from absence. That is what makes rider C's rule
> actionable: the orchestrator cannot take the work, so it must be able to see
> precisely which lane to start.

## The mechanism rider C is missing, found while drafting rider D

**A roster row cannot say a lane has work waiting.** `AgentLane`
(`packages/contract/src/schemas/agents.ts`) carries `lane`, `resident`, `live`,
`since`, `summary` and `origin`. There is no pending count. `summary` is the only
field that could carry the fact, and the contract forbids using it: *"it is for
display only — a client must never parse it, key on it, or decide anything from
it, and everything a client needs to decide from is a field of its own on this
row."*

So today the orchestrator can see that a lane is not live. It cannot see whether
anyone is waiting on it. Under the current design that gap does not matter,
because the fallback hands it the work and the work itself is the signal. **Rider
C removes the work, so the signal has to be built.**

Without it, rider D degrades into launching a listener for every non-live lane on
every pass, whether or not anything is waiting — which is both wasteful and the
shape the orchestrate skill already warns against (*"a conversation that queued
eight messages while it was unattended gets eight listeners"*).

**This is a contract and server change, and it is not optional.** It is the
difference between rider D being a rule the orchestrator can follow and a rule it
can only approximate.

**A simplification comes with it.** §7's grace window exists to compute the
fallback at claim time. With no fallback, nothing routes on it, and its only
remaining job is deciding what `live` says on a roster row — one purpose instead
of two, and the one that has a person looking at it.

## Two risks, named rather than discovered

**Every conversation becomes dependent on a listener.** Riders A and C compose
into something neither says alone: with a resident on every new thread and no
fallback, *every* conversation is answered only if its listener started. Today a
missing listener costs warmth. Then, it costs the answer. Rider D is the whole of
the mitigation, and it is a skill instruction rather than a mechanism — so the
guarantee is as good as the model following it, and no test can hold it.

**The listener count grows with the conversation count.** One long-lived
background subagent per active conversation, where today there is one per
deliberately-designated one. Nothing in §7 bounds it. Whether that needs a bound,
and what happens when it is reached, is not decided here and must be before rider
A ships.

## Consequential edits, if the riders are signed

- **§8's reopening sentence** says a reopened thread's work waits for *"the
  resident returning, or the orchestrator after the fallback"*. Rider C deletes
  the fallback, so that clause becomes false and must be repaired in the same
  change rather than left to be found.
- **The orchestrate skill's fallback section** (`assets/workspace/claude/skills/
  orchestrate/SKILL.md`, *"What the claim hands you is yours"* and *"A lapsed
  lane's work is ordinary work"*) is written entirely around the fallback,
  including the instruction *"do not hold work back for an agent that might come
  back"*. Rider C inverts it. That is product code and belongs to
  `agent-runtime`.
- **The launch-deferral rule** in the same skill (*"But never in the same pass
  you took that lane's work"*) is deleted rather than amended, per the
  reproduction above. Launching moves back to the roster read, which is where
  the rule's own text says it would sit but for the fallback.

## One edge case rider C does not settle

**A re-designation while the orchestrator is draining.** Release hands a lane's
pending events to the orchestrator — the one carve-out the user named, and the
one place rider C's absolute rule has a seam. If the person designates again before that
drain finishes, the orchestrator is mid-work on events the new listener may see
— the same collision, arriving by the one door rider C leaves open. §7 says a
stamp is made once and never rewritten, so whether the new designation produces
the same lane id decides whether this is reachable at all. **Answer it before
rider C ships**, and do not answer it by reinstating the deferral rule under
another name.

## Acceptance Criteria

- [ ] Each rider is put to the user separately, quoted, and applied only if
      signed
- [ ] The listener-count question is answered before rider A ships
- [ ] Rider C does not ship without rider D
- [ ] Every consequential edit above lands in the same change as the rider that
      makes it necessary, never in a follow-up
- [ ] The livelock is **reproduced before it is fixed** — a test that keeps a
      lane busy and asserts the listener never launches, red before the change
      and green after. A bug found in production and fixed without a
      reproduction is a bug nobody proved was fixed
- [ ] The re-designation-during-drain question is answered before rider C ships
- [ ] A roster row carries its lane's pending count, and the orchestrate skill
      decides what to launch from that field rather than from `summary` or from
      absence alone
- [ ] **No path remains by which the orchestrator works a designated lane's
      events**, other than release. Proved by a test that asserts an unscoped
      claim returns nothing for an absent lane's pending event, and returns it
      after the resident is released

## Technical Design

The domain issues are filed by `/decompose` once the riders are signed. Filing
them now would design against text the user may refuse. The shape is expected to
be: a contract half for designation-at-creation and for the composer's new
choice, a server half for both plus the release-drains-the-lane rule, an
agent-runtime half for the orchestrate skill's inverted fallback and rider D,
and a UI half for the composer.

## Testing Strategy

Per domain issue. One thing is called out here because it is the falsification
that matters: **a test proving work waits must also prove the same fixture is
worked when the resident returns.** "Nothing was claimed" passes when the whole
pipeline is broken.

## E2E Verification Plan

Per domain issue.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (orchestrator)

- [ ] Riders signed or refused, one at a time
- [ ] SPEC.md amended
- [ ] `/decompose` run against the signed text
- [ ] Committed with `[SHARED-072]` prefix
