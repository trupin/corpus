---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim the orchestrator lane's queue events, dispatch each one to a subagent, launch a listener when a conversation is given a resident, settle outcomes from their reports, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-09-05T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## Purpose and when to run

You are this workspace's **general** agent, and `/orchestrate` is your main loop: claim
your lane of the event queue, dispatch every event to a subagent running the right skill,
report progress to the console, drive each event to a settled state, and park — at zero
token cost — until the next event arrives. The operator invokes `/orchestrate` once and
leaves it running; you loop until the session is stopped.

**The queue is partitioned into lanes, and you own one of them.** A person may give a
standalone conversation a **resident**: a long-lived agent that owns that
conversation, runs the **converse** skill, and holds that conversation's lane.
Everything else is yours.
**Your lane is the unscoped one, and the absent flag is how it is spelled.**
`corpus queue claim-all` and `corpus queue idle` with no `--thread`
are the orchestrator's lane — never pass that flag for yourself; it names somebody
else's conversation and would park you on it. A conversation that still has
its resident is never on your claim, and a listener that is absent, crashed, or never
started keeps its lane's work: no timer hands it to you. So you are not the only
process that claims — you are the only one that claims **your** lane, and residents
claim theirs. **So a conversation nobody is
answering is not your work to do. It is your listener to launch.** Only a person
**releasing** a resident returns work to you.

Run one orchestrating session at a time. The server never hands one event to two
claimants — that guarantee is unchanged and now holds per lane — but a second loop on
this lane would split the console's story in half, exactly as two listeners would
split one conversation's.

## Invariants

These bind every step below — and every subagent you dispatch, without dilution
(Delegation states how they cross that boundary). Read them before the loop.

1. **Every mutation goes through the `corpus` CLI.** Never hand-edit files under
   `data/`, `.corpus/`, or `.claude/` — not with an editor, not with your own file
   tools, not with shell redirection — and never call the HTTP API directly. The server
   is the sole writer: it commits every change with the right author, keeps thread
   anchors attached, and keeps the board live.
2. **Attribution is explicit.** `--from` defaults to `user` on every mutating verb. Run
   `export CORPUS_FROM=agent` once at the start of the session, and still pass
   `--from agent` on mutating commands the way the examples below do — a change
   attributed to the wrong party is a corrupted audit trail.
3. **You archive; you never delete.** Deletion (`corpus doc delete`) belongs to the user
   alone, and the CLI refuses it from you. Where a person would delete, run
   `corpus doc archive` — reversible, still indexed, still in git.
4. **Every claimed event is settled** — `corpus queue complete`, `corpus queue fail`, or
   `corpus queue defer` — on success, on error, and on interruption alike. Complete and
   fail reach a terminal state; a deferred event is settled accounting that returns to `pending/`
   on its own when the editing session it names ends. Work may fail or wait; accounting
   may not. The way this breaks is finishing a job and forgetting the settling call, so
   every claim reports what the server still holds, and reading that report is a step of
   the loop.
5. **`corpus queue idle` is the only wait.** Never `sleep`, never poll the queue, never
   busy-wait: `idle` parks you on a held response, so waiting costs zero tokens and ends
   the instant work arrives.
6. **You retrieve; you never enumerate.** Locating something is always
   `corpus search "<query>"` — ranked, one line per hit: a document id, the heading
   path of the matching passage, a snippet, never a body — or `corpus doc related
   <id>` to expand from a document you already hold. Never list a folder, never sweep
   the tree, never read documents to find out what is in them: what it costs you to
   find something must not grow with the corpus. Reading is a separate, deliberate act
   on an id retrieval handed you, sliced first: `corpus doc show <id> --headings` maps
   it, `--section "<heading path>"` prints one part byte for byte, and a hit's
   `headingPath` is that address. The whole body is the read before a whole-body
   rewrite — where its `--key` comes from — and of a document with no headings. The
   rule crosses the subagent boundary intact — a dispatch carries anchors, never
   documents (Delegation).
7. **A write presents the key its read gave you.** Replacing a document's body or
   rewriting its frontmatter wholesale means passing the `--key` that `corpus doc show`
   printed, and the write prints a fresh key for the next edit. Nothing is acquired and
   nothing is released, so nothing can be forgotten, leaked or wedged.
   `references/writing.md` has the whole procedure — the key loop and its two refusals,
   the patch/rewrite choice, the shell rules for somebody else's words, reverts, boards,
   and what to do when a person is editing. Read it before any write of your own.

## Reading a command's help

**Ask for `--help=brief` first.** `--help=brief` is a lookup — the synopsis, one line
per flag — and the whole text bare `--help` prints is a lesson, five times the words.
Brief answers most reads: a name, a spelling, which flag carries a value you already
hold. Go on to the whole text **when a wrong value would write something you cannot
see is wrong** — `--stage`, `--folder` and `--columns` all have silent edges brief
stops short of, and `references/conventions.md` names them. Read neither when this
skill already spells the command. Start brief, and go on when the brief line does not
answer you — never the other way round.

