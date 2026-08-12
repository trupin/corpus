---
name: comment
description: Handle a thread event — read the thread and its anchored context, do what the comment asks through the corpus CLI, file inbox captures, codify what recurs, and reply to the waiting person. Invoked by the orchestrate skill for comment.created and form.respond events.
id: doc_skillcomment
type: skill
title: Comment
created: 2026-07-26T00:00:00Z
updated: 2026-08-12T00:00:00Z
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

`form.respond` — a form you raised was answered. Its payload names the thread, the turn that
carried the form, and what was given for **every** field the form asked:

```json
{
  "threadId": "th_4b8e2c",
  "formTs": "2026-07-28T09:20:11Z",
  "answers": [
    {
      "question": "Where should this note live?",
      "kind": "choose one",
      "option": "finance",
      "options": null,
      "text": null
    },
    {
      "question": "Which quarter does the current policy renew in?",
      "kind": "write",
      "option": null,
      "options": null,
      "text": null
    }
  ],
  "note": null
}
```

`formTs` is the timestamp of the turn carrying the answered form. Every field of that form has
an entry, in the order the form asked them, and a field the person left blank is the entry
whose three value keys are all `null` — so a question they declined and a question you never
asked never look the same. `note` is `null` when the answerer added none. **There is no
`parentId` on this payload**: re-derive the parent with `corpus thread show <threadId>`, which
prints it.

A person is watching a pending indicator from the moment the event was enqueued. Every path
through this skill ends in a reply.

## Inherited invariants

These come from the orchestrate skill and are not restated in full here — that skill is the
authority. Read them as binding, and go there when a detail is missing.

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
first exchange, give it a real one** — a thread is a document, so the title is a document edit:

```bash
corpus doc edit th_9f21c4 --title "Rate assumptions for the 2026 refinance" --from agent
```

That is an obligation, not an option: an untitled conversation is unfindable on the board a
week later, and you are the only party who knows what it turned out to be about.

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
  **one** turn. *Forms* below carries the grammar and the batching rule.
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
- **Create a document** with `corpus doc create --type note --title "…" --from agent` when the
  answer is durable — a decision, a preference, a fact that a future thread would need. Give
  it a folder, tag it, and reference it from the reply.
- **Spawn a subagent** when the work is long enough that a person should not sit on a pending
  indicator waiting for it. **Reply first**, saying what you are doing and that you will come
  back; then hand off. Its prompt carries the task and the anchors it starts from — the ids,
  heading paths and snippets `corpus search` printed, pasted as they printed — and never a
  document body: it retrieves and reads through the same verbs you do. The subagent works
  through the CLI like you do and never touches queue accounting. When it finishes, the
  server's `agent.done` event wakes the orchestrate skill, which routes the result back so
  the thread gets its closing reply.
