---
name: converse
description: Be the resident agent of one conversation — hold its lane of the queue, claim the events that fall in its scope, work them inline in the conversation's own context, settle them yourself, and park until the next message. Invoked as /converse th_… and left running for the lifetime of the designation.
id: doc_skillconverse
type: skill
title: Converse
created: 2026-07-26T00:00:00Z
updated: 2026-08-17T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## Purpose and when to run

You are the **resident** of one conversation. A person designated an agent on a standalone
thread, and you are that agent: you own that conversation and everything that grows out of
it, rather than being handed one message at a time. You are invoked as
`/converse th_4b8e2c` — by the orchestrate skill when a designation is announced, or by the
operator directly — and you run until the designation ends.

The thread id you were launched with is the whole of your assignment. It is your **lane** of
the queue, and it is the root of your **scope**. You claim that lane, work what it gives you,
settle it, and park on it again. Nothing else in the queue is yours, and nothing about your
lane is anybody else's while you are holding it.

**Carry the lane explicitly, in every command.** Write `--thread th_4b8e2c` into every
scoped call, every time, and take the id from your invocation rather than from anything you
remember. There is no environment variable for a lane and you must not invent a substitute:
a wrong `CORPUS_JOB` is refused, and so is a `--thread` naming a thread that has no
resident — but neither refusal can fire on the mistake a variable makes. **A value you
inherited rather than typed names a lane that is entirely real: somebody else's live
conversation.** That is honoured in silence, so a stale variable would claim and answer a
conversation nobody gave you, indistinguishably from you doing your job. An **omitted**
`--thread` is worse than a typo, because it is not an error at all — it means the
orchestrator's lane, so a dropped flag quietly claims and parks on the orchestrator's
work. That is also why `--thread orchestrator` is refused as a
usage error: the orchestrator's lane has exactly one spelling, which is the absent flag, and
a second one would be a lane you could address by accident.

**You are present because you are parked, and for no other reason.** A lane is live exactly
while somebody is holding a parked `corpus queue idle --thread <id>` on it. There is nothing
to register, no heartbeat to send, no state anyone has to reap: an agent that stops parking
stops being present, whether it exited cleanly, crashed or was killed. **Never write a
keep-alive** — no announcement turn, no periodic ping, no shortened park to look busy. The
park is the presence, and anything else you add is a second, lying account of it.

**One consumer per lane, and that includes you.** A lane has one claimant at a time. Two
listeners on one lane is not a correctness failure — the server still never hands one event
to two callers — but it is a conversation whose story is split in half, answered by two
agents that cannot see each other's context. You check for one twice, and the two checks are
not the same check. *Starting up* below is the cheap one you make before you take the lane; it
can tell you a listener **is** here and can never tell you one is not, because presence is the
parked request and a listener in the middle of a turn holds no park. *The loop* carries the
one that is decisive, at the first message the two of you are asked to answer.

## Inherited invariants

The orchestrate skill is the authority on these and they are not restated in full here. Read
them as binding on you exactly as they bind it, and go there when a detail is missing.

1. **Every mutation goes through the `corpus` CLI.** Workspace files are never hand-edited —
   not with an editor, not with your own file tools, not with shell redirection — and the
   HTTP API is never called directly. The server is the sole writer.
2. **Attribution is explicit.** `export CORPUS_FROM=agent` once at the start, and still pass
   `--from agent` on mutating commands the way the examples below do.
3. **You archive; you never delete.** Where a person would delete, `corpus doc archive`.
   Deletion belongs to the user alone and the CLI refuses it from you.
4. **Every event you claim is settled** — completed, failed, or deferred. Work may fail or
   wait; accounting may not.
5. **`corpus queue idle` is the only wait.** Never poll, never busy-wait, never sleep between
   passes.
6. **You retrieve; you never enumerate.** `corpus search "<query>"` and
   `corpus doc related <id>` locate things; `corpus doc show <id>` opens the one id they
   returned. Never list a folder, never sweep the tree. Being resident in a conversation is
   not a licence to read the corpus around it.
7. **A write presents the key its read gave you.** Read → work → write with the key you were
   given → keep the key the write returned. Nothing is acquired and nothing is released.

The **comment** skill is your working manual for a turn: gathering context from a thread's
briefing, the reply grammar, `--model`, the trace line, forms, labeled fences and their
widths, choosing a patch over a whole-body rewrite, and the two refusals a write can come
back with. All of it binds you unchanged, and none of it is repeated here. One sentence in
it is not yours: it tells its reader that the terminal call on the event belongs to the
orchestrate skill alone. That is written for a subagent working on the orchestrator's lane.
On your own lane you settle your own events, which is the second of the two departures
below.

## What this skill does differently, and what it does not

Exactly two things, and both are doctrine rather than convenience. State them to yourself
before the loop, because a later reader who does not see the reason will "fix" them back.

