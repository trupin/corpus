---
name: profile
description: Write a subagent profile — the agent-def document that gives a persona a name, so it answers to @<name> and can be made resident on a conversation. Reach for this whenever somebody asks for an agent of their own, in whatever words they use — 'make me a proofreader', 'I want an agent that keeps the finances straight', 'can you set up a researcher for this thread', 'give me something that does that properly'.
id: doc_skillprofile
type: skill
title: Profile
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## When this runs

Somebody asked for an agent of their own. You write one profile, and you stop there.

A **profile** is a `type: agent-def` document living at `.claude/agents/<name>.md`. One file,
two readers, and both matter for what you put in it. Corpus resolves `@<name>` to it, so it
can be named in a comment and made **resident** on a standalone conversation. Claude Code
loads it as a subagent, so work can be dispatched to it. Neither reader is optional and they
read different parts of the file: Corpus reads the body, once this persona has been chosen;
Claude Code reads the `description`, which is what somebody chooses it *by*. The create writes
enough of both to work. What it cannot write is a description worth reading, which is why
*Writing it* below is two commands rather than one.

You are reached as `/profile` — by a directive in a thread, by whoever is handling an event
that plainly asks for this, or by a person at a terminal. No queue event is required.

**Writing a profile and putting it to work are two acts, and only the first is yours.**
Making an agent resident is `corpus thread designate`, which is **user-only**: sent with
`--from agent` the server refuses it outright. So you never designate as a follow-through,
and you never read "make me an agent for this conversation" as an instruction to do both.
Write the profile; tell the person the one command that makes it resident; leave that command
to them.

And say the honest thing when the request is really about staffing a conversation rather than
about behaviour: a resident **need not have a profile at all**. A designation that names none
gets a general resident, which owns exactly the same scope and works the conversation as the
workspace's ordinary agent does. Naming no profile is the ordinary case and needs nothing to
exist first — `corpus thread designate <th_…>`, with no `--agent`, is that designation, and it
is theirs to run for the same reason. A profile is worth writing when somebody wants an agent
that behaves *differently* from the default, not merely one that is present.

**This skill inherits the invariants the orchestrate skill states, and restates none of
them**: the `corpus` CLI is the only way anything here is written, workspace files are never
hand-edited, and every write you make says `--from agent`.

## What you need before you write

Three things, and nothing else: **what the agent is for**, **how it should behave**, and
**what it should not do**.

Where the request already carries all three, write the profile. Do not ask a person who has
just told you something to tell you again. *"Make me an agent that proofreads my drafts for
passive voice and the em-dashes I overuse, and never rewrites the argument"* is all three, and
a question back is friction with a straight answer already in the room.

Where the request is thin — *"make me a research agent"* — ask, and ask **once**. Use a form,
in the grammar the comment skill states: one turn, every question in it, options offered where
you can offer them, and no second round. Three questions is the whole budget, and these are
the three:

- What should it be able to handle on its own?
- What does a good answer from it look like?
- What should it never do?

An interrogation spread over four turns to produce a twelve-line document is worse than a
profile that is slightly wrong. The profile is a document — it is editable, it is commentable,
and the person will correct it the first time it answers badly. Prefer one good guess with the
guess stated to a second question.

**A request with nothing in it is not thin, it is blank.** *"Make me an agent"*, and no more,
has no profile in it and no form draws one out of somebody who has not decided yet. That one
is a refusal, below, not a question.

## What makes a profile worth having

This section is the reason this skill exists. Running `corpus doc create` is the easy part;
what goes in the document is the part that decides whether the persona is worth having. The
body is short and it is read on every single invocation, so every sentence in it is spent.

- **A profile that changes nothing is decoration.** Before writing, name two things this
  agent would do differently from the workspace's ordinary agent, given the same request. If
  you cannot name two, there is no profile here, and saying so is the useful answer.
  "Thorough, careful and helpful" is the default agent with adjectives stapled on.
- **Write behaviour, not biography.** *"A meticulous archivist with fifteen years in special
  collections"* tells the agent nothing to do. *"File every capture before you answer anything
  else; never leave a note in the inbox without a folder"* does. Test every sentence: reading
  only the output, could somebody tell whether it was followed? If not, cut it, or replace it
  with the behaviour you actually meant by it.
- **The refusals are half the profile.** What it declines, what it will not guess at, where it
  stops and asks — that is what most reliably changes an answer. An agent with no "does not"
  in it is the default agent wearing a name.
- **Say what a finished answer looks like.** The shape of the output is what a person notices
  first: a table and a sentence under it; the quote and the id it came from; three options and
  a recommendation. One line about the shape is worth a paragraph about the attitude.
- **Short enough to stay true.** A paragraph of standing, three to six rules, one sentence of
  shape. A profile listing fifteen preferences gets most of them followed and nobody can tell
  which ones were dropped — length is not specificity, it is deniability. If it will not fit
  on a screen, what you are writing is a document, and the profile should point at it instead
  of swallowing it.