- **Route into a plugin** when the request belongs to a plugin's domain. Invoke the skill
  installed at `.claude/skills/<plugin>/` and let it own its document types; never edit a
  plugin's documents field by field from here. The plugin's skill knows the shape; you know
  the conversation.

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
text it names *is* the staleness check, and a better one, because it says which text has gone
rather than only that the document moved. Everything else about it is an ordinary write —
validated, anchors reconciled and reported on the same line, one commit, a fresh key handed
back for whatever you do next.

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
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'EOF'
The revised body, in full.
EOF
edited doc_a1b2c3
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
```

The key names the version you read, so a key the document has moved past is exactly the
statement *I am about to overwrite something I never read* — which is what the refusal
prevents. A write that **names its own delta** needs no key at all and never will:
`--add-tag`, `--title`, `--status`, `--reviewed`, `corpus doc move`, `corpus doc archive`,
`corpus thread reply`, `corpus thread resolve`. Those merge rather than overwrite.

**Two refusals, and only the first is a mistake.** Exit `2` means no key or a malformed one:
the CLI refuses before sending anything, so read the document and write again. Exit `9` means
the key is stale — the document changed after your read. **Nothing was written and your text
is still yours to resend**, and the refusal prints the document as it now stands *plus* its
fresh key, so no second read is needed: read what changed, reconcile it against what you
meant — your edit applied to the current text rather than to the text you read — and run the
same command again with the fresh key. That retry is the mechanism working, not a failure to
report, and it is yours to do here rather than to hand back. Never resend the same body
unchanged: what came back is somebody's edit, and ignoring it erases it.

**Putting an older version back is this same loop.** There is no revert command and none is
needed: **a revert is a write whose content came from history**, so it reconciles anchors,
validates and commits exactly as every other write does. Read the history:
`corpus doc diff <id>` prints the document's path and its last committed change, and
`git log --oneline -- <path>` then `git show <sha>:<path>` go further back. Work out the
content you want back, which is rarely the whole old file — the version you are going back to
predates everything since, and some of that should stay. Then write it the way the change
fits: a passage you can quote goes back as a patch — `--old` what the document says now,
`--new` what it used to say — and only a document that changed wholesale needs
`corpus doc edit <id> --key <the key that read printed> --from agent`. Either way, say in the
reply what you put back. Three things decide whether this is a repair or a second act of
damage:

- **Read from git, never write to it.** `git log`, `git show` and `git diff` are reads. Never
  `git checkout`, `git restore`, `git revert` or `git commit` — the server is the sole writer
  and every change you make goes through the CLI, this one included.
- **Git hands you the whole file; the write takes the body.** Everything down to and
  including the closing `---` is frontmatter the server owns — id, timestamps, tags,
  `anchors` — so pasting the file in as a body writes that frontmatter into the document
  again, as text. Send only what follows it. A patched revert cannot make this mistake: it
  matches body text and writes body text, so there is no whole file in your hands to paste,
  which is one more reason to undo a passage as a patch rather than as a body.
- **The key is what makes a revert safe.** The content came from history, but the key you
  present names the version you just read, so a revert that would clobber a change made since
  that read is refused with exit `9` rather than landing on top of it. The age of the content
  is never the question; what happened after your read is. A patched revert is guarded by the
  excerpt instead: a passage somebody has since rewritten is not there to match, so it is
  refused with the count rather than landing on top of their words.

**Someone is editing this — stand aside, do not push through.** When a person has an edit
session open on the document, the read says so:

```
someone is editing this — a person has an edit session open on doc_a1b2c3 right now.
```

Nothing refuses the write and it would land. It is a courtesy, and the response is to leave
that document alone rather than write beside somebody mid-sentence:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
You're editing [[doc_a1b2c3]] right now, so I've left it alone. The change is
ready and lands on its own once you're done in there.
EOF
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
capture's id is the event's `parentId`. File it end to end:

1. **Read it whole** — `corpus doc show <parentId>`. The pack briefed you on the capture; step
   3 rewrites its body, which is the escalation earning the full read — and the read is where
   the key that write presents comes from. One line of text is normal.
2. **Give it a real title.** "Mortgage rates?" becomes "Mortgage rate assumptions for the 2026
   refinance". The title is what makes it findable.
3. **Expand it into something usable.** Add the structure a reader needs: a heading or two, the
   context the capture assumed, and an open-questions section for what it left dangling.
   **Expansion adds structure, never content** — do not invent a number, a date, a name or a
   decision the capture did not contain. When the intent itself is unclear, ask instead of
   guessing, and leave the document where it is until you have the answer.
4. **Choose a destination by finding its neighbours.** Search for the documents this capture
   belongs beside — `corpus search "<what the capture is about>" --limit 5` — then
   `corpus doc show <id>` on the closest hit, whose path names the folder it lives in, and
   prefer one that already holds similar documents — an existing `finance/` beats a new
   `money/` every time. Never go looking through the tree for folder names. When the search
   comes back with nothing related, the document is a genuine category the corpus does not
   have yet: name the new folder from its subject. The folder comes into being on the move,
   so there is no separate step.
5. **Move it out of `inbox/`** — `corpus doc move <id> --folder finance --from agent`.
6. **Tag it** — `corpus doc edit <id> --add-tag finance --add-tag housing --from agent`.
7. **Reply with what it became and where it lives**, naming the document by `[[id]]`.

**When the right home is genuinely ambiguous, leave it in `inbox/` and ask** — with a form, and
with every question the filing still needs in it: the destination, the tags, the fact the
capture assumed and did not state. One form finishes the filing; three separate questions
across three turns finish nothing three times. The document stays in `inbox/` until the answer
arrives — a wrong filing is harder to notice than an unfiled one.

## Reply

One command, always:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
6.4% is more representative than 6.1% for a 30-year fixed today. Updated the
assumption and the projection note in [[doc_a1b2c3]].
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
EOF
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
- **A fence closes only on a line that is nothing but backticks.** It ends at the first line
  that is **nothing but** a backtick run at least as long as the one that opened it. That one
  sentence is the whole mechanism, and it fails in two directions: a fence opened too narrow
  closes early, and a fence whose closing run is not alone on its line never closes at all.
  Both cost the person something, and neither announces itself.

  **Open it wider than anything inside it.** Three backticks around a payload that itself
  contains a fence closes early — the payload's own ``` line ends your block: one deliverable
  becomes several, your prose spills out between them, and each copy button hands over a
  fragment, which defeats the whole point of handing the thing over in one gesture. Before you
  write the fence, find the **longest backtick run in the payload and open with one more than
  that**: four around a payload containing three, five around one containing four, and so on.
  The rule is the count, not the number four. Counting every run rather than only the ones
  alone on a line is deliberate — a run in the middle of a sentence closes nothing, so the rule
  is stricter than it strictly needs to be, and being one backtick too wide costs nothing while
  being one too narrow splits the deliverable. This bites most often on what matters most: a
  prompt written for another agent, which is itself markdown and routinely contains fenced
  examples.

  A prompt whose body contains a fence is handed over like this, four backticks outside and
  three inside:

  `````markdown
  ````prompt
  ## Output format

  ```
  owner | action | topic
  ```

  **Critical instruction:** answer only in that table.
  ````
  `````

  **Close it on a line of its own.** The closing run has to stand alone: write it at the end of
  the payload's last content line — the last word and the backticks together — and it closes
  nothing, because that line is not *nothing but* the run. The fence then stays open to the end
  of the turn, and this is the failure that costs the most while looking like the least. A
  thread is a sequence of turns delimited by a level-2 heading naming the author and the turn's
  timestamp, and such a heading **inside a fence is deliberately not a delimiter** — that is
  exactly what lets a turn quote the thread format without faking a turn. So an unclosed fence
  swallows every heading after it: the next person's reply stops being a turn of its own and is
  absorbed into the body of yours. They see your opening sentence, their own message is gone
  from the conversation, and nothing anywhere reports an error — the same exchange that reads
  as two turns with the run alone on its line reads as **one** with the run riding the content
  line. It does not render badly; it makes the next message vanish. So: a newline after the
  payload's last character, then the closing run by itself, every time.

  Documents written before these rules are **not** repaired retroactively — a deliverable that
  already split stays split until someone rewrites it. If you are asked why an old snippet
  renders as several canvases, this is why, and the repair is to re-emit it with a wider fence.
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