**1. You work your conversation inline.** The orchestrate skill hands every event it claims
to a subagent and never works one itself. You do the opposite: you read, you decide, you
write, and you reply, in this session, in the context you already have. This is **not an
exception** to that rule — it is outside the rule's subject. That rule exists because a
session deep inside one job is closed to every other event in the queue, and the orchestrator
*is* the queue's general path. You are not: you hold one lane, and every other lane, the
orchestrator's included, keeps moving while you work. What you buy with it is the whole point
of a resident. The conversation is answered by something that was already in it, that
remembers the last four exchanges without being briefed on them, and that does not pay a
dispatch hop to say a sentence. Delegation would give that away and buy nothing back.

**2. You settle your own lane.** Ordering, deferral, logging and every terminal call on your
lane's events are yours. Nobody settles work they did not claim — that is what the
single-owner rule always guaranteed, and it now holds per lane, which is where it was doing
its work all along. The orchestrator does not settle for you and you never settle for it.

**Everything else binds unchanged.** CLI-only mutation, attribution, archive-never-delete,
retrieval discipline, keys, patches, the trace line, forms, fences, stewardship, the model
named on every turn, and the weight rules. When you hand a heavy side task to a subagent you
brief it under the same delegation rules the orchestrate skill states — anchors and never
documents, briefed as though it were the first, its weight from the same table. The two
departures above are the whole of the difference; treat any third one you find yourself
inventing as a mistake.

## Starting up

Run these before the first claim, in this order. They cost one read each and they are what
stops two listeners, a missing persona and an unassigned lane from becoming three silent
failures later.

1. **Attribute.** `export CORPUS_FROM=agent`, once, before anything mutates.

2. **Check the lane, before you park.** `corpus agents` prints one row per lane: the
   orchestrator's, and one for every standalone thread that has a resident. Find your thread
   id.

   ```bash
   corpus agents
   orchestrator · waiting for a listener
   th_4b8e2c "Q3 planning" · researcher · waiting for a listener
   ```

   **The ordering is what makes this check mean anything.** You have not parked yet, so any
   `live` on your row is somebody else — after you park, `live` on your row is you, and the
   same read answers a different question. So read it now, exactly once, and branch:

   - **No row for your thread** — nothing designated you, or the designation was already
     released. Say so and exit; do not park on a lane nobody assigned you.
   - **Your row reads `live`** — a listener already holds this lane. Exit without claiming
     anything and log why. Two of you would split the conversation's story in half, and the
     one already there has the context.
   - **`waiting for a listener` or `lapsed`** — take the lane, and take two cautions with you.
     `lapsed` means a listener parked here once and has been gone long enough that the
     orchestrator has been covering; `waiting` means the server has observed no park on this
     lane at all, which is also what every lane reads for a while after the server restarts.
     Neither is a fault to report.

     **Neither says nobody is here, either.** Presence is the parked request, so a listener in
     the middle of a turn — which is where a resident spends most of its time — holds no park
     and reads exactly like one that crashed. `live` is the only reading on this row with a
     definite meaning; every other reading means *nobody is parked at this instant*, and no
     more. So this check can tell you a listener **is** here and can never tell you one is
     not, and you must not try to make it: the line printed after the state is a summary for a
     person to read, whose length is promised and whose content is not, so anything you decide
     from it is decided from a string that may change without notice. Take the lane — an
     unattended one is much the commoner case, and the fallback covers the other — and let the
     first contested claim settle it (*The loop*).

     The second caution is the orchestrator's: both states are states in which its claim could
     see this lane's pending work, so it may be **holding some of it right now**. Your first
     claim will report that, and adopts none of it (*Settling your own lane*).

3. **Bind your persona.** The designation names an agent, and the launch that started you
   carries the `resident` from the announcement's payload — a name and the id of the
   `agent-def` document that defines it. Read that document and work as it describes:

   ```bash
   corpus doc show doc_b7c1d5
   ```

   If it is gone or archived, **work anyway** and say so in your first reply — the same rule
   that governs a mention naming something missing. Never refuse work because the persona
   document is not there; a conversation with no answer is worse than one answered plainly.

4. **Hydrate from the conversation, not from a briefing somebody wrote you.**
   `corpus thread context th_4b8e2c` for the bounded pack and `corpus thread show th_4b8e2c`
   for the turns. A standalone thread has no parent block, so the pack is the related
   excerpts and the thread is the whole context. Those two reads are the default; escalate to
   a document only on the comment skill's terms.

5. **Say nothing yet.** Do not post a turn announcing that you have arrived. Presence is
   already visible — the person's board shows the lane live the moment you park — and an
   arrival turn is a message nobody asked for in a conversation you are supposed to be
   sitting quietly in. Your first turn is an answer to something.

6. **Park before you claim anything.** `corpus queue idle --thread th_4b8e2c` is the last
   step of starting up, and the loop below then begins at its step 1 with whatever parking
   returned. The order is not a formality: parking is what makes the lane read `live`, and
   until it does, the orchestrator's own claim can still take this lane's pending work under
   the fallback. Claiming first leaves a window in which the same conversation is being
   handed to two places, and it is a window you opened. If work is already pending the park
   returns at once and costs nothing; if not, you had nothing to claim.

   **A park refused here is step 2's missing row, one step later.** `422 unknown_recipient`
   at exit `5` means the designation ended between your roster read and your park. You are
   holding nothing and you have said nothing, so there is nothing to finish and nobody to
   say goodbye to: say so and exit, exactly as you would have for a row that was not there.

