---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim queue events, dispatch each one to a subagent, settle outcomes from their reports, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-08-12T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## Purpose and when to run

You are this workspace's agent, and `/orchestrate` is your main loop. It drains the event
queue, dispatches every event to a subagent running the right skill, reports progress to
the console, drives each event to a settled state, and parks — at zero token cost — until
the next event arrives.
The operator starts `claude` in the workspace, invokes `/orchestrate` once, and leaves it
running; you loop until the session is stopped. This session is the **only** process that
claims queue events: the server enqueues them, the board displays them, and everything in
between is you. Run one orchestrating session at a time — the server never hands one event
to two claimants, but a second loop would split the console's story in half.

## Invariants

These bind every step below — and every subagent you dispatch, without dilution
(Delegation states how they cross that boundary). Read them before the loop, because
everything after depends on them.

1. **Every mutation goes through the `corpus` CLI.** Never hand-edit files under `data/`,
   `.corpus/`, or `.claude/` — not with an editor, not with your own file tools, not with
   shell redirection — and never call the HTTP API directly. The server is the sole writer:
   it is what commits every change with the right author, keeps thread anchors attached
   through edits, and keeps the board live.
2. **Attribution is explicit.** `--from` defaults to `user` on every mutating verb. Run
   `export CORPUS_FROM=agent` once at the start of the session, and still pass
   `--from agent` on mutating commands the way the examples below do — a change attributed
   to the wrong party is a corrupted audit trail.
3. **You archive; you never delete.** Deletion (`corpus doc delete`) belongs to the user
   alone, and the CLI refuses it from you. Where a person would delete, run
   `corpus doc archive` — reversible, still indexed, still in git.
4. **Every claimed event is settled** — `corpus queue complete`, `corpus queue fail`, or
   `corpus queue defer` — on success, on error, on a document somebody is editing, and on
   interruption alike. Complete and fail reach a terminal state; a deferred event is settled
   accounting, not a dangling one — it leaves `in-progress/` and returns to `pending/` on
   its own when the editing session it names ends. Work may fail or wait; accounting may
   not. The
   way this invariant actually breaks is that you finish a job and forget the settling
   call, which nothing in the work itself reveals — so every claim reports what the server
   still holds, and reading that report is a step of the loop (Claiming and batching).
5. **`corpus queue idle` is the only wait.** Never `sleep`, never poll the queue, never
   busy-wait: `idle` parks you on a held response, so waiting costs zero tokens and ends the
   instant work arrives.
6. **You retrieve; you never enumerate.** Locating something is always
   `corpus search "<query>"` — ranked, one line per hit: a document id, the heading path of
   the matching passage, a snippet, and never a body — or `corpus doc related <id>` to expand
   from a document you already hold. Never list a folder, never sweep the tree, never read
   documents to find out what is in them: what it costs you to find something must not grow
   with the corpus. Reading a body is a separate, deliberate act on an id retrieval handed
   you: `corpus doc show <id>`. The rule crosses the subagent boundary intact — a dispatch
   carries anchors, never documents (Delegation).
7. **A write presents the key its read gave you.** Replacing a document's body or rewriting
   its frontmatter wholesale means passing the `--key` that `corpus doc show` printed, and
   the write prints a fresh key for the next edit. This adds no step to anything: you
   already read a document before rewriting it, and that read is where the key comes from.
   Nothing is acquired and nothing is released, so nothing can be forgotten, leaked or
   wedged. *Writing a document* below has the loop, the two refusals, and what to do when a
   person is editing.

## The loop

**This is a procedure, not a script**, and the difference is the difference between the loop
working and the loop silently doing nothing. Its load-bearing step — dispatch — is not a
command: it is you launching subagents, and no shell line performs it. So the steps below
are never pasted into a single command line, and two of them in particular are **never
chained**: `corpus queue claim-all` and `corpus queue idle` are always separate commands
with dispatch between them. Chained into one command, they claim the pending batch and
immediately re-park on it — that command has nowhere to put dispatch, so every event it
claims moves to `in-progress/` and is worked by nobody, with no error anywhere and nothing
in the console to show for it. Run these steps in order, indefinitely:

1. **Attribute, once per session, before anything else.** `export CORPUS_FROM=agent`.
2. **Reap.** `corpus queue reap-stale` returns events a dead session stranded in-progress.
   Run it every pass: after a clean park it reaps nothing and stays silent, and after an
   unclean stop it is what returns stranded work to `pending/`.
3. **Claim, then read what it printed.** `corpus queue claim-all` prints the pending batch
   and what the server still holds in-progress, as one payload. Nothing else happens until
   you have read it.
4. **Reconcile that held list against your own work** (Claiming and batching below). It is
   the loop's own check on itself, and it only checks anything if you act on it here.
5. **Dispatch every claimed event to a subagent** (Routing and Delegation below). **This
   step is work, not a command** — one background subagent per event, the whole batch out
   before you go on. It is the step a chained command line has nowhere to put, which is why
   that chain is forbidden rather than discouraged.
6. **Park, alone.** `corpus queue idle` is the entire command — never appended to the claim
   above it, never combined with the settling below it, never launched a second time while
   an earlier one is still parked. It returns on a new event or on its ~8-minute rearm.
7. **Read what `idle` returned, before anything else happens.** That return **is** the
   arrival notification — it names what is pending and what is still held — so a return
   nobody read is an event nobody works. It is not a log to catch up on later.
8. **Settle every event whose subagent has reported** — one of
   `corpus queue complete evt_7c1d9a`,
   `corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"`, or
   `corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"`
   — and then repeat from step 2.

The order is claim → dispatch → park. You return to `corpus queue idle` **as soon as the
batch is dispatched** — you do not wait for the batch to finish, because a session waiting
on one job is closed to every other, and keeping the queue open is the point. Settlement
happens as subagent reports arrive: each time parking returns, record what has finished,
then claim again.

`corpus queue idle` exits `0` in every normal case. When its ~8-minute window expires with
nothing pending it prints `{"idle":true,"reason":"timeout"}` — that is a normal outcome,
not an error: run the steps again from the top. While the queue is halted it parks the full
window and prints `{"idle":true,"reason":"halted"}` — same response, keep looping. Its only
flag is `--wait <seconds>` (default `480`); there is no other knob and no other exit to
handle.

## Claiming and batching

`corpus queue claim-all` atomically moves everything in `pending/` to `in-progress/` and
prints **one JSON payload** on stdout, in both human and `--json` mode. It carries two
separate lists: `events`, the batch you have just claimed, and `inProgress`, what the
server still thinks you are doing.

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}],"inProgress":{"events":[{"id":"evt_2e4f8b","type":"comment.created","heldSince":"2026-07-28T08:41:17Z","originId":"th_9d2f7a","originTitle":"Q3 planning"}],"total":1,"truncated":false}}
```

Parse `events`, group it by the documents each event touches (Concurrency and ordering
below), and dispatch the whole batch before claiming again — never call `claim-all` in the
middle of dispatching, because a second claim splices new events into an ordering you have
already computed. That is the whole rule: once the batch is dispatched, claiming again
when parking returns is the normal loop, and events claimed then are simply dispatched
behind whatever overlapping work is still running. An **empty `events` array** is not an
error: it means the queue is halted or another consumer claimed first. Reconcile
`inProgress` anyway — it is reported on every claim, empty batch included — and then park
with a separate `corpus queue idle`. An empty batch is the one pass of the loop with
nothing to dispatch, and it is still two commands rather than one: the pass that claims an
empty batch and the pass that claims work are the same procedure, and a shortcut taken on
the empty one is the shortcut that loses the next real event.

**`inProgress` is a different list from the one you just claimed, and never work to do
again.** It is `in-progress/` as it stood *before* this call's moves, so the events of this
batch are never in it: every row is something the server was already holding for you. Each
row names the event's `id` and `type`, the thread or document it came from (`originId`,
`originTitle`), and `heldSince` as an instant you age against your own clock. The list is
capped at the 20 most recently claimed and says so rather than trailing off — `total` is how
many are really held, `truncated` is true when the cap bit, and
`corpus job list --status in-progress` shows the whole set. In human mode that same list is
also printed as a readable block on stderr, ages rendered as `held 3h`; under `--json` the
block is suppressed and the field alone carries it. Nothing is printed at all when nothing
is held, which is the ordinary case. `corpus queue idle` reports the same field on the
returns that carry work.

**Read every row, and take exactly one of two actions on it.** This is the loop's own
check on itself: the way a job gets stuck is almost never a crash, it is you finishing the
work and never making the settling call, and nothing else in the loop shows you the server's
view of it.

- **You already did this work** — the reply is posted, the edits landed, the subagent
  reported, and the only thing missing was the settling call. Settle it now with the
  ordinary verbs and **do not do the work again**: `corpus queue complete evt_2e4f8b`, or
  `corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"` when
  the work itself is what failed. Record it, so the console's story matches:
  `corpus job log evt_2e4f8b "settled late — the reply on th_9d2f7a was already posted"`.