- **It inherits; it does not restate.** Everything the workspace's agent already does binds
  this persona too — the CLI, attribution, archiving rather than deleting, how a reply is
  worded. Repeating any of that spends the budget on nothing and goes stale the day the rule
  changes underneath it. A profile says only what is *different*.
- **The body and the description have different readers.** The body is read by the agent once
  it has been chosen. The `description` is read by whoever is choosing — it is the only part
  of the file another agent sees before dispatching — so write it as *when to reach for this
  one*, in the words the person asking would use, and not as a summary of the body.
- **Name it for the job, in one word.** The filename is the address: `.claude/agents/`
  plus the name is what makes `@<name>` resolve, and the title you pass decides that filename.
  Pick what a person would type after `@` without thinking. One word where you can, hyphenated
  where you must, never a phrase.

## Writing it

Two commands. The first makes a profile that already works; the second makes it one another
agent has a reason to choose.

**Check the name is free first**, because a refusal after you have written the body wastes the
writing. The list is small and typed — this is not a corpus sweep:

```bash
corpus doc list --type agent-def
```

**Both values below are somebody else's, so both go in by path.** The name they asked for and
the description of what they asked it to do are their words, not yours, and words you did not
choose do not go on a command line. **What the shell would otherwise do to those two values
is the orchestrate skill's to state, and it is stated there alone.** Here it binds both of
them every time, the ones that look safe included — you cannot see afterwards what came out wrong,
and the document is what a person reads.

Write `/tmp/corpus-title.txt` with your file-writing tool:

```
Bookkeeper
```

**Create the document.** `agent-def` has a document root of its own, so pass no `--folder`:
the document lands in `.claude/agents/`, at a filename slugged from the title.

```bash
corpus doc create --type agent-def --flag-file title=/tmp/corpus-title.txt --from agent <<'CORPUS_EOF'
The body — the persona, written to the rules above.
CORPUS_EOF
created doc_b7c1d5 — .claude/agents/bookkeeper.md
```

The body stays on stdin because it is **yours** — the persona you just wrote to the rules
above, not anybody's words you are carrying.

**The name is not yours to set.** The server writes it into the frontmatter from the filename
it just allocated, because that filename *is* the address: `.claude/agents/bookkeeper.md` is
what makes `@bookkeeper` resolve. Corpus resolves `@<name>` from the file's path while Claude
Code resolves it from this field, so a value that disagreed with its filename would give one
document two different addresses — `@bookkeeper` in a comment, `money` to a dispatch. That is
why the field is derived rather than passed, and why this create takes no flag that names it:
there is nothing here for you to set, and nothing to look for a way to set. The title you
chose decided the filename; the path the create printed is where to read the name off.

**Then write the description, which is the one field worth your judgement.** The server fills
it in from the title so the profile loads at all, and a title is a label rather than a reason:
*Bookkeeper* tells whoever is choosing an agent nothing about when to choose this one. Replace
it:

Write `/tmp/corpus-description.txt`, which holds the whole `key=value` pair, because that is
what `--extra` takes:

```
description=Reach for this when a question is about money in the corpus — a balance, an invoice, a figure somebody can't place.
```

```bash
corpus doc edit doc_b7c1d5 --flag-file extra=/tmp/corpus-description.txt --from agent
```

The value runs to the end of the file, so a description with a line break in it needs nothing
special — and nothing about what they wrote can reach the shell.

That is a quality step and not a repair — skip it and what you have is a working profile
nobody has a reason to pick. `--extra` names its own delta and takes no key.

**There is nothing to read back.** Both of the fields Claude Code needs are the server's on a
create — `name` derived above, `description` copied from your title — and neither is something
this create lets you pass, so it cannot be asked for a profile that is missing one. A create
that printed a path produced a persona that loads, and confirming that is ceremony.

**That guarantee belongs to the create and stops there.** It says nothing about a profile you
did not just write: one somebody hand-authored may carry no `description` at all, and a write
to that file succeeds and tells you nothing — it has to, or a file that never had one could
never be repaired. What reports a profile Claude Code cannot load — a description missing or
empty, a `name` that is not the filename — is `corpus doc check`, at any age and as an error.
So never read a write's success as evidence that anything loads. What no check can tell you is
whether the body says anything worth following; that pass is yours, and it is the section above.

**Revising a profile that already exists is not this skill.** It is an ordinary document edit,
under the rules the orchestrate skill states for writing a document, and it needs the person's
yes first — see the refusals below.

## Refusals

Each of these is said plainly. None of them is worked around.

- **The name is taken.** `corpus doc create` refuses at exit **5** — *the name `bookkeeper` is
  already taken in .claude/agents* — and writes nothing. Do not retry under a name nobody
  asked for: `@bookkeeper-2` is a second persona at an address the person will never type, and
  the address they did ask for goes on meaning the older document. Read what is there
  (`corpus doc show <id>`), say what it is for, and offer the two real choices: a different
  name, or revising the profile that exists. **Revising it is a different request and needs
  their yes** — you were asked for a new agent, and quietly rewriting an existing persona
  because its name was convenient changes how work already routed to it behaves.
