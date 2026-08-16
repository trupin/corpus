# [SHARED-043] A resident agent for a conversation

## Domain
shared

## Status
done — drafted, read aloud section by section, signed, and applied to SPEC.md
§7, §8 and §9.2 on 2026-08-13. Three sections changed at sign-off: §4 gained the
rearm-gap bound, §5 named the summons exception, §6 gained the missing-job and
re-stamp rules. Section 7 was corrected before it was read (it claimed to amend
three §7 sentences; only one was in §7) and all three doctrines were promoted to
§7 at the user's choice. Section 8 did not exist in the draft and was found by
reading the signed text back against §8.

## Priority
P0

## Model
fable

## Dependencies
- Depends on: —
- Blocks: [CONTRACT-050], [CONTRACT-051], [AGENT-025] (directly; the whole phase transitively)

## Spec References
- SPEC.md §7 — the agent loop, the queue, and the delegated/inline-work doctrine this rider scopes to the orchestrator's lane
- SPEC.md §8 — threads, participation, mentions, and the composer

## Summary
Draft, read aloud for signature, and apply the SPEC rider that introduces **resident
agents**: a top-level (standalone) thread may designate a long-lived agent; that agent owns
the thread's whole **scope** — the thread, its subthreads, and every artifact whose
provenance walks back to it — and runs its own claim → work → settle → park loop on a
**lane** of the queue partitioned to that scope. Users see a live roster and pick a
recipient per message; the default is computed from where they post. This deliberately
revokes three standing doctrines, and the rider must name each where it actually lives:
§7's "every event is delegated — the orchestrator never works a job inline" is scoped to
the orchestrator's lane (a resident works its conversation inline); the orchestrate
skill's "this session is the only process that claims queue events" becomes one consumer
per lane, with §7's concurrent-claims wording amended to match; and orchestrate's "queue
state never crosses the subagent boundary" becomes a lane's owner settles its own lane.

## Acceptance Criteria
- [x] Rider drafted as real spec text, presented for signature one section at a time (per the standing rider discipline), and applied to SPEC.md only after authorization
- [x] Defines **designation**: standalone threads only (`parent: null`); designation is user-only state on the thread; dissolution (release, or thread resolution) returns the scope to ordinary routing
- [x] Defines **scope** by provenance: the root thread, its child threads, documents whose `origin` chain reaches the root, and threads on those documents
- [x] Defines **lanes**: every event is stamped with its lane at enqueue time (root scope if designated, orchestrator otherwise); scoped verbs consume only their lane; unscoped verbs never see a live lane's events
- [x] Defines **liveness**: presence is the parked scoped `idle`; a lane whose listener lapses past the grace window falls back to the orchestrator — slower, never silent
- [x] Defines **recipient**: default computed from posting location; per-message override via the composer; an override routes one message and never rewires a scope; a summoned agent replies where it was asked, not at home
- [x] Defines **provenance**: mutating requests may name the job (event) they serve; the server stamps the document's origin thread at write time; origin is recorded unconditionally (scoping is computed, not stored) and is user-clearable (detach)
- [x] States the mention/lane composition rule: `@mention` and `/skill` directives bind whichever lane consumes the event, unchanged
- [x] Adds `resident.designated` to §7's core event-type vocabulary (today a closed set: `comment.created`, `form.respond`, `doc.edited`, reserved `agent.done`, plus plugin types) — the designation event is ordinary queue vocabulary, not a side channel
- [x] Reconciles §8's reply-in-parent rule and the queued-vs-working pending-indicator rider (in flight with UI-097) with lane routing
- [x] PLAN.md Phase 32 narrative updated with "(AUTHORIZED <date>, applied)" once signed

## Drafted rider — for signature, one section at a time (2026-08-13)

**Not applied.** SPEC.md is touched only after each section is authorized. The
text below is what would land, verbatim; the prose around it here is commentary
and does not go into the spec.

Sections 1–5, 7 append to **§7** after the queue verbs; Section 6 amends **§9.2**;
Section 8 amends **§8**. (The draft's own map said Section 6 amended §8 and Section 7
amended two §7 sentences — both wrong, corrected during the read-aloud.)

---

