---
id: doc_seedreadme
type: note
title: Workspace README
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: []
status: open
anchors: {}
evergreen: true
---

# This is a Corpus workspace

Everything here is a markdown file with YAML frontmatter, kept in git. `data/docs/` holds
your documents, `data/threads/` holds the conversations attached to them, and `.claude/`
holds the skills that define how the agent behaves, plus `agents/` for subagent personas you
can address by name. `.corpus/` is runtime state — generated, gitignored, and rebuildable,
apart from the queue skeleton and the install manifest, which git tracks.

## The loop

**1. Start the server.** From anywhere inside this workspace:

```bash
corpus server start
```

It prints the board URL — `http://127.0.0.1:<port>`. That is the whole UI: a horizontally
scrolling strip of columns, with a console drawer along the bottom showing what the agent is
doing. This workspace ships with three columns — Attention, Inbox, and Open threads — which
are ordinary documents under `data/docs/views/`. Rename them, reorder them, add your own, or
delete them.

**2. Start the agent.** In a second terminal, in this same directory:

```bash
claude
```

then invoke the orchestrate skill:

```
/orchestrate
```

It claims work, does it, and parks between events. Leave it running.

**3. Talk to it.** In the board, select a passage and comment on it, or open the composer
(`c`) and Ask or Capture. A comment reaches the agent when it mentions `@agent`, names a
subagent (`@researcher`), invokes a skill (`/publish`), or has the composer's agent toggle
on. Plain comments are notes to yourself and never wake it. Once the agent has replied in a
thread, your later replies re-trigger it automatically until you resolve the thread.

## Stopping it

`corpus queue halt` is the kill switch: the agent stays parked and claims nothing. The board
exposes the same toggle in the console drawer. `corpus queue resume` lets it run again.
`corpus server stop` shuts the server down.

## When the agent misbehaves

The skills in `.claude/` are documents, and the agent edits its own — which means a bad edit
to `orchestrate` or `comment` can break the loop that would otherwise fix it. The way back:

```bash
corpus queue halt
git log --oneline -- .claude/skills/orchestrate/SKILL.md
git restore --source=<sha> -- .claude/skills/orchestrate/SKILL.md
corpus queue resume
```

There is no rollback command, and here that is the point: the agent undoes a bad edit by
reading the history and writing the old content back through the CLI, but when the broken
document is the loop itself, there is no agent running to do it. So this one repair is yours,
in the workspace, with git — `git log` lists that file's revisions and `git restore` puts one
of them back. Use `comment` in place of `orchestrate` when that is the broken one. Leave the
server running: it watches the workspace, picks the change up as the out-of-band edit it is,
and commits it, so the recovery shows up in the history like everything else. The restored
skill takes effect at the next `/orchestrate`.

To turn a skill off entirely rather than revert it, `corpus doc archive` it: the skill moves
to `.claude/skills-archived/`, stays visible and restorable in the board, and is no longer
discovered by Claude Code.

## Everything else

`corpus --help` lists every command. `corpus doc check` validates the whole workspace, and
`corpus db rebuild && corpus db doctor` reconstructs the derived index from the files and
confirms the two agree.