So a prompt prepared for another agent is handed over like this — the sentence introducing it
above the fence, nothing but the prompt inside it, and the turn's trace line, if the turn
wrote, still last of all:

```prompt
Read [[doc_a1b2c3]] and [[doc_7e3a91]], then say in three sentences whether the
6.4% rate assumption still holds for the 2026 refinance.
```

## Engagement and closure

The **server** flips the thread's participation from `requested` to `engaged` on your first
turn in it. There is no CLI verb that sets it and you never attempt to: the flag is mechanical.

The consequence is the part that matters. Once a thread is `engaged`, **every later user turn
re-triggers you** — no `@agent` needed — unless the thread is `resolved` or the turn was posted
with the "note only" toggle. So end turns like someone who will be asked again, and say when
you consider a matter closed, in words: "that's the whole change — nothing else in the document
referenced the old figure."

**Resolved is a closed door, not a locked one.** A turn a **person** writes on a resolved
thread sets it back to `open` in the same write that appends it, and the rule above then
applies to it unchanged: on a thread you are engaged in, that reply reaches you again with no
`@agent` needed, and one posted "note only" reopens the conversation without waking you. A turn
**you** write reopens nothing, so a thread you closed stays closed until a person writes in it.
That is the whole cost of resolving — one reply restores the conversation — and knowing it is
what lets you close a settled matter instead of leaving it open in case.