### Section 1 — Designation ✅ SIGNED 2026-08-13 (as drafted)

> **A conversation may have a resident.** A **standalone thread** — one with no
> parent document (§6) — may designate a **resident agent**: a long-lived agent
> that owns that conversation and everything that grows out of it, rather than
> being dispatched to one message at a time. Designation is **user-only state on
> the thread**, set and released like any other thread field, and it is
> **single-valued**: a thread has one resident or none, so nothing has to
> arbitrate between two. Only standalone threads may designate, because a thread
> on a document is *about* that document, and a resident owns a conversation
> rather than a passage.
>
> **Designating enqueues an event like anything else.** `resident.designated`
> joins §7's core event types, and it lands on the orchestrator's lane whoever
> is designated — the resident does not announce itself to itself. A designation
> is therefore visible in the queue, in the job log, and in the history, exactly
> as a comment is.
>
> **Dissolution returns the scope to ordinary routing.** A resident is released
> by the person who designated it, and a thread that is **resolved** releases its
> resident with it: a settled conversation has nobody to keep resident. Neither
> rewrites anything — events already stamped keep the lane they were stamped
> with (below), and everything enqueued afterwards routes as it did before there
> was a resident. Dissolving is the absence of a resident, never a third state.

---

### Section 2 — Scope ✅ SIGNED 2026-08-13 (as drafted)

> **A resident owns a scope, not a thread.** The **scope** of a designated thread
> is: the thread itself; every thread whose parent chain reaches it; every
> document whose **origin** (§9.2) reaches it; and every thread on such a
> document. So a conversation that produces a draft, and a comment left on that
> draft, reach the same agent — which is the point: the alternative is a resident
> that owns the talking and loses the artifacts the talking produced.
>
> **Scope is computed, never stored.** Nothing carries a scope marker. Membership
> is derived at enqueue time by walking origin and parent, so a thread designated
> **after** a document was created captures that document retroactively — the
> origin was recorded when it was written, not when it became interesting. That
> is intended, and it is why origin is recorded unconditionally.
>
> **An artifact belongs to at most one scope.** Origin is single-valued and
> written once, by the first write that names a job; a second scope cannot claim
> what a first already holds. Where that lands wrongly, **detaching** is the
> escape hatch: a person clears a document's origin, and it leaves the scope.

---

### Section 3 — Lanes ✅ SIGNED 2026-08-13 (as drafted)

> **The queue is partitioned into lanes.** Every event is stamped with its
> **lane** when it is enqueued: the scope's root thread where the event falls in
> a designated scope, and the **orchestrator's lane** otherwise. The stamp is
> made once and never rewritten, so designating a thread does not move work
> already queued, and releasing a resident does not strand it.
>
> **One consumer per lane** — which replaces "one consumer for the queue".
> Claiming and parking take a lane: a scoped claim sees only its own lane's
> events, and an **unscoped claim never sees a live lane's events**. That is what
> makes two agents working at once safe: they are not racing for the same events,
> they are reading disjoint sets. §7's guarantee that concurrent claims never
> hand one event to two callers is unchanged and now holds per lane, which is
> where it was always doing its work.
>
> **A mention or a skill directive binds whichever lane consumes the event.**
> `@mention` and `/skill` are instructions to whoever does the work, and lanes
> decide who that is; neither reaches across a lane boundary to redirect an
> event, and neither is weakened by one.

---

### Section 4 — Liveness ✅ SIGNED 2026-08-13 (rearm-gap bound added at sign-off)

> **Presence is the parked request, and nothing else.** A resident is **live**
> exactly while it holds a parked scoped `idle` — the same zero-token long poll
> every agent parks on (§7). There is no heartbeat to send, no registration to
> keep fresh, and no state to reap: an agent that stops parking stops being
> present, whether it exited cleanly, crashed, or was killed.
>
> **A lapsed lane falls back to the orchestrator, at claim time.** When a lane's
> listener has been absent longer than a short grace window, that lane's pending
> events become visible to the orchestrator's unscoped claim. The fallback is
> **computed when a claim is made, never written into the events**: a resident
> that comes back finds its lane exactly as it left it. The cost of a lapse is
> therefore that the work is done by the orchestrator instead — slower, and
> without the conversation's warmth — and never that it is silently not done.
> How long the grace window is is deliberately not fixed here, for the same
> reason the idle rearm is not: what is guaranteed is that a lapse is covered,
> not the number of seconds it takes. **One bound on it is guaranteed, because
> the mechanism depends on it**: the window is longer than a rearm gap. A parked
> `idle` expires on its own and the skill re-invokes it, so a perfectly healthy
> resident is un-parked for a moment every time it re-parks; a window shorter
> than that gap would read an ordinary rearm as a lapse, and the symptom would be
> a live conversation intermittently answered by the orchestrator instead of the
> agent sitting in it.