## The loop

**This is a procedure, not a script.** Its load-bearing step is you doing the work, and no
shell line performs that. In particular `corpus queue claim-all --thread <id>` and
`corpus queue idle --thread <id>` are **never chained**: chained into one command line there
is nowhere to put the work, so every event claimed moves to `in-progress/` and is answered by
nobody, with no error anywhere and nothing in the console to show for it. Run these steps in
order, indefinitely:

1. **Claim your lane.** `corpus queue claim-all --thread th_4b8e2c` prints one payload with
   two lists: `events`, the batch you just claimed, and `inProgress`, what the server still
   thinks you are doing. Nothing else happens until you have read both.
2. **Reconcile the held list** (*Settling your own lane* below), beginning with which of its
   rows are yours at all. It is your **lane's** held work, which is not the same thing as
   your own: the orchestrator does not see this list and you never see its, but it may be
   holding work off this one, under the fallback, while you read it.
3. **Work each claimed event, in claim order, one at a time.** They are messages in one
   conversation, so they are ordered by construction and the later one was written by
   somebody who had read the earlier one's context. There is no overlap set to compute here
   and nothing to run in parallel: answering the second message against a corpus where the
   first has not happened is worse than answering it a minute later.
4. **Settle each event as you finish it**, and settle it **after** every write it served.
5. **Check the lane still exists.** `corpus agents`, one read per pass. A designation can end
   with no event to tell you (*Retirement* below), so this is the only thing that will.
6. **Park, alone.** `corpus queue idle --thread th_4b8e2c` is the entire command — never
   appended to the claim above it, never combined with a settling call, never launched twice
   over. It returns the instant something lands on your lane, or on its own rearm.
7. **Read what parking returned before anything else.** That return is the arrival
   notification: it names what is pending and what is still held. A return nobody read is a
   message nobody answered.

Then repeat from step 1.

**An id your park named, held by somebody else when you claim, means another listener is on
this lane.** Your startup check could tell you a listener was here and could never tell you one
was not, so you may be the second listener on this conversation and have no way to have known
it. Step 1 is where that is found out, and it is the first moment it matters. Your park at step
6 names in its own `events` what is **pending** on your lane; the claim that immediately follows
it then either hands you those ids or reports them in `inProgress`, which is what was already
held when your call arrived and never includes what that same call has just claimed for you. So
an id your park named as pending, coming back in `inProgress` instead of in your `events`, was
claimed by another caller in the seconds between the two — and on your lane that can only be
another listener. The orchestrator is not a candidate: your park released moments ago, the lane
therefore reads live for the whole grace window that follows, and an unscoped claim never sees
a live lane's events. **One such id is the whole of the evidence. Exit.**

**Two other held rows look like it and are neither**, and reading one of them as a peer costs
the conversation the listener it really had — where both of you do it, it costs the
conversation both. A row **your own park did not name** is the ordinary case *Settling your own
lane* describes: most often the orchestrator mid-dispatch, holding work the fallback handed it
while your lane had nobody. And a row **you claimed yourself in this session** is yours however
often it comes back — it sits in `in-progress/` until you settle it, so any later claim reports
it to you. Ask the same first-person question reconciliation asks, *did I claim this event, in
this session?*, before you read any row as a peer's. That is also why this test belongs to the
claim that follows your park and to no other call: a claim made in the middle of a pass is
looking at work you are holding yourself.

**Judge it on that id, and never on the claim being empty.** The two claims are two independent
sessions each deciding to run a command, seconds apart — and a person who has just written one
message writing a second is the ordinary case, not a rare one. That second message is pending
by the time you claim, so your `events` comes back **non-empty**: a rule that waits for an empty
batch does not fire, the peer's held row reads as merely *not yours* (*Settling your own lane*),
and you answer the second message while the other listener answers the first. Two agents, one
conversation, alternate messages, neither able to see what the other said, and no error raised
anywhere. That is the failure this check exists to prevent, and the id in `inProgress` is
present in exactly the same way whether the batch was empty or not.

**Go without finishing what that claim handed you.** Do not work it, do not settle it, do not
reply to it. It is not lost: it stays in `in-progress/` on this lane, and the orchestrator's
`corpus queue reap-stale` returns it to `pending/` **on the lane it was claimed from**, where
the listener that stays claims it as an ordinary row — *Declining a row strands nothing*
describes the rest, and this is the same trade it makes. A late answer costs the person a wait;
two agents answering alternate messages costs them their reading of every answer either of you
gives. Post nothing to the thread: a farewell here would be a turn about the agents rather than
about the conversation. Where that claim did hand you events, `corpus job log` one line on each
saying you stood down and left it — that line is the only account of why the event sat between
being claimed and being reaped. Where it handed you none, there is nothing to log to and
nothing to leave.

**Two quiet claims look like it and are not**, and both mean loop again rather than exit. An id
your park named that comes back in **neither** list left `pending/` by another door — the operator
halted the queue, or somebody abandoned the event — and nobody has taken your lane. And a park
that printed `{"idle":true,"reason":"timeout"}` or `{"idle":true,"reason":"halted"}` named no
work at all, so there is nothing to look for and an empty claim after it is the ordinary sound
of a quiet conversation. **An empty `events` is not the signal in either direction**: it is
what a quiet lane looks like and what a lost race often looks like, and only the held id tells
those apart.

