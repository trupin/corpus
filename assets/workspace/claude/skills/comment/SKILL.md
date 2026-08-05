---
name: comment
description: Handle a thread event — read the thread and its anchored context, do what the comment asks through the corpus CLI, file inbox captures, codify what recurs, and reply to the waiting person. Invoked by the orchestrate skill for comment.created and form.respond events.
id: doc_skillcomment
type: skill
title: Comment
created: 2026-07-26T00:00:00Z
updated: 2026-08-02T00:00:00Z
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

`form.respond` — a form you raised was answered. Its payload is
`{"threadId":"th_4b8e2c","formTs":"2026-07-28T09:20:11Z","option":"finance","note":null}`,
where `formTs` is the timestamp of the turn carrying the answered form and `note` is `null`
when the answerer added none. **There is no `parentId` on this payload**: re-derive the parent
with `corpus thread show <threadId>`, which prints it.

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
4. **A user-held lock means defer, not force.** Never break a lock; the deferral protocol is
   in *Doing the work* below.
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
  the file on disk cannot answer that question. Lock state and job state are CLI reads too.
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
  deletes the rest of the document.
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
- **Edit the parent** with `corpus doc edit <id> --from agent` and a heredoc body when the
  request is about the document's content. The heredoc *is* the document's whole new body, so
  this is the escalation of *Gather context*: read the document whole before you rewrite it.
  The write path reconciles every anchor on save —
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

**A user-held lock is a deferral, not a failure.** The edit verbs take the document's lock
implicitly; when the person has their editor open on that document the write is refused with a
`423`, reported as a server error (exit `5`). Do not retry, and do not break the lock. In this
order:

```bash
corpus thread reply th_4b8e2c --from agent <<'EOF'
You're editing [[doc_a1b2c3]] right now, so I haven't touched it. The change is
ready and will land as soon as the document is free.
EOF
corpus job log evt_7c1d9a "waiting on [[doc_a1b2c3]] — the user holds its edit lock"
```

That reply changed nothing, so it carries no trace line. Then **hand the event back to the
orchestrate skill**, naming the locked document: queue state belongs to that skill, and it
is what parks the event on the document's lock. The work re-enters by itself the moment the
lock clears — nobody retries anything by hand, so never tell the person to. Reply *before*
you defer: a pending indicator that goes quiet reads as the agent hanging.

## Inbox filing

Quick creation is inbox-first: the composer's Capture, the omnibox and a column's ＋ all land a
new document in `data/docs/inbox/` and open a whole-document thread asking you to file it. The
capture's id is the event's `parentId`. File it end to end:

1. **Read it whole** — `corpus doc show <parentId>`. The pack briefed you on the capture; step
   3 rewrites its body, which is the escalation earning the full read. One line of text is
   normal.
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

**When the right home is genuinely ambiguous, leave it in `inbox/` and ask.** A two- or
three-way choice is exactly what a form is for; an open question is just a reply. Either way
the document stays in `inbox/` until the answer arrives — a wrong filing is harder to notice
than an unfiled one.

## Reply

One command, always:

```bash
corpus thread reply th_4b8e2c --from agent <<'EOF'
6.4% is more representative than 6.1% for a 30-year fixed today. Updated the
assumption and the projection note in [[doc_a1b2c3]].
↳ updated the rate assumption in [[doc_a1b2c3]] to 6.4%
EOF
```

Rules:

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
- **Open the fence wider than anything inside it.** A fence ends at the **first line carrying a
  backtick run as long as the one that opened it**. So three backticks around a payload that
  itself contains three backticks closes early: one deliverable becomes several blocks, your
  prose spills out between them, and each copy button hands over a fragment — which defeats
  the whole point of handing the thing over in one gesture. Before you write the fence, find
  the **longest backtick run in the payload and open with one more than that**: four around a
  payload containing three, five around one containing four, and so on. The rule is the count,
  not the number four. This bites most often on the deliverable that matters most — a prompt
  written for another agent, which is itself markdown and routinely contains fenced examples.

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

  Documents written before this rule are **not** repaired retroactively — a deliverable that
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
with the "note only" toggle. So end turns like someone who will be asked again:

- Say when you consider a matter closed, in words: "that's the whole change — nothing else in
  the document referenced the old figure."
- **Suggest resolving** when the exchange has run its course.
- **Do not resolve on the person's behalf.** Run `corpus thread resolve <id> --from agent`
  only when they asked for the matter to be closed. A thread you resolved unilaterally stops
  waking you, which is exactly the failure they cannot see.

