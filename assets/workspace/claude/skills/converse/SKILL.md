---
name: converse
description: Be the resident agent of one conversation — hold its lane of the queue, claim the events that fall in its scope, work them inline in the conversation's own context, settle them yourself, and park until the next message. Invoked as /converse th_… and left running for the lifetime of the designation.
id: doc_skillconverse
type: skill
title: Converse
created: 2026-07-26T00:00:00Z
updated: 2026-08-16T00:00:00Z
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
a wrong `CORPUS_JOB` is refused, but a wrong lane is honoured in silence, so a variable
carrying one would let a stale value claim somebody else's conversation indistinguishably
from you doing your job. An **omitted** `--thread` is worse than a typo, because it is not
an error at all — it means the orchestrator's lane, so a dropped flag quietly claims and
parks on the orchestrator's work. That is also why `--thread orchestrator` is refused as a
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
agents that cannot see each other's context. *Starting up* below is where you check, once,
before you take the lane.

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
   - **`waiting for a listener` or `lapsed`** — the lane is yours. `lapsed` means a previous
     listener has been gone long enough that the orchestrator has been covering; that is
     ordinary and is not a fault to report. Carry on.

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
2. **Reconcile the held list** (*Settling your own lane* below). It is your lane's held work
   and nobody else's — the orchestrator does not see it and you do not see the orchestrator's.
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

`corpus queue idle` exits `0` in every normal case. A window that elapses with nothing
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

**Reconcile the held list against the conversation.** Every claim reports what the server
still holds for your lane, with `heldSince` as an instant you age against your own clock.
Unlike the orchestrator, you can usually account for a row from the corpus itself rather than
from a memory you no longer have: read the thread the row names, at the turn the event names.
If a reply answering that turn is already there, the work was done and only the settling call
was missed — settle it now with the ordinary verbs, log that it settled late, and **do not do
it again**. If nothing answers it, the work did not happen: do it now. Where you genuinely
cannot tell, leave the row exactly where it is. Completing an event to shorten a list tells
the server a job was done that nobody did, and the person waiting on it gets no reply and no
failed row to explain the silence.

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
- **Do not treat a `lapsed` row as breakage.** It is a fact about the past. Take the lane and
  carry on.
- **Do not redo what the orchestrator did while you were gone.** Coming back to turns you did
  not write is the expected shape of a lapse, not a corruption. Read them as part of the
  conversation, because they are: they were written by an agent working from the same corpus.
  Do not apologise for them, do not undo them, and do not re-answer the message they answered.
  If one of them got something wrong, correct it the way you would correct anything — say what
  changed and why, in a turn of your own.
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

**Never re-park on a dissolved lane.** A scoped park on a lane nobody has designated is
accepted and parks; it does not error, because a lane may be designated a moment later and
the server does not second-guess the caller. So a listener that skips the check waits forever
on a conversation that no longer has it, invisible to everyone, while the orchestrator answers
the messages it thinks it is holding.

When your row is gone from the roster:

1. Finish and settle any event you are holding. Work already stamped for your lane is still
   yours — releasing strands nothing and rewrites nothing.
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

Nothing is held, so there is nothing to reconcile. The turn asks for the rate assumption to
be written down where the rest of the plan can find it. That is one document and one reply,
in this session — no dispatch, because there is nothing here a subagent would do better than
the agent that has been in the conversation since the first message:

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
corpus thread show th_4b8e2c
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
Stepping out of this conversation — it has been handed back to the general agent, which will pick up anything you write here next.
EOF
```

The row is gone, the thread is still open, so the sign-off is posted and the session ends.
Nothing is settled, because everything was settled as it was worked, and nothing is logged,
because no event is being held to log it to. No further park is attempted: the lane is not
this agent's any more, and parking on it would be waiting forever for a conversation somebody
else is now answering.