---

### Section 5 — Recipient ✅ SIGNED 2026-08-13 (summons exception named at sign-off)

> **Every message has a recipient, and where you post computes it.** Posting
> inside a designated scope addresses that scope's resident; posting anywhere
> else addresses the orchestrator. The default is never a guess a person has to
> check — it follows from where they are.
>
> **A person may override it for one message.** The composer offers the live
> roster and a message may name a different recipient, which routes **that
> message and nothing else**: an override never rewires a scope, never
> re-designates anything, and never persists past the message it was set on.
> **A summoned agent replies where it was asked**, not in its own conversation,
> because the reply belongs to the thread the question was asked in. This is the
> **one place a scope boundary is crossed on purpose**, and it is worth naming
> rather than leaving to be inferred: a summons routes a single event across a
> lane boundary, the summoned agent works it, and the reply lands in the host
> thread. What it writes there belongs to the **host's** scope, not the summoned
> agent's — origin follows the job the write serves (§9.2), and that job was
> enqueued on the host's lane. Answering a question does not annex the thread it
> was asked in.
>
> **Who is running is a read, never a push.** The roster and each lane's liveness
> are read behind the ordinary invalidate keys (§9.4), like any other projection —
> presence is not a new channel and does not travel over SSE as data.

---

### Section 6 — Provenance (§9.2) ✅ SIGNED 2026-08-13 (missing-job and re-stamp rules added at sign-off)

> **A mutating request may name the job it serves.** Any write may carry the
> event id it is doing the work of, and the server records the **origin thread**
> of a document it creates from that job — unconditionally, whether or not any
> thread is designated, because scope is computed later and a fact not recorded
> at write time cannot be recovered afterwards. Origin is written once and is
> **user-clearable**: detaching a document is how a person corrects it.
>
> **A write that names no job records no origin**, and the document stays outside
> every scope until something claims it. Naming the job is therefore an ordinary
> instruction rather than a rule enforced against the writer: forgetting it costs
> **provenance, never correctness** — nothing is refused, nothing is lost, and the
> document simply belongs to no conversation. That asymmetry is deliberate. §7
> replaced the edit lock because a thing agents were asked to volunteer went
> unvolunteered, and the answer there had to live in the write path because
> forgetting cost a lost edit. Here forgetting costs an unfiled document, so the
> same failure does not justify the same machinery.
>
> **A detached document may be claimed again** by a later write that names a job.
> Detach removes an origin; it does not mark the document permanently unownable.
> The consequence is worth stating rather than discovering: a person's detach can
> be undone by an agent's later write, so detaching is a **correction and not a
> lock** — a document that must stay unfiled stays unfiled by nobody writing it
> from a job, never by the record refusing one.

---

### Section 7 — The three doctrines this scopes ✅ SIGNED 2026-08-13 (all three promoted to §7 at sign-off)

**Corrected before it was read aloud.** The draft called these "the two doctrines
this scopes" and presented all of them as §7 amendments. Only **one** is in §7;
the other two live in the orchestrate skill under `assets/workspace/`, which is
product code. Worse, one was quoted in words that exist nowhere: there is no
sentence reading *"queue state never crosses the subagent boundary"* — the skill
says *"This skill routes and dispatches, and **owns queue state**, ordering,
deferral, logging, and the halt switch."*

At sign-off the user chose to **promote all three to §7** rather than leave two in
the skill: they bind any runtime, not only the skill this repo ships, and §7
already describes the orchestrator's loop, so they are within the section's
existing subject. `AGENT-026` then makes the skill match the spec rather than the
other way round.

