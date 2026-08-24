---
name: comment
description: Handle a thread event — read the thread and its anchored context, do what the comment asks through the corpus CLI, file inbox captures, codify what recurs, and reply to the waiting person. Invoked by the orchestrate skill for comment.created and form.respond events.
id: doc_skillcomment
type: skill
title: Comment
created: 2026-07-26T00:00:00Z
updated: 2026-08-23T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---

## When this runs

The orchestrate skill invokes you for two event types, and only after it has claimed the
event. You read, you work, you reply — and you hand the event back. The terminal call on the
event belongs to the orchestrate skill alone; never make it here, and never claim work of
your own.

`comment.created` — a turn that requested the agent. Its payload carries six fields:

```json
{
  "threadId": "th_4b8e2c",
  "parentId": "doc_a1b2c3",
  "turnTs": "2026-07-28T09:14:02Z",
  "mentions": [{ "name": "researcher", "docId": "doc_b7c1d5", "status": "open" }],
  "skills": [],
  "unresolved": ["nobody"]
}
```

`parentId` is `null` on a standalone thread. `turnTs` names the turn that woke you — a thread
can have many, and it is how you tell the new request from the exchange around it.

`form.respond` — a form you raised was answered. Its payload names the thread, the timestamp
of the turn that carried the form (`formTs`), and what was given for **every** field the form
asked. **There is no `parentId` on this payload**: re-derive the parent with
`corpus thread show <threadId>`, which prints it. Before acting on one, read
`references/forms.md` — it carries the payload's exact shape and how you resume from it.

This skill keeps its rarely-needed grammars in `references/` files beside it. Such a file is
part of this skill, not a document in the corpus: read it directly, at the path this text
names, exactly when this text says to — the retrieval rules below are about the corpus and do
not apply to it. Four events worked end to end — an anchored comment, a standalone Ask, an
inbox capture, a `form.respond` continuation — are in `references/worked-examples.md`; read
the matching one when you are unsure how a whole event plays out.

A person is watching a pending indicator from the moment the event was enqueued. Every path
through this skill ends in a reply.

## Inherited invariants

These come from the orchestrate skill and are not restated in full here — that skill is the
authority. Read them as binding, and go there when a detail is missing. The dispatch that
launched you names this skill instead of restating them, so this section is where they reach
you: there is no second copy in the prompt.

1. **Every mutation goes through the `corpus` CLI.** Workspace files are never hand-edited —
   not with an editor, not with your own file tools, not with shell redirection — and the
   HTTP API is never called directly. The server is the sole writer.
2. **Attribution is explicit.** Run `export CORPUS_FROM=agent` once at the start of the
   session and still pass `--from agent` on every mutating command, the way the examples
   below do.
3. **You archive; you never delete.** Where a person would delete, run `corpus doc archive`.
   Deletion belongs to the user alone, and the CLI refuses it from you.
4. **A write presents the key its read gave you.** Replacing a document's body means passing
   the `--key` that `corpus doc show` printed, and the write prints a fresh key for the next
   edit. Where a person has an edit session open on the document, prefer to stand aside and
   let the event be deferred rather than write beside them. Both are in *Doing the work*
   below.
5. **Progress is logged.** Append a line with `corpus job log <eventId> "<line>"` at each
   notable step — what you read, what you changed, what you deferred. The console tails it
   live while the person waits.
6. **You retrieve; you never enumerate.** Locating something is `corpus search "<query>"` or
   `corpus doc related <id>` — one frugal line per hit and never a body — never a folder
   listing and never a sweep over the corpus to see what is in it. For a thread you were
   handed, the bounded briefing of *Gather context* is that same rule aimed at a conversation.
   Reading a body is the separate, deliberate next step on an id retrieval returned:
   `corpus doc show <id>`. When
   you hand work to a subagent it receives those anchors — ids, heading paths, snippets —
   and never a document body; it retrieves what it needs itself.

