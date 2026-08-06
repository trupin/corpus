# [SHARED-019] The agent resolves conversations it asked for and got

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.
implementing chain does not start before the text is in place — the same rule
SHARED-012, SHARED-013, SHARED-014, SHARED-016 and SHARED-017 are held to.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: **SHARED-018** (collapse anywhere) — the other half of "let me focus
  on what's important". They are **separable and must stay so**: 018 changes what
  a reader sees, 019 changes what the agent may write. Sign either alone. But if
  **both** are signed, one interlock binds them and it is stated in both files —
  see "The interlock with SHARED-018" below.
- Blocks: the AGENT issue this implies (skill text) and, if Amendment 1 is
  signed, a SERVER issue (reply-reopens) — neither filed yet

## Spec References

- §6 Threads and anchors — `status: open | resolved`; forms in turns
- §7 Event queue and agent loop — **Comment skill**; Agent stewardship ("every
  change leaves a visible trace"); Read state; Attention
- §8 Agent participation semantics — **owns** the re-trigger rule this rider
  amends
- §11 UI — Attention seed view; the thread card's resolve/reopen control

---

## The user, verbatim (2026-08-05)

> "The agent should resolve conversations subthreads where the goal was for me to
> provide feedback / new info and there's no follow-up."

**The trigger is already settled** (asked and answered in the same session —
treat as decided, not as an open question): the agent resolves **only where the
person already answered**. Concretely — the agent asked for feedback or
information, the person provided it, the agent used it, and nothing further is
pending.

**A thread the person never replied to stays open.** That is an unanswered ask,
and collapsing it out of view is precisely the failure the current rule exists to
prevent. This rider does not soften that case; it narrows the permission to the
one shape where the person's own turn is the evidence that the matter is done.

---

## This reverses an explicit existing rule

`assets/workspace/claude/skills/comment/SKILL.md` currently states, verbatim
(verified 2026-08-05, in the section on ending turns):

> - **Suggest resolving** when the exchange has run its course.
> - **Do not resolve on the person's behalf.** Run `corpus thread resolve <id> --from agent`
>   only when they asked for the matter to be closed. A thread you resolved unilaterally stops
>   waking you, which is exactly the failure they cannot see.

**The hazard that rule names is real, and it is worse than the rule says.**
Verified end-to-end, 2026-08-05:

1. **Resolved suppresses the re-trigger.** §8: "Every later turn in a thread
   where the agent is `engaged` re-triggers the agent unless the user marks the
   thread `resolved`…". The server implements exactly that — the implicit
   re-trigger branch returns false when `thread.status === "resolved"`.
2. **A reply does not reopen the thread.** Appending a turn writes only the
   thread's `updated` stamp and its `agent` field. `status` is never touched by
   any reply path. So a person replying to a resolved thread leaves it resolved.
3. **Therefore a person's reply to a resolved thread reaches nobody** — no event
   is enqueued, no job appears in the console, and the thread stays resolved.
   Nothing on screen reports this.
4. **The UI already promises the opposite.** The thread card's own confirmation
   after resolving reads, verbatim: `"Thread resolved — committed. Replying
   reopens it."` **That sentence is false today** — replying reopens nothing.
   This is a pre-existing defect independent of this rider, and Amendment 1 is
   what makes the promise true. _(File it as a UI/SERVER bug even if this rider
   is declined — the app is currently telling people something untrue about how
   to get the agent back.)_
5. **There is an escape hatch, and it is invisible.** An explicit `@agent`
   mention or the composer's ask-agent toggle **does** still enqueue on a
   resolved thread — those short-circuit before the resolved check. So the
   person is not permanently locked out; they simply have to know a rule nothing
   tells them.
6. **Nothing in the server or the CLI restricts who may resolve.** The
   resolve/reopen endpoints take any actor and `corpus thread resolve` accepts
   `--from agent` today. The prohibition is skill text only — which is why this
   rider is a text change, not a permissions change.

So the reversal is safe **only if the silencing stops being permanent**. That is
Amendment 1, and it is the load-bearing half of this file.

---

## What this rider is for

A thread stays open because someone has to do something about it. The failure the
user is reporting is that threads stay open after nobody has to do anything about
them — the agent asked for a number, got the number, used the number, and the
conversation sits in the margin forever looking like work. Every settled thread
left open is noise in the one place the reader looks for signal, and the cost
compounds exactly as the corpus becomes worth having.

The agent is the party that knows the matter is settled: it made the ask, it
consumed the answer, and it is the one writing the closing turn. Requiring the
person to also click resolve is asking them to do bookkeeping about work that is
already finished — the definition of the busywork the product exists to remove.

---

## The decisions this draft makes, and why

**Resolution stops being absorbing (Amendment 1).** The hazard the skill names is
not really "the agent resolved it" — it is "resolved is a one-way door with no
handle on the far side". So the draft fixes the door rather than the doorman: **a
person's reply to a resolved thread reopens it and reaches the agent under §8's
ordinary rules.** That is what a person means by replying to a settled
conversation — it turned out not to be settled — and it is what the UI already
tells them will happen. It makes _every_ resolution recoverable, including the
ones the person made themselves, and it is worth signing even if the rest of this
file is declined.

**The note-only toggle keeps its job.** Amendment 1 must not take away the
ability to add a remark to a closed thread without summoning anybody. §8 already
has the instrument for that and the draft leans on it rather than inventing a
second one: a note-only reply reopens the thread (the conversation is live again)
but wakes no one. So "reply and get the agent" and "reply and don't" both stay
expressible, and the distinction is the toggle the composer already has.

**Only the person's reply reopens.** An agent turn on a resolved thread does not
reopen it — otherwise a thread the agent resolves in the same breath as its
closing reply would immediately reopen itself, and resolution would never stick.

**The agent resolves in the same turn as a reply, never as a bare act.** §7 says
"every change leaves a visible trace" and gives the agent the vocabulary for it —
the trace line (§6), a one-line past-tense report of what the turn did. Resolving
is a state change to the thread, so it is reported like every other. The
practical effect is that **resolution never happens without a turn the person can
read**, which is the whole difference between closing a conversation and
disappearing one. _(The user was offered a variant requiring a closing turn and
did not pick it — this is a recommendation, Q2, not an assumption.)_

**Who opened the thread is irrelevant; who was waiting is what matters.** The
draft deliberately does not key the permission to authorship. The real shape is:
the last outstanding item in the conversation was **the agent's own ask**, the
person answered it, and the agent has used the answer. That happens just as often
in a thread the person started (they ask, the agent needs a clarification, they
clarify, the agent finishes) as in one the agent started. Keying on authorship
would forbid the commonest case and permit nothing useful.

**Nothing cascades.** A child thread is its own document with its own status.
Resolving a subthread does not resolve its parent, and resolving a parent does
not resolve its children — a settled sub-question inside a live conversation is
exactly the case the user described, and it must be resolvable without touching
the conversation around it.

**An unanswered form is never settled.** §6 makes threads with an unanswered form
surface in Attention as "awaiting your answer". That is an outstanding ask by
definition, so it is named as an explicit exclusion rather than left to judgment.

**This belongs in SPEC, not only in the skill.** Threads changing status without
a person acting is observable product behaviour, and §8's current sentence says
"unless **the user** marks the thread `resolved`" — that phrasing is exclusive
and would contradict the new behaviour if left alone. What stays in the skill is
the judgment ("has this actually run its course"), which is not spec material.

---

## The interlock with SHARED-018

**Read this section in both files.** SHARED-018 makes resolved threads collapse
by default. This rider lets the agent produce resolved threads. Composed
naively, the agent would gain the ability to make a conversation fold itself
away, which is the one outcome neither rider wants.

The interlock is a single rule and it lives in **SHARED-018's** text, where the
collapse rules are: **a thread carrying a turn you have not seen is never
collapsed by rule.** An agent-resolved thread always carries the agent's closing
reply, and that reply is unread until it is read — so it stays expanded until the
person has actually seen it, and only then takes its place among the settled
conversations.

This is not a special case invented for this rider. §7's read-state rule already
says a collapsed chip "has displayed nothing" and so never counts as read;
without the interlock, a resolved-and-collapsed unread thread would stay unread
forever with nothing ever prompting anyone to open it. The rule is load-bearing
for SHARED-018 on its own and merely _also_ what makes this rider safe.

**If SHARED-018 is signed and this one is not**, the interlock still belongs in
018. **If this one is signed and 018 is not**, nothing collapses and the
interlock is inert — but the agent's reply still shows as unread in Attention,
which is the same guarantee by another route.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §8, REPLACE the re-trigger bullet

REPLACE, in **§8 Agent participation semantics (opt-in per comment)**, exactly
this existing line (it is the only line in SPEC.md beginning "Every later turn"):

> - Every later turn in a thread where the agent is `engaged` re-triggers the agent unless the user marks the thread `resolved` or posts with the "note only" toggle. (Rationale: once you've pulled the agent into a conversation, replying to it should just work.)

with:

> - Every later turn in a thread where the agent is `engaged` re-triggers the agent unless the thread is `resolved` or the turn was posted with the "note only" toggle. (Rationale: once you've pulled the agent into a conversation, replying to it should just work.)
> - **Resolved is a closed door, not a locked one: a person's reply reopens it.** A turn written by a person on a `resolved` thread sets the thread back to `open`, and from there §8's ordinary rules apply unchanged — so a reply on a thread the agent is `engaged` in reaches the agent again, and a reply posted "note only" reopens the conversation without waking anybody. Replying is what a person does when a settled matter turns out not to be settled, and it must not be the one action that silently reaches no one. A turn written by the **agent** never reopens a thread, so a conversation the agent closes stays closed. Reopening this way is an ordinary status change: it is committed, it is visible on the thread, and it is indistinguishable afterwards from reopening by hand.

### Amendment 2 — §7, APPEND to the **Comment skill** paragraph

APPEND immediately after, in §7's **Comment skill** paragraph, exactly this
existing sentence, which ends the paragraph:

> Close the loop by setting `agent: engaged` on first reply.

the following:

> **The agent closes conversations it asked for and got.** When the agent asked the person for feedback or information, the person provided it, the agent has used it, and nothing in the thread is still waiting on anyone, the agent **resolves the thread itself**, in the same turn as the reply that reports the work — never as a separate silent act, and always stating in that turn that it is closing the matter. This is the one shape it may close: **a thread the person never replied to always stays open**, because an unanswered ask is exactly what the open state is for, and so does a thread holding an unanswered form (§6), an unfinished piece of the agent's own work, or a question the person put to the agent that the agent has not yet answered. Who opened the thread does not matter — a settled sub-question inside a live conversation is resolved on its own, and resolving a thread never resolves its parent or its children. The person's resolve/reopen control is untouched: they may close anything at any time, and reopening an agent-closed thread is the same action as reopening any other — as is simply replying to it (§8). _(Rider signed 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Amendment 1 at all? It is the safety half, and it is the bigger change.**
As drafted, a person's reply reopens a resolved thread. This is a server
behaviour change affecting every thread, not only agent-resolved ones, and it
changes an existing §8 sentence rather than adding to it.

_Recommendation: sign it, and sign it first._ Three reasons, in order of weight:
the app **already tells people this is how it works** and it is not (the resolve
confirmation reads "Replying reopens it"), so this fixes a live lie regardless of
the rest of the rider; without it, the skill's stated hazard is unanswered and
Amendment 2 should not be signed; and it makes every resolution recoverable by
the most obvious possible action, which is what makes resolving cheap enough to
do freely. If the user wants Amendment 2 alone, say so explicitly and I will note
in the issue that the hazard was accepted knowingly — but I would not
recommend it.

**Q2 — Must the agent say it is resolving, in words, before doing it?** As
drafted, the resolution rides on the reply turn and that turn states it. The
variant the user was offered and did not pick was a **separate closing turn**
whose only job is to announce the close.

_Recommendation: as drafted — stated in the reply, not a turn of its own._ A
separate turn costs the person an extra unread item that carries no information
the reply could not, and §7's trace-line convention already exists for exactly
this ("what this turn did to the corpus"). The thing worth insisting on is not a
second turn but that **there is always a first one**: no resolution without a
readable turn. That is what the amendment says.

**Q3 — May the agent resolve a thread it did not open?** As drafted: yes, because
authorship is the wrong key — what matters is whether the outstanding item was
the agent's ask.

_Recommendation: as drafted._ The narrower rule (agent may close only threads it
opened) forbids the commonest real case — the person asks, the agent needs one
clarification, gets it, finishes — and permits almost nothing the broader rule
does not.

**Q4 — Does this belong in SPEC at all, or only in the skill?** As drafted, both:
§8 gets the reopen rule (product behaviour), §7 gets the permission, and the
judgment stays in the skill.

_Recommendation: as drafted._ §8's sentence currently reads "unless **the user**
marks the thread `resolved`", which actively contradicts an agent that resolves;
leaving SPEC alone would leave the spec and the product disagreeing. The
alternative — skill text only — also makes the behaviour untestable by an
evaluator reading SPEC, which is how these riders are checked.

**Q5 — Should an agent-resolved thread be distinguishable from a
person-resolved one?** The draft does **not** ask for this: `status` is
`open | resolved` with no third value, and git already records the acting party
as the commit author (§7), so the audit trail exists without a schema change.

_Recommendation: no new field, as drafted._ If the user wants it visible in the
UI rather than in git, the honest cheap form is that the agent's closing turn
says so in words — which Amendment 2 already requires — rather than a new
frontmatter value every consumer would have to learn.

---

## Non-goals (state them so the chain does not drift)

- **No new state.** `status` stays `open | resolved`. No "auto-resolved", no
  "pending close", no expiry timer.
- **Nothing time-based.** The agent never resolves a thread because it went
  quiet. Silence is not an answer, and a thread nobody replied to is the case
  this rider most carefully excludes.
- **No bulk or retroactive resolution.** This is a per-thread act taken in the
  course of working one event. The agent does not sweep the corpus closing old
  threads (and a sweep would violate §7's "never enumerate the corpus" anyway).
- **The agent still never deletes.** §7's rule is untouched: archive and resolve,
  never delete.
- **No change to what triggers the agent, beyond Amendment 1's reopen.** The
  mention/invocation/toggle rules of §8 are untouched, including the existing
  behaviour that an explicit `@agent` or the ask-agent toggle reaches the agent
  even on a resolved thread.
- **No change to Attention.** An agent-resolved thread carrying an unread reply
  is still an unread agent reply, and still surfaces there; resolving does not
  clear an unread mark.
- **Not a collapse feature.** What a resolved thread looks like is SHARED-018's
  question, not this one's.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q5 and the text is adjusted
- [ ] Amendment 1 applied to SPEC.md §8 verbatim at phase kickoff, by the
      orchestrator, **replacing** the quoted line
- [ ] Amendment 2 applied to SPEC.md §7 verbatim, **appended** after the quoted
      sentence — nothing in §7 is deleted by this rider
- [ ] `assets/workspace/claude/skills/comment/SKILL.md` is updated in the same
      phase: the "Do not resolve on the person's behalf" bullet is replaced, and
      the replacement states the narrow trigger **and** the exclusions, so the
      skill and SPEC cannot drift
- [ ] The false confirmation text ("Thread resolved — committed. Replying
      reopens it.") is either made true by Amendment 1 or corrected — it does not
      survive this phase as-is
- [ ] The implementing chain does not start before the text is in place

## Technical Design

### Files to Create/Modify

- `SPEC.md` §8 (one replace), §7 (one append)
- `assets/workspace/claude/skills/comment/SKILL.md` (replace the prohibition) —
  AGENT issue, filed after sign-off
- The reply path's participation decision and the thread's status write — SERVER
  issue, filed after sign-off, only if Amendment 1 is signed
- The resolve confirmation copy — UI issue, filed after sign-off

## Testing Strategy

None here — spec text. The notches worth fixturing when the domain issues are
filed:

- a resolved, `engaged` thread + a person's plain reply → thread is `open` again
  **and** an event was enqueued
- the same with the note-only toggle → thread is `open` again and **no** event
- a resolved thread + an **agent** turn → still `resolved`, and no reopen
- resolving is idempotent and the CLI still reports "already resolved" (existing
  behaviour, must not regress)
- a thread whose last turn is the agent's unanswered question → the agent does
  **not** resolve it
- a thread with an unanswered form → the agent does **not** resolve it
- a child thread resolved by the agent → parent's status unchanged; and a parent
  resolved → children unchanged
- an agent-resolved thread → its closing turn exists, is readable, says the
  matter is closed, and is **unread** until opened

## E2E Verification Log

_N/A — spec draft. The pre-existing defects it documents were verified by reading
the server's turn-append and participation paths and the thread card's
confirmation copy on 2026-08-05; an implementing agent should reproduce them
against the running app before changing anything._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-019]` prefix
