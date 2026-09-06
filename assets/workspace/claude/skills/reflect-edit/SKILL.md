---
name: reflect-edit
description: Reflect on a person's finished editing session — read the change with the event's commit range, judge it, carry entailed corrections across, and record one changelog entry. Invoked by the orchestrate skill for doc.edited events.
id: doc_skillreflectedit
type: skill
title: Reflect edit
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## When this runs

The orchestrate skill invokes you for one event type, `doc.edited`, and only after it
claims the event. You read the change, judge it, and act on what it rippled
into — your report is what the event settles on. Never claim work of your own.

The dispatch that launched you carries the event id, the payload verbatim — both
shas included — and the model you run at. The procedure below is the whole of this
skill; work it in order. A section named in italics that is not in this file —
*Delegation*, *Several commands in one invocation* — is the orchestrate skill's, and
*Writing a document* is that skill's `references/writing.md`.

## Inherited invariants

The orchestrate skill is the authority on these; they are not restated in full here.
Read them as binding on you exactly as they bind it, and go there when a detail is
missing. A subagent inherits nothing and the dispatch names this skill instead of
restating them, so this section is where they reach you.

1. **Every mutation goes through the `corpus` CLI.** Workspace files are
   never hand-edited — not with an editor, not with your own file tools, not with
   shell redirection — and the HTTP API is never called directly. The server is the
   sole writer.
2. **Attribution is explicit.** Run `export CORPUS_FROM=agent` once at the start
   and still pass `--from agent` on every mutating command, as the examples below do.
3. **You archive; you never delete.** Where a person would delete,
   `corpus doc archive`. Deletion belongs to the user alone and the CLI refuses it
   from you.
4. **A write presents the key its read gave you.** Read, work, write with that key,
   keep the key the write returned. A stale-key refusal (exit `9`) is yours to
   handle — re-read what the refusal printed, reconcile, write again — never a block
   to report. A person with an edit session open on the document is the one thing
   you stand aside for: leave it alone, say so in your report, and the orchestrate
   skill defers the event.
5. **Progress goes to the dispatching event's job.** `corpus job log <id> "<line>"`
   with the event id the dispatch named, at each notable step, naming the object and
   the change — the console watches this work as it watches the orchestrator.
6. **You retrieve; you never enumerate.** `corpus search "<query>"` and
   `corpus doc related <id>` locate things; `corpus doc show <id>` opens the one id
   they returned. Never list a folder, never sweep the corpus.
7. **Queue state is not yours to move.** You never run `corpus queue claim-all`,
   `complete`, `fail` or `defer`: you report an outcome, and the orchestrate skill
   makes the terminal call. Where the procedure below shows a `corpus queue` command,
   it is showing the settlement your report leads to — the event's lifecycle as the
   console sees it, not a call of yours.
8. **Every turn you post names the model that wrote it.** `--model <name>` on
   `corpus thread create` and `corpus thread reply`, quoting the word your dispatch
   handed you — a **Model** cell of the tier table the orchestrate skill declares, and
   nothing else. The grammar around a turn — the trace line, labeled fences, their
   widths — is the comment skill's, and it binds here unchanged.

## Reflecting on a user edit

`doc.edited` says a person finished an editing session on a document. It carries the
document id, an opaque `sessionId`, the commit range (`from`, `to`) and three counts
— never the diff itself. Reflecting on it is three decisions, in order: what changed,
whether it ripples into other documents, and what to say. The whole procedure runs inside the dispatched subagent, weighed by the two
passes in Delegation like any other work and by no rule of its own: reflecting answers the
first pass **no** — it produces a changelog entry, revised like the rest of the
corpus — so the weight comes from the second pass, which puts a one-document
reflection at the **Sonnet** tier and raises it to **Opus 5** where step 4 is going
to write another document. The dispatch prompt carries the payload verbatim,
the two shas above all: they are passed straight back.

**Your own edits never wake you.** The payload's actor is always `user`: the server
emits nothing for an agent-authored write, and a payload claiming otherwise is
dropped before it reaches you.

**But an agent turn can still wake the loop, so this needs care rather than confidence.**
The server checks the turn's *body* before it checks the author: a turn mentioning
`@agent` enqueues whoever wrote it. So the rule is two things, not one — post
**no `--requests-agent` and no `@agent` in the body**, in every turn you write
here. That
matters most where you are least thinking about it: a ripple comment or an
acknowledgment that **quotes a user's line** carries whatever that line said, and a
quoted `@agent` wakes the loop exactly as a written one does. Quote the passage you
mean, and drop the mention if it carries one. The rule is *write no `@agent`*, never
*detect one*, and it binds every turn any agent in this workspace writes — whose lane a
mention wakes, and why detection is impossible, is `references/reasoning.md`'s to
tell.