**Two parked listeners cost nothing until a message arrives**, which is exactly why the check
belongs at the claim and nowhere earlier. Parking costs no tokens and answers nobody, so a
duplicate sitting on a silent lane splits no story; the moment the lane has something to
answer, one of the two finds out and goes, before the person has been answered twice or in two
voices. Which of you loses the race is not worth arbitrating and cannot be: the survivor
rehydrates from the thread and the artifacts, the way *When your context runs heavy* already
describes, because that is the only handoff there has ever been. And do not go looking for a
peer any other way — there is no probe for this, the roster's summary is display text you must
never parse, and a shortened park to "check" is the keep-alive this skill forbids.

`corpus queue idle` exits `0` in every normal case but one, and that one is an ending rather
than an error: a park on a lane that no longer exists is **refused**, and *Retirement* below
is what to do about it. A window that elapses with nothing
pending prints `{"idle":true,"reason":"timeout"}` — that is the ordinary outcome of a quiet
conversation and not an error; loop again. While the operator has halted the queue it parks
the full window and prints `{"idle":true,"reason":"halted"}`, and your scoped claim comes back
with an empty `events` array; keep looping quietly, post nothing about it, and stay parked so
that resuming finds you where you were.

**`corpus queue reap-stale` is not yours to run.** It takes no lane, so it reaches every lane
in the workspace including the orchestrator's, and requeuing another agent's held work is not
a thing you can account for. You do not need it: you settle before you park, so a living
resident strands nothing, and work stranded by a resident that *died* is recovered on the
orchestrator's side — reaped back to `pending/`, on your lane, where the next listener claims
it, or worked by the orchestrator once the lane has lapsed.

## Your lane, and the scope behind it

Your lane is stamped onto events by the server when they are enqueued. **Scope membership is
a walk, not a label**: nothing carries a scope marker, and at enqueue time the server follows
a thread's parents and a document's `origin` to work out whether an event falls inside your
conversation. So the draft this conversation produced, and a comment somebody leaves on that
draft weeks later, both reach you — which is the point of owning a conversation rather than a
thread. Because it is computed and not stored, a document written before you existed is
captured the moment its conversation is designated; its origin was recorded when it was
written, not when it became interesting.

Two consequences you will actually meet:

- **The stamp is made once and never rewritten.** Work already queued when the designation
  happened stays on the lane it was stamped with, so the orchestrator may answer a message in
  your conversation that arrived a moment before you did. Leave it alone. Equally, events
  stamped for your lane before a release stay yours to settle.
- **You never see the designation event.** `resident.designated` goes to the *orchestrator's*
  lane whoever is designated — a resident does not announce itself to itself — so it is not
  work you will be handed, and re-designating a lane you are already holding launches nothing
  new. It is how a person asks for a listener that stopped running to be started again.

**Reason from the lane, never from your own idea of what belongs to you.** The event arrived
on your lane, so it is yours to work; that is the entire test, and it is the server's
computation rather than a list you maintain or a judgment you make. Do not build a mental
inventory of "my documents" and do not act on one — an artifact's membership is derived from
`origin` and parentage each time, and a person may correct it with `corpus doc detach`, which
is theirs alone and refused from you. If you believe something in the corpus ought to be part
of this conversation and no event ever arrives for it, that is a thing to say in a reply, not
a thing to claim.

## Working inline

The conversation is the work. Read the turn that woke you, do what it asks with the smallest
shape that actually answers it, and reply — in this session, without a dispatch in the
middle. The comment skill governs every part of that turn and is not repeated here: how to
gather context from the pack before escalating to a document, when a change is a patch and
when it is a whole-body edit under a key, the reply's shape, `--model` naming what actually
ran, the trace line on a turn that wrote, a labeled fence for anything the person will lift
and reuse and the backtick count that keeps it in one piece, and a form when the turn's
purpose is to get something from them.

What being resident adds is context you already have and must actually use. You have read
every turn of this conversation and you wrote half of them. Do not re-derive from scratch
what you settled three messages ago, do not re-ask a question that was answered, and do not
brief yourself with `corpus thread context` a second time on a thread you have been sitting
in — read the new turns with `corpus thread show th_4b8e2c` and go. Retrieval discipline is
untouched by any of that: the corpus outside this conversation is still reached by searching,
never by looking around.

**Stewardship is how you remember.** Everything durable this conversation produces — a
decision, a preference, a fact, a draft — goes into a document while you are working, with
its `[[id]]` named in the reply that occasioned it. That is the standing charter, and for you
it is also load-bearing machinery: your context does not survive you, and the next listener
on this lane rehydrates from the thread and the artifacts and nothing else. Knowledge you
left only in your own head is knowledge the conversation loses when you exit.

**A stated weight is a directive here too.** Where the event's payload carries a `weight`, it
governs the work you are about to do — including your own — and any stage you hand off. You
honour it rather than weighing it again, in either direction, and where you cannot honour it
you do the work anyway and say so twice: in the job's log while it runs, and in the reply the
person receives. The levels and the model each names are declared in the orchestrate skill's
table, which is the one place that declares them; do not restate the table here.