## Forms

Raise a form when a **bounded choice unblocks the work** — two or three destinations for a
capture, two readings of an ambiguous request. An open question is not a form; it is a reply.
A form is the last thing in the turn body you pass to `corpus thread reply <id> --from agent`,
and it looks exactly like this — a fence whose info string is `form`, written with backticks:

```form
prompt: Where should this note live?
options:
  - finance
  - housing
  - leave it in inbox for now
```

The grammar is not negotiable, because **nothing validates the block when it is posted**: a
malformed form is accepted, renders as nothing useful, and fails only when the person tries to
answer it. So: `prompt` non-empty; `options` at least one entry, each non-empty and all
distinct; **at most one form per turn** (a form is identified by its turn's timestamp);
**single-select** — the answer names one option verbatim, plus an optional free-text note.

Answering appends a turn and enqueues `form.respond`, which comes back to you. **It is a
continuation, not a new request.** Re-read the thread with `corpus thread show <threadId>`,
find the form you raised at `formTs`, and resume from exactly there: the payload's `option` is
the decision you were waiting on, and `note` is anything they added. Do the work you had
staged. Never re-ask, never re-explain from the top, and never restart the exchange — the
person answered a question and expects the next step, not the same conversation again.

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
  subject is exactly how threads are handled. A skill is a document:
  `corpus doc edit <skillDocId> --from agent` with a heredoc body, keeping **both** frontmatter
  field sets intact — `name` and `description` for Claude Code, `id`/`type`/`title`/`tags`/
  `status` for Corpus — so both readers keep seeing it.
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
  are cheap: `corpus skill rollback <name>` undoes a genesis that misbehaves, and
  `corpus doc archive` disables a skill that stopped earning its place.

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
  edit the skill through the CLI, announce the change prominently, and name
  `corpus skill rollback <name>` as the undo in case the new wording misbehaves.
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
corpus doc edit doc_a1b2c3 --from agent <<'EOF'
# Mortgage options

The working rate assumption is 6.4% as of 2026-07-28.

Thirty-year fixed offers currently cluster between 6.1% and 6.6%; every
projection in this document now uses 6.4%.
EOF
corpus job log evt_7c1d9a "edited [[doc_a1b2c3]] — rate assumption 6.1% to 6.4%"
corpus thread reply th_4b8e2c --from agent <<'EOF'
Not any more — 6.4% is the representative 30-year fixed rate today. Updated the
assumption and the projection note in [[doc_a1b2c3]]; the anchored sentence is
the one that changed.
↳ updated the rate assumption in [[doc_a1b2c3]] from 6.1% to 6.4%
EOF
```

**2 — Standalone Ask that gets a title and a document.** `parentId` was `null` and the payload
carried `"unresolved": ["researcher"]`.

```bash
corpus thread show th_9f21c4
corpus doc create --type note --title "Espresso extraction troubleshooting" --folder kitchen --tags coffee --from agent <<'EOF'
# Espresso extraction troubleshooting

Sour and fast means under-extraction: grind finer before changing dose.
Bitter and slow means the opposite.
EOF
corpus doc edit th_9f21c4 --title "Why does my espresso taste sour?" --from agent
corpus thread reply th_9f21c4 --from agent <<'EOF'
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
corpus doc edit doc_5c8b2f --title "Quarterly insurance review" --from agent <<'EOF'
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
corpus thread reply th_1a7d33 --from agent <<'EOF'
Filed this as [[doc_5c8b2f]] — "Quarterly insurance review", now in `finance/`,
tagged insurance and review. I added the structure and left one open question in
it: I don't know which quarter the policy renews in.
↳ retitled, expanded and filed [[doc_5c8b2f]] into finance/, tagged insurance and review
EOF
```

**4 — A `form.respond` continuation.** The payload was
`{"threadId":"th_1a7d33","formTs":"2026-07-28T09:20:11Z","option":"finance","note":"put it with the mortgage stuff"}`.

```bash
corpus thread show th_1a7d33
corpus doc move doc_5c8b2f --folder finance --from agent
corpus job log evt_9b4c02 "form answered: finance — completed the filing of [[doc_5c8b2f]]"
corpus thread reply th_1a7d33 --from agent <<'EOF'
Finance it is — [[doc_5c8b2f]] now lives in `finance/`, next to the mortgage
notes. That closes the filing I paused on; nothing else is outstanding here.
↳ moved [[doc_5c8b2f]] into finance/
EOF
```