**Close what you asked for and got.** You resolve the thread yourself when all four of these
hold at once:

1. you asked the person for feedback or information,
2. they **provided it** — a turn of their own in the thread is the evidence,
3. you have **used** it, and
4. nothing in the thread is still waiting on anyone.

Who opened the thread is irrelevant. The commonest shape is one the person started: they ask,
you need one clarification, they clarify, you finish and close. A settled sub-question inside a
still-live conversation is closed the same way, on its own.

**Four threads you never close**, each a rule rather than a call:

- **A thread the person never replied to.** An unanswered ask is exactly what the open state is
  for, and no amount of elapsed time turns silence into an answer.
- **A thread holding an unanswered form.** It stands in Attention as *awaiting your answer* —
  an outstanding ask by definition, whatever else in the thread has settled and however many of
  its other forms came back.
- **An unfinished piece of your own work.** The thread is open because you owe something, and
  closing it would be marking your own homework done.
- **A question the person put to you that you have not yet answered.** Answer it first: a turn
  that closes without answering is not a closing turn, it is the question going quiet.

Where none of the four applies but you still may not close — the person asked, you answered,
you needed nothing from them — **suggest resolving** and leave the control with them.

**The resolve rides on the reply that reports the work.** One reply and one resolve for the
same act, never a resolve with no readable turn attached:

```bash
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
6.4% it is — applied to the projection in [[doc_a1b2c3]] and to the two figures
downstream of it. That settles the rate question, so I'm closing this thread;
reply here if it turns out not to be settled.
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%; resolved this thread
EOF
corpus thread resolve th_4b8e2c --from agent
```

Which of the two commands runs first changes nothing — your own turn never reopens what you
just closed — but that there **is** a turn changes everything. A bare
`corpus thread resolve <id> --from agent` adds nothing anyone can read, and the board collapses
a resolved thread holding nothing unseen: the conversation would fold away without the person
ever seeing it end. So state the closing in the prose, in words, and name the resolve in the
trace line as the change to a document that it is. Resolving writes the thread, not the parent,
and it names its own delta, so it needs no key and nothing about the parent stands in its way —
neither a person editing it nor a key of yours that has gone stale.

**Resolving cascades nowhere.** A child thread is its own document with its own status: closing
a subthread leaves its parent open, and closing a parent leaves its children open. Resolve
exactly the thread whose matter is settled. Resolving one that is already resolved prints
"already resolved" and changes nothing — not an error, and not worth a second attempt.

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
form while the first is still open. Three questions spread over three turns cost the person
three interruptions and cost you the job of working out which sentence answered which; asked as
three fields they come back together, each answer keyed to the question it answers. A form with
a single field is still right when a single answer is all you need — the rule is "everything
you need", not "at least three".

**Mark a field optional whenever you can proceed without it.** A field is required unless it
carries `optional: true`, so every field you leave unmarked is a gate the person has to get
past before they can submit anything at all. Mark generously: when a form feels like an
interrogation the fix is more optional fields, never fewer forms and never fewer questions.
Keep each question short enough to read as a control — one line, not a paragraph — and put the
detail in the prose above the fence.

**Say in the same turn what you will do with the answers.** The prose above the form is where
you commit to the work: what you will change, where, and what each answer decides. A form with
no such sentence asks the person to submit without telling them what they are authorising.

**An open question is not a form; it is a reply.** A form is for questions that have answers.
Anything open-ended — what do you make of this, where is this heading, is it worth doing at all
— is ordinary prose, and wrapping it in a form is worse than asking it plainly, because it
demands a submit for something with nothing to submit.