- **You are still working it** — a subagent you dispatched has not reported yet. Leave it
  exactly where it is. The row disappears from the next claim the moment you record that
  subagent's outcome.

**Never settle an event you cannot account for.** Reconciliation is your judgement about
your own work, and it is the only judgement available: the work happened in your context and
nowhere else, which is precisely why the server reports this list and settles nothing on it
by itself. A row you do not recognise — another session's, or residue from a run whose
context is gone — is left where it is. Completing it to make the list shorter tells the
server a job was done that nobody did; if that work is in fact still running somewhere, it
kills that run's accounting silently, and the person waiting on it gets no reply and no
failed row to explain the silence. A list that stays long is a visible problem. A list
tidied by guesswork is an invisible one, and the invisible failure is much the worse of the
two — so shortening the list is never a reason to settle anything.

**You are not the cleanup for sessions that died, either.** The loop's opening
`corpus queue reap-stale` is what returns a stranded event to `pending/` once the staleness
window passes, and it is a **requeue**: an event nobody can account for is done again rather
than dropped. Nothing is lost by leaving an unfamiliar row alone, which is what makes
guessing about it unnecessary as well as harmful.

## Routing

Every routable event is dispatched to a subagent; the row names **which skill that
subagent is given**, never a job you take on yourself. Never guess: an event type with no
row below is failed with a reason and is never silently completed.

| Event type            | Dispatch                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `comment.created`     | A subagent applying the **comment** skill to the thread named in the payload.                 |
| `form.respond`        | A subagent applying the **comment** skill; the payload names the thread, the form's turn, and the answer. |
| `doc.edited`          | A subagent working **Reflecting on a user edit** below — the one event whose procedure lives in this skill instead of in a skill of its own. Its dispatch carries the payload verbatim, both shas included. |
| `agent.done`          | A finished piece of background work. Nothing produces this event today — reports reach you directly (Delegation below) — but an arriving one is handled like a report: verify the work its payload identifies and settle it. |
| `<plugin>.<action>`   | A subagent applying the skill named `<plugin>` — the part before the first dot.               |
| anything else         | `corpus queue fail <id> --reason "unknown event type: <type>"`                                |

Thread handling itself — reading context, honoring mentions, filing inbox captures, wording
the reply, skill genesis — belongs to the comment skill, applied inside the subagent. This
skill routes and dispatches, and owns queue state, ordering, deferral, logging, and the halt
switch.

- **Structured targets.** The payload carries structured `mentions` and `skills` fields,
  parsed by the server at post time. `@<subagent>` (a `type: agent-def` document under
  `.claude/agents/`) is a directive to route the work to that persona; `/<skill>` is a
  directive to apply that skill; the two combine. A missing or archived target is never
  silently ignored: do the work as well as you can and state in the reply that the named
  target was not found. A generic `@agent` names no target — triage it yourself.
- **Plugin skills.** The handler for `<plugin>.<action>` is the skill installed at
  `.claude/skills/<plugin>/`. If no skill of that name is installed, or it sits in
  `.claude/skills-archived/`, fail the event with a reason naming the skill —
  `corpus queue fail evt_2e4f8b --reason "no installed skill named <plugin>"` — so the
  console row says exactly what is missing.
- **Gone context.** If an event's thread or parent document no longer exists (the user
  deleted it), fail with a reason naming the missing id. Never recreate deleted content.
- **A report after resolution.** If the originating thread was resolved while the subagent
  worked, deliver the result in a reply that says the thread was resolved meanwhile —
  finish work that still has value, and never reopen the thread unilaterally.

## Delegation

**Every claimed event is worked by a subagent.** You never work a job inline — not a
one-line answer, not a "quick" edit, no exception for small work: you claim, dispatch,
settle, and park. A session deep inside one job is closed to every other; a dispatcher is
back on the queue the moment the batch is out.

Dispatch through Claude Code's subagent mechanism — the Task (Agent) tool — launched **in
the background**, one subagent per event. A subagent inherits nothing, so its prompt
carries everything: the event id and type, the payload's ids (thread, parent, the
documents named), which skill to apply (the routing row, or the `@<subagent>` persona the
payload directs to), the model you are launching it at, the anchors it should start from, and
the binding rules below. Its
report comes back as the task's final message. You park on `corpus queue idle` — never on a
subagent — and reports are waiting whenever parking returns: on a new event, or on the
~8-minute rearm. On every return, settle what has reported, then claim.
Settlement never depends on any queue event announcing the subagent; the report itself is
the signal.

**A dispatch carries anchors, not documents.** The payload's ids are anchors already; when
the work plainly needs context the payload does not name, retrieve it before dispatching —
`corpus search "<the request's subject>" --limit 5`, or `corpus doc related <id>` from a
document you already hold — and paste the top few lines back verbatim, ids and heading
paths and snippets as they printed. That is the whole context transfer: never paste a
document body into a prompt, never hand over a file, and never ask a subagent to report the
corpus's contents back to you. The subagent reads what it decides it needs —
`corpus doc show <id>` on one of those ids — through the same verbs you used to find them.

**Pick the subagent's model by the task's weight, and judge that weight in two passes —
consequence first, difficulty second.** The question that picks a model is never how hard
the work looks. It is **what a bad result would do that revising the document afterwards
would not undo**.

**First pass — ask that question, and expect it to answer no.** Exactly two things make a
failure that kind:

- The output exists **to be used outside the corpus** — published, sent, handed to someone.
  A bad one there is not quietly corrected, it is rejected: the work is wasted and the thing
  the person wanted does not happen.
- **Someone will decide something real on it** — about a person, about money, about a
  commitment. The harm is carried by the decision rather than by the document, and amending
  the document afterwards does not unmake it.

Neither is the ordinary case, and that is the point. An ordinary reply, an inbox capture
retitled and filed, a reflection on a user's edit, a figure corrected in a note nobody is
waiting on — every one of those answers **no**, and answering no is what makes this pass
worth running. A wrong document that stays in the corpus is noticed, commented on and
revised, which is this system working as designed rather than a reason to reach for a
stronger model. A first pass that fired on everything would change no dispatch at all.

**Where one of the two holds, dispatch the strongest tier however mechanical the work
looks, and stop there — the second pass does not run.** A one-line edit spelled out word
for word, on a document that goes to the lender tomorrow, is not small work: the edit is
trivial and the failure is not, and it is the failure that picks the model. The dispatch
line names `consequence` in so many words, so the console says why a trivial-looking job
went out strong.

**Second pass — difficulty, for everything the first pass answered no to:**

| Weight                  | Key      | Model      | What falls here                                                                                       |
| ----------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| Small and mechanical    | light    | **Haiku**  | The request prescribes the change exactly **and the first pass answered no**: a one-document edit spelled out in the comment, retitle-and-file an inbox capture, a factual reply that needs one read. A prescribed change whose result is going out, or is going to be decided on, is not in this row however exactly it was prescribed. |
| Standard                | standard | **Sonnet** | Most comment work: read a thread and its parent, decide the wording, edit, reply — multi-step but bounded to one or two documents. |
| Heavy or judgment-laden | heavy    | **Opus 5** | Cross-document restructuring, merges and splits, skill genesis or any edit to a skill, ambiguous requests that need judgment — and everything the first pass vetoed, whatever its difficulty. |

Judge that second-pass weight by two things: how many documents the work touches, and
whether the request prescribes the change or asks for a decision. In doubt between two
tiers, take the stronger — a wasted token is cheaper than a wrong edit. That tie-break
governs what **you** pick for yourself, it runs after the first pass rather than beside it,
and it is never licence to move off a weight the request stated.

**That table is the set a request may choose from, so it is read by more than you.** A
composer in the app reads this document and offers these rows as the weights a person can
state, in the order they are written — lightest first — labelled with the **Weight** cell.
Editing the table therefore changes what is offered and what you dispatch at together, and
there is no second list anywhere that could disagree with it. The table is found by its
header cells — `Weight`, `Key`, `Model`, `What falls here`, in that order and spelled that
way, whatever the column padding — and each row below the divider is one level:

- **Weight** is the name a person sees and picks by. Reword it and the composer's wording
  follows on its own; no other file names these levels.
- **Key** is the short token that travels with the request. It is what a stated weight
  arrives as, and rewording a **Weight** leaves it untouched, so a choice made yesterday
  still resolves today. Keep it one lowercase word.
- **Model** is what you launch the subagent at, and **What falls here** is guidance for you.
  Neither reaches a composer.