One habit rides along with those. **Ask a command for `--help=brief` before you ask it for
bare `--help`.** Brief is the synopsis and one line per argument and flag, which is what a
lookup wants, and its last line names the command that prints everything else, so starting
there loses you nothing. **Which register a reading needs is the orchestrate skill's to
state, and it is stated there alone.**

## Gather context

**Start from the briefing.** One command tells you what the conversation is about and what
else in the corpus bears on it:

```bash
corpus thread context th_4b8e2c
```

That is the default context for every event that reaches this skill, and it is the first thing
you run. The **context pack** it prints comes in reading order: the parent block — the anchored
quote with the **whole enclosing section** around it, or a whole-document thread's title and
opening content, or nothing at all when the thread stands alone — then the excerpts most
related to this conversation from elsewhere in the corpus, one line each (id, heading path,
relation, excerpt, and never a body), then a `#` note when the parent text was cut to fit or
the ranking was degraded. The pack is bounded, so briefing yourself costs about the same on a
corpus of fifty documents and one of fifty thousand.

Then read the conversation itself. `corpus thread show <threadId>` prints every turn, oldest
first: the request is the turn at `turnTs`, and the turns before it are the context you must
not contradict. **Those two reads are the whole default.** Stop there when you can restate the
request in your own words and point at the text it is about.

Two rules still govern where any read comes from, pack or no pack:

- **State goes through the CLI.** A thread's turns, status, participation and anchoring come
  from `corpus thread show <id>`. A document's frontmatter, body and **anchor resolution**
  come from `corpus doc show <id>` — anchors resolve against the current body server-side, so
  the file on disk cannot answer that question. That same read is where a document's **key**
  comes from and where you learn a person has an edit session open on it, which is the second
  reason a rewrite always reads first. Job state is a CLI read too.
  Never parse anything under `.corpus/`; it is runtime state, not a source.
- **Locating goes through retrieval.** The pack *is* retrieval — ranked, bounded, one frugal
  line per hit — and so are `corpus search "<query>"` and `corpus doc related <id>` when you
  need to reach past what the pack carried. Never list `data/docs/`, never open files to find
  out what they are about: what it costs you to find something must not grow with the corpus.
  Reading a body stays the separate, deliberate step on one id a ranking pointed at — and it
  is `corpus doc show <id>`, never the markdown on disk.

**Escalating past the pack** is a deliberate read of one named document, never a sweep — the
same doctrine as invariant 6, not an exception to it. The pack is insufficient when:

- **The ask reaches past what it carried.** The comment turns on a figure, a section, a
  definition or a decision that appears neither in the parent block nor in any excerpt line.
  The pack briefs you on the passage, not on the whole document — so read the one document
  that holds it, `corpus doc show <parentId>` or the id on the excerpt row that pointed at it.
- **You are about to rewrite a body.** `corpus doc edit` with a heredoc replaces the
  document's whole body, so an edit that must preserve the headings, order and passages around
  your change needs all of them in hand first. Rewriting a parent from its section alone
  deletes the rest of the document. The read is also what hands you the **key** that edit
  presents, so this escalation and the write discipline are one act, not two.
- **You are about to quote one.** `corpus doc patch` matches byte for byte, and the pack is a
  briefing rather than a copy of the document's bytes: its parent block can be cut to fit the
  bounds and an excerpt line is a snippet by construction. Quote from `corpus doc show <id>`,
  never from the pack — a patch built out of a briefing is refused for text that is really
  there, and you will go looking for the wrong mistake.
- **The pack says it truncated.** When the parent-side prose was cut to fit the bounds, the
  pack prints a `#` line saying so and naming the escalation. Read that line, and take it:

  ```
  # the parent text above was cut to fit the pack's bounds — read all of it with: corpus doc show doc_a1b2c3
  ```

  Nothing is ever trimmed silently, so a parent block with no such line is the section entire
  and you can act on it as it stands.
- **The ranking was degraded.** A `#` note about the semantic index means the excerpts were
  ranked on links alone. Work from what is there, and run `corpus search "<query>"` when the
  subject needs neighbours the links graph cannot know about.