Get those two right and nothing here feeds itself. One more drop — a repeat: at most one event exists per `sessionId`, so a second carrying an id you
already handled is completed without acting on it.

**1 — Read the change, always, exactly once.** The event's `from` and `to` go in as
`--from-rev` and `--to-rev` unchanged — no conversion, no resolution, including the
empty-tree sha an event carries for a document's **first** change, which diffs as
wholly added:

```bash
corpus doc diff doc_a1b2c3 --from-rev 0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b --to-rev 9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
doc_a1b2c3 · data/docs/finance/mortgage-options.md
0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b..9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456
1 commit · +2 -2 · 268 characters
```

The stats do not decide whether to make that call — they cannot tell a one-word
correction from a one-word reversal, because `will` becomes `will not` at `+1 -1`
exactly like a misspelling does. What they are for is sizing the read — a change far
past the 16000-character bound comes back cut, and the numbers say so before you spend
the call — and giving you the honest figure to quote when it does.

**An empty-tree base is the ordinary shape of a first change, not an anomaly to
report.** `from` is git's empty tree whenever nothing before the range ever touched
**this** document — any document's first commit. What comes back is the whole document
as added, the truth about a document with no earlier revision: read it and judge it
like any other change, and raise a new document's newness with nobody. Why the base
is the empty tree is `references/reasoning.md`'s to tell.

**2 — Decide triviality from the diff, never from its size.** Read the `-` and `+`
lines as claims and ask one question: does the document assert anything different now?
An edit is **trivial** when every changed line says what it said before — spelling,
punctuation, casing, whitespace, rewrapping, formatting, an ordering that preserves
meaning. It is **substantive** when any changed line adds, removes or reverses a
claim: a number, a date, a name, a status, a negation, a modal, a `[[ref]]`, a
heading that renames a section, or prose that is simply new.

Length is never the test: one word is substantive when it is a negation, a quantity,
a name or a modal; two hundred reflowed lines are trivial. Where the diff leaves you
unable to tell, call it substantive and let the ripple check come back empty — that
costs two retrievals, while a thread about a whitespace fix is the behaviour that gets
the loop switched off by lunchtime.

**A trivial edit is completed in silence** — no thread, no reply, no write. One
job-log line is the whole record, so the console shows the event was seen and judged:

```bash
corpus job log evt_7c1d9a "doc.edited on [[doc_a1b2c3]] — rewrapped a paragraph, no claim changed"
corpus queue complete evt_7c1d9a
```

**3 — Check the ripple by retrieving.** A substantive edit gets two bounded lookups
and no more. `corpus doc related doc_a1b2c3 --limit 5` walks the documents already
linked to this one, and one `corpus search` per changed claim — at most three claims —
finds the ones that are not. Search on what the `-` and `+` lines disagree about, never on the document's own
title, which returns the document you already hold; `--references doc_a1b2c3`
narrows a search to the documents that point back at it.
Open a body with `corpus doc show <id>` only where a snippet restates the old claim,
and open at most three.

**Those lookups are one invocation, not four** — every query comes from the diff and
no lookup reads another's answer, the shape *Several commands in one invocation* is
for:

```bash
corpus batch <<'CORPUS_EOF'
[["doc","related","doc_a1b2c3","--limit","5"],
 ["search","6.1%","--limit","5"],
 ["search","rate assumption","--references","doc_a1b2c3","--limit","5"]]
CORPUS_EOF
```

The reads you then decide on — the at most three `corpus doc show` calls — go the
same way, in one more invocation.

**4 — Update, log, or ask, and lean to logging.** Three outcomes, and only the third
is a thread. **Update** another document when the correction is mechanical and entailed — the
same fact, stated the same way, now wrong, with one way to write the new one. **Log** when the ripple is real and you have no question about it — an entry in
that document's changelog saying what changed upstream and what it means here,
opening nothing; log rather than update whenever the diff came back cut. **Ask** only
when you cannot act without a decision from the person. That is one thread on the
document the decision is about —
`corpus thread create --parent doc_7e3a91 --from agent --model <name> --quote "<the passage that is now wrong>"`
when you can quote the span exactly, which is what makes it findable, the same
command without `--quote` when the passage is not one span — and it asks with a **form**:
a fenced block whose info string is `form`, last in the turn body, one field per
question, asked once. The comment skill's **Forms** section, with the
`references/forms.md` file it directs a read of, is the whole grammar and binds here
unchanged. Stop at three documents: past that, name what looks affected in the entry on the
edited document, and let the person point at the ones that matter.