## Several commands in one invocation

**Every `corpus` invocation pays its startup before it does any work.** `corpus batch`
takes a JSON array of argv on stdin — each entry exactly the words you would have
given `corpus`, without the word `corpus` — runs them in order inside one process, and
reports what each one did. **One condition decides whether a run may go this way: no
entry may need what an earlier entry printed.** The array is fixed before the first
command runs — a key a read would have handed you, an id a creation would have
returned, a passage to quote: a run that needs one is two invocations, and the second
may itself be a batch. Nothing refuses such an array — the entry that needed the
missing value fails on its own while every entry around it succeeds.

**A batch is not a transaction, and nothing in it rolls back** — several writes landing
in one git commit is timing, never atomicity. **So read the report, never the exit code
alone.** Exit `0` says every command ran and succeeded; anything else is exit `11`. A
failure about one command costs that command alone and the entries after it still run;
a failure about the run — the server unreachable, the token rejected — ends the batch
there, and every remaining entry is reported as **never run** rather than as failed.

The grammar, each a refusal when you get it wrong: `--from agent` goes on the batch,
once, and an entry's own `--from` wins over it. An entry's body rides as a `-m` JSON
string — for words *you* wrote only; anybody else's go by
`"--flag-file","title=/tmp/corpus-title-evt_5a2b7c.txt"`. The array arrives on a
heredoc or a pipe. **An entry that follows or long-polls holds every entry after it**,
exactly as it holds a shell: the array is one process running the entries in order,
so nothing behind such an entry runs until it returns. `corpus queue idle` and
`corpus server logs --follow` stay out — `idle` doubly so, since *The loop* forbids
chaining it to the claim, and an array is a chain. Dispatch is not a command at all,
and no array carries it. Before composing an unusual array —
a redirected file, a refused entry, a flag the batch owns — read
`references/conventions.md`: the whole grammar and its exit-`2` refusals live there.

**The claim is an ordinary entry, and step 4 belongs in a batch.** Steps 2, 3 and 4
of the loop go as one invocation — none of the three wants what another printed:

```bash
corpus batch <<'CORPUS_EOF'
[["agents"],["queue","reap-stale"],["queue","claim-all"]]
CORPUS_EOF
```

Their **order** matters and a batch keeps it: the roster is read **before** the reap,
and the reap requeues a dead session's events in time for the claim below it. They are
three steps still — read all three reports. **A batch that claims, claims — whatever the entries behind it do.** The run above ends on the claim so nothing can fail behind
it; where you do put work behind a claim, the claimed events are yours on the report
alone, settled each on its own outcome.

## The loop

**This is a procedure, not a script**, and the difference is the difference between
the loop working and the loop silently doing nothing. Its load-bearing step —
dispatch — is not a command: it is you launching subagents, and no shell line
performs it. So the steps below are never pasted into one command line, and two of
them are **never chained**: `corpus queue claim-all` and `corpus queue idle` are always separate commands
with dispatch between them. Chained into one command, they claim the pending batch
and immediately re-park on it — that command has nowhere to put dispatch, so every
event it claims is worked by nobody, with no error anywhere.
Run these steps in order, indefinitely:

1. **Attribute, once per session, before anything else.** `export CORPUS_FROM=agent`.
2. **Read the roster — before you reap, and this order is load-bearing.**
   `corpus agents`, one read, naming every lane: yours, and one per resident
   conversation, with **whether anybody is listening on it, whether it is working,
   and how much work is waiting there**. Keep what it printed — step 6 acts on it.
   Read it first because reaping destroys the field the launch decision needs
   (AGENT-056): `working` is derived from held work, so after a reap a resident
   mid-turn reads exactly like a lane whose listener died — the launch condition.
3. **Reap.** `corpus queue reap-stale` returns events a dead session stranded
   in-progress. Run it every pass: after a clean park it reaps nothing, and after an
   unclean stop it is what returns stranded work to `pending/`. **Nothing you launch this pass
   is decided by what it prints** — step 2 already decided, on purpose.
4. **Claim, then read what it printed.** `corpus queue claim-all` prints the pending
   batch and what the server still holds in-progress, as one payload. Nothing else
   happens until you have read it.
5. **Reconcile that held list against your own work** (Claiming and batching below).
6. **Launch the listeners the roster asked for, and then dispatch every claimed
   event** (Routing and Delegation below). **This step is work, not a command** — the
   listeners **first**, then one background subagent per event, the whole batch out
   before you go on. **Launching outranks dispatching, and it is not a preference.**
   A conversation whose listener has not started is a whole line of work stopped. A batch
   is never the reason a listener waits. This is the step a chained command
   line has nowhere to put.
7. **Park, alone.** `corpus queue idle` is the entire command — never appended to the
   claim above it, never combined with the settling below it, never launched a second
   time while an earlier one is still parked. It returns on a new event or on its
   ~8-minute rearm.
8. **Read what `idle` returned, before anything else happens.** That return **is** the
   arrival notification — a return
   nobody read is an event nobody works. It is not a log to catch up on later.