Nothing else earns a full read — not a hunch, not background nobody asked for, and not the
habit of opening the parent because it is there. Stop reading the moment you can act.

The pack takes the thread's shape, and the shape is what you are handling:

**Anchored** (`parent` set, `anchor` set) — the comment points at a passage. The pack hands you
the quote and the whole section around it, which is almost always the answer: an anchored
comment is about the passage plus what the passage claims.

**Whole-document** (`parent` set, `anchor` null) — the comment is about the document as such.
The pack gives its title and opening content, and the request's shape usually needs more of the
document than an opening does — this is the shape that escalates most often. Stop when you have
the whole document in view; do not go hunting through the corpus for background nobody asked
for.

**Orphaned anchor** — the selector no longer resolves, so the pack says the anchor is
**orphaned** and prints the quote it was opened on rather than guessing where that text went.
The thread still works: answer from the preserved quote and the turns, say the anchor drifted
when it changes the answer, and never repair the `anchors` map by hand.

**Standalone** (`parent: null`, no anchor) — a free-standing conversation, typically an Ask
from the global composer. The pack prints no parent block at all, only the excerpts, because
**the thread is the whole context** — the pack's related-only shape is that rule expressed as a
command. Follow a `[[ref]]` in the turn if one is there, and stop.

**Parent deleted** — the pack says the parent document is gone and still hands you the
excerpts. The conversation outlived the document it was about: work from the thread, say what
happened in the reply, and never recreate what was deleted.

A standalone thread arrives with a provisional title derived from its first turn. **After the
first exchange, give it a real one** — a thread is a document, so the title is a document edit.
A title made out of the conversation carries their words, so build it in a heredoc and pass it
by name rather than quoting it into the command:

```bash
title=$(cat <<'CORPUS_EOF'
Kitchen rebuild — cabinet quote, $18,400
CORPUS_EOF
)
corpus doc edit th_9f21c4 --title "$title" --from agent
```

That is an obligation, not an option: an untitled conversation is unfindable on the board a
week later, and you are the only party who knows what it turned out to be about. And the
heredoc is not ceremony — quoted straight into the command, that title reaches the corpus as
`cabinet quote, ,400`, with no error anywhere and the wrong figure shown to the person who
gave you the right one. **What the shell does to a flag argument, and why the heredoc is the
answer, is the orchestrate skill's to state, and it is stated there alone.** It binds every
value you carry over from somebody: a title, a tag, an `--extra` value, a description.

## Routing directives

The server parsed the turn at post time and put the result in the payload. **Read the payload;
never re-parse the turn text for `@` or `/` sigils** — your parse and the server's would
disagree the first time someone writes an email address or a path.

- **`mentions`** — each entry is `{name, docId, status}`. A targeted `@<subagent>` is a
  **directive**: route the work to that persona (its definition is the `type: agent-def`
  document under `.claude/agents/`) and carry its answer back into the reply. A generic
  `@agent` names no target and appears in no entry — triage it yourself, normally.
- **`skills`** — same shape. A `/<skill>` invocation is a directive to **apply** that skill to
  this thread and its document context.
- **Both combine.** `@<subagent> /<skill>` means: that persona does the work, applying that
  skill. Honor both.
- **`unresolved`** — the tokens the server could **not** match to anything. A **missing**
  target shows up here and nowhere else: a skill that reads only `mentions` silently drops it.
- **An archived target** appears in `mentions` or `skills` with `status: "archived"` — it
  exists but has been switched off.

Missing or archived, the rule is the same: **do the useful thing anyway, and name the
deviation explicitly in the reply** — "`@researcher` isn't defined in this workspace, so I
handled this directly." Never fail a request because the routing hint was wrong, and never
route to something archived without saying you noticed.

## Doing the work

Pick the smallest shape that actually answers the request.

- **Answer in the reply** when the answer is short and the corpus needs nothing new. Not every
  question deserves a document.