**5 — Write the entry, and open no thread.** Every substantive edit ends in exactly
one entry, appended to the changelog at the end of the edited document's own body.
**Noticing is written down, not asked about.** A thread means _I need something from you_;
a changelog entry means _I noticed_. Every observation this reflection produced is an
entry — the routine ones and the
ones that look worrying, on the same terms — and the moment one carries a question you cannot
proceed without, that is step 4's ask, on one thread, with a form, about
that question alone. An observation that troubles you and carries no question is
still an entry and nothing more. One entry per session, never a second.
A trivial edit gets none of this.

**The changelog is yours to maintain and theirs to edit; neither of you owns it.**
Somebody remarking on an entry is an ordinary anchored comment and needs nothing
special from you. Why the document rather than a thread — and the cost that trade
accepts — is `references/reasoning.md`'s to tell.

**Say what you made of it, not what the diff said.** Git holds every diff already, so
an entry that only restates one is worth less than the room it takes. Name the claim
that changed, then what it means for the corpus: what you checked, what you found,
what you changed elsewhere, what you deliberately left alone. A date and two sentences is
the size of it. The entry is body text rather than a turn, so it carries no trace arrow.

**Append; never rewrite the section.** There is no append verb — `corpus doc edit`
replaces the body — so it is `corpus doc show doc_a1b2c3` for the body as it now stands
**and for its key**, then one
`corpus doc edit doc_a1b2c3 --key <the key that read printed> --from agent` sending
that body back with the new entry after the last one, every other byte reproduced
exactly. **This is the bounded change that does not go back as a patch**: the section
is the last thing in the body, so the append has nothing on its far side to quote, and
only the key covers the text you did not name — the splice a patch would silently
permit is `references/reasoning.md`'s to tell.

The person writes in this section too: re-wording, re-ordering, re-dating, merging
or condensing an existing entry is how their writing disappears — and every thread
anchored into an entry you rewrote comes loose, which
the edit reports as an orphan after the fact rather than refusing beforehand. Sending the body back is not a licence to tidy it on the way
through: every byte above your entry goes back exactly as the read printed it, the
person's wording included. Entries run oldest first, so the newest goes last. Where the section is absent
the first entry creates it, as the last thing in the body — a blank line, the
heading, a blank line, the entry. That heading is spelled `## Changelog` and nothing else —
a second spelling is a second section, and the reader's clip finds neither.

**The word to read in the anchor report is `orphaned`.** An honest append orphans
nothing, so an orphan after one means what you sent was not what you read: go back to
`corpus doc show` and redo the append from what the document actually says. A
**remap** on a first entry is not a warning — the anchor stayed where it was
(`references/reasoning.md` says why). Later appends report nothing at all.

**This write replaces the body, so it presents a key — where a thread post would have
needed none.** Two things can have happened since the read that gave it. The
document moved — somebody appended their own entry, or changed a line anywhere else
in the body: the write is refused at exit `9` carrying the current text and a
fresh key — append your entry to *that* body and write again, since what moved is
somebody else's change and your entry belongs after it. Or
the person's editor is open again: leave the document alone — you report it, and the
orchestrate skill will defer with `--blocked-on` naming it — and the entry lands
when the event comes back.
Never drop the entry because the document was busy.

**Length is never a reason to prune.** Past a threshold the reader clips the section
and says how many entries sit behind the control, and expanding shows them whole; the
entries stay. You never delete one, never fold two into one, and never
start the section over — the rule that has you archive rather than delete, again.

**A cut diff is never reasoned about as if it were whole.** The size slot on the
counts line says which case you are in, and a `#` notice repeats it under the body.
When it is cut: say so in the entry, never update another document off it, and read
`references/reasoning.md` § *A cut diff* for the two recovery reads.

**Worked, end to end** — the person edits a mortgage note, the reflection carries one
figure across and writes both entries — is `references/worked-example.md`. Read it when
the procedure's shape is unclear, never as part of an ordinary reflection.