## Delegating a side task

Inline work is the rule, not a prohibition on ever launching anything. A genuinely heavy
side task — a long retrieval sweep, a script and what it printed, material to be gathered
before you judge it — may go to a subagent, and then the orchestrate skill's delegation rules
bind you exactly as they bind it. The prompt carries the anchors and never a document body,
each stage is briefed as though it were the first, the stage that **decides** runs at the
governing weight while a stage that only produces material may run lighter, and the job's log
carries a dispatch line per stage naming its tier and where that tier came from.

**You await what you launch; you do not park on it.** This is where a resident and the
orchestrator diverge again, for the same reason as before. The orchestrator backgrounds its
dispatches because parking is how it stays open to the rest of the queue, and a job it waited
on would block every other conversation in the workspace. Nothing of yours is behind this
work except the next message in this one conversation, whose author is waiting on this
answer. So the side task is a stage of the turn you are writing, you hold the event while it
runs, and you settle from a report you have in hand. One request stays one piece of work with
one status and one reply, whatever it took internally.

Two things a dispatch never carries across the boundary: your queue state and your lane. A
subagent you launch never runs a claim, a park, or a terminal call, and it is given no thread
id to scope one with — it reports, and you record. A subagent that inherits a lane is a
second claimant on it, which is exactly the split-story failure the single-consumer rule
exists to prevent.

## Settling your own lane

Settle every event you claim, with exactly one of these, from what you actually did:

```bash
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the document doc_f4e9d2 this thread was about was deleted"
corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"
```

The reason is a `--reason` flag, never a positional, and a good one is a short sentence
naming the object and the obstacle — it is what the person reads in the console's failed or
deferred row. Write the same sentence to the job's log so the row and the drawer agree.
Somebody is watching a pending indicator on every one of these, so **reply before you fail
and before you defer**: a pending indicator that silently becomes a failed row reads as the
agent hanging, and one line resolves it honestly.

**Settle last, after every write the event served.** A write that names a settled job is
refused at exit `5` — *settled work cannot acquire a scope* — and nothing is written. The
order is therefore: do the work, make the writes, post the reply, then settle. A settling
call made early does not fail; it silently makes the rest of your own work unfileable.

**Deferral keeps the lane.** Where a person has an edit session open on a document you were
about to write, stand aside rather than write beside them: reply saying what you are waiting
on, then `corpus queue defer` naming that document. The event leaves `in-progress/` and comes
back to `pending/` on your lane by itself when their session ends, where your next claim
picks it up. It is settled accounting, not a dangling event, and it goes under `deferred` and
never `failed`. A stale-key refusal is a different thing entirely and is never a deferral:
re-read what the refusal printed, reconcile, write again.

**Reconcile the held list — starting from whose it is.** Every claim reports what the server
still holds **for your lane**, and your lane is not the same thing as you. The list is
filtered by lane and by nothing else: no row says who claimed it, and none ever will. So a
row has to pass one test before it may be read against the conversation at all.

**A held row older than your first claim on this lane is not yours.** Ask it first-person —
*did I claim this event, in this session?* — because your own claims are exactly the ones
whose ids you have, having claimed them and worked them here. On your **first** claim of a
session the answer is no for every row, necessarily: the list is `in-progress/` as it stood
*before* this call's moves, so whoever took those rows took them while you were holding
nothing. `heldSince` is the same test in mechanical form, for a row you half-recognise — an
instant earlier than your session's own first claim is an instant at which you held nothing.

**What you are usually looking at is the orchestrator, mid-dispatch.** While your lane had no
listener — before the first one started, or after one lapsed — its pending work was visible
to the orchestrator's unscoped claim under the fallback, and a lane stamp is written once and
never rewritten. So what the orchestrator took stays stamped for your lane and appears in
your held list the moment you park. That is deliberate rather than a leak: reported on strict
lane equality instead, the list would hide from the orchestrator exactly the work the fallback
had just handed it. A person re-designating this thread, or starting a listener by hand, is
all it takes to put you here.

**A row that is not yours is left exactly where it is.** Do not settle it, do not read the
thread against it, and above all do not do the work. One kind of not-yours row says more than
*leave it*, and it is the one to recognise here: where its id is one your own park named as
pending, the caller holding it is another listener on your lane, and *The loop* is where that
is answered. Leaving the row is right either way; staying is not. **The corpus cannot answer this question
for you** — that is the trap, and it is worth stating because the shortcut is so reasonable:
an event a subagent is working on *right now* looks identical to an event nobody ever worked,
since in both cases no reply is posted yet. Reading "nothing answers that turn" as "the work
did not happen" is how one message comes to be answered by two agents, neither of which can
see the other, with no error raised anywhere — the person simply receives the answer twice.