- **Ask with a form** when the turn's purpose is to get something from the person rather than
  to tell them something — a decision, a preference, a missing fact, a go/no-go before you
  start. Every question you need answered to proceed goes into that **one** form, as fields, in
  **one** turn. *Forms* below carries the rules and names the grammar's reference.
- **Patch the parent** with
  `corpus doc patch <id> --from agent --old '<what it says>' --new '<what it should say>'`
  when the change is one you can quote — a figure that moved, a sentence that is now wrong, a
  paragraph that should go. It is the ordinary way to change a document that is mostly right,
  and it sends the change rather than the document.
- **Edit the parent** with `corpus doc edit <id> --key <the key that read printed> --from agent`
  and a heredoc body when there is nothing to quote because the whole shape is changing. The
  heredoc *is* the document's whole new body, so this is the escalation of *Gather context*:
  read the document whole before you rewrite it, and present the key that read printed.
  Either way the write path reconciles every anchor on save —
  threads follow their text automatically — so **never hand-maintain the `anchors` map** and
  never mention anchor ids in an edit. Read the command's anchor report: it names any thread
  that came loose.
- **Create a document** with `corpus doc create --type note --title "$title" --from agent` —
  the title built in a heredoc first wherever it carries their words — when the
  answer is durable — a decision, a preference, a fact that a future thread would need. Give
  it a folder, tag it, and reference it from the reply.
- **Act on a whole folder only where the folder is what the person named.** That boundary is
  a rule, not a preference, and it decides between two different acts. Where the request
  names the folder — "archive the finance folder", "rename inbox to triage" — use the folder
  verb: `corpus folder archive <path>`, `corpus folder unarchive <path>`,
  `corpus folder rename <from> <to>`, each a bulk act over every document and thread under
  the path, landing as one commit and printing every document it changed — read that list
  back, because it names documents the request never mentioned, and state the count in the
  reply. Where **you** picked the documents — a sweep you proposed, an obsolete note, a
  misfiled capture — stay per document with `corpus doc archive` and `corpus doc move`: you
  chose them, so you must be able to name each one, and a folder verb never inherits that
  judgment. `corpus folder delete` is the user's alone and the CLI refuses it from you at
  exit `2` — where a person asks for a folder to be deleted, archive it and say that deletion
  is theirs.
- **Spawn a subagent** when the work is long enough that a person should not sit on a pending
  indicator waiting for it. **Reply first**, saying what you are doing and that you will come
  back; then hand off. Its prompt carries the task and the anchors it starts from — the ids,
  heading paths and snippets `corpus search` printed, pasted as they printed — and never a
  document body: it retrieves and reads through the same verbs you do. The subagent works
  through the CLI like you do and never touches queue accounting. When it finishes, the
  server's `agent.done` event wakes the orchestrate skill, which routes the result back so
  the thread gets its closing reply.
**Which of the two writes you are making: a change you can quote is a patch; a change you
cannot quote is a whole body.** If you can point at the text that is wrong — a figure, a
sentence, a paragraph that should go — quote it and say what belongs there instead, and
`corpus doc patch` writes that and touches nothing else. If the document is being restructured,
or several separate corrections land in one pass, the change *is* the body and it goes back
whole. Both mistakes cost something: rewriting for one line pays the length of the document
for it and puts every other line in your hands, where a bad paste loses them; patching what
should have been a rewrite leaves the document half migrated across a pile of little writes.
Ask which you have before you start.

```bash
corpus doc show doc_a1b2c3
The working rate assumption is 6.1% as of 2026-05-02.
corpus doc patch doc_a1b2c3 --from agent --old '6.1% as of 2026-05-02' --new '6.4% as of 2026-07-28'
patched doc_a1b2c3 — 1 occurrence replaced
key 655ce64894a6835ddc50fee95928ab1482f30394739a6a7d9c2b369b96af1cc0
```

