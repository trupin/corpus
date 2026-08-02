---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim queue events, dispatch each one to a subagent, settle outcomes from their reports, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-08-02T00:00:00Z
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
2. **Attribution is explicit.** `--from` defaults to `user` on every mutating verb,
   including `corpus lock acquire`. Run `export CORPUS_FROM=agent` once at the start of the
   session, and still pass `--from agent` on mutating commands the way the examples below
   do — a change attributed to the wrong party is a corrupted audit trail.
3. **You archive; you never delete.** Deletion (`corpus doc delete`) belongs to the user
   alone, and the CLI refuses it from you. Where a person would delete, run
   `corpus doc archive` — reversible, still indexed, still in git.
4. **Every claimed event is settled** — `corpus queue complete`, `corpus queue fail`, or
   `corpus queue defer` — on success, on error, on a blocking lock, and on interruption
   alike. Complete and fail reach a terminal state; a deferred event is settled
   accounting, not a dangling one — it leaves `in-progress/` and returns to `pending/` on
   its own when the lock it names clears. Work may fail or wait; accounting may not.
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

## The loop

Run it exactly like this, in order, indefinitely:

```bash
export CORPUS_FROM=agent    # once per session, before anything else
corpus queue reap-stale     # returns events a dead session stranded in-progress
corpus queue claim-all      # the whole pending batch, as one JSON payload
# dispatch every claimed event to a subagent (Routing and Delegation below), then park:
corpus queue idle           # returns on a new event or on its ~8-minute rearm
# on every return, settle each event whose subagent has reported —
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"
corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "waiting for the user's edit lock"
# — then repeat from claim-all
```

The order is claim → dispatch → park. You return to `corpus queue idle` **as soon as the
batch is dispatched** — you do not wait for the batch to finish, because a session waiting
on one job is closed to every other, and keeping the queue open is the point. Settlement
happens as subagent reports arrive: each time parking returns, record what has finished,
then claim again.

`corpus queue idle` exits `0` in every normal case. When its ~8-minute window expires with
nothing pending it prints `{"idle":true,"reason":"timeout"}` — that is a normal outcome,
not an error: re-run the loop from `claim-all`. While the queue is halted it parks the full
window and prints `{"idle":true,"reason":"halted"}` — same response, keep looping. Its only
flag is `--wait <seconds>` (default `480`); there is no other knob and no other exit to
handle. Run `corpus queue reap-stale` at every loop start: after a clean park it reaps
nothing and stays silent, and after an unclean stop it is what returns stranded work to
`pending/`.

## Claiming and batching