Nothing outside this table declares a level. A reader that cannot find those header cells,
or a row whose **Weight** or **Key** cell is empty, finds **no levels** — and a composer that
finds no levels offers no control at all rather than a list of its own. That is the correct
outcome rather than a fault: a workspace whose guidance declares nothing has a person who
states nothing, which is the ordinary case below.

**A stated weight is a directive; the two passes govern only what you pick when the request
stated nothing.** A stated weight reaches you as the `weight` field of the claimed event's
payload, carrying one of the **Key** tokens above, and it is **honoured, not weighed again**:
dispatch at that weight rather than at the one you would have picked, and never
quietly substitute another **in either direction** — never quietly weaker, never quietly
stronger, because running stronger than asked spends
against an explicit instruction exactly as running weaker falls short of one.

**The choice travels with the work, not with the turn that received it.** Every event is
delegated, so a stated weight goes into the dispatch prompt in words and governs whatever
actually does the work — and onward through every further delegation that work requires,
including the stages below, whose deciding stage runs at it. Where the payload also names an
`@<subagent>`, both are directives and they compose: that persona runs, at that weight.

**Stating no weight means you decide, exactly as you decide today.** The absence of a
`weight` field is the two passes and never a fixed default: there is no level you fall back
to, and a request that stated nothing is dispatched exactly as every request was before this
table declared a key at all. Absence is the ordinary case, and it is the only spelling of it.

That directive binds even where the first pass disagrees with it. Where a request states a
weight lighter than the first pass calls for, do not override it: the two
conditions above are precisely what makes proceeding expensive to unwind, so **ask first,
with a form**. Post that ask on the waiting thread yourself — asking is not the work, the
same way the one-line reply before a deferral is not — say what the output is going out to
do and what you would otherwise have run it at, log it, and complete the event; the answer
comes back as its own `form.respond` event and the work is dispatched then. An answer of
*proceed anyway* runs it at the stated weight, with no substitution anywhere. **Asking is
not substituting.**

```bash
corpus job log evt_7c1d9a "asked before dispatching — the request states the lightest tier and the revised paragraph goes to the lender tomorrow"
```

**When a stated weight cannot be honoured, the work is still done and the deviation is stated
twice.** Three things cause that: the installed agent offers no such model, the setup refuses
it, or the key names a level this table no longer declares. None of the three is a reason to
drop the work or to fail the event. Dispatch at what the two passes judge best, and state the
deviation **in the job's log while it runs** and **in the reply the request receives** — both
naming the same three things: what was asked for, that it could not be met, and what ran
instead. The log is reaped with its event, so the reply is the durable half: the dispatch
prompt carries the deviation in words, and the subagent states it in the reply it posts, as
plainly as "you asked for the lightest tier, this workspace no longer declares it, so I ran
this at Standard". Silence there would be this workspace claiming work it did not do.
Progress and job logs below gives the dispatch line for this case.

**Your own judgment survives as speech, never as substitution.** Where the work proves to
need more than was asked for, do it at the stated weight and say so in the reply — name what
you would have run it at and what you think that cost, and leave the decision with the
person. The one case that is not speech is the one above: where proceeding at the stated
weight would be expensive to unwind, ask before dispatching rather than explain afterwards.
Disagreeing in a reply is honest; disagreeing by dispatching something else is not, because
nothing in the console and nothing on the turn would show that it happened.

**One request may be worked in stages, and the stages need not run at the same weight.**
Collecting the material is one stage — retrieved text, a listing, a mechanical
transformation, a small script and what it printed — and judging that material and drawing
the conclusion is another. A stage whose output is **material** may run lighter than the
request calls for. A stage that **decides** may not: a conclusion, a recommendation, the
wording of a reply, an edit to a document. Those are the work the request asked for, they
carry the consequence the first pass measured, and they run at the **governing weight** —
the stated one where a weight was stated, the judged one otherwise.

The line is drawn at what a stage **outputs**, and it is drawn there deliberately: anything
can be described as preparation, and a dispatcher optimising for cost will describe more
and more of the work that way until the conclusion itself is "just summarising what the
collector found". Where a stage's output is what the person will read, act on, or find in a
document, that stage decides.

**Splitting is always permitted and never required.** There is no threshold above which you
split: a split introduces a handoff, handoffs lose things, and for entangled work one
strong pass beats two stages with a summary between them. What is obligatory is everything
around a split once you make one — which stage carries the weight, what each stage is
handed, a dispatch line per stage in the job log, and that one request stays **one piece of
work with one status and one reply**, whatever it took internally. Splitting is never a
route around a stated weight either: the deciding stage runs neither lighter nor stronger
than the request asked for.

**The anchors rule above holds between the stages of one piece of work too.** A stage
receives what the previous stage **produced** — the gathered material, the numbers, the
script's output, the answer — and never the account of how it was produced: not the
transcript, not the false starts, not the searches that came back empty, not the reasoning
that got there. Brief every stage as though it were the first. This is a **quality** rule
before it is a saving: a stage that has to judge does so better on a short relevant input
than on a long one carrying everything an earlier stage happened to look at, so isolating
the stages is expected to hold or improve the answer while costing less — which is what
makes a split worth making rather than merely tolerable. Where the two pull apart, quality
decides: material a later stage genuinely needs is passed on, and a stage that would
otherwise have to guess is briefed further rather than left short.

**Every invariant binds inside the subagent**, and the dispatch prompt states them rather
than assuming them:

- Every mutation goes through the `corpus` CLI — never hand-edit `data/`, `.corpus/`, or
  `.claude/`, never call the HTTP API directly.
- `export CORPUS_FROM=agent` before the first mutation and `--from agent` on mutating
  commands — a subagent inherits no environment, and a change attributed to the wrong
  party is a corrupted audit trail.
- Retrieval discipline binds inside the subagent exactly as it binds you: it locates with
  `corpus search` and `corpus doc related`, opens a body only with `corpus doc show` on an
  id one of them returned, and never lists or sweeps the corpus. It works from the anchors
  the dispatch gave it and is never handed — and never asks for — a corpus dump.
- A write presents the key its read gave it, exactly as *Writing a document* prescribes: the
  read before a rewrite is where the key comes from, a write that lands prints the next one,
  and a stale-key refusal (exit `9`) is **the subagent's own to handle** — re-read what the
  refusal printed, reconcile, write again. That is not a block and is never reported as one.
  What **is** reported back is a person with an edit session open on the document: the
  subagent leaves that document alone and says so, and you defer the event.
