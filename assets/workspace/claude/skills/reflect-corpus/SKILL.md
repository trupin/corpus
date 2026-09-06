---
name: reflect-corpus
description: Reflect on the whole corpus — gather the window the event's `since` opens with one bounded listing, write a changelog entry on each document there is something to say about, and post exactly one digest thread, empty windows included. Invoked by the orchestrate skill for workspace.reflect events.
id: doc_skillreflectcorpus
type: skill
title: Reflect corpus
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## When this runs

The orchestrate skill invokes you for one event type, `workspace.reflect`, and only after it
has claimed the event. You gather the window, you write what you noticed, you post the
digest — and your report is what the event settles on. Never claim work of your own.

The dispatch that launched you carries the event id, the payload's `since` verbatim — `null`
included — and the model you run at. The procedure below is the whole of this skill; work it
in order. Where it names a section in italics that is not in this file — *Delegation*,
*Several commands in one invocation* — that is a section of the orchestrate skill, whose
loop dispatched you, and the reference is to the rule stated there.

## Inherited invariants

The orchestrate skill is the authority on these and they are not restated in full here. Read
them as binding on you exactly as they bind it, and go there when a detail is missing. A
subagent inherits nothing, and the dispatch that launched you names this skill instead of
restating them, so this section is where they reach you: there is no second copy in the
prompt.

1. **Every mutation goes through the `corpus` CLI.** Workspace files are never hand-edited —
   not with an editor, not with your own file tools, not with shell redirection — and the
   HTTP API is never called directly. The server is the sole writer.
2. **Attribution is explicit.** Run `export CORPUS_FROM=agent` once at the start and still
   pass `--from agent` on every mutating command, the way the examples below do.
3. **You archive; you never delete.** Where a person would delete, `corpus doc archive`.
   Deletion belongs to the user alone and the CLI refuses it from you.
4. **A write presents the key its read gave you.** Read, work, write with that key, keep the
   key the write returned. A stale-key refusal (exit `9`) is yours to handle — re-read what
   the refusal printed, reconcile, write again — never a block to report. A person with an
   edit session open on the document is the one thing you stand aside for: leave that
   document alone, say so in your report, and the orchestrate skill defers the event.
5. **Progress goes to the dispatching event's job.** `corpus job log <eventId> "<line>"`
   with the event id the dispatch named, at each notable step, naming the object and the
   change — the console watches this work exactly as it would watch the orchestrator.
6. **You retrieve; you never enumerate.** `corpus search "<query>"` and
   `corpus doc related <id>` locate things; `corpus doc show <id>` opens the one id they
   returned. The window listing the procedure below directs is the one bounded exception —
   bounded by the event's own `since` — and it earns no second sweep beside it.
7. **Queue state is not yours to move.** You never run `corpus queue claim-all`,
   `complete`, `fail` or `defer`: you report an outcome, and the orchestrate skill makes the
   terminal call on the event. Where the procedure below speaks of settling or failing the
   event, it is stating what your report leads to — the event's lifecycle, not a call of
   yours.
8. **Every turn you post names the model that wrote it.** `--model <name>` on
   `corpus thread create` and `corpus thread reply`, quoting the word your dispatch handed
   you — a **Model** cell of the tier table the orchestrate skill declares, and nothing
   else. The grammar around a turn — the trace line, labeled fences and their widths — is
   the comment skill's, and it binds here unchanged.

## Reflecting on the corpus

**Reflection is an act over the whole corpus, and never a side effect of one change.** A stage
moved, a status flipped, a tag added, a document moved or archived: none of those enqueues
anything, and none of them is a message to you. The one event that reaches you is
`workspace.reflect`, and its payload is one timestamp, `since` — the start of the window, the
moment the corpus was last reflected on. Somebody asked for it from the board bar or with
`corpus reflect`, or the corpus went quiet for long enough after a change and the server
enqueued it. Either way the work is the same, and the event is always yours: it falls in no
scope, so no resident owns it.

**You gather the window yourself, and that is the whole cost control.** The event carries a
timestamp and nothing else — no document list, no diff, no summary. One command opens the
window:

```bash
corpus doc list --since 2026-08-21T09:00:00Z --json --fields id,type,title,path,status,stage,tags,excerpt,lastActor
```

`since` is `null` for a corpus nobody has reflected on yet. That means **everything**, so run
the same command with **no `--since` at all** rather than with an empty value. The list
excludes archived documents by default, which is the right default here: an archived document
has been put away rather than left waiting. The list is paginated and the `page` object beside
the items says so — read the next page with `--offset` when the window is wider than one page.

**`--fields` names the nine the paragraphs below read, and asking for the row whole is the
expensive mistake here.** A full `--json` row carries around thirty-five fields — every
excerpt, every last-turn preview, every board key — and measured on a twenty-document window
it costs 203.6 tokens a row against 59.6 for the nine named above. A five-hundred-document
window is the difference between reading a novel and reading a page. Name a field the moment
one of these paragraphs starts reading it, and drop one the moment none of them does: a field
the projection omits is simply absent from the row, with no error anywhere, so the list is
what these paragraphs need and nothing else. `--fields` needs `--json`, and a name no row
carries is a usage error listing the real ones before any request is sent.