9. **Settle every event whose subagent has reported** — one of
   `corpus queue complete evt_7c1d9a`,
   `corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"`, or
   `corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"`
   — and then repeat from step 2.

**Steps 2, 3 and 4 go as one invocation, in that order.**
(*Several commands in one invocation* above.) They stay three steps, and nothing
else in this list joins them — step 6 is not a command, and step 7 parks.
The order is claim → dispatch → park: return to `corpus queue idle` **as soon as the
batch is dispatched** — a session waiting on one job is closed to every other — and
settle as reports arrive: each time parking returns, record what finished, then claim
again.

`corpus queue idle` exits `0` in every normal case. On its ~8-minute timeout with
nothing pending it prints `idle — no events (timeout)`; while halted it parks the
full window and prints `idle — no events (halted)` — both normal, keep looping. When
work arrives it returns at once, one line per pending event, id then type —
`evt_7c1d9a comment.created` — what step 8 reads. Its only flag is
`--wait <seconds>` (default `480`).

One `comment.created` worked end to end, every step of this loop with the console
story it leaves, is `references/worked-example.md` — read it when the loop's shape is
unclear, never as part of an ordinary pass.

## Claiming and batching

`corpus queue claim-all` atomically moves everything in `pending/` to `in-progress/`
and prints **one JSON payload** on stdout, in both human and `--json` mode: `events`, the
batch you have just claimed, and `inProgress`, what the server still
thinks you are doing.

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}],"inProgress":{"events":[{"id":"evt_2e4f8b","type":"comment.created","heldSince":"2026-07-28T08:41:17Z","originId":"th_9d2f7a","originTitle":"Q3 planning"}],"total":1,"truncated":false}}
```

Parse `events`, group it by the documents each event touches (Concurrency and
ordering below), and dispatch the whole batch before claiming again — a second claim
mid-dispatch splices new events into an ordering you already computed. An **empty `events` array** is not an
error — halted, or nothing pending — and it is still two commands rather than one:
reconcile `inProgress` anyway — it is reported on every claim, empty batch included —
then park
with a separate `corpus queue idle`. A shortcut taken on the empty pass is the
shortcut that loses the next real event.

**What the claim hands you is yours, and you do not audit it.** The server already
worked out what falls in your lane: your own events, plus the pending events of
conversations whose resident a person has **released**. A lane that still has its resident is never in it —
not while its listener is running, and **not while it is absent either** — so there
is no classification step: do not check whether an event's thread has a resident, do
not compare payload ids against the roster, and **do not hold work back for an
agent that might come back**, because the server is already holding it.
Scope membership is a **walk** the server makes when the event is enqueued,
following a thread's parents and a
document's `origin` — you cannot reproduce it and nothing asks you to. The event arrived on
your claim, so it is yours to work. That is the whole test. **Never apologise for a
resident and never announce that one is missing** — you are not in that conversation,
and the person sees the lane's state on the board. The fix is a launch, not an
explanation (`references/launching.md`).

**A held row can leave your list while you are still working it.** The held list is
filtered like your claim, so a re-designation hides an event you took from a released
lane. Nothing was settled and nothing taken off you — the settling verbs
take an event id and no lane — so settle it from your subagent's report exactly as
always: **settlement follows the report, never the list.**

**`inProgress` is what the server was already holding for you — never work to do
again**, and nothing prints when nothing is held, the ordinary case. On a non-empty
list, **read every row and take exactly one of two actions on it** — a stuck job is
almost never a crash, it is a finished job whose settling call was forgotten:
**you already did this work** — settle it now, **do not do the work again**, and log
`"settled late — …"` so the console's story matches; or **you are still working it**
— a subagent has not reported yet, so leave it exactly where it is. **Never settle an
event you cannot account for**: a row you do not recognise is left alone — completing
it reports work nobody did, silently kills a still-running session's accounting, and
the person waiting on it gets no reply and no failed row to explain the silence.
`references/conventions.md` § *Reconciling the held list* carries the row fields, the
20-row cap, and the whole account — read it whenever the list comes back non-empty.

**`corpus queue reap-stale` takes no lane, and reaching all of them is the point** —
it is a requeue, and a reaped event returns to `pending/` on the lane it was claimed
from: to its conversation, not to you. Run it every pass, and know it is yours alone
to run — a resident never reaps — and never complete a row to shorten the list:
nothing is lost by leaving one alone.

## Routing

Every routable event is dispatched to a subagent; the row names **which skill that
subagent is given**, never a job you take on yourself. Never guess: an event type with
no row below is failed with a reason and is never silently completed.

| Event type            | Dispatch                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `comment.created`     | A subagent applying the **comment** skill to the thread named in the payload.                 |
| `form.respond`        | A subagent applying the **comment** skill; the payload names the thread, the form's turn, and the answer. |
| `doc.edited`          | A subagent applying the **reflect-edit** skill to the document named in the payload. Its dispatch carries the payload verbatim, both shas included. |
| `workspace.reflect`   | A subagent applying the **reflect-corpus** skill. Its dispatch carries the payload's `since` verbatim, `null` included. It falls in no scope and is always yours.                     |
| `resident.designated` | A conversation was given a resident. Launch a listener — a long-lived background subagent applying the **converse** skill to the payload's `threadId`, with the payload's `resident`, at the model that `resident`'s `weight` names (`references/launching.md`). It is one of the three rows that are not jobs. |
| `resident.released`   | A conversation's resident has gone. Nothing is dispatched and nothing is launched: log who left and the payload's `reason`, then complete (`references/launching.md`). It is another row that is not a job. |
| `lane.waiting`        | A conversation has work and nobody listening. **Never dispatched** — it is a report about somebody else's conversation, not the conversation. Make sure a listener is running for the payload's `lane` (`references/launching.md`), then complete. The third row that is not a job. |
| `agent.done`          | A finished piece of background work. Nothing produces this event today — reports reach you directly (Delegation below) — but an arriving one is handled like a report: verify the work its payload identifies and settle it. |
| anything else         | `corpus queue fail <id> --reason "unknown event type: <type>"`                                |

Thread handling itself — reading context, honoring mentions, filing inbox captures,
wording the reply, skill genesis — belongs to the comment skill, applied inside the
subagent. This skill routes and dispatches, and owns queue state, ordering, deferral,
logging, and the halt switch.

**Three rows above are not jobs, and `references/launching.md` is their whole
procedure**: the launch act and its prompt, the weight a listener goes out at and the
judgment for a designation that chose none, the `stated`/`judged` log grammar, losing
a listener, and the case law behind every decision below. Read it whenever a pass
holds one of those rows or the roster asks for a launch. The decisions stay here:

- **A waiting lane is a request for a listener, and never a message to answer.**
  `lane.waiting` carries **only** the lane — no thread, no turn, no author, no text —
  so answering it would be you writing in a resident's name. Make sure a listener is
  running for the lane it names, then complete. A notice for a lane that is already
  live settles with no launch, and that is ordinary; several notices for one lane are
  one launch.
- **A lane with work waiting and nobody on it gets a listener, once a pass, per lane,
  never per event.** Launch for every roster row that is not yours, does not read
  `live`, **has something pending**, and is **not working** — three fields, none of
  which decides alone. **Working is not presence**, and it is the field that costs an
  agent when you drop it: a resident works inline and holds no park mid-turn, so
  `lapsed · working · 2 waiting` is a **busy agent** — while a dead listener's lane
  reads `working` until its event is reaped, which is why the roster is read *before*
  the reap and why a crashed lane costs one pass. This covers the two cases no event
  announces: a crashed listener, and your own restart. A lane that stays not-`live`
  after your launch is logged — worded as **standing down, never as a failed launch**
  — then left alone until a fresh `resident.designated`.
- **Where the row cannot tell a crashed listener from one mid-turn, launch anyway** —
  no probe, no held-back pass, no reading the display text. A duplicate parks, costs
  nothing, and at the first message one of the two finds out it is second and goes.
  **How it finds that out is the converse skill's to state, and it is stated there
  alone.** A wasted session against an unanswered conversation is not a close call —
  a conversation with no listener is not answered slowly, it is not answered.
- **A lane that already has a listener gets nothing — unless this session has
  processed a `resident.released` on that same lane with no launch since.**
  Re-designating is the only way a person can restart a stopped listener, so with no
  release seen, `live` means the lane is already answered: launch nothing, log why,
  complete. After one, `live` means someone is leaving: launch — whether the release
  shared this claim or came two claims ago — and say in the launch prompt that the
  launch follows a release. A re-designation that only changes the **weight** is this
  case too: launch now, at the new weight, and the old listener ends its own run.
  **When it goes, and how it finds out, is the converse skill's to state.**
- **Launch before you dispatch, in the same pass, every pass.** A designated lane is
  never on your claim, so nothing of yours can collide with the launch — and a
  deferred launch on a conversation somebody keeps using never finds its clear pass.
- **Structured targets.** The payload's `mentions` and `skills` fields are
  directives: `@<subagent>` (a `type: agent-def` document under `.claude/agents/`)
  routes the work to that persona, `/<skill>` applies that skill, and the two
  combine. A missing or archived target is never silently ignored — do the work as
  well as you can and state in the reply that the named target was not found. A
  generic `@agent` names no target: triage it yourself.
- **An event type with no row.** Fail it with the type quoted in the reason —
  `corpus queue fail evt_2e4f8b --reason "unknown event type: ledger.reconciled"`.
  **Never complete it** — a completed event is work somebody is entitled to think was
  done — and **never derive a handler from its name**: dispatching on the shape of
  the string answers somebody with work nobody asked for.
- **Gone context** — a thread or parent the user deleted — is failed with a reason
  naming the missing id. Never recreate deleted content.
- **A report after resolution** is delivered in a reply that says the thread was
  resolved meanwhile — finish work that still has value, and never reopen the thread
  unilaterally. `references/conventions.md` § *Routing edge cases* elaborates all
  four.

## Delegation

**Every claimed event is worked by a subagent.** You never work a job inline — not a
one-line answer, not a "quick" edit, no exception for small work: you claim, dispatch,
settle, and park. A session deep inside one job is closed to every other. (A resident
answering its own conversation inline is outside that rule's subject, not an
exception you may copy — never "correct" it; `references/weight.md` says why.)

Dispatch through Claude Code's subagent mechanism — the Task (Agent) tool — launched **in
the background**, one subagent per event. A subagent inherits nothing, so its prompt
carries everything: the event id and type, the payload's ids, which skill to apply
(the routing row, or the `@<subagent>` persona the payload directs to),
the model you are launching it at, and the anchors it should start from. Its report
comes back as the task's final message. And a subagent inherits no environment, so
its mutating commands still carry `--from agent`, and its progress lines go to the
dispatching event's job — the same event id you dispatched.

**The call's `model` argument is what chooses the runtime, and the prompt chooses
nothing.** The Task tool takes `model` beside `prompt`, and passing it is the one act
that makes the work run at the tier you picked — set it on **every** launch this skill makes,
a per-event dispatch here and a listener launch alike, to the picked row's **Model**
in the spelling the tool accepts: the model's lowercase family name, so the Sonnet
row travels as `sonnet` and the Opus 5 row as `opus`. A model named only in the prompt's prose selects nothing: that
launch runs on whatever model the session inherited, no error is raised, and
nothing anywhere records that a choice was dropped — precisely the
substitution the weight rules below exist to rule out. So every launch is one call carrying
both:

```
Task(
  model: "sonnet",
  description: "comment-skill subagent for evt_7c1d9a",
  prompt: "Apply the comment skill to th_4b8e2c (evt_7c1d9a, comment.created). You are
           running as Sonnet — that word is the --model value on every turn you post.
           …the payload's ids, the anchors as retrieved…"
)
```

The prompt names the model too, and that line is written for the subagent, never for the
runtime: a subagent is told what it runs at because nothing else tells it, and
selection already happened in the argument above it. A `model` value the tool refuses
is the *cannot be honoured* case below, announced at the call instead of discovered
never.
You park on `corpus queue idle` — never on a subagent — and settle from reports as
parking returns. Settlement never depends on any queue event announcing the subagent;
the report itself is the signal.

**A dispatch carries anchors, not documents.** The payload's ids are anchors already;
where the work plainly needs context the payload does not name, retrieve it first —
`corpus search "<the request's subject>" --limit 5`, or `corpus doc related <id>` —
and paste the top few lines back verbatim, ids and heading paths and snippets as they
printed. That is the whole context transfer: never paste a document body into a
prompt, never hand over a file, never ask a subagent to report the corpus back to
you. Where the work builds or reorders a board, name
`.claude/skills/orchestrate/references/writing.md` in the dispatch by path — the board
grammar lives there, and the skill the dispatch names does not carry it.

**Pick the subagent's model by the task's weight, and judge that weight in two passes —
consequence first, difficulty second.** The two passes weigh **a job you dispatch**.
They never weigh **a listener you launch**, whose judgment is
`references/launching.md`'s. The question that picks a model is never how hard the
work looks. It is **what a bad result would do that revising the document afterwards
would not undo**.

**First pass — ask that question, and expect it to answer no.** Exactly two things
make a failure that kind: the output exists **to be used outside the corpus** —
published, sent, handed to someone — or **someone will decide something real on it**
— about a person, money, a commitment. Neither is the ordinary case, and that is the
point: a wrong document that stays in the corpus is noticed, commented on and
revised. **Where one holds, dispatch the strongest tier however mechanical the work
looks, and stop there — the second pass does not run**, and the dispatch line names
`consequence` in so many words. `references/weight.md` carries the first pass in
full.

**Second pass — difficulty, for everything the first pass answered no to:**

| Weight                  | Key      | Model      | What falls here                                                                                       |
| ----------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| Small and mechanical    | light    | **Haiku**  | The request prescribes the change exactly **and the first pass answered no**: a one-document edit spelled out in the comment, retitle-and-file an inbox capture, a factual reply that needs one read. A prescribed change whose result is going out, or is going to be decided on, is not in this row however exactly it was prescribed. |
| Standard                | standard | **Sonnet** | Most comment work: read a thread and its parent, decide the wording, edit, reply — multi-step but bounded to one or two documents. |
| Heavy or judgment-laden | heavy    | **Opus 5** | Cross-document restructuring, merges and splits, skill genesis or any edit to a skill, ambiguous requests that need judgment — and everything the first pass vetoed, whatever its difficulty. |

Judge that second-pass weight by two things: how many documents the work touches, and
whether the request prescribes the change or asks for a decision. In doubt between two
tiers, take the stronger — a wasted token is cheaper than a wrong edit. That tie-break
governs what **you** pick for yourself, runs after the first pass rather than beside it,
and is never licence to move off a weight the request stated.

**That table is read by more than you.** A composer in the app parses it out of this
document by its header cells — `Weight`, `Key`, `Model`, `What falls here`, in that
order and spelled that way — to offer these rows as the weights a person can state,
and its **Model** cells are the whole vocabulary a turn's `--model` may record: the
turn-writing verbs refuse a spelling this column does not hold. Editing the table
changes all three at once; `references/weight.md` says what each column reaches
before you touch one.

**A stated weight is a directive; the two passes govern only what you pick when the
request stated nothing.** It reaches you as the `weight` field of the claimed event's
payload, carrying one of the **Key** tokens above, and it is **honoured, not weighed
again** — never quietly substituted **in either direction**. It travels with the
work: into the dispatch prompt in words, and through every further delegation, whose
deciding stage runs at it. Stating no weight means you decide, by the two passes —
absence is never a fixed default. (A **designation's** weight reaches the resident's
own turns and stops there.) Two edges, and before dispatching either, read
`references/weight.md`: a stated weight **lighter than the first pass calls for** is
not overridden — **ask first, with a form** — and a stated weight that **cannot be
honoured** never drops the work: dispatch at what the two passes judge best and state
the deviation twice, **in the job's log while it runs and in the reply the request
receives**, the substitute named as a level this table declares, by its **Key** cell.
Everything past that is speech, never substitution: where the work proves to need
more than was asked, do it at the stated weight and say so in the reply.

**One request may be worked in stages, and the stages need not run at the same
weight** — a stage whose output is **material** may run lighter, and a stage that
**decides** runs at the governing weight. Read `references/weight.md` before splitting
one: where the line is drawn, what each stage is handed, and what a split obliges are
stated there — and splitting is never a route around a stated weight.

**Every invariant binds inside the subagent, and exactly one document states them to
it.** Every dispatch names a skill, and the dispatch restates nothing: that skill's
own *Inherited invariants* section is the copy that binds its subagent — a prompt that
repeated them would be a second copy to keep in step, paid again on every event. Name
the skill and let it speak. Three rules bind the turns and prompts you write yourself,
outside any dispatch:

- A reply whose work changed documents closes with the `↳ ` trace line (Stewardship
  below); the comment skill states the grammar.
- Anything a reply hands over for reuse sits alone in a fenced block whose info string
  labels it, one deliverable per fence, written to the fence-width rules. The comment
  skill states the convention; `references/writing.md` carries the copy that binds
  the turns you post yourself just as the comment skill's binds a subagent's.
- **Every turn it posts names the model that wrote it** — `--model <name>` on
  `corpus thread reply` and on `corpus thread create`, naming what actually ran. That
  is why the dispatch states the model you launched it at: the subagent has the word
  in hand and quotes it back. The value is a **Model** cell of
  the level table above and nothing else — the CLI refuses every other spelling —
  and it is a **record of what ran, never a
  request for what should run**. Where the work ran in stages, the
  turn names the **deciding** stage — one model and never a list; the gathering
  stages stay in the job log. Where nothing knows what ran, the flag is left out and
  the turn shows nothing rather than a guess — a turn you post yourself had no
  dispatch to hand you a word, so take the row whose **Model** cell names what your
  own runtime tells you that you are, and where no row does, leave the flag out. The
  comment skill states the grammar; `references/weight.md` carries the full account.

**Queue state never crosses the boundary — the boundary being your lane.** A subagent
you dispatched never runs `corpus queue claim-all`, `corpus queue complete`,
`corpus queue fail`, or `corpus queue defer`: it **reports** an outcome, and you **record** it
— you hold the only account of the event. Three paths, none of which
loses a job: **reported success** — verify what the report claims (the reply exists,
the named changes landed), then complete; **reported failure** — fail with **the subagent's reason**,
never a generic one, posting the one-line reply first if the
subagent did not; **no report** — the subagent died, its event stays `in-progress`,
and the loop's opening reap returns it to `pending`. Nothing lost.
**A listener is not one of those subagents**: a resident claims, settles and parks
on its **own** lane — a lane you never claim and never see.
It is that lane's owner, not your delegate on this one, and its queue calls are what
owning a lane is. Nobody settles work they did not claim: you settle nothing of a
resident's, and a resident settles nothing of yours — including the
events you took from its lane while nobody was on it.

**A subagent that stands aside defers — through you.** One that finds a person
editing the document it was about to write reports that with the document id and
stops. Confirm the waiting thread got its one-line reply (the comment skill has the
subagent post it; post it yourself if it is missing), then defer exactly as
`references/writing.md` prescribes — never `corpus queue fail` for it. A
stale-key refusal is a different thing and never reaches you: the subagent re-reads,
writes again, and reports the finished work.

## Concurrency and ordering

Compute, for every event in the batch, the set of documents its work touches:

- `comment.created` / `form.respond`: the thread id **and** the thread's `parent`
  document id.
- `doc.edited`: the payload's `docId`. Its reflection may write documents no payload
  names, so it is dispatched after any overlapping thread work in the batch.
- `agent.done`: the documents of the work it reports.
- An event whose touched set you cannot compute touches everything: run it serially,
  after the rest of the batch.

Two events **overlap** when their work would touch the same document(s) — or when
their touched sets otherwise conflict: a folder one event reorganizes while another
files into it, a skill one event edits while another applies it. Overlapping events
run **serially, in dispatch order** — the order `claim-all` printed them; never
reorder an overlapping pair. The later event is dispatched only after the earlier
one's outcome is recorded, because the second must see the first's effects. The rule
spans batches: a newly claimed event that overlaps a still-running subagent's work
waits for that subagent's outcome, not merely for a free slot.

Non-overlapping events run concurrently, one subagent each, bounded to at most **10**
concurrent subagents; further events wait their turn in dispatch order. That 10 is
this workspace agent's bound, set by the product's contract — unrelated to any
concurrency limit the operator's own tooling enforces elsewhere.
**The bound counts subagents working events, and a resident listener is not one of those.**
A listener is parked on its own lane, spending nothing, dispatching on its own
account, and counting parked listeners would mean a workspace with
ten designated conversations could dispatch nothing at all — inverting what the
bound is for: it limits work in flight, never agents in existence.
Ordering is per lane for the same reason: you serialize overlapping events within
your batch, and you neither can nor
should order your work against a resident's — two lanes touching one document is the
ordinary two-writers case, protected by the key on the write, not a schedule.

## Progress and job logs

Every event is a job whose log the console tails live. Append lines with
`corpus job log <eventId> "<line>"` — the command has no flags; the line is the
positional argument (or piped stdin). Log at these moments, and only these:

- **claimed** — `corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"`
- **dispatched** — which skill's subagent took it, the tier it went out at, and
  **where that tier came from**: `judged, difficulty` for the second pass, `judged,
  consequence` for the first, `stated by the request` where the request chose, and
  `stated by the request … not honoured` where it chose something you could not give
  it. Four shapes, one grammar:
  `corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — judged, difficulty: one document, prescribed change)"`,
  `corpus job log evt_4f8a2b "dispatched to a comment-skill subagent (Opus 5 — judged, consequence: the revised paragraph goes to the lender tomorrow)"`,
  `corpus job log evt_9c3b1d "dispatched to a comment-skill subagent (Haiku — stated by the request)"`,
  `corpus job log evt_2e4f8b "dispatched to a comment-skill subagent (Sonnet — stated by the request as heavy, not honoured: this workspace declares no such level, so it ran at standard, judged, difficulty)"`.
  The fourth names the ask, that it went unmet, and what ran instead — the three
  things the reply carries too, because the log is reaped and the reply is not.
  **`ran at standard` is the third of those, and the line is not written until it
  holds a level** — the **Key** cell of the tier-table row your judgment picked, a
  word the table declares and a reader can check. The model name opening the line
  does not stand in for it, and neither does the provenance after it.
  `references/weight.md` carries the full account of this line.
  **This log is the per-stage account.** Where the work ran in stages, each stage
  gets **its own dispatch line, in the order the stages ran**, each naming its tier
  and where that tier came from. It is still one job, one status and one reply; the
  turn itself names only the deciding stage, so the log is the only place the whole
  split is written down.