- Progress lines go to **the dispatching event's job** — `corpus job log <eventId>
  "<line>"` with the same event id you dispatched — so the console watches delegated work
  exactly as it would watch you. Same discipline: name the object and the change.
- A reply whose work changed documents closes with the `↳ ` trace line; the comment skill
  states the grammar.
- **Every turn it posts names the model that wrote it** — `--model <name>` on
  `corpus thread reply` and on `corpus thread create`, naming what actually ran. That is why
  the dispatch states the model you launched it at: the subagent has the name in hand and
  states the one it is running as, and where the two differ the one that ran goes on the turn
  and the difference goes in this event's job log. It is a **record of what ran, never a
  request for what should run** — a weight the request stated is a directive you honour rather
  than weigh again, and this turn is the evidence that you did, which it cannot be if it merely
  repeats what was asked for. Where the work ran in stages, the turn names the **deciding**
  stage — the one that drew the conclusion or wrote the words — one model and never a list;
  the gathering stages stay in the job log. Where nothing knows what ran, the flag is left out
  and the turn shows nothing rather than a guess. The comment skill states the grammar, and it
  governs every turn you post yourself exactly as it governs a subagent's.
- Anything a reply hands over for reuse elsewhere — a prepared prompt, a command line, a
  config snippet — sits alone in a fenced block whose info string labels it (`prompt`,
  `command`), one deliverable per fence, prose outside it: the board renders that fence as a
  **copyable canvas** titled by the label. The comment skill states the convention; it binds
  the turns you post yourself just as it binds a subagent's.
- **A fence closes only on a line that is nothing but backticks**, and both halves of that
  follow from it. **Wider than anything inside** — longest backtick run in the payload, plus
  one: a three-backtick fence closes at the payload's own three backticks, and the deliverable
  arrives as several canvases with prose leaking between them. **Closed on a line of its own** —
  a run left at the end of the payload's last content line closes nothing, so the fence stays
  open to the end of the turn, and a turn heading inside a fence is not a delimiter: every
  later heading is swallowed, and the next person's reply disappears into the body of yours
  with no error anywhere. This is not a corner case for you: the payload you hand over most
  often is a **prompt written for a subagent**, which is markdown and usually contains fenced
  examples of its own. Check the payload before you write the fence and the newline before you
  close it, every time. The comment skill carries both halves and an example; a subagent that
  never read it will get this wrong, so it belongs in what you brief them with.

**Queue state never crosses the boundary.** A subagent never runs `corpus queue
claim-all`, `corpus queue complete`, `corpus queue fail`, or `corpus queue defer`: it
**reports** an outcome, and you **record** it. Three paths, none of which loses a job:

- **Reported success** — verify what the report claims (the reply exists, the named
  changes landed), then `corpus queue complete`.
- **Reported failure** — `corpus queue fail` with **the subagent's reason**, never a
  generic one; if the subagent did not reply to the waiting thread, post the one-line
  reply first.
- **No report** — the subagent died mid-job. Its event stays `in-progress`, and the
  loop's opening `corpus queue reap-stale` returns it to `pending` after the staleness
  window. Nothing to do in the moment; nothing lost.

**A subagent that stands aside defers — through you.** A subagent that finds a person editing
the document it was about to write reports that with the document id and stops. Confirm the
waiting thread got its one-line reply (the comment skill has the subagent post it; post it
yourself if it is missing), then defer exactly as *Writing a document* prescribes — never
`corpus queue fail` for it, and never a loop of re-reads against somebody still typing. A
stale-key refusal is a different thing and never reaches you: the subagent re-reads and
writes again on its own, and reports the finished work.

## Writing a document

**Two ways to change a body, and the choice is not a matter of taste: a change you can quote
is a patch; a change you cannot quote is a whole-body edit.** If you can point at the text
that is wrong — a figure, a sentence, a paragraph that should go — then say so: quote it, give
what belongs in its place, and `corpus doc patch` writes exactly that and nothing else. If
there is nothing to point at because the document is being restructured, its argument
rewritten, two sections folded into one, then the change *is* the body and it goes back whole
through `corpus doc edit`. Several separate corrections in one pass are a rewrite by volume:
send the body once rather than quoting your way across the document.

Getting that choice wrong costs something in both directions, which is why it is worth asking
before you start rather than after. Rewriting a document to correct one line pays the length
of the document for that line and puts every other line in your hands, where a bad paste can
lose them. Patching what should have been a rewrite is the opposite failure: one change
becomes a pile of little ones, each its own quote-and-replace, with the document sitting half
migrated between them and a commit for every step.

**Patching: quote it, replace it.** Read the document, quote a line of it back exactly, say
what it should say instead. One command, nothing sent but the change.

```bash
corpus doc show doc_a1b2c3
- 30-year fixed at 6.1%.
corpus doc patch doc_a1b2c3 --from agent --old '30-year fixed at 6.1%.' --new '30-year fixed at 5.8%.'
patched doc_a1b2c3 — 1 occurrence replaced
key 655ce64894a6835ddc50fee95928ab1482f30394739a6a7d9c2b369b96af1cc0
```

**`--old` is matched byte for byte against the body as it is stored** — no trimming, no
normalisation, no case folding, no patterns. Quote it exactly as `corpus doc show` printed it:
whitespace, indentation and line breaks all count, and single quotes span lines in the shell,
so a multi-line excerpt is still one command. The **body** is the markdown alone — the
frontmatter block is not part of it, so an excerpt quoting a frontmatter field matches nothing
and those fields are changed by naming them on `corpus doc edit` instead. `--new ''` is how a
deletion is spelled, and quoting the line breaks around a passage takes its blank line with it
rather than leaving a hole; an omitted `--new` is a usage error, not a deletion, and nothing
is sent.

**A patch presents no key, and that is a consequence rather than an omission.** It names the
text it expects to find, which is the same staleness check by another route — and, *for the
text it replaces*, the more useful one, because it tells you which text has gone rather than
merely that the document moved. Read the scope of that check literally: it covers what you
quoted and nothing else. The excerpt says the passage you are replacing is still the passage
you read; it says nothing about what has grown up around it since. There is no `--key` flag on
this verb and passing one is a usage error. Everything else about a patch is an ordinary
write: it is validated before it lands, anchors are reconciled and reported on the same line,
one commit is made under `--from`, and a fresh key comes back for whatever you do next.

**A patch replaces; it does not insert — and an append is an insertion.** You can spell one
anyway, by quoting text and handing it back with your addition attached, and it will work. Its
check is on the wrong thing: your quote proves the text you quoted is unchanged, and what
would make you wrong is somebody else's insertion at the same place, which leaves that text
exactly as it was. So decide by what sits on either side of where you are inserting. Between
two things, **quote across the gap** — the tail of what comes before and the head of what
comes after, as one excerpt — and any other insertion there breaks the quote and is refused.
At the **end of the body** there is nothing on the far side to quote and so nothing to refuse:
another writer's paragraph can land between your read and your write, your patch splices yours
above theirs, and the confirmation says one occurrence replaced. That one goes back whole
under a key, which is the only check that covers text you did not name.

**Two refusals, exit `10` both, nothing written — and their recoveries are opposites.** The
message names the count, so branch on it rather than guessing.

- **Matched 0 times: the text is not there.** Either the document is not what you last read,
  or you quoted from memory instead of from a read. **Re-read it** — `corpus doc show <id>` —
  and quote what it says now. Do not resend the same excerpt, and do not go hunting for the
  normalisation that would have made it match; there is none. This refusal is the staleness
  check doing its work, so answer it the way you answer a stale key: read, reconcile, write
  again.
- **Matched more than once: the excerpt is ambiguous.** The text is there N times and nothing
  will choose between them for you. **Quote more** of what surrounds it until it occurs
  exactly once — the line above is usually enough, the heading above that always is. `--all`
  replaces every occurrence and is right only when every occurrence is genuinely what you
  meant; never reach for it to make a refusal go away, because it rewrites text you never
  looked at.

Exit `9` from a patch is a third thing and a rare one: a stale key here means something
**outside** Corpus wrote the file between the match and the save. Nothing you quoted was
wrong. Read the document again and reissue the same patch.

**When the shell is the problem** there are three more flags, and they are escape hatches
rather than the normal form: `--old-file` and `--new-file` read each side from a file byte for
byte, and `--stdin` takes the whole request as one JSON object and therefore takes no other
patch flag. A file and a heredoc both end in a newline, and a newline is text like any other —
an excerpt that should obviously match and reports 0 matches is usually one trailing newline
long.

**The whole-body edit, and the key that protects it.** When there is nothing to quote, the
write replaces the body, and then: **read → work → write with the key you were given → keep
the key the write returned.** That is the whole discipline, and every step of it is something
you were doing anyway. Reading a
document prints its **key**; a write that replaces the body presents that key; the write
prints a fresh key on the line after its confirmation, which is the key the next edit
presents. There is nothing to acquire, nothing to release, and nothing left behind if you
stop halfway.

```bash
corpus doc show doc_a1b2c3
Mortgage options
doc_a1b2c3 · note · open
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'EOF'
The revised body, in full.
EOF
edited doc_a1b2c3
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
```

The key names the version you read, so presenting it says *this edit is written against what
I saw* — and a key the document has moved past is exactly the statement *I am about to
overwrite something I never read*. That is why the write is refused rather than landed.
Because every write hands back the next key, **a chain of edits costs one read at the
start**, not a read between every pair: carry the printed key forward and keep going. Read
the key as opaque and echo it back exactly — never shorten it, never build one, never reuse
one across two different documents.

**What needs a key, and what never will.** A write that replaces a block needs one, because
it says nothing about what it changes and is the write that can destroy silently: the body
(`-m`, `--file`, a heredoc) and a wholesale frontmatter rewrite.
A write that **names its own delta** needs none, and never will: `--add-tag`, `--remove-tag`,
`--title`, `--status`, `--reviewed`, `--pinned`, `--order`, `--query`, `--extra`, along with
`corpus doc move`, `corpus doc archive`, `corpus doc unarchive`, `corpus thread reply` and
`corpus thread resolve`. Each of those says what it changes, so it merges with whatever else
happened rather than overwriting it. A key is still accepted and still checked on them, which
is worth passing on the rare edit you would rather have refused than merged. And a patch needs
none for the third reason above: it names the text it expects to find, which is that check by
another route.

**Two refusals on a keyed write, and only the first is a mistake.**

- **Exit `2` — no key, or a malformed one.** You asked to replace a body without saying which
  version you were replacing. The CLI refuses before it sends anything, so nothing reached
  the server: read the document and write again with the key it prints.
- **Exit `9` — the key is stale.** The document changed after the read that handed you that
  key. **Nothing was written, and the text you tried to save is still yours to resend.** The
  refusal prints the document as it now stands *and* its fresh key, so no second read is
  needed. Do three things with it, in order: read what changed, reconcile that against what
  you meant to write — your edit applied to the current text, not the text you read — and run
  the same command again with the fresh key. **That retry is the mechanism working**, not a
  failure to report and not a reason to give up on the edit.

Reconcile; never resend unchanged. The text that came back is somebody's edit, and a body
that ignores it erases it just as surely as the write the refusal prevented. The refusal
exists so that you get to decide, and deciding means reading what it printed.

**Putting an older version back is this same loop.** There is no revert command and there is
none to look for: **a revert is a write whose content came from history**, so it goes down
the path every other write goes down — anchors reconciled, frontmatter validated, committed
under you, and refused rather than landed when what it would write over has moved. Three
steps, and only the last one writes.

1. **Read the history.** `corpus doc diff <id>` prints the document's path and its last
   committed change, and for a small change that diff already carries the old text. To go
   further back, read git directly: `git log --oneline -- <path>` lists the revisions that
   touched that one file, `git show <sha>:<path>` prints the file as of one of them.
2. **Work out the content you want back.** Rarely the whole old file: the version you are
   going back to predates everything that happened since, some of which should stay. Decide
   what the body should now say, exactly as you would for any other edit.
3. **Write it**, and the same choice decides how. A passage you can quote goes back as a
   **patch**: `--old` the text standing there now, `--new` the text you are restoring. Only a
   document that changed wholesale needs a read for its key and the whole body back through
   `corpus doc edit`.

```bash
corpus doc diff doc_a1b2c3
git log --oneline -- data/docs/finance/mortgage-options.md
git show 8509044:data/docs/finance/mortgage-options.md
corpus doc patch doc_a1b2c3 --from agent --old 'Rates are refreshed weekly, and' --new 'The rate sheet is republished every Monday, and'  # one passage back
patched doc_a1b2c3 — 1 occurrence replaced
corpus doc show doc_a1b2c3  # or, when the whole shape has to go back: a read for the key
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'EOF'
The body as it read before the change you are undoing.
EOF
```

**Read from git, never write to it.** `git log`, `git show` and `git diff` are reads, and
you are good at them. `git checkout`, `git restore`, `git revert`, `git add` and `git commit`
are writes into the workspace behind the server's back, and the server is the sole writer —
every change you make goes through the CLI, this one included.

**What git hands you is the whole file; what the write takes is the body.** Everything down
to and including the closing `---` is frontmatter the server owns — the id, the timestamps,
the tags, the `anchors` map — so pasting the file in as a body writes that frontmatter into
the document a second time, as text. Send only what follows it.

**A bounded revert is a patch, and a patch cannot make that mistake.** Undoing one paragraph
is exactly what the verb is for: quote what the document says now, give what it used to say,
and only those bytes move. There is no whole file in your hands to paste by accident, because
a patch matches body text and writes body text — the frontmatter git handed you is not part of
what either half can touch. Keep the whole-body edit for a revert that puts back the shape of
a document rather than a passage of it.

**The key is what makes a revert safe**, and it is the whole difference between this and a
command that puts an old file back. The content came from history, but the write still
presents the key of the version you *just read* — so a revert that would clobber a change
made since that read is refused with exit `9` and the current text in front of you, instead
of landing on top of it. The age of the content is never the question; what happened after
your read is. A patched revert is guarded the same way by the excerpt it quotes: a passage
somebody has since rewritten is not there to match any more, so the refusal comes back with
the count rather than the old words landing on top of theirs. Reverting is a change like any
other, so say so in the reply: name the document, what you put back, and what it said before.

The same loop puts back a skill you edited badly — a skill is a document (below). It works
as long as the loop is still running. When the loop itself is what broke, nobody is there to
run this, and the way back is the operator's: see *If the loop breaks*.

**Someone is editing this — a courtesy, with a named response.** A read also says when a
person has an edit session open on the document:

```
someone is editing this — a person has an edit session open on doc_a1b2c3 right now.
```

Nothing is refused for it and a write would land. It is information, not a gate, and what it
asks for is politeness rather than obedience: a document somebody is typing in is about to
change, so a write beside them answers a version that is already going, and it arrives under
their cursor while they are mid-sentence. Prefer to leave the document alone and come back —
and where the work is a claimed event, coming back has a name: **defer it**, in this order.

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
You're editing [[doc_a1b2c3]] right now, so I've left it alone. The change is
ready and lands on its own once you're done in there.
EOF
# nothing changed, so that reply carries no trace line
corpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"
```

