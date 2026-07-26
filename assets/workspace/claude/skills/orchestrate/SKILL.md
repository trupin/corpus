---
name: orchestrate
description: Run the Corpus agent loop in this workspace — claim queue events, route each one to a handler, report progress to the console, and park on idle until the next event arrives. Invoke as /orchestrate and leave it running.
id: doc_skillorchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## Purpose and when to run

`/orchestrate` is the agent loop for this workspace. The operator starts it once, in the
workspace directory, and leaves it running: it claims queue events, routes each one to a
handler, and parks between events at zero token cost. It is the only process that claims
queue events — never run two orchestrators against one workspace.

## Invariants

These hold for every event, every handler, and every subagent. Read them before the loop,
because everything after depends on them.

1. **Every mutation goes through the `corpus` CLI.** Never edit files under `data/`,
   `.corpus/`, or `.claude/` by hand, and never call the HTTP API directly. The server is
   the sole writer; the CLI is how you reach it. Hand-edited files bypass validation,
   anchor reconciliation, git attribution, and the live UI.
2. **Archive, never delete.** `corpus doc archive` is a reversible `status: archived` flip.
   Deletion is user-only.
3. **Every claimed event reaches a terminal state** — `corpus queue complete` or
   `corpus queue fail`. An event left in `in-progress` is a stuck job on the operator's
   console.
4. **`corpus queue idle` is the only wait.** Never sleep, never poll in a loop, never busy-
   wait on a file.

## The loop

```bash
corpus queue claim-all        # atomically claims every pending event, prints one JSON batch
# handle each claimed event, then for each:
corpus queue complete <eventId>
# or: corpus queue fail <eventId> --reason "<why>"
corpus queue idle             # long-polls; returns as soon as work exists, else on rearm
```

Repeat forever. `corpus queue idle` blocks on an HTTP response rather than looping, so
parking costs nothing. It exits on its own after the rearm window (~8 minutes) even with no
work; that is normal — call it again.

## Claiming and batching

`corpus queue claim-all` returns the whole pending batch in one payload. Parse it, group it,
and work it to completion. Do not claim again in the middle of a batch.

## Routing

| Event type          | Handler                                                        |
| ------------------- | -------------------------------------------------------------- |
| `comment.created`   | the `comment` skill                                            |
| `form.respond`      | the `comment` skill (it resumes the same conversation)         |
| `agent.done`        | resume the work the background subagent finished               |
| `<plugin>.<action>` | the installed skill whose name is `<plugin>`                   |

An event type with no handler — including a plugin event whose skill is missing or archived
— fails with a reason naming what was missing.

## Concurrency and ordering

Events that touch the same document run serially, in claim order. A thread event touches
both its thread and its `parent` document. Independent documents may be worked in parallel
by subagents. Subagents do work; the orchestrator alone claims, completes, and fails events.

## Locks and deferral

The CLI's edit verbs acquire the per-document lock implicitly and release it afterwards. A
document locked by the user is not yours to edit: defer the work until the lock clears
rather than forcing it. The agent never breaks a lock — `corpus lock break` is the
operator's escape hatch, and `corpus lock reap` clears locks whose TTL has expired.

## Progress and job logs

Every event is a job, and its log is what the operator watches in the console:

```bash
corpus job log <eventId> "claimed comment.created on th_x9y8"
```

Log at the points that change the operator's understanding — claimed, routed, acted,
terminal — and make each line say what happened to what. Do not narrate individual tool
calls.

## Completing and failing

```bash
corpus queue complete <eventId>
corpus queue fail <eventId> --reason "parent doc_a1b2c3 no longer exists"
```

A failure reason names the cause and the identifier involved. When a thread event fails,
reply in the thread first — someone is watching a pending indicator. After an unclean stop,
`corpus queue reap-stale` returns stranded `in-progress` events to the queue; run it at loop
start when the previous session did not exit cleanly.

## HALT

`corpus queue halt` writes the kill switch; `corpus queue resume` clears it. While halted,
`corpus queue idle` parks and `corpus queue claim-all` returns an empty batch. The correct
behavior is a quiet loop: claim nothing, do nothing, park again.

## Stewardship charter

Leave the corpus better than you found it — while working a task, not only when asked.

- Durable knowledge learned in a thread (a preference, a decision, a fact) is written into a
  document, created or updated. It does not stay buried in conversation.
- Stale content is updated, obsolete documents are archived, misfiled ones are moved,
  near-duplicates are merged, overgrown ones are split.
- Every change leaves a visible trace: the server auto-commits with the acting party as git
  author, and when stewardship happens in service of a thread, the reply says what changed.
- Nothing is silently destructive. Archiving is reversible; deletion is the user's alone.

## Skills and subagents are documents

Skills (`.claude/skills/<name>/SKILL.md`) and subagent personas (`.claude/agents/<name>.md`)
are indexed as documents like anything else in the corpus — searchable, commentable, and
editable through the same CLI verbs. Creating one makes it immediately available to `/` and
`@` autocomplete. A change to the orchestrate skill takes effect on the next `/orchestrate`,
not mid-loop.

## If the loop breaks (operator recovery)

For the human reading this after a bad edit to a core skill. Symptoms: the agent stops
claiming, claims and never completes, or does something the skill plainly should not.

```bash
corpus queue halt                     # stop the loop from taking new work
corpus skill rollback orchestrate     # restore the last-known-good version of a skill
corpus queue resume                   # let it run again
```

`corpus doc archive` on a skill disables it by moving it to `.claude/skills-archived/` —
still indexed and restorable, no longer discovered by Claude Code.

## Worked example

One `comment.created` event, end to end:

```bash
corpus queue claim-all
# → [{"id":"evt_7c1d","type":"comment.created",
#     "payload":{"threadId":"th_x9y8","parentId":"doc_a1b2c3"}}]

corpus job log evt_7c1d "claimed comment.created on th_x9y8"
# route to the comment skill, which reads the thread and its parent, does the work,
# and posts the reply:
corpus thread reply th_x9y8 --from agent <<'EOF'
6.4% is more representative than 6.1% — updated the assumption in [[doc_a1b2c3]].
EOF

corpus job log evt_7c1d "replied on th_x9y8; edited doc_a1b2c3"
corpus queue complete evt_7c1d
corpus queue idle
```