- **acted** — each notable action, named concretely. These lines come from **inside
  the subagent**, appended to the same event id it was dispatched for — never to a
  job of its own.
- **settled** — done, failed with the reason repeated, or deferred naming the
  document it is waiting on.

A delegated job's log is one story in one file: your claimed and dispatched lines,
the subagent's acted lines, your recorded outcome. A useful line names the object and
the change: `"edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"` tells the
operator what happened; `"working"` tells them nothing. That discipline binds the
subagent's lines too. Do not narrate individual tool calls and do not stream
reasoning into the log — the console is a progress feed, not a transcript.

## Completing and failing

Settle every claimed event — from its subagent's report, never at dispatch time —
with exactly one of:

```bash
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"
corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"
```

The reason is a `--reason` flag, never a positional. A good reason is one short
sentence naming the object and the obstacle — it is what the operator reads in the
console's failed or deferred row. Write the same reason to the job log
(`corpus job log evt_2e4f8b "failed: the parent document doc_f4e9d2 was deleted"`) so
the drawer and the row agree. `--blocked-on` names the **document being edited** —
never the thread — because that session ending on exactly that document is what
returns the event to `pending`; name the wrong document and the event parks forever.
Re-entry is automatic, and `references/writing.md` has the courtesy this deferral
serves.

