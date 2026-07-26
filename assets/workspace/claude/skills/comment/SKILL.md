---
name: comment
description: Handle a comment that requested the agent — read the thread and its anchored context, do what the comment asks, and reply through the corpus CLI. Invoked by the orchestrate skill for comment.created and form.respond events.
id: doc_skillcomment
type: skill
title: Comment
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## When this runs

The orchestrate skill enters this skill with a `comment.created` or `form.respond` event
already claimed. The payload carries `threadId`, `parentId` (null for a standalone thread),
and the structured `mentions` and `skills` the server parsed from the turn.

## Inherited invariants

From the orchestrate skill, in force here without restatement of their rationale: every
mutation goes through the `corpus` CLI and workspace files are never hand-edited; archive,
never delete; defer rather than force when the user holds a document's lock; log progress
with `corpus job log`. Queue state is the orchestrator's — this skill never completes or
fails an event.

## Gather context

Read before acting, and stop reading once you can answer.

- **Anchored thread** — the thread's turns, the parent document, and the anchor quote with
  enough surrounding text to see what the comment points at. An orphaned anchor still
  carries its last selector; work from the thread.
- **Whole-document thread** — the thread and its parent.
- **Standalone thread** (`parent: null`) — the thread is the whole context. After the first
  exchange, give it a real title; a thread is a document, so its title is edited like any
  other document's.

## Honor the routing directives

`@<subagent>` routes the work to that subagent. `/<skill>` applies that skill to this
context. Both can combine. A bare `@agent` leaves routing to your own triage. Read the
directives from the event payload rather than re-parsing the prose. If a named target is
missing or archived, do the useful thing anyway and name the deviation in the reply.

## Do the work

Answer in the reply when the answer is the whole deliverable. Edit the parent with
`corpus doc edit` when the document is wrong or incomplete — anchors reconcile automatically
on save, so never hand-maintain the `anchors` map. Create a document with `corpus doc create`
when the answer is durable enough to outlive the conversation. Spawn a subagent when the
work is long enough that the user should not wait on a single turn; acknowledge in the
thread immediately rather than going silent, and let the `agent.done` event bring you back.

## Inbox filing

A capture arrives as a small document in `data/docs/inbox/` with a thread asking you to file
it. Read it, give it a real title, expand its structure into something usable, choose a
destination folder, `corpus doc move` it there, tag it, and say in the reply what it became
and where it lives. Prefer a folder that already holds similar documents; create a new one
only for a genuinely missing category. When the right home is truly ambiguous, leave it in
`inbox/` and ask.

## Reply

Always reply, even when the outcome is "nothing to do" — someone is watching a pending
indicator. Lead with the answer, then say what changed, linking changed documents by id:

```bash
corpus thread reply th_x9y8 --from agent <<'EOF'
6.4% is more representative than 6.1% — updated the assumption in [[doc_a1b2c3]].
EOF
```

Use a quoted heredoc so nothing in your text is re-interpreted by the shell.

## Engagement and closure

Replying sets the thread's participation to `engaged`, which means every later turn in it
re-triggers you unless the user resolves the thread or posts a note-only turn. Suggest
resolving when the matter is settled; do not resolve on the user's behalf unless they asked
for it to be closed.

## Forms

Raise a form when a bounded choice blocks the work — two or three options the user can pick
between. Open questions are just replies. A `form.respond` event resumes the same
conversation; continue it rather than starting over.

## Stewardship in service of a thread

While you are inside a document, fix what is obviously stale, misfiled, or duplicated, and
say so in the reply that occasioned it. Archive, never delete; nothing silently destructive.

## Skill genesis

A preference stated more than once, a correction repeated across threads, or a workflow the
user keeps describing has earned codification. Extend an existing skill when one fits;
create a new skill document otherwise, carrying both Claude Code's `name`/`description` and
Corpus's `id`/`type`/`title` so both systems see it. When a correction contradicts an
existing skill, edit that skill rather than writing a second one that disagrees. Announce it
in the reply so the user can push back — and mention `corpus skill rollback <name>` when the
skill you changed is one of the core-loop skills.

## Worked example

An anchored comment that changes the parent document:

Read the thread `th_x9y8` — its turns, its `parent`, and its anchor quote — then read the
parent document `doc_a1b2c3`. Edit the parent and reply:

```bash
corpus doc edit doc_a1b2c3          # anchors reconcile on save
corpus thread reply th_x9y8 --from agent <<'EOF'
Checked current averages: 6.4% is more representative than 6.1%. Updated the rate
assumption in [[doc_a1b2c3]] and left the sensitivity table alone.
EOF
```