> **These rules are per lane, and always were.** Each was written when there was
> one consumer, so each says "the queue" where it meant "the work this agent
> owns". Lanes make the difference visible, and the rules are stated here in the
> form they take now.
>
> **Every event is delegated, on the orchestrator's lane.** The orchestrator
> hands each event it claims to a subagent and never works one inline. A resident
> is not an exception to that rule; it is outside its subject. **A resident works
> its conversation inline**, which is what makes a Corpus conversation feel
> answered rather than dispatched — and it is safe precisely because it does not
> hold the queue: it holds one lane, and every other lane, the orchestrator's
> included, keeps moving while it works.
>
> **One consumer per lane.** A lane has exactly one claimant at a time: the
> orchestrator for the unscoped lane, a resident for its scope. Two agents
> working at once are reading **disjoint sets**, never racing for one event, and
> the guarantee that a claim never hands one event to two callers is unchanged —
> it now holds per lane, which is where it was always doing its work. Running two
> agents against one lane remains what running two orchestrators always was: not
> a correctness failure, because the server still refuses the second claim, but a
> conversation whose story is split in half.
>
> **A lane's owner settles its own lane.** Ordering, deferral, logging and the
> halt switch belong to whoever owns the lane the work came from — the
> orchestrator for the unscoped lane, a resident for its scope. **Nobody settles
> work they did not claim**, which is exactly what the single-owner rule
> guaranteed when there was one owner, and is the whole of what it guaranteed.

---

### Section 8 — The §8 interactions ✅ SIGNED 2026-08-13 (as drafted)

Neither was in the draft; both were found by reading the signed sections back
against §8's existing rules, and both are behaviours nobody would predict from
either sentence alone.

> **Reopening does not restore a resident.** A resolved thread released its
> resident (above), and §8's reply-reopens rule brings the thread back to `open`
> without bringing the resident back with it: the conversation resumes on the
> orchestrator's lane, and designating again is a deliberate act, as the first
> designation was. The alternative — reopening silently restoring an agent that
> was released — would make release conditional on nobody ever replying.
>
> **A message waiting on a lapsed lane says it is waiting, not that anyone is
> working.** §8's indicator already distinguishes *queued and unclaimed* from
> *working*, and a lane whose listener has lapsed is the first case: the message
> is enqueued, no one has claimed it, and the grace window has not yet expired.
> It reads as waiting to be picked up until something claims it — which is the
> resident returning, or the orchestrator after the fallback.


## Corrections after signature (PR #47 review, 2026-08-15)

Both found by review of the applied text, both delegated back to the
orchestrator by the user ("do whatever you recommend"), and both are cases where
a signed sentence's **conclusion** was right and its **reason** was not.

**Section 5 — the summons was unimplementable as written.** The signed text said
the summons event "was enqueued on the host's lane". Combined with Section 3's
"an unscoped claim never sees a live lane's events", that leaves such an event
claimable by nobody: the summoned resident's scoped claim is on a different
lane, and the orchestrator cannot reach a live one.

Resolved by separating two things the draft had conflated. **The lane and the
origin are read off different things**: the lane is stamped to route the work
(so a summons carries the *recipient's* lane), while the origin is the thread the
event's payload names (so a message posted in the host thread files there
whoever works it). Routing follows the recipient; filing follows the
conversation. That keeps Section 3's disjoint sets — the property that makes two
agents safe — and keeps the feature, where the alternatives lost one or the
other.

**Section 6 — "nothing is refused" was contradicted by this phase's own code.**
CONTRACT-050 added a `422` for a job that names no event or names settled work,
and §9.2 said provenance never refuses. Amended to state the asymmetry the
contract already relied on: **omitting is free and misnaming is not**. Dropping
the refusal instead was the alternative, and was rejected for the reason the
route's own docblock gives — the one thing worse than no provenance is a caller
believing it has some.

### And a correction to the correction (PR #47 re-review)

The summons fix above traded an *unimplementable* sentence for a *contradictory*
one. Section 3's lane rule — "the scope's root thread where the event falls" —
was left untouched while Section 5 gained "a summons is stamped with the
recipient's lane", so §7 stated two different lanes for one event four
paragraphs apart.