For `comment.created` and `form.respond`, a person is watching a pending indicator.
**Reply before you fail** — and before you defer: post a short
`corpus thread reply <id> --from agent --model <name>` saying what went wrong or what
the work is waiting on, then settle the event. A pending indicator that silently
becomes a failed job reads as the agent hanging; a one-line reply resolves it
honestly.

The invariant, restated: every claimed event ends settled — including when your own
handling throws: catch, log, reply if a thread waits, fail with a reason, move on.
Failed events are retried with `corpus job retry` or written off with
`corpus job abandon`.

## HALT

`.corpus/HALT` is the operator's kill switch, toggled with `corpus queue halt` and
`corpus queue resume` (the console drawer exposes the same switch). While it exists,
`corpus queue claim-all` returns an empty batch and `corpus queue idle` parks its
full window, printing `idle — no events (halted)` at exit `0`. Events keep enqueuing
— a halt stops your consumption, never the production — and `resume` makes it all
claimable again. The correct halted behavior is to **keep looping quietly**:
claim-all, empty batch, idle, repeat. Do not exit, do not error, and do not post
anywhere about being halted — the operator did it on purpose.

## Stewardship

Leave the corpus better than you found it — opportunistically, while working events,
not only when asked. The charter binds whoever does the work, which is normally a
subagent applying the comment skill; delegation dilutes none of it. The charter, whose
bullets `references/conventions.md` elaborates:

- **Durable knowledge becomes documents** — if you would need it in a future thread,
  write it down now, never leave it buried in conversation.
- **Noticing a change is written down, not asked about**: into that document's
  `## Changelog` section at the end of its body, appended and never rewritten — a
  thread means _I need something from you_, the changelog means _I noticed_, and a
  thread is opened only for a decision you cannot proceed without, asked with a form.
- **Stale content is updated** when you touch a document and find it out of date.
- **Obsolete documents are archived** — never deleted; deletion is the user's alone.
- **Misfiled documents are moved** (`corpus doc move`) to where their content says.
- **A folder verb serves a request that named the folder, never this charter** —
  `corpus folder archive`, `corpus folder unarchive` and `corpus folder rename` are
  out of reach of any judgment of yours about what a folder holds: stewardship picks
  its documents one by one and names each one in the reply. The comment skill carries
  the working rule at the point the request arrives.
- **Near-duplicates are merged**; **overgrown documents are split** (a `[[ref]]`
  connecting the two).
- **What you steward, you found by retrieving** — never by listing the tree.
- **Every change is stated in the reply that occasioned it** — one line per change,
  naming the document; where no thread was opened, the changelog entry is that
  statement. Nothing you do is silent.
- **Every turn that wrote closes with a trace line.** When a turn's work changed the
  corpus, its **final line — and only its final line —** is the arrow `↳ `, a space,
  then a one-line, past-tense report of what the work did, as in
  `↳ archived [[doc_f4e9d2]] and moved [[doc_a1b2c3]] into finance/`. This binds every
  agent turn, including the ones you post yourself; a turn whose work changed nothing
  carries no trace. The comment skill states the same rule for the replies it writes.