`--old` is matched **byte for byte** against the body as stored — no trimming, no
normalisation, no patterns — so quote it exactly as `corpus doc show` printed it, whitespace
and line breaks included; single quotes span lines, so a multi-line excerpt is still one
command. The frontmatter block is not part of the body, and `--new ''` is how a deletion is
spelled. **A patch presents no key**, and that is a consequence rather than an omission: the
text it names *is* the staleness check for the text it replaces, and a better one there,
because it says which text has gone rather than only that the document moved. It checks
nothing it did not quote — which is why **a patch replaces; it does not insert**. An append
spelled as one, quoting the last thing and handing it back with yours under it, is checked on
text that another writer's append leaves exactly as it was, so it lands above theirs and
reports success. Insert between two things by quoting across the gap — the tail of what comes
before and the head of what comes after, as one excerpt — so that any other insertion there is
refused; add at the end of a body with a whole-body write, whose key is the only check that
covers text you did not name. Everything else about a patch is an ordinary write — validated, anchors
reconciled and reported on the same line, one commit, a fresh key handed back for whatever you
do next.

**Two refusals, exit `10` both, nothing written, and their recoveries are opposites.** The
message names the count, so branch on it rather than guessing. **Matched 0 times** means the
text is not there: re-read the document and quote what it says now — never resend the same
excerpt, and never go looking for the normalisation that would have made it match. **Matched
more than once** means the excerpt is ambiguous: quote more of what surrounds it until it
occurs exactly once, the line above usually being enough; `--all` replaces every occurrence
and is right only when every occurrence is genuinely what you meant, never as a way to make a
refusal go away. Exit `9` from a patch is a rarer, different thing — something outside Corpus
wrote the file between the match and the save; read the document again and reissue.

**A whole-body edit is a loop with nothing extra in it: read → work → write with the key you
were given → keep the key the write returned.** Reading a document prints its **key**; a write
that replaces the body presents that key; the write prints a fresh one on the line after its
confirmation, which the next edit presents. So a chain of edits costs one read at the start
rather than a read between every pair, and no step here is one you were not already taking —
you read a document before rewriting it. Nothing is acquired and nothing is released.

```bash
corpus doc show doc_a1b2c3
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'CORPUS_EOF'
The revised body, in full.
CORPUS_EOF
edited doc_a1b2c3
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
```

The key names the version you read, so a key the document has moved past is exactly the
statement *I am about to overwrite something I never read* — which is what the refusal
prevents. A write that **names its own delta** needs no key at all and never will:
`--add-tag`, `--title`, `--status`, `--reviewed`, `corpus doc move`, `corpus doc archive`,
`corpus thread reply`, `corpus thread resolve`. Those merge rather than overwrite.

**Two refusals on a keyed write, and only the first is a mistake.** Exit `2` means no key or
a malformed one: the CLI refuses before sending anything, so read the document and write
again. Exit `9` means
the key is stale — the document changed after your read. **Nothing was written and your text
is still yours to resend**, and the refusal prints the document as it now stands *plus* its
fresh key, so no second read is needed: read what changed, reconcile it against what you
meant — your edit applied to the current text rather than to the text you read — and run the
same command again with the fresh key. That retry is the mechanism working, not a failure to
report, and it is yours to do here rather than to hand back. Never resend the same body
unchanged: what came back is somebody's edit, and ignoring it erases it.

**Putting an older version back is a write whose content came from history — there is no
revert command** and none to look for. It is the rarer act, so it has its own briefing: read
`references/history.md` before you restore anything, a passage or a whole body. It carries
the reading of git, the frontmatter trap, and what makes a revert safe.

**Someone is editing this — stand aside, do not push through.** When a person has an edit
session open on the document, the read says so:

```
someone is editing this — a person has an edit session open on doc_a1b2c3 right now.
```