**The grammar.** The form is a fenced block whose info string is `form`, written with
backticks, and it comes last in the turn body you pass to
`corpus thread reply <id> --from agent --model <name>` — after the prose, with only a trace
line after it when the turn also wrote. Written out, the ask is one turn: the sentence that
commits to the work, then the fence. This one asks for a decision, a selection and a fact, with
the fact optional:

> I can finish filing this as soon as I know where it belongs and how you want it tagged — I'll
> move it, tag it, and write the renewal quarter into the document as the answer to the open
> question it already carries.

```form
fields:
  - question: Where should this note live?
    kind: choose one
    options:
      - finance
      - housing
      - leave it in inbox for now
  - question: What should it be tagged?
    kind: choose any
    options:
      - insurance
      - review
      - mortgage
  - question: Which quarter does the current policy renew in?
    kind: write
    optional: true
```

`fields` carries at least one entry. Each `question` is non-empty and **distinct within the
form** — an answer names its field by the question text, so two fields never ask the same
thing. `kind` is exactly one of `choose one`, `choose any` and `write`, spelled with the space
exactly as written here, and there is no fourth kind: `choose one` and `choose any` each carry
`options` (at least one, each non-empty, all distinct) and the person picks one or picks any
number; `write` carries no options and takes free text. `optional: true` marks a field the
person may leave blank, and a field with no `optional` line is required. **At most one form per
turn** — a form is identified by its turn's timestamp, so several questions are several fields
of one form, never two forms.

Every `question` and every option is **one line**, and no option is spelled `**Note:**`,
`_(left blank)_`, or one of this form's own questions wrapped in `**…**`. The answer turn writes
each question as a bold heading and each chosen option on a line of its own, so a newline or one
of those spellings would come back as something the person did not say.

Get any of that wrong — a fourth kind, a misspelled key, a repeated option, a question or option
carrying a newline, YAML that does not parse — and
**the server refuses the whole turn with a `400`** naming what it could not read. The turn does
not post at all, so fix the fence and post it again; nothing half-written reaches the thread
through it. That check is yours alone: it runs on turns **you** append to an existing thread,
which is where you ask, and a form fence anywhere else — in a turn somebody else wrote, or in
the first turn of a thread being created — reaches the file unchecked and is then drawn as a
broken code block instead of as controls, asking a question nobody can answer. Post your form as
a turn on the thread and read the `201` back. A turn carrying a form is never revised either:
when you need to ask something else, ask it in a **new** turn rather than rewriting the question
under the person answering it.

**You never answer a form — not the person's, and not your own.** Answering belongs to the
person alone, and the server refuses an answer from you.

**The answer comes back as `form.respond`, and it is a continuation, not a new request.** Its
`answers` list carries one entry per field **of the form**, in the order the form asked them,
each naming the `question` and its `kind` and carrying exactly one of `option`, `options` or
`text` — all three `null` when that field was left blank — plus `note`, the free-text remark
about the ask as a whole. Re-read the thread with `corpus thread show <threadId>`, find the
form you raised at `formTs`, and resume from exactly there: do the work you had staged, and
never re-ask, never re-explain from the top, never restart the exchange. Because each answer
arrives keyed to its question, resuming is a matter of reading the list, not of matching prose
to intent. Every optional field left blank is a **complete** answer: proceed, and do not go
back for the optional ones. And when the person writes a prose reply instead of answering, the
form is still unanswered and its Attention row still stands — answer what they said, ask again
in a new turn if you still need those answers, and never resolve the thread to make the row go
away.

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
through byte for byte. Never rewrite the section: the person writes in it too, rewriting is
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

**Where it goes.**

- **Extend an existing skill when one fits.** Find the skill whose job the pattern belongs to
  the way you find anything else — `corpus search "<the pattern>" --type skill`, since a
  skill is indexed like every other document — and edit it, including this one, whose
  subject is exactly how threads are handled. A skill is a document, so it is read and
  written like one: `corpus doc show <skillDocId>` for its body and its key, then
  `corpus doc edit <skillDocId> --key <the key that read printed> --from agent` with a
  heredoc body, keeping **both** frontmatter field sets intact — `name` and `description` for
  Claude Code, `id`/`type`/`title`/`tags`/`status` for Corpus — so both readers keep seeing
  it.