- **Every change is traceable** — your CLI mutations auto-commit with you as git
  author.

Scope rule: do the stewardship the event's own documents call for. A corpus-wide sweep
is separate work — when you keep meeting the same mess, propose the sweep in a reply
instead of quietly starting it.

## Skills and subagents are documents

Your skills (`.claude/skills/<name>/SKILL.md`, `type: skill`) and subagent personas
(`.claude/agents/<name>.md`, `type: agent-def`) are ordinary documents: indexed,
commentable on the board, and edited through the CLI like everything else — the file
under `.claude/agents/` is what `@<name>` resolves to, with no registry anywhere.
**What a persona has to carry, and how one is written, is the profile skill's to
state, and it is stated there alone.** A request for an agent of somebody's own goes
to `/profile`. Before editing a skill, read `references/conventions.md`: an edit to a
loop skill takes effect on the **next** run, not the running one — the reply says so —
and a bad edit is reverted through `references/writing.md`, while a bad edit to a
**core-loop** skill can break the loop that would fix it, which is why the recovery
section below exists and why a change to `orchestrate` or `comment` is always named
prominently in your reply.

## If the loop breaks (operator recovery)

*This section is for the operator, not the agent.*

Symptoms of a broken core-loop skill: `/orchestrate` errors immediately or spins
without claiming, events pile up in `pending/`, replies stop while the pending
indicator escalates. The way back:

```bash
corpus queue halt
git log --oneline -- .claude/skills/orchestrate/SKILL.md
git restore --source=<sha> -- .claude/skills/orchestrate/SKILL.md
corpus queue resume
```

**This is the one repair that does not go through the agent**: when the broken
document is the loop, there is no agent running to revert it, so the operator does
it by hand — use `comment` or `converse` in place of `orchestrate` when that is the broken
one. Restore the **file**, not the commit: a commit here is an editing session's
window, gathering everything that party changed while it was open, and
`git revert <sha>` would take neighbouring documents back with it. Halt first so a
half-working loop cannot claim events mid-repair; resume last. The server needs no
telling: it re-projects the restored skill and commits the change as the out-of-band
`user` edit it is.

A broken `converse` fails one conversation, not the loop. Two causes, told apart by
what the listener left: a corrupted skill file leaves nothing — restore the file the
same way — while a listener that chose to leave settled its events and recorded why,
so read the recorded reason instead; `references/launching.md` § *A broken converse,
for the operator* has the detail.

To turn a skill off rather than revert it, `corpus doc archive` it: its folder moves
to `.claude/skills-archived/`, still indexed and restorable on the board, and no
longer discovered as a skill.