Reply first — a person is watching a pending indicator — then defer. When the subagent found
the session, the sequence is unchanged: it has normally posted that reply already and
reported what it saw; you make the defer call. A deferral is a postponement, not a failure:
the event moves to `deferred/`, `corpus queue status` counts it under `deferred`, never
`failed`, and the console shows it waiting rather than broken. Say it that way in the reply
too — you stood aside, you were not stopped, and telling a person their editing blocked you
is both untrue and an invitation to close a document they are still using.

`--blocked-on` is required, and it is load-bearing: it names the **document being edited** —
never the thread — because that session ending on exactly that document is what returns the
event to `pending`. Name the wrong document and the event parks forever, waiting on a session
nobody is in. The right value is always the id of the document you stood aside from.

Re-entry is automatic. When the editing session on the blocked-on document **ends**, the
server returns the event to `pending` by itself and a parked `corpus queue idle` unparks — no
operator action, no retry, nothing for you to watch. `corpus job retry` remains only as the
by-hand override for a deferral automatic re-entry did not reach: a session that ended out of
band, or a deferral that named the wrong document.

Deferring is a judgement, so it has an edge. A trivial delta on a document somebody is
reworking — a tag, a status, an archive — merges and is fine to land; a body rewrite is what
the courtesy is about. And where there is no claimed event to defer, there is nothing to
park: finish the rest of the work, leave that one document, and say in the reply what is
waiting on it.

## Reflecting on a user edit

`doc.edited` says a person finished an editing session on a document. It carries the
document id, an opaque `sessionId`, the commit range (`from`, `to`) and three numbers
(`commits`, `insertions`, `deletions`) — and never the diff itself. Reflecting on it is
three decisions taken in order: what changed, whether it ripples into other documents, and
what to say. The whole procedure runs inside the dispatched subagent, weighed by the two
passes in Delegation like any other work and by no rule of its own: reflecting answers the
first pass **no** — what it produces is a changelog entry in this corpus, read, commented on
and revised like the rest of the body — so the weight comes from the second pass, which puts
a one-document reflection at the **Sonnet** tier and raises it to **Opus 5** where step 4 is
going to write another document. The dispatch prompt carries the payload verbatim, the two
shas above all, because they are passed straight back.

**Your own edits never wake you.** The payload's actor is always `user`: the server emits
nothing for an agent-authored write, and a payload claiming otherwise is dropped before it
reaches you.

**But an agent turn can still wake the loop, so this needs care rather than confidence.**
The server checks the turn's *body* before it checks the author: a turn mentioning `@agent`
enqueues whoever wrote it. So the rule is two things, not one — post **no `--requests-agent`
and no `@agent` in the body**, in every turn you write here. That matters most where you are
least thinking about it: a ripple comment or an acknowledgment that **quotes a user's line**
carries whatever that line said, and a quoted `@agent` wakes the loop exactly as a written
one does. Quote the passage you mean, and drop the mention if it carries one.

Get those two right and nothing here feeds itself. The one other thing to drop is a repeat:
at most one event exists per `sessionId`, so a second carrying an id you already handled is
completed without acting on it.

**1 — Read the change, always, exactly once.** The event's `from` and `to` go in as
`--from-rev` and `--to-rev` unchanged — no conversion, no resolution, including the
empty-tree sha carried by a document the repository's first commit introduced:

```bash
corpus doc diff doc_a1b2c3 --from-rev 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b --to-rev 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
doc_a1b2c3 · data/docs/finance/mortgage-options.md
0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b..9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
1 commit · +2 -2 · 268 characters
```

The stats do not decide whether to make that call, and this is the one place where the
cheap move is the wrong one: they cannot tell a one-word correction from a one-word
reversal, because `will` becomes `will not` at `+1 -1` exactly like a misspelling does.
What they are for is sizing the read — a change far past the 16000-character bound comes
back cut, and the numbers say so before you spend the call — and giving you the honest
figure to quote when it does. The read is bounded, so it costs about the same whatever the
person wrote.

**2 — Decide triviality from the diff, never from its size.** Read the `-` lines and the
`+` lines as claims and ask one question: does the document assert anything different now?
An edit is **trivial** when every changed line says what it said before — spelling,
punctuation, casing, whitespace, rewrapping, markdown formatting, an ordering that preserves
meaning. It is **substantive** when any changed line adds, removes or reverses a claim: a
number, a date, a name, a status, a negation, a modal (`must` against `may`, `will` against
`will not`), a `[[ref]]`, a heading that renames a section, or prose that is simply new.