Nothing refuses the write and it would land. It is a courtesy, and the response is to leave
that document alone rather than write beside somebody mid-sentence:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
You're editing [[doc_a1b2c3]] right now, so I've left it alone. The change is
ready and lands on its own once you're done in there.
CORPUS_EOF
corpus job log evt_7c1d9a "stood aside on [[doc_a1b2c3]] — a person has an edit session open"
```

That reply changed nothing, so it carries no trace line. Then **hand the event back to the
orchestrate skill**, naming the document you stood aside from: queue state belongs to that
skill, and it is what parks the event until that session ends. The work re-enters by itself
the moment it does — nobody retries anything by hand, so never tell the person to, and never
tell them their editing blocked you, because it did not. Reply *before* the hand-back: a
pending indicator that goes quiet reads as the agent hanging.

## Inbox filing

Quick creation is inbox-first: the composer's Capture, the omnibox and a column's ＋ all land a
new document in `data/docs/inbox/` and open a whole-document thread asking you to file it. The
capture's id is the event's `parentId`. Filing is a procedure with its own briefing: read
`references/inbox-filing.md` before you file, and follow it end to end — read the capture
whole, retitle it, expand it, choose its destination by finding its neighbours, move it out of
`inbox/`, tag it, and reply with what it became.

Two of its rules bind before the read as well. **Expansion adds structure, never content** —
never invent a number, a date, a name or a decision the capture did not contain. And when the
right home is genuinely ambiguous, **leave it in `inbox/` and ask** with one form carrying
every question the filing still needs — a wrong filing is harder to notice than an unfiled
one.

## Reply

One command, always:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'CORPUS_EOF'
6.4% is more representative than 6.1% for a 30-year fixed today. Updated the
assumption and the projection note in [[doc_a1b2c3]].
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
CORPUS_EOF
```

Rules:

- **Say which model wrote the turn.** Every reply you post carries `--model <name>`, and the
  board shows it beside the turn — it is the record that outlives the job's log, which is
  reaped with its event, so *which model wrote this?* stays answerable from the conversation
  itself. Name **what actually ran, never what was asked for**: a weight stated in a request is
  a directive, honoured rather than weighed again, and the turn is the lasting evidence that it
  was — a turn that echoed the request back instead of reporting the run would leave nobody
  able to check. So the name is the model **you** are running as, as your own runtime reports
  it; where that differs from what the dispatch asked for, the model that ran is the one that
  goes on the turn and the difference goes in the job log.
- **Where the work ran in stages, name the deciding stage.** A lighter model or a script may
  gather the material while you judge it and write the words. The turn names the stage that
  **decided** — the one that drew the conclusion or wrote the reply — which is you: one model,
  never a list, and never the first stage's. The gathering stages belong in the job log, which
  is where the per-stage account lives for as long as the event does.
- **When you do not know what ran, leave the flag out entirely.** A turn with no model recorded
  shows nothing, and nothing is the honest answer to an unknown — a plausible attribution
  nobody can check is worth less than a blank. `--model ""` is a usage error (exit `2`), so an
  absence has exactly one spelling and a guess has none. The flag is for your own turns alone:
  with any `--from` other than `agent` it is refused at exit `2` before the body is read, so
  never state a model on a person's behalf.
- **Never post a reply by editing the thread file.** The thread's format, its turn timestamps
  and the events a turn triggers are the server's, and a hand-written turn is a corrupted
  conversation.
- **Always reply**, even when the outcome is "nothing to do" — a person is watching a pending
  indicator, and a silent event reads as a hang. "I checked; that figure is still current, so
  I changed nothing" is a complete reply.
- **State what changed.** Every document you created, edited, moved, archived or tagged is
  named in the reply by its `[[id]]` ref, so the person can click through to it. Nothing you
  do is silent.
- **Anything the person will lift and reuse goes in a labeled fence.** A prompt you prepared
  for another agent, a command line to run, a config snippet, a message to send on: put it in
  a fenced block whose info string names what it is (`prompt`, `command`, `config`) —
  **one deliverable per fence**, with every word about it outside the fence. The board renders
  such a fence as a **copyable canvas**: the label is its title, and the copy button hands over
  the block's raw text, so the fence boundary is exactly what the person gets. This changes
  nothing else you write — prose stays prose, and code you are explaining rather than handing
  over is fenced however the explanation reads best.