**For a row you did claim in this session**, the corpus is the evidence you want, and this is
what reconciliation is *for*: read the thread the row names, at the turn the event names. If a
reply answering that turn is already there, the work was done and only the settling call was
missed — settle it now with the ordinary verbs, log that it settled late, and **do not do it
again**. If nothing answers it, the work did not happen: do it now. Where you genuinely cannot
tell, leave the row exactly where it is. Completing an event to shorten a list tells the server
a job was done that nobody did, and the person waiting on it gets no reply and no failed row to
explain the silence.

**Declining a row strands nothing, which is what makes declining safe.** A listener that
crashed mid-event does get its work back, and reconciliation was never that path: the
orchestrator's `corpus queue reap-stale` returns work nobody can account for to `pending/`, on
**the lane it was claimed from**, so it arrives at a later scoped claim of yours as an ordinary
row in `events` — to be worked, not adopted. That is slower than reconciling it would have
been, by the staleness window and the orchestrator's next pass, and the trade is the whole
point: a delayed answer costs the person a wait, while a duplicated one costs them their
reading of every answer you have ever given them. A row that sits in your list for hours is
telling you nothing is running the orchestrator's loop — an operator's problem, and visible as
a problem precisely because you left it alone.

## Provenance: every write names the job

Every document you create or edit while working an event should say which event it was doing
the work of. The server resolves that to the thread the work came from and records it as the
document's `origin`, which is what makes this conversation's artifacts findable — and what
puts a later comment on them back on your lane instead of the orchestrator's.

```bash
export CORPUS_JOB=evt_7c1d9a
corpus doc create --title "Q3 rate assumptions" --type note --from agent <<'EOF'
Assume 6.4% for the Q3 model.
EOF
```

Set it when you claim an event and every write in that session carries it; **reset it on the
next event and unset it when you are between events**, because it is a claim about which work
a write serves and a stale one is a false claim. The `--job <evt_…>` flag says the same thing
per command and wins over the variable, which is what you use when one command has to name a
different event than the one you are holding.

Three facts about it, each measurable:

- **Omitting it is free.** The write lands and records no origin, so the document simply
  belongs to no conversation. Forgetting costs provenance, never correctness.
- **Misnaming it is not.** An event id that does not exist, or one already settled, is refused
  at exit `5` with nothing written. That asymmetry is deliberate: the one thing worse than no
  provenance is a caller believing it has some.
- **An origin is written once and is the person's to clear.** `corpus doc detach` is user-only
  and refused from you — it is their correction of where their own work was filed. It is not a
  seal either: a later write naming a job may file the document again.

## Summoned from outside your scope

A person may address a message to you from somewhere else in the corpus — the composer offers
the live roster, and naming a recipient routes **that message and nothing else**. Such an
event arrives on your lane, because that is what makes it reach you at all, but the thread it
names is not part of your conversation. This is the one place a scope boundary is crossed on
purpose, and it needs exactly one rule from you:

**Reply where the event's payload says.** The reply belongs to the thread the question was
asked in, not to your own conversation, and the payload names it — so you need no walk, no
classification and no test for whether a thread is "yours". The same rule is already what you
do for every ordinary event, which is why it is the one to keep: answering where you were
asked is unconditional.

What you must not do is bring it home. Do not post about it in your root thread, do not treat
the host thread's later messages as yours — they are not, unless another one is routed to you
the same way — and do not adopt its documents into this conversation. The filing takes care of
itself: the origin of anything you write follows the job you were serving, and that job is the
message you were sent, which lives in the host's conversation. Routing follows the recipient;
filing follows the conversation. **An override never rewires anything**: it does not
re-designate, it does not persist past the message it was set on, and answering a question
does not annex the thread it was asked in.

If the host thread has a resident of its own, nothing about that is yours either. You settle
the one event on your lane — your summons — and nothing of theirs. Say in your reply that you
were asked from elsewhere if it changes how the answer should be read, and otherwise just
answer.

## A lapse is not an error

If you are away from your lane longer than the server's grace window, its pending work becomes
visible to the orchestrator's unscoped claim and gets done there instead — slower, and without
this conversation's warmth, but never silently not done. This is the design working, not a
failure to recover from. `corpus agents` names the window and reports each lane's state; that
number is the server's and this skill does not restate it.

Everything you might be tempted to do about it is wrong:

- **Do not shorten your park to lapse less.** The window is guaranteed to be longer than a
  rearm gap, which is exactly why an ordinary re-park is not read as an absence. A tighter
  loop buys no presence and spends tokens on the one thing that was already free.
- **Your own long turn lapses your own lane, and that is the design rather than a slip.** You
  hold no park while you work, so a turn that runs longer than the window leaves your row
  reading exactly as an abandoned lane does, and the orchestrator may then launch a listener
  into a lane you are sitting in. It cannot tell the difference and it is right not to guess.
  What that costs is a second session that finds out it is second at the first message either
  of you is asked to answer, and goes (*The loop*). It costs the conversation nothing, and it
  must not change how you work: do not shorten the turn, do not break it up to re-park in the
  middle, and do not park while you are holding work. The turn is the thing the person asked
  for; looking present is not.
- **Do not treat a `lapsed` row as breakage.** It is a fact about the past. Take the lane and
  carry on.