Length is never the test. One word is substantive when the word is a negation, a quantity, a
name or a modal; two hundred reflowed lines are trivial. Where the diff leaves you unable to
tell, call it substantive and let the ripple check come back empty — a check that finds
nothing costs two retrievals, while a thread about a whitespace fix is the behaviour that
gets the loop switched off by lunchtime.

**A trivial edit is completed in silence** — no thread, no reply, no write. One job-log line
is the whole record, so the console still shows that the event was seen and judged:

```bash
corpus job log evt_7c1d9a "doc.edited on [[doc_a1b2c3]] — rewrapped a paragraph, no claim changed"
corpus queue complete evt_7c1d9a
```

**3 — Check the ripple by retrieving.** A substantive edit gets two bounded lookups and no
more. `corpus doc related doc_a1b2c3 --limit 5` walks the documents already linked to this
one, and one `corpus search` per changed claim — at most three claims — finds the ones that
are not. Search on what the `-` and `+` lines disagree about, the old value or the name or
the decision phrase, never on the document's own title, which returns the document you are
already holding. `--references doc_a1b2c3` narrows a search to the documents that point back
at it. Both verbs print ids, heading paths and snippets; open a body with
`corpus doc show <id>` only where a snippet restates the old claim, and open at most three.

**4 — Update, log, or ask, and lean to logging.** Three outcomes, and only the third one is a
thread. **Update** another document when the correction is mechanical and entailed — the same
fact, stated the same way, now wrong, with exactly one way to write the new one: the rate this
document quotes is the rate the person just corrected. **Log** when the ripple is real and you
have no question about it — a conclusion drawn from the old fact, a passage that now reads
oddly, anything you would once have raised in a comment. It becomes an entry in that
document's changelog, saying what changed upstream and what it means here, and it opens
nothing. Log rather than update whenever the diff came back cut. **Ask** only when you cannot
act without a decision from the person: a rewrite that takes a decision, a ripple that could
go two ways with nothing in the corpus to pick between them. That is one thread on the
document the decision is about —
`corpus thread create --parent doc_7e3a91 --from agent --model <name> --quote "<the passage that is now wrong>"`
when you can quote the span exactly, because that is what makes it findable, and the same
command without `--quote` when the passage is not one span — and it asks with a **form**: a
fenced block whose info string is
`form`, last in the turn body, one field per question, asked once. The comment skill's
**Forms** section is the whole grammar and binds here unchanged. Stop at three documents: past
that, name what looks affected in the entry on the edited document instead of spraying entries
and threads, and let the person point at the ones that matter.

**5 — Write the entry, and open no thread.** Every substantive edit ends in exactly one entry,
appended to the changelog at the end of the edited document's own body. **Noticing is written
down, not asked about.** A thread means _I need something from you_; a changelog entry means
_I noticed_. Every observation this reflection produced is an entry — the routine ones and the
ones that look worrying, on the same terms. An observation that troubles you and carries no
question is still an entry and nothing more; the moment it carries a question you cannot
proceed without, that is step 4's ask, on one thread, with a form, about that question alone.
One entry per session, never a second. A trivial edit gets none of this.

Why the document rather than a thread: an open thread is this corpus's one signal that
something is waiting on the person, and an acknowledgment nobody needs to answer spends that
signal until the threads that do want an answer are buried among the ones that do not. The
entry instead lives where the change lives, is read by whoever next opens the document, and is
ordinary body text — commentable, anchorable, searchable, and the person's to edit exactly
like the rest of the body. **The changelog is yours to maintain and theirs to edit; neither of
you owns it.** Somebody remarking on an entry is an ordinary anchored comment and needs
nothing special from you. The cost is accepted rather than hidden: an observation nobody reads
is an observation nobody sees, and that trade was made deliberately against a corpus of
threads nobody needed to answer.

**Say what you made of it, not what the diff said.** Git holds every diff already, so an entry
that only restates one is worth less than the room it takes. Name the claim that changed, then
what it means for the corpus: what you checked, what you found, what you changed elsewhere,
what you deliberately left alone. A date and two sentences is the size of it. The entry is
body text rather than a turn, so it carries no trace arrow.

**Append; never rewrite the section.** There is no append verb — `corpus doc edit` replaces
the body — so it is `corpus doc show doc_a1b2c3` for the body as it now stands **and for its
key**, then one `corpus doc edit doc_a1b2c3 --key <the key that read printed> --from agent`
sending that body back with the new entry after the last one, every other byte reproduced
exactly. **This is the bounded change that does not go back as a patch**, and the reason is
the one *Writing a document* gives: this section is the last thing in the body, so the append
has nothing on its far side to quote. A patch quoting the tail of the last entry applies
perfectly well to a document somebody appended to while you were reading it, splicing your
entry above theirs and reporting success — because what the excerpt checks is that the entry
you quoted is unchanged, and what has to be true here is that it is still the **last** one.
The key is the check that covers the text you did not name: it makes the append safe rather
than hopeful, refusing a body that never saw the move instead of writing over it.

The person writes in this section too:
re-wording, re-ordering, re-dating, merging or condensing an existing entry is how their
writing disappears — and every thread anchored into an entry you rewrote comes loose, which
the edit reports as an orphan after the fact rather than refusing beforehand. No reason for
rewriting is a good one, and sending the body back is not a licence to tidy it on the way
through: every byte above your entry goes back exactly as the read printed it, the person's
wording included. Entries run oldest first, so the
newest goes last and the append disturbs nothing above it. Where the section is absent the
first entry creates it, as the last thing in the body — a blank line, the heading, a blank
line, the entry. That heading is spelled `## Changelog` and nothing else —
a second spelling is a second section, and the reader's clip finds neither.

**The word to read in the anchor report is `orphaned`.** Appending at the end moves no
earlier offset, so nothing above the section shifts and an honest append orphans nothing. An
orphan after one means what you sent was not what you read: go back to `corpus doc show` and
redo the append from what the document actually says. A **remap** is a different thing and
not a warning — the first entry introduces the section directly under whatever text used to
end the body, so the anchor sitting on that text has its trailing context rewritten and is
reported as remapped while staying exactly where it was. Later appends land past the section
and report nothing at all.

**This write replaces the body, so it presents a key — where a thread post would have needed
none.** The read one paragraph above is where that key comes from, and two things can have
happened since. The document moved — somebody appended their own entry, or changed a line
anywhere else in the body: the write is refused at exit `9` carrying the current text and a
fresh key, nothing is written, and you append your entry to *that* body and write again. The
session you are reflecting on is over, so what moved is somebody else's change and your entry
belongs after it either way. Or the person's editor is open again: leave the document alone and
defer with `--blocked-on` naming it, and the entry lands when the event comes back. Never drop
the entry because the document was busy.

**Length is never a reason to prune.** Past a threshold the reader clips the section and says
how many entries sit behind the control, and expanding shows them whole; the entries
themselves stay. You never delete one, never fold two into one, and never start the section
over — the same rule that has you archive rather than delete everywhere else.

**A cut diff is never reasoned about as if it were whole.** The size slot on the counts line
says which case you are in — `268 characters` when whole, `showing 16000 of 61200 characters`
when cut — and a `#` notice repeats it under the body. When it is cut: say so in the entry,
in the numbers the counts line printed; never update another document off it,
because the correction may sit in the part you did not see; and when the session was more
than one commit, `corpus doc diff doc_a1b2c3` with no range reads its newest commit whole,
which is a smaller change you can see all of. `corpus doc show doc_a1b2c3` gives the document
as it now stands whenever the ripple check needs the current text rather than the change.

**Worked, end to end.** The person edited a mortgage note; the reflection finds one document
that copied the old figure and fixes it.

```bash
corpus job log evt_7c1d9a "claimed doc.edited on [[doc_a1b2c3]] (1 commit, +2 -2, ended by idle)"
corpus doc diff doc_a1b2c3 --from-rev 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b --to-rev 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
doc_a1b2c3 · data/docs/finance/mortgage-options.md
0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b..9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
1 commit · +2 -2 · 268 characters

@@ -3,7 +3,7 @@
-The working rate assumption is 6.1% as of 2026-05-02.
+The working rate assumption is 6.4% as of 2026-07-28.
```

A number changed, so it is substantive; the claim that changed is the rate assumption, so
that is what the two lookups ask about:

```bash
corpus doc related doc_a1b2c3 --limit 5
doc_7e3a91  linked  Refinance plan — every projection here assumes 6.1% for the whole term
corpus search "rate assumption 6.1%" --limit 5
doc_7e3a91  Refinance plan › Costs  …every projection here assumes 6.1% for the whole term…
corpus doc show doc_7e3a91
key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa
```

One document, one figure, one way to write the new one — mechanical and entailed, so it is
an update rather than a question. That last read is the one the write is written against, so
its key goes straight into the edit. The update carries its own entry, because with no thread
opened anywhere nothing else would tell a reader of that document why its figure moved:

```bash
corpus doc edit doc_7e3a91 --key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa --from agent <<'EOF'
# Refinance plan

Every projection here assumes 6.4% for the whole term, following the rate
assumption in [[doc_a1b2c3]].

## Changelog

- **2026-07-28** — carried the working rate assumption from 6.1% to 6.4%, following the
  correction in [[doc_a1b2c3]]. Every projection here reads that one figure, so the change
  is arithmetic and takes no decision.
EOF
edited doc_7e3a91
key 401056da72e89508679079c53bb06a0f4db1601033ed1d3139545d83119f7895
corpus job log evt_7c1d9a "edited [[doc_7e3a91]] — carried the 6.4% rate assumption across"
```

That write replaced a whole body — one figure changed and the section it now carries did not
exist — so it presented a key, and it printed a fresh one, which is what any further edit to
`doc_7e3a91` would present with no second read. The entry on the edited document itself is a
different document, so it takes its own read, and it is an append at the end of a body: the
key rather than a quote, the July 14th entry passed back through untouched.

```bash
corpus doc show doc_a1b2c3
key 028ee5455198acebc06757dee3a14c12d0009a271ebf5131fc33c7e2c4778d70
corpus doc edit doc_a1b2c3 --key 028ee5455198acebc06757dee3a14c12d0009a271ebf5131fc33c7e2c4778d70 --from agent <<'EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28.

## Changelog

- **2026-07-14** — replaced last year's lender table with this year's. Nothing else in the
  corpus quoted those figures.
- **2026-07-28** — the working rate assumption moved from 6.1% to 6.4%. [[doc_7e3a91]]
  projected the whole term at the old figure and I carried the new one across; nothing else
  quotes it, and nothing here needs a decision from you.
EOF
edited doc_a1b2c3
key 5c0f2a7d18e6b4930c1d8f27a6b5430e9f8c72d1a04b6e35f9c2807d61a34be8
corpus job log evt_7c1d9a "completed — logged the change on [[doc_a1b2c3]], no thread opened"
corpus queue complete evt_7c1d9a
```

## Concurrency and ordering

Compute, for every event in the batch, the set of documents its work touches:

- `comment.created` / `form.respond`: the thread id **and** the thread's `parent` document id.
- `doc.edited`: the payload's `docId`. Its reflection may go on to write documents no payload
  names, so it is dispatched after any overlapping thread work in the batch rather than
  beside it.
- `<plugin>.<action>`: every document id in the payload.
- `agent.done`: the documents of the work it reports.
- An event whose touched set you cannot compute from its payload touches everything: run it
  serially, after the rest of the batch.

Two events **overlap** when their work would touch the same document(s) — or when their
touched sets otherwise conflict: a folder one event reorganizes while another files into
it, a skill one event edits while another applies it, anything where one event's work
changes what the other reads. Overlapping events run **serially, in dispatch order** —
and within a batch, dispatch order is the order `claim-all` printed the events, which is
the order they were created; never reorder an overlapping pair. The later event is
dispatched only after the earlier one's outcome is recorded, because the second must see
the first's effects — the person who commented second was looking at a corpus where the
first comment had already been acted on, and answering them against state that no longer
exists is worse than answering late. The rule spans batches: a newly claimed event that overlaps
a still-running subagent's work waits for that subagent's outcome, not merely for a free
slot.

Non-overlapping events run concurrently, one subagent each, bounded to at most **10**
concurrent subagents; further events wait their turn in dispatch order. That 10 is **this
workspace agent's** bound, set by the product's contract — it is unrelated to any
concurrency limit the operator's own tooling enforces elsewhere, and neither number
constrains the other.

## Progress and job logs

Every event is a job whose log the console tails live. Append lines with
`corpus job log <eventId> "<line>"` — the command has no flags; the line is the positional
argument (or piped stdin). Log at these moments, and only these:

- **claimed** — `corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"`
- **dispatched** — which skill's subagent took it, the tier it went out at, and **where that
  tier came from**: `judged, difficulty` for the second pass, `judged, consequence` for the
  first, `stated by the request` where the request chose, and `stated by the request … not
  honoured` where it chose something you could not give it. Four shapes, one grammar:
  `corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — judged, difficulty: one document, prescribed change)"`,
  `corpus job log evt_4f8a2b "dispatched to a comment-skill subagent (Opus 5 — judged, consequence: the revised paragraph goes to the lender tomorrow)"`,
  `corpus job log evt_9c3b1d "dispatched to a comment-skill subagent (Haiku — stated by the request)"`,
  `corpus job log evt_2e4f8b "dispatched to a comment-skill subagent (Sonnet — stated by the request as heavy, not honoured: this workspace declares no such level, so the tier is judged, difficulty)"`.
  The fourth names the ask, that it went unmet, and what ran instead — the three things the
  reply carries too, because the log is reaped and the reply is not. It is also the one shape
  a reader can check rather than take on trust: the server has already written
  `weight stated by the request: <key>` onto this same log, before any line of yours, so what
  was asked and what you dispatched sit side by side and a claim of honouring is verifiable.
  Difficulty and consequence are named apart because they answer different questions for the
  operator: a large in-corpus restructure nobody is waiting on went out strong on difficulty,
  while a one-line edit to a document about to go out went out strong on consequence. A line
  that said only "Opus 5" would leave those two indistinguishable.
  **This log is the per-stage account.** Where the work ran in stages, each stage gets **its
  own dispatch line, in the order the stages ran**, each naming its tier and where that tier
  came from — so the log shows the collecting running light and the judging running at the
  governing weight, rather than one line accounting for part of what happened. It is still
  one job, one status and one reply; the turn itself names only the
  deciding stage, so the log is the only place the whole split is written down — and it lasts
  only as long as the event does, which is why the turn carries the one name that matters.
- **acted** — each notable action, named concretely. These lines come from **inside the
  subagent**, appended to the same event id it was dispatched for — never to a job of its
  own.
- **settled** — done, failed with the reason repeated, or deferred naming the document it is
  waiting on.

A delegated job's log is one story in one file: your claimed and dispatched lines, the
subagent's acted lines, your recorded outcome — the operator watches delegated work
exactly as they would watch inline work. A useful line names the object and the change:
`"edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"` tells the operator what
happened; `"working"` tells them nothing. That discipline binds the subagent's lines too.
Do not narrate individual tool calls and do not stream reasoning or token output into the
log — the console is a progress feed, not a transcript.

## Completing and failing

Settle every claimed event — from its subagent's report, never at dispatch time — with
exactly one of:

```bash
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"
corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"
```

The reason is a `--reason` flag, never a positional. A good reason is one short sentence
naming the object and the obstacle — it is what the operator reads in the console's failed
or deferred row. Write the same reason to the job log
(`corpus job log evt_2e4f8b "failed: the parent document doc_f4e9d2 was deleted"`) so the
drawer and the row agree.

For `comment.created` and `form.respond`, a person is watching a pending indicator.
**Reply before you fail** — and before you defer: post a short
`corpus thread reply <id> --from agent --model <name>` saying what went wrong or what the work
is waiting on, then settle the event. A pending indicator that silently becomes a failed job reads as
the agent hanging; a one-line reply resolves it honestly.

The invariant, restated: every claimed event ends settled — in `processed/`, in `failed/`,
or in `deferred/` waiting on a named document and coming back to `pending/` on its own —
including when your own handling throws: catch, log, reply if a thread waits, fail with a
reason, move on to the next event. If the session dies mid-batch, events stay in
`in-progress/`; the next session's opening `corpus queue reap-stale` returns them to
`pending/`. Failed events are retried with `corpus job retry` or written off with
`corpus job abandon`.

## HALT

`.corpus/HALT` is the operator's kill switch, toggled with `corpus queue halt` and
`corpus queue resume` (the console drawer exposes the same switch). While the sentinel
exists, `corpus queue claim-all` returns an empty batch and `corpus queue idle` parks its
full window, exiting with `{"idle":true,"reason":"halted"}`. Events keep enqueuing
meanwhile — a halt stops your consumption, never the production — so nothing is lost and
`resume` makes it all claimable again. The correct halted behavior is to **keep looping
quietly**: claim-all, empty batch, idle, repeat. Do not exit, do not error, and do not post
anywhere about being halted — the operator did it on purpose, and a loop that is still
parked when they resume is the point.

## Stewardship

Leave the corpus better than you found it — opportunistically, while working events, not
only when asked. The charter binds whoever does the work, which is normally a subagent
applying the comment skill; delegation dilutes none of it. The charter:

- **Durable knowledge becomes documents.** A preference, a decision, or a fact learned in a
  thread is written into a document — created, or an existing one updated — never left
  buried in conversation. The rule: if you would need it in a future thread, write it down
  now.
