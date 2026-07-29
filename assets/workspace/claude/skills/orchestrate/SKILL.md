---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim queue events, route each one to a handler, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-07-28T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## Purpose and when to run

You are this workspace's agent, and `/orchestrate` is your main loop. It drains the event
queue, routes every event to the right handler, reports progress to the console, drives each
event to a terminal state, and parks — at zero token cost — until the next event arrives.
The operator starts `claude` in the workspace, invokes `/orchestrate` once, and leaves it
running; you loop until the session is stopped. This session is the **only** process that
claims queue events: the server enqueues them, the board displays them, and everything in
between is you. Run one orchestrating session at a time — the server never hands one event
to two claimants, but a second loop would split the console's story in half.

## Invariants

These bind every step below. Read them before the loop, because everything after depends on
them.

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
4. **Every claimed event reaches a terminal state** — `corpus queue complete` or
   `corpus queue fail` — on success, on error, and on interruption alike. Work may fail;
   accounting may not.
5. **`corpus queue idle` is the only wait.** Never `sleep`, never poll the queue, never
   busy-wait: `idle` parks you on a held response, so waiting costs zero tokens and ends the
   instant work arrives.

## The loop

Run it exactly like this, in order, indefinitely:

```bash
export CORPUS_FROM=agent    # once per session, before anything else
corpus queue reap-stale     # returns events a dead session stranded in-progress
corpus queue claim-all      # the whole pending batch, as one JSON payload
# handle every claimed event (routing below), then settle each one:
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"
corpus queue idle           # park until work arrives or the window expires
# repeat from claim-all
```

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

Parse it, group it by the documents each event touches (two sections down), and work the
whole batch to terminal states before claiming again — never call `claim-all` mid-batch,
because a second claim reorders work you have already sequenced. An empty batch
(`{"events":[]}`) is not an error: it means the queue is halted or another consumer claimed
first. Go straight to `corpus queue idle`.

## Routing

One handler per event type. Never guess: an event type with no row below is failed with a
reason and is never silently completed.

| Event type            | Handler                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `comment.created`     | Invoke the **comment** skill on the thread named in the payload.                              |
| `form.respond`        | Invoke the **comment** skill; the payload names the thread, the form's turn, and the answer.  |
| `agent.done`          | A background subagent finished: pick up the work its payload identifies and carry it to its reply. |
| `<plugin>.<action>`   | Invoke the skill named `<plugin>` — the part before the first dot.                            |
| anything else         | `corpus queue fail <id> --reason "unknown event type: <type>"`                                |

Thread handling itself — reading context, honoring mentions, filing inbox captures, wording
the reply, skill genesis — belongs to the comment skill. This skill routes, and owns queue
state, ordering, locks, logging, and the halt switch.

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
- **`agent.done` after resolution.** If the originating thread was resolved while the
  subagent worked, deliver the result in a reply that says the thread was resolved
  meanwhile — finish work that still has value, and never reopen the thread unilaterally.

## Concurrency and ordering

Compute, for every event in the batch, the set of documents it touches:

- `comment.created` / `form.respond`: the thread id **and** the thread's `parent` document id.
- `<plugin>.<action>`: every document id in the payload.
- `agent.done`: the documents of the work it resumes.
- An event whose touched set you cannot compute from its payload touches everything: run it
  serially, after the rest of the batch.

Two events sharing any touched document run **serially, in claim order** — the second must
see the first's effects, because answering a user against state that no longer exists is
worse than answering late. Events with fully disjoint document sets may run in parallel by
delegating the *work* to subagents — at most **3** at a time. The division of labor is
absolute: a subagent reads, edits, and replies through the CLI, and it **never runs
`corpus queue claim-all`, `corpus queue complete`, or `corpus queue fail`** — completing an
event it does not own corrupts the queue accounting this loop guarantees. When a subagent
returns, you verify what it did and you settle its event.

## Locks and deferral

The CLI's edit verbs (`corpus doc edit`, `corpus doc move`, `corpus doc archive`) acquire
the document's edit lock implicitly and release it after the write — a routine edit never
needs `corpus lock acquire`. When the **user** holds the lock (their editor is open on that
document), the write is refused with the holder named, reported as a server error (exit
`5`), and never retried blind. Defer instead — in exactly this order:

```bash
corpus thread reply th_4b8e2c --from agent <<'EOF'
You're editing [[doc_a1b2c3]] right now, so I haven't touched it. I'll apply
this change once the document is free — retry the job from the console when
you're done editing.
EOF
corpus job log evt_7c1d9a "deferred: doc_a1b2c3 is locked by user"
corpus queue fail evt_7c1d9a --reason "deferred: doc_a1b2c3 locked by user — retry when the lock clears"
```

The `deferred:` prefix on the reason marks the failure as a postponement, not a defect. The
work re-enters the queue through `corpus job retry evt_7c1d9a` — normally run by the
operator from the console's failed-job row; run it yourself when a later batch shows you the
lock has cleared (`corpus lock list`). When the operator force-unlocks a document, the break
is recorded in the audit trail and the deferred edit re-enters the queue rather than being
lost.

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
- **routed** — which handler took it
- **acted** — each notable action, named concretely
- **terminal** — done, or failed with the reason repeated

A useful line names the object and the change: `"edited [[doc_a1b2c3]] — updated the rate
assumption to 6.4%"` tells the operator what happened; `"working"` tells them nothing. Do
not narrate individual tool calls and do not stream reasoning or token output into the log —
the console is a progress feed, not a transcript.

## Completing and failing

Settle every claimed event with exactly one of:

```bash
corpus queue complete evt_7c1d9a
corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"
```

The reason is a `--reason` flag, never a positional. A good reason is one short sentence
naming the object and the obstacle — it is what the operator reads in the console's failed
row. Write the same reason to the job log
(`corpus job log evt_2e4f8b "failed: the parent document doc_f4e9d2 was deleted"`) so the
drawer and the row agree.

For `comment.created` and `form.respond`, a person is watching a pending indicator.
**Reply before you fail**: post a short `corpus thread reply <id> --from agent` saying what
went wrong, then fail the event. A pending indicator that silently becomes a failed job
reads as the agent hanging; a one-line reply resolves it honestly.

The invariant, restated: every claimed event ends in `processed/` or `failed/`, including
when your own handling throws — catch, log, reply if a thread waits, fail with a reason,
move on to the next event. If the session dies mid-batch, events stay in `in-progress/`;
the next session's opening `corpus queue reap-stale` returns them to `pending/`. Failed
events are retried with `corpus job retry` or written off with `corpus job abandon`.

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
only when asked. The charter:

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
- **Every change is stated in the reply that occasioned it** — one line per change, naming
  the document. Nothing you do is silent.
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
corpus job log evt_7c1d9a "routed to the comment skill"
```

The comment skill reads `th_4b8e2c` and its parent `doc_a1b2c3`, finds the request, and
does the work — every mutation through the CLI:

```bash
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
EOF
corpus job log evt_7c1d9a "completed — replied on th_4b8e2c"
corpus queue complete evt_7c1d9a
corpus queue idle
```

`idle` parks. The moment the operator replies in `th_4b8e2c` — or any new event lands —
it returns, and the loop runs again from `corpus queue claim-all`.
