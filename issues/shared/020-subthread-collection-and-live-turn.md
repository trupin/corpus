# [SHARED-020] Subthread replies are collected; the agent's latest turn stays current

## Domain

shared (orchestrator-owned)

## Status

done — signed by the user 2026-08-05; amendments applied to SPEC.md.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: nothing signed. It **assumes** SHARED-019 (subthread settling) and
  SHARED-018 (resolved threads collapse) rather than restating them — see
  "What this rider assumes and does not say" below.
- Blocks: a contract issue (a turn-revision primitive), a server issue (revision
  as a body edit through the existing reconciliation + auto-commit path), a UI
  issue (revised marking, unread-on-revision), and an agent-runtime issue (the
  collect-and-continue-in-the-parent discipline). None filed.

## Spec References

- §4 The workspace — auto-commit with the acting party as git author; "`git log`
  doubles as the audit trail of who changed what"
- §6 Threads and anchors — **owns** turn format, turn identity, deletion,
  recursion (child threads), anchor reconciliation, "a visible orphan beats a
  silent misattachment"
- §7 Event queue and agent loop — **Read state** ("a thread is **unread** when its
  last turn is newer than your last-seen mark")
- §8 Agent participation semantics — engaged threads re-trigger on every later
  turn; this rider adds *where* the agent replies without touching *whether* it
  is asked
- §11 UI — Thread view: turn-selection commenting, "Child threads shown per-turn",
  "Opening a thread marks it seen"

---

## The user, verbatim (2026-08-05)

> "Sometimes, I'll answer to the agent using subthreads. The problem with that is
> that the answers come non linearly. I don't want the agent to use the subthread
> to continue the conversation. It should collect what I say and fallback to the
> main thread to keep going. Because my answers will arrive async spread across
> subthreads, I want the next message in the main thread to be relevant to the
> latest state of the conversation. So the agent should edit that message
> dynamically as I provide more context. It means it should be able to edit its
> latest message in the thread instead of leaving trails of messages that are just
> reflecting a state that is no longer current."

Two distinct asks, and they are separable:

- **(a) Collection.** A reply written in a subthread is *input*, not a venue: the
  agent gathers it and continues in the parent conversation.
- **(b) A live latest turn.** The agent may revise its own newest message so the
  parent's last message reflects everything collected so far, instead of the
  conversation accumulating superseded states.

(a) alone is a behavioural rule the agent runtime could adopt today. (b) needs a
new primitive.

---

## What already exists — verified 2026-08-05, this rider does not re-specify it

- **Subthreading a turn is already specified and is exactly what the user is
  doing.** §6's **Recursion**: "commenting on a thread turn creates a child thread
  whose `parent` is the thread's id." §11's Thread view adds the finer form:
  "Selecting text inside a rendered turn offers the same Comment affordance the
  document view offers: the selection becomes the child thread's text-quote anchor
  (§6)". So a subthread reply is, by construction, **anchored into the text of the
  agent's message** — that is the fact this rider has to survive.
- **A reply in a child thread already wakes the agent** by §8's ordinary rules
  (`@agent`, a targeted mention, a skill invocation, the composer toggle, or an
  engaged thread's every-later-turn rule). Nothing here changes triggering.
- **There is no revise-a-turn capability.** The contract's per-turn surface is
  `DELETE /api/threads/{id}/turns/{ts}` and nothing else that touches a turn's
  body. _(Correction to the brief that commissioned this rider: the turn routes
  are spread across three files, not one — `POST /api/threads/{id}/turns` appends
  and `POST /api/threads/{id}/turns/{ts}/form` answers a form. The substantive
  claim holds: **no route replaces a turn's body**, and §6 knows only append and
  delete.)_
- **A turn's identity is its timestamp.** §6: the server "guarantees turn
  timestamps are unique (monotonic) within a thread — they are the turn's
  identity." So "editing" must mean **replacing a body while keeping that
  identity**. Delete-and-repost is not a substitute: it moves the turn to the end,
  reorders the conversation, drops the child threads hanging off it (§6's cascade
  removes the anchor entry), and is barred anyway — turn deletion is user-only and
  "the agent never deletes turns."
- **Deletion is user-only; the agent archives, never deletes** (§6, §7). A revise
  right granted to the agent must not become a delete right by another name.
- **Nothing is lost when text is rewritten.** §4: "Every mutation the server
  performs auto-commits the affected files ... with the acting party (`user` or
  `agent`) as git author." That is the honest mitigation for "the agent rewrites
  what it said" — the previous wording is in history, attributed — and the draft
  leans on it rather than pretending a revision is free.
- **Anchor reconciliation already covers this case.** §6 reconciles a document's
  anchors on **every save path**, including out-of-band writes. A child thread
  anchored into a turn has its anchor entry in *the thread document's*
  frontmatter, and revising a turn is a body edit to that thread document — so
  reconciliation applies unchanged, with its published guarantees: text left alone
  keeps its thread; text removed orphans it, selector preserved byte-for-byte,
  "still fully functional and listed"; and "a visible orphan beats a silent
  misattachment" — never re-attached to a lookalike.
- **Read state is per-thread and turn-based.** §7: "A thread is **unread** when
  its last turn is newer than your last-seen mark," cleared by displayed content.
  A revision adds no turn, so under the text as it stands **a revision is
  invisible to read state**. That sentence therefore has to change or the feature
  is silent — this is the one place the rider replaces existing text.
- **The loop's self-feeding hazard is already written down.** The orchestrate
  skill: "**But an agent turn can still wake the loop** ... The server checks the
  turn's *body* before it checks the author: a turn mentioning `@agent` enqueues
  whoever wrote it." A revision that counted as a turn would close a loop
  (subthread reply → agent wakes → agent revises parent → revision wakes agent).
  The draft forecloses it unconditionally.

---

## The collision this rider exists to resolve

**The feature as literally described degrades the very thing the user is doing.**

The user's workflow is *answering via subthreads*. Every such reply is a child
thread whose anchor points into a phrase of the agent's message. Ask (b) is that
the agent **rewrites that message**. A wholesale rewrite is, to §6's
reconciliation, a deletion of the anchored text — so it **orphans exactly the
threads the person is using to talk**. The more the person engages, the more the
feature costs them. That has to be answered in the spec text, not left to
implementation.

Four ways to answer it were weighed:

**A — Refuse revisions that would orphan an anchor.** A hard guarantee: nothing
ever detaches. **Rejected.** It inverts the incentive — the person's own act of
commenting *freezes* the text they commented on, so the more subthreads they open
the less the agent can maintain the message, which is the opposite of the ask. It
also creates a failure with no good exit: an agent that must correct a sentence
someone quoted is simply stuck, mid-loop, with a refusal and no fallback. And a
hard refusal is a rule about editability that §6 does not otherwise have.

**B — Let anchors orphan, visibly.** §6's existing answer, and the honest floor.
**Kept as the fallback, not as the plan.** Alone it is bad: the person's open
question becomes a detached thread while they are waiting on it.

**C — A stable region and a volatile region.** The agent writes its turn so the
parts people select and reply to — the questions, the options, the cited passages
— are carried forward verbatim, and revises *around* them. §6's first guarantee
("an anchor whose text the edit left alone keeps its `exact`") then keeps those
child threads attached with no new machinery at all. **Chosen as the spine.**
It makes the good outcome the default rather than a promise, and it costs no new
anchor rules — which matters, because anchor reconciliation is the most carefully
specified mechanism in the document and this rider should not amend a word of it.

**D — Settle each subthread once it has been collected.** Once the person's answer
has been folded into the parent, the child thread's purpose is finished; closing
it out means a later orphan is closed business rather than a lost question.
**Chosen as the complement**, and it is SHARED-019's subject — this rider assumes
it and does not restate it.

**The draft is C + D, with B as the stated floor, and A rejected.** Plus one rule
that catches the residual case: when what needs to change *is* the anchored text —
the question has been answered, so the question must go — the agent **posts a new
turn instead of revising**. Revision is for keeping a message current, not for
erasing the parts of it people are holding on to.

**What the user loses, stated plainly.** (1) A revision that removes text someone
commented on detaches their thread: it keeps its quote and stays fully usable, but
it no longer sits inline under the turn. (2) Text the person has already read can
change under them without a new message appearing — which is why the draft makes a
revision re-mark the thread unread and makes the turn say it was revised. (3) The
conversation stops being a strict append-only log of what the agent said at each
moment; that log now lives in git rather than on screen.

---

## What this rider assumes and does not say

Three riders form one workflow. Kept separate so each can be signed or refused on
its own:

- **SHARED-019 — subthread settling.** What happens *in* the child thread once its
  input has been collected: acknowledged and resolved rather than left open. This
  rider's §8 text says only that a collected child thread is closed out rather
  than left unanswered, so it stands alone if 019 never signs; 019 owns the
  resolve mechanics and the "nothing pending" test.
- **SHARED-018 — resolved threads collapse.** Why settling a child thread actually
  tidies the parent's surface. Not referenced in this rider's spec text at all.
- **SHARED-020 (this one)** — where the agent replies, and the right to keep its
  latest message current.

**Not on disk at drafting time.** `issues/shared/` contains 001–017; no 018 or 019
file exists in this working tree (checked 2026-08-05). They were described to me
as drafted and unsigned. If they do not materialise, this rider is still coherent
— it degrades to "the agent closes out the child thread with a brief
acknowledgment" — but the cross-references in the prose above should be corrected
before sign-off rather than left pointing at nothing.

---

## The decisions this draft makes, and why

**A revision keeps the turn's identity — same author, same timestamp, same
position.** Anything else reorders the conversation and breaks what points into
it. This is the whole reason the primitive has to be new rather than assembled
from delete + append.

**Agent-only, and only its own turns.** A person editing their own past turns is a
much larger change to the record: the agent has already read, acted on, and
possibly committed work against what was written, and rewriting it retroactively
makes the audit trail describe a conversation that did not happen. The person also
has cheap alternatives the agent does not — delete the turn (user-only, already
specified) or post another. This is a one-way door that can be opened later
without breaking anything specified here; opening it now buys nothing the user
asked for.

**Only while it is still the last turn, in an open thread.** Revising a message
someone has already replied to rewrites what they were answering — the single
worst version of this feature. Last-turn-ness is the whole gate: no time window,
no revision budget, nothing to tune. A resolved thread is closed, and a message
changing inside a closed conversation is a surprise, so revision needs the thread
open too.

**A pending revision that loses the race becomes a new turn.** If a turn lands
between the agent deciding to revise and the revision arriving, the revision must
not apply — but it must not vanish either. It becomes a new turn, so the content
always reaches the conversation, late-but-visible rather than silently dropped or
applied to a turn that is no longer last.

**A revision is never a turn and never re-triggers the agent — unconditionally.**
Not "unless it mentions `@agent`", not "unless the thread is engaged". The
triggering rule §8 states is about turn bodies; extending it to revisions closes
the loop the orchestrate skill already warns about, and the loop would be driven
by the agent's own text. Editing its own message can never be how the agent gives
itself more work.

**A revision re-marks the thread unread.** §7's read state exists to answer "have I
seen the current state of this conversation", and a revision changes that state.
The alternative — a quieter revised-marker that does not count as unread — makes
the feature's payload (the newest message is the one that matters) the one thing
the person is not told about. The cost is real and worth naming: a thread you just
read pops back into Attention each time the agent folds in another answer. Given
that the user's stated scenario is answering across several subthreads, that is
several re-notifications for one exchange — see Q1.

**The turn says it was revised, and when.** A message that changed must be
distinguishable from one that never did; otherwise the person's memory of what
they read and what is on screen diverge with nothing on screen admitting it.

**Collection applies to a child of a *turn*, not to every thread.** A comment on a
*document*, and a standalone thread, are their own conversations with no parent
conversation to fall back to — redirecting those would break ordinary commenting.
For a child of a child, the venue is the nearest ancestor thread the agent is
engaged in.

**Collection changes where the agent replies, never whether it is asked.** §8's
triggering rules are untouched: a subthread reply requests the agent exactly as it
does today. What changes is the venue of the answer.

---

## Proposed SPEC.md amendments — verbatim, for sign-off

### Amendment 1 — §6, APPEND after the **Turn format** paragraph

APPEND immediately after, in §6, exactly this existing text (end of the **Turn
format** paragraph):

> **Deletion cascades**: deleting a thread's last turn deletes the thread itself,
> and deleting a thread (either way) removes its anchor entry from the parent's
> frontmatter — no highlight is ever left pointing at an empty conversation.

the following:

> **Revising a turn — agent-only, last turn only.** A turn's body can be
> **replaced in place**, keeping the turn's identity: same author, same timestamp,
> same position in the conversation. Revising is not deleting and re-posting — the
> turn does not move, the conversation does not reorder, and everything pointing
> into it still points at it. The right is deliberately narrow:
>
> - **Only the agent revises, and only its own turns.** A person's turn is never
>   rewritten by anyone — someone who wants to change what they said deletes the
>   turn (above) or posts another one.
> - **Only while it is still the last turn of an open thread.** The moment any
>   turn lands after it, from either party, that turn is frozen for good: revising
>   a message someone has already replied to rewrites what they were answering. If
>   a turn lands between the agent's decision to revise and the revision itself,
>   the revision **does not apply**, and what the agent meant to say arrives as a
>   **new turn** instead — a revision is never silently dropped and never lands
>   late.
> - **A revision is not a turn.** It appends nothing, enqueues nothing, and
>   **never re-triggers the agent** (§8) — whatever the revised body says,
>   including a mention that would wake the agent had it been written as a new
>   turn. The agent editing its own message can never be how the agent gives
>   itself work.
> - **Nothing is erased.** A revision auto-commits like every other mutation (§4),
>   with the agent as author, so every previous wording of the turn remains in git
>   history: what was said at the time stays recoverable, and revising is not a
>   way to unsay anything.
> - **Anchors are governed by this section, unchanged.** A child thread anchored
>   into a turn's text is an anchor on this thread document, and a revision is a
>   body edit to it — the same reconciliation runs, with the same guarantees: text
>   the revision leaves alone keeps its child thread attached; text the revision
>   removes orphans it, visibly, selector preserved, still fully functional, and
>   never re-attached to a lookalike. **So a revision carries the asks forward**:
>   the agent writes its turn so the parts people select and reply to — its
>   questions, its options, the passages it cites — stay put across revisions, and
>   revises around them. When what has to change *is* text a child thread is
>   anchored to, the agent **posts a new turn instead of revising**: keeping a
>   message current is never worth detaching a conversation someone is in the
>   middle of.

### Amendment 2 — §8, APPEND as a final bullet

APPEND immediately after, in §8, exactly this existing text (the section's last
bullet):

> - The UI shows an honest, time-aware pending indicator while an agent response
>   is outstanding ("working…" → "still working…" with escalating thresholds like
>   45 s / 3 m / 15 m). **No fake progress, no token streaming.**

the following:

> - **A reply in a child thread is collected; the conversation continues in the
>   parent.** Commenting on a turn — or on a selection inside one — starts a
>   **child thread** (§6), and answering the agent that way is ordinary use:
>   several questions in one message get several separate answers, each written
>   when it is ready. The agent does not carry the conversation on in the child.
>   It **collects** what was said there as input to the conversation the turn
>   belongs to, and replies in that parent thread — for a child of a child, in the
>   nearest ancestor thread it is engaged in. Because those answers arrive out of
>   order and spread across several child threads, **the parent's newest message
>   is the current one**: instead of appending a fresh message per fragment and
>   leaving a trail of superseded states, the agent **revises its own latest turn**
>   (§6) as more comes in, so the newest thing in the conversation reflects
>   everything collected so far. A child thread whose input has been collected is
>   **closed out with a brief acknowledgment** rather than left open and
>   unanswered — a child thread is a place to say something, not a place to be
>   ignored — and if the person keeps writing there, that is more input, not a
>   change of venue. This governs **where** the agent replies, never **whether**
>   it is asked: a reply in a child thread requests the agent by exactly the rules
>   above. And it applies only to a thread on a **turn** — a thread on a document,
>   or a standalone thread, is a conversation in its own right with no parent to
>   fall back to, and is answered where it is.

### Amendment 3 — §7 **Read state**, REPLACE the first sentence

REPLACE, in §7's **Read state** paragraph, exactly this existing sentence:

> **Read state.** A thread is **unread** when its last turn is newer than your
> last-seen mark.

with:

> **Read state.** A thread is **unread** when its newest content is newer than
> your last-seen mark — which a new last turn makes true, and so does that last
> turn being **revised** after you saw it (§6). What read state answers is whether
> you have seen the conversation as it now stands, and a revision changes what it
> says without adding a turn; a message that quietly rewrote itself while you
> were not looking is exactly the one worth telling you about.

_(The rest of the paragraph — marks living server-side, what counts as read,
opening a parent document not marking its chips seen, Attention — is unchanged.)_

### Amendment 4 — §11 **Thread view**, APPEND after the newlines sentence

APPEND immediately after, in §11's **Thread view** bullet, exactly this existing
text:

> **Newlines in a turn written by a person render as line breaks** — a textarea
> offers no other way to write one — while a turn written by the agent renders as
> ordinary markdown, where a single newline is a space and a break is written as
> markdown spells it. _(Rider signed 2026-08-03.)_

the following:

> **A revised turn says so.** When the agent revises its latest turn (§6), the
> thread shows the current text, **marked as revised** and saying when it was last
> revised — a message that changed is never indistinguishable from one that never
> did, and the mark stays for good rather than flashing once. Because a revision
> adds no turn, a reader who had already seen the thread finds it **unread again**
> (§7), surfacing in Attention like any unread agent reply: the point of revising
> is that the newest message is the one worth reading, and a change nobody is told
> about is worse than a message nobody had to read. Child threads keep showing
> against their turn across a revision; one whose anchored text a revision removed
> appears among the detached threads with its quote intact (§6), the same as any
> other orphan. Nothing about revision is offered on a person's turn, and nothing
> is offered on an agent turn that is no longer the last one. _(Rider signed
> 2026-08-05.)_

---

## Open questions for sign-off

**Q1 — Should a revision make the thread unread again?** As drafted, yes
(Amendment 3 + 4). The cost lands squarely on the user's own scenario: answering
four subthreads over an afternoon means the parent thread re-enters Attention four
times for what is, to them, one conversation.

_Recommendation: yes, as drafted._ The alternative — a revised-marker visible only
once you open the thread — makes the feature's entire payload invisible from the
board, which is where the user lives. If the noise proves real, the narrower fix
worth having later is **coalescing**: a thread already unread for a revision does
not re-notify for the next one, so the first revision after you read pings and
subsequent ones do not. That is a refinement of the same rule, not a different
rule, and is better added on evidence than guessed at now.

**Q2 — Confirm the anchor trade (the crux).** The draft chooses: the agent keeps
anchored text stable and revises around it; when the anchored text itself must
change, it posts a new turn; and anything that still orphans, orphans visibly per
§6. The rejected alternative is a hard rule that a revision which would orphan an
anchor is **refused outright**.

_Recommendation: as drafted, and reject the hard refusal._ A refusal guarantees no
detachment but makes the person's own commenting freeze the agent's message —
under exactly the workflow this rider is for — and leaves the agent stuck with no
fallback. As drafted, the bad outcome is bounded (a detached thread that keeps its
quote and still works) and the agent has an always-available escape (post a new
turn). If the user wants the stronger guarantee anyway, the honest version is not
a refusal but a **downgrade**: a revision that would orphan silently becomes a new
turn instead — same guarantee, no dead end. Say so and the draft can be adjusted
to that in one sentence.

**Q3 — Does the person get to revise their own turns too?** As drafted, no:
agent-only.

_Recommendation: agent-only._ The agent has already read and acted on what the
person wrote, sometimes committing work against it; retroactively rewriting it
makes `git log` describe a conversation that did not happen. The person already
has delete (user-only) and "post again". This can be opened later without
invalidating anything signed here.

**Q4 — Should previous wordings be visible in the app?** As drafted, no: the mark
says *that* a turn was revised and *when*, and git history holds *what it said*.

_Recommendation: no, for now._ In-app revision history is a real feature (a diff
view per turn, a picker, a story about what a child thread anchored to a wording
that no longer exists should show) and none of it was asked for. If it is wanted,
it is its own rider.

**Q5 — What if the person explicitly asks the agent to answer *in* the
subthread?** The rule as drafted is unconditional: the substance goes to the
parent, the child gets an acknowledgment. Taken literally that means the agent
declines a direct instruction.

_Recommendation: let an explicit instruction win, and say so in the text if the
user agrees._ "Answer here" is a direct request, and refusing it to satisfy a
default is the kind of obedience-to-the-rule that makes a tool feel broken. It
stays testable — the venue is the parent unless the reply asks otherwise. I have
**not** written this into Amendment 2, because the user's phrasing ("I don't want
the agent to use the subthread to continue the conversation") is emphatic and this
is their call, not mine.

**Q6 — Ordering against SHARED-016.** Its Amendment 1 and this rider's Amendment 4
append to §11's Thread view bullet after **the same** existing sentence. Both are
unsigned. Whichever signs second appends after the other's inserted text — no
conflict, but the second one to be applied must re-read the bullet rather than
pattern-match blindly. Flagged so the orchestrator does not discover it mid-edit.

---

## Non-goals (state them so the chain does not drift)

- **No change to what triggers the agent.** §8's triggering rules are untouched;
  this rider must be applicable without altering a single triggering behaviour.
- **No change to anchor reconciliation.** §6's reconciliation text is not amended
  by a word. Revision is a body edit that flows through it as specified.
- **No new deletion right.** Revision replaces a body; it never removes a turn,
  never changes a timestamp, and never gives the agent a path to what §6 reserves
  for the user.
- **Not retroactive.** Turns written before this exists behave like any other; a
  turn nobody has revised carries no mark and reads exactly as it does today.
- **No in-app revision history** (subject to Q4).
- **No person-side turn editing** (subject to Q3).
- **No cross-thread merging.** Collection is the agent reading child threads and
  answering in the parent; no turns are moved, copied, or rewritten between
  threads.
- **Not a resolve mechanic.** What happens to the settled child thread is
  SHARED-019's; what a resolved thread looks like is SHARED-018's.

## Acceptance Criteria

- [ ] User signs off, or answers Q1–Q6 and the text is adjusted
- [ ] The SHARED-018 / SHARED-019 cross-references are corrected or removed if
      those riders do not exist at sign-off time
- [ ] All four amendments applied to SPEC.md verbatim at phase kickoff, by the
      orchestrator: Amendments 1, 2, 4 appended after the quoted existing text
      (nothing deleted), Amendment 3 replacing exactly the quoted sentence and
      leaving the rest of §7's Read state paragraph intact
- [ ] §6's **Anchoring** and **Anchor reconciliation** text is **not** edited
- [ ] §8's existing triggering bullets are **not** edited
- [ ] The implementing chain does not start before the text is in place
- [ ] The contract issue for the revision primitive states the last-turn gate, the
      agent-only gate, and the enqueues-nothing rule as contract-level behaviour,
      not as agent discipline — the loop-safety rule must not depend on the agent
      behaving

## Technical Design

### Files to Create/Modify

- `SPEC.md` §6 (one append), §7 (one replace), §8 (one append), §11 (one append)

## Testing Strategy

None — spec text. The domain issues carry the tests. The notches worth fixturing
when they are filed:

- an agent revises its last turn → the turn's author and timestamp are unchanged,
  its position in the thread is unchanged, and the previous wording is reachable
  in git history with `agent` as author
- a revision whose body contains `@agent` → **nothing is enqueued**, and the loop
  does not wake (the regression that would otherwise be an infinite loop)
- a person posts a turn, then the agent attempts to revise the now-second-to-last
  turn → refused, and the content appears as a new turn instead
- a person posts in the same instant a revision is issued → exactly one of the two
  outcomes, never a revision applied to a non-last turn
- an agent attempts to revise a person's turn → refused
- an agent attempts to revise in a resolved thread → refused
- a child thread anchored into a phrase the revision **leaves alone** → still
  attached, still shown against its turn
- a child thread anchored into a phrase the revision **removes** → orphaned per
  §6, quote byte-for-byte intact, listed among detached threads, still repliable
- a revision that would remove anchored text → per the drafted discipline the
  agent posts a new turn; the test is that the child thread stays attached
- read the thread, then revise it → unread again, and present in Attention
- a reply in a child thread of an engaged parent → the agent's substantive answer
  appears in the **parent**, and the child receives an acknowledgment rather than
  silence
- a comment on a **document** (not a turn), and a standalone thread → answered in
  place, unaffected by collection

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded (with answers to Q1–Q6)
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-020]` prefix