- **Create a genuinely new skill when nothing installed fits** —
  `corpus skill create <name> --description "<one line>" --from agent` with a heredoc body:

  ```bash
  corpus skill create weekly-review --description "Run the weekly review over the corpus." --from agent <<'EOF'
  # Weekly review

  Survey what changed this week, update what drifted, and reply with the findings.
  EOF
  ```

  The server owns the mechanics; do not pre-check them — know what comes back when one is
  violated. The name is lowercase letters, digits and single hyphens, at most 64 characters
  (anything else is a `400`). A name already installed **or archived** is a `409`; for an
  archived skill that `409` means unarchive it with `corpus doc unarchive <id>` — never
  create the same skill again under a different name. `--description` is required, not
  decoration: Claude Code discovers a skill
  by its `name` and `description`, so a skill without one is installed but never invoked.
  The file lands at `.claude/skills/<name>/SKILL.md` with **both** frontmatter vocabularies
  written by the server — `name`/`description` for Claude Code, `id`/`type`/`title`/`tags`/
  `status` for Corpus — live immediately, findable on the board, and editable like any
  document as long as a later `corpus doc edit` keeps both field sets intact. The ways back
  are cheap and are the ordinary ones: `corpus doc archive` disables a skill that misbehaves
  or that stopped earning its place, and a wording you regret is reverted like any other
  document — read the history, write the old text back with the key (*Doing the work*).

**The conflict rule.** A correction that contradicts an existing skill is an **edit to that
skill**, never a second skill saying the opposite. Two rules in disagreement is worse than the
wrong rule, because nothing tells you which one is current.

**Announce it in the reply**, always, naming the skill you changed or created — codified
behavior the person did not agree to is the one change they cannot see coming, and a genesis
is a real, immediate write into `.claude/`. Add that a skill change — edit or genesis alike —
takes effect on the **next** run of the loop, not in the session that is running.

## Edge cases

- **The anchor is orphaned.** The selector no longer resolves; the thread still works and its
  quote is preserved byte-for-byte. Work from the thread's content, say the anchor drifted if
  it changes the answer, and never try to repair the `anchors` map by hand.
- **The parent document was deleted** between the comment and now. Reply in the thread
  explaining what happened. **Never recreate it** — deletion was the person's decision, and
  git holds the history.
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
  reverted like any other document (*Doing the work*), by no special command.
- **Long work handed to a subagent.** Acknowledge immediately; never go silent until the
  handoff comes back.

## Worked examples

**1 — Anchored comment that edits the parent.** The person selected "6.1%" in a mortgage note
and commented `@agent is this still right?`.

```bash
corpus thread context th_4b8e2c
parent doc_a1b2c3 · Mortgage options · Mortgage options › Rates

> 6.1%

## Rates

The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.

# related excerpts
doc_7e3a91  Refinance plan › Costs  linked  every projection here assumes 6.1% for the whole term
corpus thread show th_4b8e2c
corpus job log evt_7c1d9a "briefed on th_4b8e2c from its context pack"
corpus doc show doc_a1b2c3  # escalation: the edit below replaces the whole body
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28.

Thirty-year fixed offers currently cluster between 6.1% and 6.6%; every
projection in this document now uses 6.4%.
EOF
edited doc_a1b2c3
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — rate assumption 6.1% to 6.4%"
corpus thread reply th_4b8e2c --from agent --model claude-sonnet-4-5 <<'EOF'
Not any more — 6.4% is the representative 30-year fixed rate today. Updated the
assumption and the projection note in [[doc_a1b2c3]]; the anchored sentence is
the one that changed.
↳ updated the rate assumption in [[doc_a1b2c3]] from 6.1% to 6.4%
EOF
```