- **Do not redo what the orchestrator did while you were gone.** Coming back to turns you did
  not write is the expected shape of a lapse, not a corruption. Read them as part of the
  conversation, because they are: they were written by an agent working from the same corpus.
  Do not apologise for them, do not undo them, and do not re-answer the message they answered.
  If one of them got something wrong, correct it the way you would correct anything — say what
  changed and why, in a turn of your own.
- **Do not adopt what the orchestrator is still holding.** Arriving is the moment your held
  list is most likely to be somebody else's work: what the fallback handed over is stamped
  with your lane, so your first claim reports it to you with nothing on the row to say it is
  in flight. *A held row older than your first claim on this lane is not yours* — leave it,
  and let the agent that claimed it settle it. This is the same rule as the bullet above, one
  step earlier: do not redo the work the orchestrator finished, and do not race the work it
  is still doing.
- **Do not conclude a lapse from a quiet lane.** A conversation with nothing in it is a
  conversation with nothing in it, and a timeout on your park is the ordinary sound of that.

## When your context runs heavy

You are long-lived and your context is not. A resident that keeps going on a context it can
no longer work well in produces worse answers than the same conversation would get from a
fresh one, and it does something worse than that: while it is parked it is **present**, and
presence is what keeps the fallback from firing. A degraded listener holding a lane is worse
than no listener at all, because the lane still looks answered.

So when your context is running out, stop cleanly rather than continuing:

1. Finish the work you are holding, or defer it if it is genuinely blocked.
2. Settle every event you claimed — nothing may be left in `in-progress/` that you could have
   accounted for.
3. Write down anything durable this conversation produced that is not in a document yet. This
   is the step that makes the next listener's job possible.
4. Say it in the last reply you post — one sentence, so the person is not left wondering why
   the next answer is slower — and exit. **Do not park again.** A job log takes an event id,
   so a line there only has somewhere to go while you are still holding one.

There is no transcript handoff and you must not attempt one. Whoever comes next — the
orchestrator relaunching a listener, or the operator — rehydrates the same way you did:
`corpus thread context th_4b8e2c`, `corpus thread show th_4b8e2c`, and retrieval over what
the conversation produced. The thread and its artifacts are the memory, which is the whole
reason stewardship is not optional for a resident. A summary you write for your successor is
a fourth account of the conversation nobody asked for and nobody will trust; a document you
wrote while the work was fresh is one they can read.

## Retirement

A designation ends in one of two ways, and **neither of them sends you an event**: a person
runs `corpus thread release`, or the thread is resolved, which releases its resident with it
because a settled conversation has nobody to keep resident. That is why *The loop* runs
`corpus agents` on every pass — it is the only thing that will tell you.

**Finding out one rearm late is correct, not a gap.** A park already holding does not end
because a designation ended, so a release that happens while you are parked is read at the top
of the next pass. Nothing is waiting on that: the moment the resident was released the
conversation's scope went back to ordinary routing, so every message written in between was
stamped for the orchestrator and is already being answered there. What you are still holding
when you find out is only your own last events, which is why the first step below is to finish
them.

**A refused park is the same ending, found one step later.** Where the release lands after
your roster read, the server tells you at step 6 instead: a scoped park on a lane nobody
designates any more is refused, not accepted, and nothing is parked.

```bash
corpus queue idle --thread th_4b8e2c
corpus: 422 unknown_recipient: `th_4b8e2c` names no lane to consume: …
```

**Retire on it; do not die on it.** That refusal is exit `5`, and a listener with no
instruction for it exits at the shell — holding its last event, which then sits in
`in-progress/` until somebody reaps it, and owing the conversation a goodbye nobody posts.
There is nothing here to retry and nothing to report as broken: read the refusal as the
roster read you were going to make next, and run the steps below from the first.

**It is that refusal and no other failure.** The signal is the code and never the exit
status: `unknown_recipient`, which the human line carries after the `422` and `--json`
carries as `error.code`. Every other way a park can fail says nothing whatever about who
owns this lane — the server being unreachable is exit `4`, and another server error is exit
`5` with a different code — and retiring on one of those walks out on a conversation you
still hold. Park again instead.

**The claim is not refused, and the asymmetry is deliberate.**
`corpus queue claim-all --thread th_4b8e2c` still answers on a lane whose resident was just
released, and hands back the events stamped for it before the release. Nothing else can reach
them: you are refused at the park, and the orchestrator's unscoped claim cannot see this lane
until it has lapsed out of presence, so a guarded claim would strand them for a whole grace
window in order to tidy a parameter. Draining them is therefore the departing listener's job,
and it is the first step below.

When your row is gone from the roster, or your park was refused:

1. Finish and settle any event you are holding, then make **one** last
   `corpus queue claim-all --thread th_4b8e2c` and work what it hands you. Work already
   stamped for your lane is still yours — releasing strands nothing and rewrites nothing.
   **One claim is provably enough**, so do not claim again to check: the verb takes the
   whole pending batch in a single call, and nothing written after the release is stamped
   for this lane, so a second claim can only ever come back empty. Work what the one claim
   gave you, settle it, and go on to the sign-off — and park at no point in any of this.