`corpus queue claim-all` atomically moves everything in `pending/` to `in-progress/` and
prints the batch as **one JSON payload** on stdout:

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}]}
```

Parse it, group it by the documents each event touches (Concurrency and ordering below),
and dispatch the whole batch before claiming again — never call `claim-all` in the middle
of dispatching, because a second claim splices new events into an ordering you have
already computed. That is the whole rule: once the batch is dispatched, claiming again
when parking returns is the normal loop, and events claimed then are simply dispatched
behind whatever overlapping work is still running. An empty batch (`{"events":[]}`) is not
an error: it means the queue is halted or another consumer claimed first. Go straight to
`corpus queue idle`.

## Routing

Every routable event is dispatched to a subagent; the row names **which skill that
subagent is given**, never a job you take on yourself. Never guess: an event type with no
row below is failed with a reason and is never silently completed.

| Event type            | Dispatch                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `comment.created`     | A subagent applying the **comment** skill to the thread named in the payload.                 |
| `form.respond`        | A subagent applying the **comment** skill; the payload names the thread, the form's turn, and the answer. |
| `agent.done`          | A finished piece of background work. Nothing produces this event today — reports reach you directly (Delegation below) — but an arriving one is handled like a report: verify the work its payload identifies and settle it. |
| `<plugin>.<action>`   | A subagent applying the skill named `<plugin>` — the part before the first dot.               |
| anything else         | `corpus queue fail <id> --reason "unknown event type: <type>"`                                |

Thread handling itself — reading context, honoring mentions, filing inbox captures, wording
the reply, skill genesis — belongs to the comment skill, applied inside the subagent. This
skill routes and dispatches, and owns queue state, ordering, locks, logging, and the halt
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
payload directs to), the anchors it should start from, and the binding rules below. Its
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

**Pick the subagent's model by the task's weight** — small, mechanical work goes to a
smaller, faster model; judgment goes to the strongest:

| Weight               | Model      | What falls here                                                                                          |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| Small and mechanical | **Haiku**  | The request prescribes the change exactly: a one-document edit spelled out in the comment, retitle-and-file an inbox capture, a factual reply that needs one read. |
| Standard             | **Sonnet** | Most comment work: read a thread and its parent, decide the wording, edit, reply — multi-step but bounded to one or two documents. |
| Heavy or judgment-laden | **Opus 5** | Cross-document restructuring, merges and splits, skill genesis or any edit to a skill, ambiguous requests that need judgment, anything where a wrong answer is expensive to unwind. |

Judge weight by three things: how many documents the work touches, whether the request
prescribes the change or asks for a decision, and the cost of getting it wrong. In doubt
between two tiers, take the stronger — a wasted token is cheaper than a wrong edit.

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
- Locks are respected exactly as the edit verbs enforce them: a refused write is reported
  back, never retried blind, never broken.
- Progress lines go to **the dispatching event's job** — `corpus job log <eventId>
  "<line>"` with the same event id you dispatched — so the console watches delegated work
  exactly as it would watch you. Same discipline: name the object and the change.
- A reply whose work changed documents closes with the `↳ ` trace line; the comment skill
  states the grammar.
- Anything a reply hands over for reuse elsewhere — a prepared prompt, a command line, a
  config snippet — sits alone in a fenced block whose info string labels it (`prompt`,
  `command`), one deliverable per fence, prose outside it: the board renders that fence as a
  **copyable canvas** titled by the label. The comment skill states the convention; it binds
  the turns you post yourself just as it binds a subagent's.

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

**A blocked subagent defers — through you.** A subagent that hits a user-held lock
reports the block with the document id and stops. Confirm the waiting thread got its
one-line reply (the comment skill has the subagent post it; post it yourself if it is
missing), then defer exactly as Locks and deferral below prescribes — never
`corpus queue fail` for a lock, never a retry loop against it.

## Concurrency and ordering

Compute, for every event in the batch, the set of documents its work touches:

- `comment.created` / `form.respond`: the thread id **and** the thread's `parent` document id.
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

## Locks and deferral

The CLI's edit verbs (`corpus doc edit`, `corpus doc move`, `corpus doc archive`) acquire
the document's edit lock implicitly and release it after the write — a routine edit never
needs `corpus lock acquire`. When the **user** holds the lock (their editor is open on that
document), the write is refused with the holder named, reported as a server error (exit
`5`), and never retried blind. Defer instead — in exactly this order:

```bash
corpus thread reply th_4b8e2c --from agent <<'EOF'
You're editing [[doc_a1b2c3]] right now, so I haven't touched it. The change is
ready and will land on its own once the document is free.
EOF
# nothing changed, so that reply carries no trace line
corpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3 --reason "waiting for the user's edit lock on doc_a1b2c3"
```

Reply first — a person is watching a pending indicator — then defer. When the refusal
happened inside a subagent, the sequence is unchanged: the subagent has normally posted
that reply already and reported the block; you make the defer call. A deferral is a
postponement, not a failure: the event moves to `deferred/`, `corpus queue status` counts
it under `deferred`, never `failed`, and the console shows it waiting rather than broken.

`--blocked-on` is required, and it is load-bearing: it names the **locked document** —
never the thread — because clearing the lock on exactly that document is what returns the
event to `pending`. Name the wrong document and the event parks forever, waiting on a lock
that will never clear. The right value is always the id of the document whose write was
refused.

Re-entry is automatic. When the lock on the blocked-on document is **released**,
**force-broken**, or **reaped**, the server returns the event to `pending` by itself and a
parked `corpus queue idle` unparks — no operator action, no retry, nothing for you to
watch. `corpus job retry` remains only as the by-hand override for a deferral automatic
re-entry did not reach: a lock that cleared out of band, or a deferral that named the
wrong document.

- **Never force a lock.** `corpus lock break` is the human's escape hatch, and the CLI
  refuses it from you (exit `2`). That refusal is correct: contention you could break
  yourself is no contention at all.
- A lock left behind by your own crashed earlier run expires on its TTL, and
  `corpus lock reap` clears expired locks. That is the whole recovery — you do not break
  locks, not even your own.

## Progress and job logs

Every event is a job whose log the console tails live. Append lines with
`corpus job log <eventId> "<line>"` — the command has no flags; the line is the positional
argument (or piped stdin). Log at these moments, and only these:

- **claimed** — `corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"`
- **dispatched** — which skill's subagent took it, on which model tier, and why that
  tier: `corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — one
  document, prescribed change)"`
- **acted** — each notable action, named concretely. These lines come from **inside the
  subagent**, appended to the same event id it was dispatched for — never to a job of its
  own.