Resolved by putting the exception where the rule is: the lane rule now reads
"the recipient's lane where the message named a recipient, and otherwise the
scope's root thread… or the orchestrator's lane". The lesson is in the text —
a routing rule and its carve-out stated in two places is how they come to
disagree, which is what happened here twice in one phase.

## Open questions the draft takes a position on

Each is a place the rider could reasonably read otherwise. Raised here rather
than buried, so a signature is on the version that was actually chosen.

1. **Resolution releases the resident** (Section 1). The alternative is that a
   resolved thread keeps its resident so reopening restores it. Chosen against,
   because §8 already lets a person's reply reopen a thread, and a resident
   quietly surviving resolution means a settled conversation still owns every
   artifact it ever produced.
2. **Scope reaches documents, not just threads** (Section 2). The narrower
   reading — a resident owns the thread and its subthreads only — is simpler and
   was rejected: the artifacts are what the conversation is *for*.
3. **Origin is recorded unconditionally** (Sections 2, 6), which is a write on
   every document created from a job whether or not it will ever matter. The
   alternative records it only inside a designated scope and cannot answer
   retroactively.
4. **A lapse falls back rather than queues** (Section 4). Holding a lapsed lane's
   events until its resident returns would preserve warmth at the cost of a
   conversation silently stopping, which is the failure mode this whole design is
   trying to avoid.

## Technical Design

### Files to Create/Modify
- `SPEC.md` — §7 and §8 amendments (applied only after signature)
- `issues/PLAN.md` — Phase 32 header row status

### Key Implementation Details
The rider is the design authority for every issue in Phase 32; the per-domain issues carry
the mechanics but the rider owns the vocabulary (`resident`, `scope`, `lane`, `recipient`,
`origin`) and the invariants. Name the two revoked doctrines explicitly and replace them
with their successors: *one consumer per lane* (not one consumer per queue), and *a lane's
owner settles its own lane* (the orchestrator settles the unscoped lane, a resident settles
its scope). Keep the SSE rule intact — presence and the roster are reads behind invalidate
keys, never data over SSE.

### Edge Cases
- A document whose origin thread is designated *after* the document was created: origin was stamped unconditionally, so the scope captures it retroactively — the rider must state this is intended
- Two designated threads cannot both claim one artifact: origin is single-valued, first writer wins, detach is the escape hatch
- Designation of a thread with events already pending in the orchestrator lane: pending events keep their stamped lane; only new enqueues route to the resident

## Testing Strategy
Not applicable — this is spec work. The check is the signature.

## E2E Verification Plan
Read the applied §7/§8 text against every acceptance criterion above; confirm PLAN.md and
the rider agree on vocabulary; confirm no SPEC section asserts a queue-wide
delegation or claiming rule that the per-lane doctrine does not scope.

### Verification Steps
1. `grep -n "resident\|lane\|recipient" SPEC.md` — the vocabulary appears in §7/§8 and nowhere contradicts it
2. `grep -n "works a job inline\|Every event is delegated" SPEC.md` — every hit is inside text that scopes the rule to the orchestrator's lane; none asserts it queue-wide
3. The orchestrate and converse skills' single-claimant language matches the rider's per-lane rule verbatim (checked when AGENT-025/026 land, but the rider's wording is what they quote)

## E2E Verification Log
**Model: Opus 5 (1M context)**, orchestrator, 2026-08-13. Verification steps run
as written in the plan above:

1. `grep -n "resident|lane|recipient" SPEC.md` — the vocabulary appears in §7,
   §8 and §9.2 and contradicts nothing (resident ×9, lane ×8, origin ×10,
   scope ×14).
2. `grep -o "Every event[^.]*delegated[^.]*." SPEC.md` — **two** hits, and both
   scope the rule to the orchestrator's lane. The original sentence asserted it
   queue-wide and was amended **in place** rather than merely restated below,
   which is what this step exists to catch: adding a scoped version while leaving
   an unscoped one standing would have left §7 asserting both.
3. The skill's single-claimant language is AGENT-026's to match; the rider is now
   the authority it quotes.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [x] Rider signed by the user before SPEC.md is touched
- [ ] `/lint` passes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[SHARED-043]` prefix