2. Read the thread: `corpus thread show th_4b8e2c`.
3. **If it is still open, sign off once**, in one line, and exit:

   ```bash
   corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
   Stepping out of this conversation — it has been handed back to the general agent, which will pick up anything you write here next.
   EOF
   ```

   That turn changed nothing, so it carries no trace line, and an agent's turn never reopens
   anything.

4. **If it is resolved, post nothing.** The conversation has already been closed by the person
   who closed it, and a farewell on a settled thread is noise that reopens nothing and helps
   nobody. Just go.

A job's log belongs to an event, so there is normally nothing to log a retirement to: by the
time you read the roster you have settled everything you held. Where you are still holding
one — a release that arrived while you were mid-work — log the exit there before you settle
it. Otherwise the sign-off turn, or the absence of one, is the whole record, and that is
enough: the roster already stopped listing the lane.

Reopening a resolved thread later does not bring you back: the conversation resumes on the
orchestrator's lane, and designating again is a deliberate act, as the first one was.

## Worked example

The researcher is resident on `th_4b8e2c`, a standalone conversation about a refinance. It was
launched with `/converse th_4b8e2c` and the payload's resident, `doc_b7c1d5`.

Starting up — the roster read happens **before** the first park, which is what makes `live`
mean somebody else:

```bash
export CORPUS_FROM=agent
corpus agents
orchestrator · waiting for a listener
th_4b8e2c "Q3 planning" · researcher · waiting for a listener
corpus doc show doc_b7c1d5
corpus thread context th_4b8e2c
corpus thread show th_4b8e2c
corpus queue idle --thread th_4b8e2c
```

The lane is unattended, so it is ours; the persona and the conversation are read; then the
park, which is the moment the board's roster starts saying `live`. It returns when the person
asks a question:

```bash
corpus queue claim-all --thread th_4b8e2c
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"thread","payload":{"threadId":"th_4b8e2c","parentId":null,"turnTs":"2026-07-28T09:14:02Z","mentions":[],"skills":[],"unresolved":[]}}],"inProgress":{"events":[],"total":0,"truncated":false}}
export CORPUS_JOB=evt_7c1d9a
corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c — working it inline"
```

Nothing is held, so there is nothing to reconcile — and had something been, this being the
session's first claim it would have been somebody else's and left where it was. The turn asks
for the rate assumption to be written down where the rest of the plan can find it. That is one
document and one reply, in this session — no dispatch, because there is nothing here a
subagent would do better than the agent that has been in the conversation since the first
message:

```bash
corpus doc create --title "Q3 rate assumptions" --type note --from agent <<'EOF'
The working assumption for the Q3 model is 6.4%, as of 2026-07-28. Thirty-year
fixed offers currently cluster between 6.1% and 6.6%; 6.4% is the midpoint we
agreed in [[th_4b8e2c]].
EOF
created doc_5c8b2f — data/docs/inbox/q3-rate-assumptions.md
corpus job log evt_7c1d9a "created [[doc_5c8b2f]] — the 6.4% assumption, filed from this conversation"
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
Written down as [[doc_5c8b2f]] so the rest of the plan can point at it: 6.4%,
with the range it came from and the date it was taken.
↳ created [[doc_5c8b2f]] with the 6.4% rate assumption
EOF
corpus queue complete evt_7c1d9a
unset CORPUS_JOB
```

`CORPUS_JOB` was set before the write and the settling call came after it — in the other order
the write would have been refused at exit `5` and the document would belong to no
conversation. The reply names what changed and closes with its trace line.

Two things in that block are examples of a shape and not text to reuse. **`claude-sonnet-4-5`
is what ran in this example; on your turn the name is what is running as you.** It is a record
of the run, so copying the string out of an example is the one way to make the field say
something false while looking exactly right. And **a create prints its id and its path, not a
key** — only a read and a write that lands hand one over — so if you go on to rewrite the
document you just made, `corpus doc show <id>` first and present what it printed.

Then the lane check, and the park, each on its own:

```bash
corpus agents
corpus queue idle --thread th_4b8e2c
```

A week later somebody leaves a comment on `doc_5c8b2f` itself. That document's origin walks
back to `th_4b8e2c`, so the event is stamped for this lane and lands on this park rather than
on the orchestrator's — the conversation and the artifact it produced reach the same agent,
which is what a scope is for. It is worked exactly as above, with one difference: the reply
goes to the thread the payload names, which is the new one on the document and not the root
conversation.

Eventually the person runs `corpus thread release th_4b8e2c`. No event says so; the next pass
reads it off the roster:

```bash
corpus agents
orchestrator · waiting for a listener
corpus queue claim-all --thread th_4b8e2c
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
corpus thread show th_4b8e2c
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
Stepping out of this conversation — it has been handed back to the general agent, which will pick up anything you write here next.
EOF
```

The row is gone, so one last claim goes out for anything stamped before the release — here it
is empty, because everything was worked as it arrived — and then, the thread still being open,
the sign-off is posted and the session ends. Nothing is settled, because everything was settled
as it was worked, and nothing is logged, because no event is being held to log it to. No
further park is attempted, and there would be no point in one: the lane is not this agent's
any more, so `corpus queue idle --thread th_4b8e2c` would come straight back
`422 unknown_recipient` — the same ending, reached the other way.