- **Noticing a change is written down, not asked about.** When you notice that a document has
  changed, what you noticed goes into that document's changelog — the `## Changelog` section
  at the end of its body — and no thread is opened for it. A thread means _I need something
  from you_; the changelog means _I noticed_. This holds for every observation, the routine
  ones and the ones that look worrying alike: you open a thread only when you cannot proceed
  without a decision from the person, and then you ask for that decision with a form. It
  narrows what a noticed change may do and narrows nothing else — everywhere else you need a
  decision, a preference or a missing fact, the ask is exactly what it was. The section is
  appended to and never rewritten, so the person's own writing inside it survives; it is
  yours to maintain and theirs to edit, and neither of you owns it.
- **Stale content is updated** when you touch a document and find it out of date.
- **Obsolete documents are archived** — you archive, never delete; deletion is the user's
  alone.
- **Misfiled documents are moved** (`corpus doc move`) to where their content says they
  belong.
- **Near-duplicates are merged**: fold the lesser into the better, then archive the emptied
  one.
- **Overgrown documents are split**: create the new document, connect the two with a
  `[[ref]]`, trim the original.
- **What you steward, you found by retrieving.** The near-duplicate worth folding in and the
  better home for a misfiled document are both one `corpus search` on the subject away, and
  `corpus doc related <id>` walks out from the document already in front of you. Neither is
  ever a reason to list the tree or read documents to see what they hold: retrieve, then open
  the one id that earned it.
- **Every change is stated in the reply that occasioned it** — one line per change, naming
  the document. Where the work opened no thread to reply in, which is what reflecting on a
  user edit now does, the changelog entry is that statement. Nothing you do is silent.
- **Every turn that wrote closes with a trace line.** When a turn's work changed the corpus,
  its **final line — and only its final line —** is the arrow `↳ `, a space, then a one-line,
  past-tense report of what the work did, as in
  `↳ archived [[doc_f4e9d2]] and moved [[doc_a1b2c3]] into finance/`. It is an action report,
  not conversation. This binds every agent turn, including the ones you post yourself; a turn
  whose work changed nothing — an answer, a deferral, an apology for a failure — carries no
  trace. The comment skill states the same rule for the replies it writes.
- **Every change is traceable.** Your CLI mutations auto-commit with you as git author, so
  the git log answers "what did the agent change, and when" completely.

Scope rule: while handling an event, do the stewardship its own documents call for — the
ones the event made you read and touch. A corpus-wide sweep is separate work: do one when a
thread asks for it, and when you keep meeting the same mess, propose the sweep in a reply
instead of quietly starting it.

## Skills and subagents are documents

Your skills (`.claude/skills/<name>/SKILL.md`, `type: skill`) and subagent personas
(`.claude/agents/<name>.md`, `type: agent-def`) are ordinary documents: indexed, searchable,
visible and commentable on the board, and edited through the CLI like everything else —
`corpus doc edit` on a skill is how you revise your own behavior when feedback in a thread
calls for it, and a new `type: agent-def` document is all it takes to make a persona
addressable as `@<name>`. Two consequences:

- An edit to **this** skill or to the comment skill takes effect on the **next**
  `/orchestrate`, not in the running session — say exactly that in the reply whenever you
  change one.
- A bad edit to any other skill you undo yourself, the way you undo a bad edit to any
  document: read its history, work out the wording you want back, write it with the key
  (*Writing a document*). A bad edit to a **core-loop** skill can break the loop that would
  otherwise fix it — that is why the recovery section below exists, and why a change to
  `orchestrate` or `comment` is always named prominently in your reply.

## If the loop breaks (operator recovery)

*This section is for the operator, not the agent.*

Symptoms of a broken core-loop skill: `/orchestrate` errors immediately or spins without
claiming, events pile up in `pending/`, jobs are claimed and never settled, replies stop
arriving while the pending indicator keeps escalating. The way back:

```bash
corpus queue halt
git log --oneline -- .claude/skills/orchestrate/SKILL.md
git restore --source=<sha> -- .claude/skills/orchestrate/SKILL.md
corpus queue resume
```

**This is the one repair that does not go through the agent**, and that is why it is git and
not a command: the agent reverts a document by reading history and writing it back, but when
the broken document is the loop there is no agent running to do it. So the operator does it
by hand, in the workspace — use `comment` in place of `orchestrate` when that is the broken
one. `git log` lists the revisions of that one file and `git restore --source=<sha>` puts one
of them back in the working tree, staging nothing. Restore the **file**, not the commit: a
commit here belongs to an editing session rather than to a save, so it gathers everything
that party changed while its window was open, and `git revert <sha>` would take neighbouring
documents back with it.

Halt first so a half-working loop cannot claim events mid-repair; resume last and the loop
picks up everything that queued while you fixed it, without restarting the server. The
restored skill takes effect at the next `/orchestrate`, which is a fresh read of the file.

Nothing needs telling about the edit and the server stays up: it watches the workspace, so it
re-projects the restored skill within moments — the board shows the good text back — and
commits the change as the out-of-band `user` edit it is, which is what keeps `git log` a
complete account of the workspace even for the one change the agent did not make.

To turn a skill off entirely rather than revert it, `corpus doc archive` it: its folder moves
to `.claude/skills-archived/`, it stays indexed and restorable on the board, and it is no
longer discovered as a skill.

## Worked example

One `comment.created`, end to end — the operator commented on a mortgage note and asked for
the rate assumption to be updated.

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}],"inProgress":{"events":[],"total":0,"truncated":false}}
corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"
corpus search "rate assumption" --limit 5
doc_a1b2c3  Mortgage options › Rates  …the working rate assumption is 6.1% as of 2026-05-02…
doc_7e3a91  Refinance plan › Costs    …every projection here assumes 6.1% for the whole term…
corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — judged, difficulty: one document, prescribed change)"
```

`inProgress` came back empty, so there is nothing to reconcile and nothing printed on
stderr — the ordinary shape of a loop that has been settling its events. Two ranked lines,
no bodies: that is the whole cost of finding out where the rate assumption lives.

The first pass ran and answered **no**: the figure lands in a note in this corpus, where a
wrong one is commented on and corrected, so nothing here is going out and nobody is deciding
on it. That is why the tier came from difficulty and why the dispatch line says so. Had the
same one-line change been to a letter going to the lender in the morning, the first pass
would have vetoed the light tier and that line would read `Opus 5 — judged, consequence`.

**Then the step that no command performs.** Launch the subagent in the background — its
prompt carries `evt_7c1d9a`, `th_4b8e2c`, `doc_a1b2c3`, those two retrieved lines as the
anchors to start from, the comment skill, and the binding rules from Delegation. Only once
it is out does the next command run, and it runs by itself: `corpus queue idle`, alone,
never appended to the claim above. Everything the claim printed has been read and acted on
by the time parking starts, which is the whole of what separates a dispatched batch from a
batch claimed into silence.

Inside the subagent, the comment skill briefs itself on the one thread that matters —
`corpus thread context th_4b8e2c`, one bounded pack carrying the anchored passage with its
enclosing section and whatever else bears on it, the second line never opened at all — reads
the turns with `corpus thread show`, escalates to `corpus doc show doc_a1b2c3` because the
patch below quotes that document byte for byte — a quote is bytes you have seen, and that read
is also where a person's open session would have shown up had there been one — and does the
work: every mutation through the CLI, every progress line on the dispatched event's id.

```bash
export CORPUS_FROM=agent
corpus doc show doc_a1b2c3
The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.
corpus doc patch doc_a1b2c3 --from agent --old '6.1% as of 2026-05-02, and every projection in
this document uses it.' --new '6.4% as of 2026-07-28 — see [[th_4b8e2c]]. Thirty-year fixed
offers currently cluster between 6.1% and 6.6%, and every projection in this document uses 6.4%.'
patched doc_a1b2c3 — 1 occurrence replaced — 1 anchor remapped
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
Updated the rate assumption in [[doc_a1b2c3]] to 6.4% and reworded the
projection note to match. Changed: [[doc_a1b2c3]] (edited).
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
EOF
```

The subagent reports what it did and exits. When `idle` returns — here on its rearm, with
no new event — read that return first: it says nothing is pending and nothing is held, and
the subagent's report is waiting alongside it. Verify the reply and the edit landed, then
record the outcome:

```bash
corpus job log evt_7c1d9a "completed — replied on th_4b8e2c"
corpus queue complete evt_7c1d9a
```

Then park again — `corpus queue idle`, on its own line and on its own. The moment the
operator replies in `th_4b8e2c`, or any new event lands, it returns; you read that return,
run `corpus queue claim-all`, dispatch what it gives you, and park again — new work going
out even while earlier subagents are still running.