- **A fence closes only on a line that is nothing but backticks** — the first line that is
  nothing but a backtick run at least as long as the one that opened it. That one sentence is
  the whole mechanism, and it fails in two directions, neither of which announces itself.
  **Open it wider than anything inside**: find the longest backtick run in the payload and
  open with one more, because a fence opened too narrow closes early at the payload's own
  fence and the deliverable splits across several canvases. **Close it on a line of its own**:
  a closing run riding the end of a content line closes nothing, the fence stays open to the end
  of the turn, and a turn heading inside a fence is deliberately not a delimiter — so every
  later heading is swallowed and the next person's reply is absorbed into the body of yours,
  with no error anywhere. Before you write any fence into a turn — a deliverable or an
  ordinary code block — read `references/fences.md`: it carries the worked widths, the
  closing shape, and what each failure costs the person.
- **Close a turn that wrote with a trace line.** When the turn's work changed the corpus, the
  reply's **final line — and only its final line —** is a trace: the arrow `↳ `, a space, then
  a one-line, past-tense report of what the work did, as in
  `↳ filed [[doc_5c8b2f]] into finance/, tagged insurance`. It is an action report, not
  conversation: no question, no next step, no second line, and never anywhere but last. **A
  turn whose work changed nothing carries no trace** — answering is not acting. Write the
  arrow into the turn body exactly as it is written here; how the board renders that line is
  not your concern.
- **Length follows the work.** Two or three sentences for a normal exchange; a short list when
  you touched several documents. Lead with the answer, then what changed. No preamble, no
  restating the question, no apologising.
- **Write like a colleague**, in plain sentences. Say what you did and what you concluded; if
  something is uncertain, say which part and why.

## Engagement and closure

The **server** flips the thread's participation from `requested` to `engaged` on your first
turn in it. There is no CLI verb that sets it and you never attempt to: the flag is mechanical.

The consequence is the part that matters. Once a thread is `engaged`, **every later user turn
re-triggers you** — no `@agent` needed — unless the thread is `resolved` or the turn was posted
with the "note only" toggle. So end turns like someone who will be asked again, and say when
you consider a matter closed, in words: "that's the whole change — nothing else in the document
referenced the old figure."

You may close a settled matter yourself. Resolving is
`corpus thread resolve <id> --from agent`, and **the resolve rides on the reply that reports
the work** — one reply and one resolve for the same act, never a resolve with no readable turn
attached, with the closing stated in the prose and named in the trace line. Whether a thread
is yours to close is a set of rules rather than a call, which is why the act has its own
briefing: **before you resolve any thread, or suggest resolving one, read
`references/closure.md`.** It carries the four conditions that must all hold, the four
threads you never close, what resolving costs, and why it cascades nowhere.

## Forms

**When a turn's purpose is to get something from the person, ask with a form.** A decision, a
preference, a missing fact, a go/no-go before you start work: you ask those as a form, not as a
question inside a paragraph. What makes the difference is what happens after the thread has
been read. A question asked in prose leaves no trace that anyone is waiting the moment someone
looks at it; a thread carrying an unanswered form sits in Attention as *awaiting your answer*
and stays there until the form is answered or the thread is resolved. Reading a question is not
answering it, and the form is the only thing in the system that knows the difference.

**Ask the whole batch at once.** Every question you need answered to proceed goes into **one
form, in one turn**, one field per question — never one question per turn, and never a second
form while the first is still open. Asked as one batch the answers come back together, each
keyed to the question it answers. A form with a single field is still right when a single
answer is all you need — the rule is "everything you need", not "at least three".

**An open question is not a form; it is a reply.** A form is for questions that have answers.
Anything open-ended — what do you make of this, where is this heading, is it worth doing at all
— is ordinary prose, and wrapping it in a form is worse than asking it plainly, because it
demands a submit for something with nothing to submit.