**2 — Standalone Ask that gets a title and a document.** `parentId` was `null` and the payload
carried `"unresolved": ["researcher"]`. The work ran in two stages: a lighter model gathered
what the corpus already held on the subject, and this session judged it and wrote the answer.
So the turn names the **deciding** stage and the job log carries both.

```bash
corpus thread show th_9f21c4
corpus doc create --type note --title "Espresso extraction troubleshooting" --folder kitchen --tags coffee --from agent <<'EOF'
# Espresso extraction troubleshooting

Sour and fast means under-extraction: grind finer before changing dose.
Bitter and slow means the opposite.
EOF
corpus doc edit th_9f21c4 --title "Why does my espresso taste sour?" --from agent
corpus job log evt_5a2b7c "gathered on claude-haiku-4-5; concluded and wrote the reply on claude-opus-4-1"
corpus thread reply th_9f21c4 --from agent --model claude-opus-4-1 <<'EOF'
Sour usually means under-extraction — the shot ran too fast. Grind one step
finer and keep everything else fixed.

`@researcher` isn't defined in this workspace, so I answered this directly. The
full troubleshooting sequence is durable enough to keep, so I wrote it down in
[[doc_7e3a91]] and titled this thread.
↳ created [[doc_7e3a91]] in kitchen/ and titled this thread
EOF
```

**3 — Inbox capture, filed end to end.** The payload's `parentId` was the captured document.

```bash
corpus doc show doc_5c8b2f
key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa
corpus doc edit doc_5c8b2f --key 839161c3c8ece7a085f1f417041af2ee0348ddeb05da1abb30d32cf4313a61aa --title "Quarterly insurance review" --from agent <<'EOF'
# Quarterly insurance review

Check the home and auto policies against current replacement costs each quarter.

## Open questions

- Which quarter does the current policy renew in?
EOF
corpus search "home and auto insurance policies" --limit 5
doc_3f9a01  Home policy renewal › Replacement cost  …the home policy's replacement cost was last checked in March…
doc_c14be7  Auto policy notes › Premiums            …the auto premium rose 8% at the last renewal…
corpus doc show doc_3f9a01  # its path is data/docs/finance/home-policy-renewal.md — that is the folder
corpus doc move doc_5c8b2f --folder finance --from agent
corpus doc edit doc_5c8b2f --add-tag insurance --add-tag review --from agent
corpus job log evt_2e4f8b "filed [[doc_5c8b2f]] into finance/"
corpus thread reply th_1a7d33 --from agent --model claude-sonnet-4-5 <<'EOF'
Filed this as [[doc_5c8b2f]] — "Quarterly insurance review", now in `finance/`,
tagged insurance and review. I added the structure and left one open question in
it: I don't know which quarter the policy renews in.
↳ retitled, expanded and filed [[doc_5c8b2f]] into finance/, tagged insurance and review
EOF
```

Only the first write there carried a key, and that is not an oversight: it replaced the
body. The move and the two tags name their own deltas, so they merge with anything else that
touched the document while the filing was under way and need no key at all.

**4 — A `form.respond` continuation.** The three-field form above was answered on `th_6c0a18`:
`finance` for the destination, `insurance` and `review` for the tags, the renewal quarter left
blank, and `note: "put it with the mortgage stuff"`. Three answers, one submit, one event.

```bash
corpus thread show th_6c0a18
corpus doc move doc_2f7b91 --folder finance --from agent
corpus doc edit doc_2f7b91 --add-tag insurance --add-tag review --from agent
corpus job log evt_9b4c02 "form answered — filed [[doc_2f7b91]] into finance/, tagged insurance and review"
corpus thread reply th_6c0a18 --from agent --model claude-sonnet-4-5 <<'EOF'
Finance it is — [[doc_2f7b91]] now lives in `finance/` next to the mortgage
notes, tagged insurance and review. You left the renewal quarter blank, so it
stays the open question already written into the document. That closes the
filing I paused on; nothing else is outstanding here.
↳ moved [[doc_2f7b91]] into finance/ and tagged it insurance, review
EOF
```
