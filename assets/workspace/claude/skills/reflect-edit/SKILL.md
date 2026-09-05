---
name: reflect-edit
description: Reflect on a person's finished editing session — read the change with the event's own commit range, judge whether any claim moved, carry entailed corrections across, and record one changelog entry, opening a thread only for a decision the person must take. Invoked by the orchestrate skill for doc.edited events.
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

The orchestrate skill invokes you for one event type, `doc.edited`, and only after it has
claimed the event. You read the change, you judge it, you act on what it rippled into — and
your report is what the event settles on. Never claim work of your own.

The dispatch that launched you carries the event id, the payload verbatim — both shas
included — and the model you run at. The procedure below is the whole of this skill; work it
in order. Where it names a section in italics that is not in this file — *Delegation*,
*Writing a document*, *Several commands in one invocation* — that is a section of the
orchestrate skill, whose loop dispatched you, and the reference is to the rule stated there.

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
   returned. Never list a folder, never sweep the corpus to see what it holds.
7. **Queue state is not yours to move.** You never run `corpus queue claim-all`,
   `complete`, `fail` or `defer`: you report an outcome, and the orchestrate skill makes the
   terminal call on the event. Where the procedure below shows a `corpus queue` command, it
   is showing the settlement your report leads to — the event's lifecycle as the console
   sees it, not a call of yours.
8. **Every turn you post names the model that wrote it.** `--model <name>` on
   `corpus thread create` and `corpus thread reply`, quoting the word your dispatch handed
   you — a **Model** cell of the tier table the orchestrate skill declares, and nothing
   else. The grammar around a turn — the trace line, labeled fences and their widths — is
   the comment skill's, and it binds here unchanged.

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

**The turn's lane is where it lands, and it is not always yours.** A turn carrying `@agent`
enqueues on the lane of the **thread it was posted in**. An agent turn posted into a
designated conversation wakes that conversation's resident and never appears on your claim;
one posted anywhere else wakes you. So the rule binds every turn any agent in this
workspace writes — yours, your subagents', a resident's — and it binds them all for the same
reason rather than because of who gets woken. What reaches you is the ordinary case, a turn in
a conversation nobody is resident in, and you triage it as you triage everything: it arrives
as a `comment.created` like any other, with no marker anywhere saying a machine wrote the
mention that produced it. That is exactly why the rule is *write no `@agent`* rather than
*detect one*.

Get those two right and nothing here feeds itself. The one other thing to drop is a repeat:
at most one event exists per `sessionId`, so a second carrying an id you already handled is
completed without acting on it.

**1 — Read the change, always, exactly once.** The event's `from` and `to` go in as
`--from-rev` and `--to-rev` unchanged — no conversion, no resolution, including the
empty-tree sha an event carries for a document's **first** change, which diffs as wholly
added:

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

**An empty-tree base is the ordinary shape of a first change, not an anomaly to report.**
`from` is git's empty tree whenever nothing before the range ever touched **this
document** — that is **any** document's first commit, not only one the repository's root
commit introduced. Both ends of a range walk this document's history, not the branch's, and
they have to: a commit window belongs to a party rather than to a document and gathers that
party's saves across documents, so the commit sitting immediately before a document's first
one is routinely somebody else's save to a different file — a commit at which this document
did not exist, and naming it as the base would be a false claim about where this document
came from. What comes back is the whole document as added, which is the truth about a
document with no earlier revision. Read it and judge it like any other change; a new
document being new is not something to raise with anyone.

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

**Those lookups are one invocation, not four.** You know every query before you run any of
them — they come from the diff, and no lookup here reads another's answer — so this is the
shape *Several commands in one invocation* is for, at its cheapest and safest:

```bash
corpus batch <<'CORPUS_EOF'
[["doc","related","doc_a1b2c3","--limit","5"],
 ["search","6.1%","--limit","5"],
 ["search","rate assumption","--references","doc_a1b2c3","--limit","5"]]
CORPUS_EOF
```

The reads you then decide on — the at most three `corpus doc show` calls — go the same way,
in one more invocation, because you have chosen all three ids before you open any of them.

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
**Forms** section, with the `references/forms.md` file it directs a read of, is the whole
grammar and binds here unchanged. Stop at three documents: past
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
corpus doc edit doc_7e3a91 --key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa --from agent <<'CORPUS_EOF'
# Refinance plan

Every projection here assumes 6.4% for the whole term, following the rate
assumption in [[doc_a1b2c3]].

## Changelog

- **2026-07-28** — carried the working rate assumption from 6.1% to 6.4%, following the
  correction in [[doc_a1b2c3]]. Every projection here reads that one figure, so the change
  is arithmetic and takes no decision.
CORPUS_EOF
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
corpus doc edit doc_a1b2c3 --key 028ee5455198acebc06757dee3a14c12d0009a271ebf5131fc33c7e2c4778d70 --from agent <<'CORPUS_EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28.

## Changelog

- **2026-07-14** — replaced last year's lender table with this year's. Nothing else in the
  corpus quoted those figures.
- **2026-07-28** — the working rate assumption moved from 6.1% to 6.4%. [[doc_7e3a91]]
  projected the whole term at the old figure and I carried the new one across; nothing else
  quotes it, and nothing here needs a decision from you.
CORPUS_EOF
edited doc_a1b2c3
key 5c0f2a7d18e6b4930c1d8f27a6b5430e9f8c72d1a04b6e35f9c2807d61a34be8
corpus job log evt_7c1d9a "completed — logged the change on [[doc_a1b2c3]], no thread opened"
corpus queue complete evt_7c1d9a
```