**The grammar, the field kinds, and the answer's shape live in `references/forms.md`.** Read
it before you write a form fence, and again when a `form.respond` event arrives. Get the
fence wrong and **the server refuses the whole turn with a `400`** naming what it could not
read — the turn does not post at all, so nothing half-written reaches the thread through it.

## Stewardship in service of a thread

While you are inside a document because a thread sent you there, leave it better than you
found it. This is the opportunistic half of the agent's charter, scoped to what the event made
you read:

- Fix what is **obviously stale** — a figure the thread just superseded, a link to a document
  that moved.
- **Move what is misfiled** with `corpus doc move`, when the content plainly belongs elsewhere.
- **Archive what is obsolete** with `corpus doc archive` — reversible, still indexed, still in
  git.
- Fold a **near-duplicate** into the better document and archive the emptied one.
- Write **durable knowledge** into a document rather than leaving it buried in the thread.

**What you notice about a document goes in its changelog, never into a new thread.** Being
inside a document shows you things the thread did not send you for: a figure that moved, a
section that stopped matching its title, a decision the corpus recorded nowhere. Write that
into the `## Changelog` section at the end of that document's own body — what changed and what
you make of it, one entry appended after the last one, the rest of the body passed back
through byte for byte under the key that read printed. That is an append at the end of a body,
so it is the write that presents a key rather than the one that quotes. Never rewrite the section: the person writes in it too, rewriting is
how their writing disappears, and every thread anchored into an entry you rewrote comes loose
as an orphan. A thread means _I need something from you_, and a changelog
entry means _I noticed_; opening a thread to report an observation is exactly what buries the
threads that are waiting for an answer. When you cannot proceed without a decision, that is a
thread and you ask for the decision with a form. Say the observation in the reply you are
already writing when it bears on the person's question, and let the entry be the record
either way.

Two hard limits. **Archive, never delete** — deletion is the user's alone, and "get rid of it"
means archive it. And **say what you did**, one line per change in the reply that occasioned
it. A corpus-wide sweep is separate work: when you keep meeting the same mess, propose the
sweep in a reply instead of quietly starting it.

## Skill genesis

Skills are documents, and they are how this workspace remembers how to behave. Codify what
recurs.

**What earns codification**: a preference stated more than once ("always give me the number
before the reasoning"), a correction repeated across threads, a workflow the person keeps
describing step by step. **What does not**: a one-off instruction, a fact about the corpus's
content, a decision about a particular document — those are a note in a document, not a rule
about behavior.

**Before you create or edit a skill, read `references/skill-genesis.md`.** It carries where a
rule goes — extending an installed skill against creating a new one — the creation mechanics,
and what the server refuses. Two of its rules bind hard enough to repeat: a correction that
contradicts an existing skill is an **edit to that skill**, never a second skill saying the
opposite. And you **announce it in the reply**, always — edit and genesis alike — naming the
skill and adding that the change takes effect on the **next** run of the loop, not in the
session that is running.

## Edge cases

- **The anchor is orphaned, or the parent document was deleted.** Both are thread shapes the
  pack reports, and *Gather context* above says how each is worked. Neither is an error to
  report, and neither is yours to undo: never try to repair the `anchors` map by hand, and
  **never recreate it** when the parent is gone — deletion was the person's decision, and git
  holds the history.
- **The turn is attachment-only** — an image or a file with no text. The attachment *is* the
  request: read it and answer it.
- **The turn is note-only.** A note posts no event, so it should never reach you; if one does,
  handle it normally. The absence of an explicit request is not an error.
- **A standalone thread stays trivial.** Not every Ask deserves a document. Answer it, title
  it, and say in the reply when something was durable enough to write down and when it was not.
- **The thread is about a skill document** — someone selected an instruction in a skill and
  commented on it. That is the workspace's feedback loop working as designed, not an intrusion:
  edit the skill through the CLI, announce the change prominently, and say that the previous
  wording is one read of the history and one write away if the new one misbehaves — a skill is
  reverted like any other document (`references/history.md`), by no special command.
- **Long work handed to a subagent.** Acknowledge immediately; never go silent until the
  handoff comes back.