**Read a document only when its list line is not enough.** The row carries the title, the
type, the folder (its `path`), the tags, the stage, the status and an excerpt, and for a great
many changes that is the whole story. `corpus doc show <id>` is the deliberate second act,
taken on the few ids that earned it, and `corpus doc diff <id>` shows what moved in one of
them without the document around it. You pick every one of those ids off the listing before
you open any of them, so they go as one invocation together — *Several commands in one
invocation*, on the shape it costs least on. A reflection that reads every document in its
window has turned a cheap act into an expensive one and learned very little more.

**Your own writes are not new work.** A document whose last write was yours is your own output
coming back at you — the changelog entries and the digest a reflection produces are exactly
that. `lastActor` on every row is what tells the two apart, and `user` is the half worth your
attention.

**Never read a stage as an instruction.** A stage is where a document sits in somebody's
workflow. A document in `doing` is not asking you to do it, a document in `review` is not
asking you to review it, and a stage called `agent` is a column name rather than an address.
What a person wants from you arrives as a comment, a form answer, or an ask — not as a word in
a frontmatter field. Report a stage that moved. Never act on it.

**What a reflection produces is two things, and neither is a surprise.** First, an entry in
the changelog of each document you have something to say about — the same appended
`## Changelog` section as everywhere else, one entry, saying what you noticed. A document you
have nothing to say about gets nothing. Second, **one standalone thread, the digest**, and
exactly one per reflection.

**Three things about the digest are mechanical, and getting any of them wrong loses it.**

- **No parent.** It is a standalone thread, so pass no `--parent`. A digest written on a
  document is a comment on that document, and the corpus's digest is about the corpus.
- **`--job <the reflect event id>`.** This is what records the thread as this reflection's
  digest, at the one moment both facts are in the same place. Nothing can recover the link
  afterwards: the event's payload names no thread. Leave the flag off and the board's "what
  the agent said last time" points at nothing, with no error anywhere.
- **Post it before you settle the event.** The thread is promoted to the corpus's digest when
  the event reaches `processed`, so a digest posted after the completion is posted too late.

The digest's first turn is written in this order:

1. **The window**, on the first line: `since <the payload's timestamp> until <the moment you
   gathered>`. A person reading it a week later must be able to tell what it covered.
2. **What moved** — the documents that changed in the window, grouped so the shape is
   readable rather than listed one per line for two hundred rows.
3. **What you did** — every change you made, one line each, naming the document.
4. **What you ask** — the decisions you could not take yourself. Nothing here is rhetorical.

```bash
corpus thread create --title "Reflection — 21 Aug" --from agent --model "Opus 5" --job evt_3d8f04 <<'CORPUS_EOF'
since 2026-08-21T09:00:00Z until 2026-08-22T09:04:11Z

Eleven documents changed, nine of them in `finance/` while you reworked the mortgage
material. [[doc_a1b2c3]] moved its rate assumption to 6.4% and four documents quoted the
old figure.

I carried the new figure into [[doc_7e3a91]] and logged it on both. I filed three inbox
captures into `finance/` and retitled them.

[[doc_f4e9d2]] and [[doc_2f7b91]] both now describe the same refinance scenario, and one of
them should go. I have not merged them, because which one is the keeper is your call.

↳ edited [[doc_7e3a91]], filed 3 captures into finance/ and logged entries on 5 documents
CORPUS_EOF
```

**Post the digest even when there is nothing to say, and post it in one line.** A quiet window
is a real result, and a reflection that stayed silent is indistinguishable from a reflection
that never ran. One line, naming the window, is the whole thread.

```bash
corpus thread create --title "Reflection — 21 Aug" --from agent --model "Opus 5" --job evt_3d8f04 <<'CORPUS_EOF'
since 2026-08-21T09:00:00Z until 2026-08-22T09:04:11Z — nothing changed, nothing to report.
CORPUS_EOF
```

**The digest asks for nothing to run.** Never pass `--requests-agent true` on it and never
write `@agent` in it, or the thread you just posted wakes you to answer yourself. Asking a
person for a decision is what the fourth part is for, and a person answering the digest
re-triggers you the ordinary way.

**Where residents are running, hand each one its own part.** A reflection covers the whole
corpus, and part of that window may sit inside a conversation somebody else owns. Say so in
the digest, and send that resident a message about its own documents rather than settling
their fate from outside. The reflection stays one event, one digest and yours.

**A failed reflection is safe to retry.** The clock only moves when the job reaches
`processed`, so a failure leaves it exactly where it was and the retry opens the same window.
Fail the event with the reason, the way you fail any other, and never invent a narrower window
to make a second attempt cheaper. Never ask for a reflection while you are doing one either —
`corpus reflect` answers an ask that arrives while one is pending with the pending one, at
exit 0, so a second ask is not an error and is also not a second reflection. `--json` carries
`pending`, which is the field that tells the two apart.