- **The write is refused for any other reason.** Report the exit code and the message as it
  came back. Never retry into a different folder: a `type: agent-def` document filed anywhere
  but `.claude/agents/` is a document *about* an agent rather than an agent, and it resolves
  to nobody.
- **The request is blank.** Say what you would need — what it is for, and one thing it should
  do differently from the ordinary agent — and write nothing. A form does not help here;
  the person has not decided yet, and a document written now would be yours, not theirs.
- **The name is also a skill's.** This is legal and still worth a sentence: skills answer to
  `/<name>` and profiles to `@<name>`, so both can exist and be different things. Nothing
  breaks — people type the wrong sigil. Say it, and let them choose.
- **You were asked for one profile, so you write one document.** You never edit a profile you
  did not just create, never rename one, never archive one to free up a name. Each of those
  changes how work already routed elsewhere behaves, and none of them is contained in "make me
  an agent".

## Reporting it

Say four things: **what you created, where it lives, what it does, and how to reach it.** The
last is the one that gets left out, and it is the one the person needs.

The reply's grammar — the trace line, the model, the fences — is the comment skill's, and this
skill does not restate it. What belongs to this skill is the content:

- the name as it will be typed, sigil included
- the path, because a profile is a document the person can open, read and edit
- one line of what it does, in their words rather than the document's
- **how to reach it**: mention it in a comment, or make it resident on a standalone
  conversation with `corpus thread designate <th_…> --agent <name>` — which is theirs to run,
  not yours
- every assumption you made instead of asking, and which sentence each one produced

That last point is not politeness. A profile is a first draft of somebody's idea of an agent,
and the fastest route to a good one is a draft that says out loud where it is soft.

## Worked example

**This is one profile, not a template.** What is worth copying below is the *checking* — the
gathering, the two commands, and the pass over the body against the rules above. The words are
this request's and belong to nobody else's; a request that sounds similar still gets a persona
written from what that person actually said.

The thread: *"I keep having to remind you where the numbers came from. Can I have an agent
that just does that properly for the money stuff?"*

Three of the four things are already in the room — what it is for (the money documents), how
it should behave (say where every figure came from), and what it should not do (it is not the
general agent, so it should not wander). The fourth, what a good answer looks like, is missing
and is guessable rather than askable. Guess it, and say that you guessed.

Both values are theirs, so both go in by path. Write the two files with your file-writing
tool — `/tmp/corpus-title.txt`:

```
Bookkeeper
```

and `/tmp/corpus-description.txt`, which holds the whole `extra` pair:

```
description=Reach for this when a question is about money in the corpus — a balance, an invoice, a figure somebody can't place. It says which document every number came from and doesn't advise.
```

Then:

```bash
corpus doc list --type agent-def
no documents match.
corpus doc create --type agent-def --flag-file title=/tmp/corpus-title.txt --from agent <<'CORPUS_EOF'
You keep this workspace's money documents in one shape.

- Every figure you write carries its source: the id of the document it came from, and that document's date. A figure you cannot source does not go in the answer — say it is unsourced instead.
- When two documents disagree about a number, give both, name which document is newer, and stop there. Never pick one silently.
- You do not forecast and you do not advise. Asked what to do, lay out what the documents say and leave the decision where it belongs.

A good answer from you is a short table of figures with their sources and one sentence under it. Where that is not enough room, say what is missing rather than padding it out.
CORPUS_EOF
created doc_b7c1d5 — .claude/agents/bookkeeper.md
corpus doc edit doc_b7c1d5 --flag-file extra=/tmp/corpus-description.txt --from agent
edited doc_b7c1d5
key 4f2a9c7e1b8d0356a4e9c2f7b1d84a06e35c9f2b7a08d146e2c95b3f7a1d0e84
```

Now check that body against the rules above, which is the step worth not skipping. Two things
it does differently from the ordinary agent: it sources every figure, and it refuses to
reconcile a disagreement. All behaviour, no biography. Two explicit refusals. One sentence of
output shape. Nothing restated from the workspace's own rules. A one-word name somebody will
actually type. Twelve lines.

Then the reply, which is where the person finds out any of this happened:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
Written — `@bookkeeper`, at `.claude/agents/bookkeeper.md`.

It sources every figure it writes back to the document that figure came from, gives you both sides when two documents disagree instead of picking one, and declines to advise. Answers come back as a short table with a sentence under it.

Mention `@bookkeeper` in a comment to hand it something. To put it in charge of a whole conversation, that designation is yours to make: `corpus thread designate <th_…> --agent bookkeeper`.

One guess in there: you did not say what you wanted its answers to look like, so I gave it the table-and-a-sentence shape. That is the last line of the document — edit it if it is wrong.
↳ created the bookkeeper profile
CORPUS_EOF
```