- **settled** — done, failed with the reason repeated, or deferred naming the blocking
  document.

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
corpus queue defer evt_9c3b1d --blocked-on doc_a1b2c3 --reason "waiting for the user's edit lock"
```

The reason is a `--reason` flag, never a positional. A good reason is one short sentence
naming the object and the obstacle — it is what the operator reads in the console's failed
or deferred row. Write the same reason to the job log
(`corpus job log evt_2e4f8b "failed: the parent document doc_f4e9d2 was deleted"`) so the
drawer and the row agree.

For `comment.created` and `form.respond`, a person is watching a pending indicator.
**Reply before you fail** — and before you defer: post a short
`corpus thread reply <id> --from agent` saying what went wrong or what the work is waiting
on, then settle the event. A pending indicator that silently becomes a failed job reads as
the agent hanging; a one-line reply resolves it honestly.

The invariant, restated: every claimed event ends settled — in `processed/`, in `failed/`,
or in `deferred/` waiting on a named lock and coming back to `pending/` on its own —
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
  the document. Nothing you do is silent.
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
- A bad edit to a core-loop skill can break the loop that would otherwise fix it. That is
  why the recovery section below exists, and why a change to `orchestrate` or `comment` is
  always named prominently in your reply.

## If the loop breaks (operator recovery)

*This section is for the operator, not the agent.*

Symptoms of a broken core-loop skill: `/orchestrate` errors immediately or spins without
claiming, events pile up in `pending/`, jobs are claimed and never settled, replies stop
arriving while the pending indicator keeps escalating. The way back:

```bash
corpus queue halt
corpus skill rollback orchestrate
corpus queue resume
```

`corpus skill rollback <name>` restores that skill's last-known-good version from git
history — use `comment` in place of `orchestrate` when that is the broken one. Halt first
so a half-working loop cannot claim events mid-repair; resume last and the loop picks up
everything that queued while you fixed it, without restarting the session. To turn a skill
off entirely rather than revert it, `corpus doc archive` it: its folder moves to
`.claude/skills-archived/`, it stays indexed and restorable on the board, and it is no
longer discovered as a skill.

## Worked example

One `comment.created`, end to end — the operator commented on a mortgage note and asked for
the rate assumption to be updated.

```bash
corpus queue claim-all
{"events":[{"id":"evt_7c1d9a","type":"comment.created","created":"2026-07-28T09:14:02Z","source":"ui","payload":{"threadId":"th_4b8e2c","parentId":"doc_a1b2c3"}}]}
corpus job log evt_7c1d9a "claimed comment.created on th_4b8e2c"
corpus search "rate assumption" --limit 5
doc_a1b2c3  Mortgage options › Rates  …the working rate assumption is 6.1% as of 2026-05-02…
doc_7e3a91  Refinance plan › Costs    …every projection here assumes 6.1% for the whole term…
corpus job log evt_7c1d9a "dispatched to a comment-skill subagent (Sonnet — one document, prescribed change)"
```

Two ranked lines, no bodies: that is the whole cost of finding out where the rate
assumption lives. Launch the subagent in the background — its prompt carries `evt_7c1d9a`,
`th_4b8e2c`, `doc_a1b2c3`, those two retrieved lines as the anchors to start from, the
comment skill, and the binding rules from Delegation — and go straight back to parking:

```bash
corpus queue idle
```

Inside the subagent, the comment skill briefs itself on the one thread that matters —
`corpus thread context th_4b8e2c`, one bounded pack carrying the anchored passage with its
enclosing section and whatever else bears on it, the second line never opened at all — reads
the turns with `corpus thread show`, escalates to `corpus doc show doc_a1b2c3` because the
edit below replaces the whole body, and does the work: every mutation through the CLI, every
progress line on the dispatched event's id.

```bash
export CORPUS_FROM=agent
corpus doc edit doc_a1b2c3 --from agent <<'EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28 — see [[th_4b8e2c]].

Thirty-year fixed offers currently cluster between 6.1% and 6.6%; every
projection in this document now uses 6.4%.
EOF
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — updated the rate assumption to 6.4%"
corpus thread reply th_4b8e2c --from agent <<'EOF'
Updated the rate assumption in [[doc_a1b2c3]] to 6.4% and reworded the
projection note to match. Changed: [[doc_a1b2c3]] (edited).
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
EOF
```

The subagent reports what it did and exits. When `idle` returns — here on its rearm, with
no new event — the report is waiting: verify the reply and the edit landed, record the
outcome, and park again:

```bash
corpus job log evt_7c1d9a "completed — replied on th_4b8e2c"
corpus queue complete evt_7c1d9a
corpus queue idle
```

`idle` parks. The moment the operator replies in `th_4b8e2c` — or any new event lands —
it returns, and the loop runs again from `corpus queue claim-all`, dispatching new work
even while earlier subagents are still running.
