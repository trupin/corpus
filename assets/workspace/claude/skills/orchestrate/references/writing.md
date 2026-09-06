# Writing a document — the whole procedure

The orchestrate skill's body carries the write invariant — a write presents the key its
read gave you — and points here for the rest. This file is the whole procedure: the
patch/rewrite choice, the shell rules for somebody else's words, the key loop and its two
refusals, reverts, the editing courtesy and the deferral it leads to, and the board, kanban
and stage grammar. Read it before a write of your own — a deferral's reply, a revert of a
skill, a board you were asked to build — and name it by path in a dispatch whose work needs
it, since a subagent inherits nothing. The skills a dispatch names carry their own write
procedures; this copy is the one that binds the writes you make yourself.


**Two ways to change a body, and the choice is not a matter of taste: a change you can quote
is a patch; a change you cannot quote is a whole-body edit.** If you can point at the text
that is wrong — a figure, a sentence, a paragraph that should go — then say so: quote it, give
what belongs in its place, and `corpus doc patch` writes exactly that and nothing else. If
there is nothing to point at because the document is being restructured, its argument
rewritten, two sections folded into one, then the change *is* the body and it goes back whole
through `corpus doc edit`. Several separate corrections in one pass are a rewrite by volume:
send the body once rather than quoting your way across the document.

Getting that choice wrong costs something in both directions, which is why it is worth asking
before you start rather than after. Rewriting a document to correct one line pays the length
of the document for that line and puts every other line in your hands, where a bad paste can
lose them. Patching what should have been a rewrite is the opposite failure: one change
becomes a pile of little writes with the document sitting half migrated between them.

**Patching: quote it, replace it.** Read the section that holds it, quote a line of it back
exactly, say what it should say instead. One command, nothing sent but the change.

```bash
corpus doc show doc_a1b2c3 --section "Rates"
## Rates
- 30-year fixed at 6.1%.
corpus doc patch doc_a1b2c3 --from agent --old '30-year fixed at 6.1%.' --new '30-year fixed at 5.8%.'
patched doc_a1b2c3 — 1 occurrence replaced
key 655ce64894a6835ddc50fee95928ab1482f30394739a6a7d9c2b369b96af1cc0
```

**`--old` is matched byte for byte against the body as it is stored** — no trimming, no
normalisation, no case folding, no patterns. Quote it exactly as `corpus doc show` printed it:
whitespace, indentation and line breaks all count, and single quotes span lines in the shell,
so a multi-line excerpt is still one command. The **body** is the markdown alone — the
frontmatter block is not part of it, so an excerpt quoting a frontmatter field matches nothing
and those fields are changed by naming them on `corpus doc edit` instead. `--new ''` is how a
deletion is spelled, and quoting the line breaks around a passage takes its blank line with
it; an omitted `--new` is a usage error, not a deletion, and nothing is sent.

**A patch presents no key, and that is a consequence rather than an omission.** It names the
text it expects to find, which is the same staleness check by another route — and, *for the
text it replaces*, the more useful one, because it tells you which text has gone rather than
merely that the document moved. Its scope is literal: it covers what you quoted and
nothing else, and says nothing about what has grown up around the passage since. There is no `--key` flag on
this verb and passing one is a usage error. Everything else about a patch is an ordinary
write: it is validated before it lands, anchors are reconciled and reported on the same line,
one commit is made under `--from`, and a fresh key comes back for whatever you do next.

**A patch replaces; it does not insert — and an append is an insertion.** One can be spelled
anyway, and its check is on the wrong thing: your quote proves the text you quoted is
unchanged, and what would make you wrong is somebody else's insertion at the same place,
which leaves that text exactly as it was. So decide by what sits on either side of where you are inserting. Between
two things, **quote across the gap** — the tail of what comes before and the head of what
comes after, as one excerpt — and any other insertion there breaks the quote and is refused.
At the **end of the body** there is nothing on the far side to quote and so nothing to
refuse: another writer's paragraph can land between your read and your write, and your patch
splices above theirs at exit 0. That one goes back whole under a key, the only check that
covers text you did not name.

**Two refusals, exit `10` both, nothing written — and their recoveries are opposites.** The
message names the count, so branch on it rather than guessing.

- **Matched 0 times: the text is not there.** Either the document is not what you last read,
  or you quoted from memory instead of from a read. **Re-read it** — the read you
  quoted from — and quote what it says now. Do not resend the same excerpt, and do not go hunting for the
  normalisation that would have made it match; there is none. This refusal is the staleness
  check doing its work, so answer it the way you answer a stale key: read, reconcile, write
  again.
- **Matched more than once: the excerpt is ambiguous.** The text is there N times and nothing
  will choose between them for you. **Quote more** of what surrounds it until it occurs
  exactly once — the line above is usually enough, the heading above that always is. `--all`
  replaces every occurrence and is right only when every occurrence is genuinely what you
  meant; never reach for it to make a refusal go away, because it rewrites text you never
  looked at.

Exit `9` from a patch is a third thing and a rare one: a stale key here means something
**outside** Corpus wrote the file between the match and the save. Nothing you quoted was
wrong. Read the document again and reissue the same patch.

**When the shell is the problem** there are three more flags, and they are escape hatches
rather than the normal form: `--old-file` and `--new-file` read each side from a file byte for
byte, and `--stdin` takes the whole request as one JSON object and therefore takes no other
patch flag. A file and a heredoc both end in a newline, and a newline is text like any other —
an excerpt that should obviously match and reports 0 matches is usually one trailing newline
long.

**The shell reads every argument before the CLI sees it, and what it does to somebody's words
is mostly silent.** A figure is where it bites first. `--title "… quote, $18,400"` does not
arrive carrying `$18,400`: `$18` is a positional parameter, so the title lands as
`quote, ,400` under zsh and `quote, 8,400` under bash — and the second is the worse of the
two, because `8,400` is a figure a person reads straight past. A backtick is not corrupted but
**obeyed**: a title mentioning `` `whoami` `` reaches the document as the username. And single
quotes are not the repair, because they fail on the other character in the same silent way —
`--title 'O'Brien's report'` is three quoted pieces that the shell joins back into one
argument, so the title lands as `OBriens report`, exit `0`, committed, both apostrophes gone.
Each of those is a write that succeeded and a document that is wrong, and nothing afterwards
tells you: not the confirmation, not the exit code, not the commit.

**So text you are carrying over from somebody else never goes on a command line at all.**
Write it to a file with your file-writing tool — which is not a shell and expands nothing —
and name the file:

```bash
corpus doc edit doc_a1b2c3 --flag-file title=/tmp/corpus-title-evt_5a2b7c.txt --from agent
```

`--flag-file <flag>=<path>` works for any flag on any command that takes text, and takes the
file's bytes as the value. `--file <path>` does the same for a body. Between them there is no
character list to keep in your head and nothing to weigh: `$`, a backtick, a backslash, a `!`,
an apostrophe and a quote all reach the server as themselves, because nothing between your tool
and the CLI is reading them.

**Name the file for the job that writes it, never for the flag and never for the subject
alone.** You are not alone in `/tmp`, and you are not alone on this machine: this loop
dispatches events concurrently, a resident works its lane while every other lane keeps moving,
and a second workspace may be running its own agents beside yours. So while you are between
your write and your read, another agent may be at the same step — and two invocations that
chose one fixed name overwrite each other there, so the command carries the other job's value,
exit `0`, committed, wrong.

**Name it for the event you are working: `corpus`, the flag, then the event id** —
`/tmp/corpus-title-evt_5a2b7c.txt`. The event id is minted by the server and is unique across
every workspace and every agent, so two jobs cannot choose it even by accident. **Where you
hold no event** — a resident answering its own conversation, a profile being created before
anything has an id — name it for the subject **and** add something only this invocation knows,
such as the moment you are writing: `/tmp/corpus-reply-th_9f21c4-1432.md`.

**Do not name it for the subject alone.** A thread id looks unique and is not: a summoned
resident replies *in the host thread* while that thread's own lane keeps working, which §7
permits on purpose, so two agents legitimately hold one thread id at the same time. A name is
what nothing else can choose, not what this piece of work is about.

The rule covers every file a command reads back: a flag's value, a body for `--file`, a batch
array for a redirect. And when the command has run, leave the file where it is. `/tmp` is the
system's to clear, a refused invocation's retry reads the same file again, and a leftover named
for its job is a record of what was sent — where a delete step, mislearned by one position,
destroys the value before the command gets it.

**The test is where the text came from, not what is in it.** Words you wrote yourself, out of
ordinary vocabulary, have nothing in them for anything to act on, and `--title "Quarterly
insurance review"` is fine as it stands. Words you are carrying over are the other case —
their question as a thread's title, a figure from their message, a name, a phrase you are
handing back — because you did not choose those characters and so cannot know what is among
them. Those go in by path every time: a title, a tag, an `--extra` value, a description, a
body. One rule, and the same one whether the words fill a document or a single flag.

**Why not a heredoc, which is what this skill used to say.** A heredoc whose terminator is
quoted expands nothing, and for every *character* it is correct. It has one failure that is not
about characters at all: the heredoc ends at the first line that is exactly its terminator, so
a value containing that line ends early and the shell runs the remainder **as commands**.
Measured: a pasted vendor transcript containing a line reading `CORPUS_EOF` created a file,
exited `0`, and committed a document holding a command's own output in place of the missing
lines — with the tail of the message intact, so nothing read as truncated. You cannot inspect
your way out of that, because you would be inspecting the text you are least able to read, and
the write succeeds either way. A path has no terminator, so it has no line that can end it.

**Do not build the file with a shell either.** Redirecting a heredoc into the file first is the
same construction with the same failure, one step earlier. Use the tool that writes a file
directly.

**Where a heredoc is still right.** Words *you* wrote — a reply you composed, a summary, a
document you are drafting — have no such problem, and feeding them to a command on stdin is
shorter than writing a file first. Where you do that, the terminator is always `CORPUS_EOF`,
never `EOF`: `EOF` is the word every shell transcript on earth already ends its heredocs with,
so it is the one most likely to appear in text, and choosing per message is the weighing this
rule exists to remove.

**When the shell refuses the line, the answer is never a double quote.** An unmatched quote or
an unexpected end of file is the loud half of this same defect, and it is the better half:
nothing ran, so nothing was written and nothing was lost. Reaching for a double quote to make
the complaint go away is how a failure you can see turns into one you cannot. If it is
somebody's words in the line, the answer is the file.

**Two refusals to expect from `--flag-file`, and both are the mechanism working.** Naming the
flag and its file together is refused rather than one silently winning — pass the value one
way. Naming a flag the command does not have is refused with the nearest one it does. Both
exit `2`, both name the repair, and neither writes anything.

**The whole-body edit, and the key that protects it.** When there is nothing to quote, the
write replaces the body, and then: **read → work → write with the key you were given → keep
the key the write returned.** That is the whole discipline. Reading a
document prints its **key**; a write that replaces the body presents that key; the write
prints a fresh key on the line after its confirmation, which is the key the next edit
presents. There is nothing to acquire, nothing to release, and nothing left behind if you
stop halfway.

```bash
corpus doc show doc_a1b2c3
Mortgage options
doc_a1b2c3 · note · open
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'CORPUS_EOF'
The revised body, in full.
CORPUS_EOF
edited doc_a1b2c3
key 305eb7108492c96bfdf5dd3e337b4101362de6c23eeb0c3df50df830135957e8
```

The key names the version you read, so presenting it says *this edit is written against what
I saw* — and a key the document has moved past is exactly the statement *I am about to
overwrite something I never read*. That is why the write is refused rather than landed.
Because every write hands back the next key, **a chain of edits costs one read at the
start**, not a read between every pair: carry the printed key forward and keep going. Read
the key as opaque and echo it back exactly — never shorten it, never build one, never reuse
one across two different documents.

**What needs a key, and what never will.** A write that replaces a block needs one, because
it says nothing about what it changes and is the write that can destroy silently: the body
(`-m`, `--file`, a heredoc) and a wholesale frontmatter rewrite.
A write that **names its own delta** needs none, and never will: `--add-tag`, `--remove-tag`,
`--title`, `--status`, `--reviewed`, `--stage`, `--query`, `--extra`, `--unset`, the board keys
`--columns`, `--kanban`, `--order` and `--default-open`, along with
`corpus doc move`, `corpus doc archive`, `corpus doc unarchive`, `corpus thread reply` and
`corpus thread resolve`. Each of those says what it changes, so it merges with whatever else
happened rather than overwriting it. A key is still accepted and still checked on them, which
is worth passing on the rare edit you would rather have refused than merged. And a patch needs
none for the third reason above: it names the text it expects to find, which is that check by
another route.

**Two refusals on a keyed write, and only the first is a mistake.**

- **Exit `2` — no key, or a malformed one.** You asked to replace a body without saying which
  version you were replacing. The CLI refuses before it sends anything, so nothing reached
  the server: read the document and write again with the key it prints.
- **Exit `9` — the key is stale.** The document changed after the read that handed you that
  key. **Nothing was written, and the text you tried to save is still yours to resend.** The
  refusal prints the document as it now stands *and* its fresh key, so no second read is
  needed. Do three things with it, in order: read what changed, reconcile that against what
  you meant to write — your edit applied to the current text, not the text you read — and run
  the same command again with the fresh key. **That retry is the mechanism working**, not a
  failure to report and not a reason to give up on the edit.

Reconcile; never resend unchanged. The text that came back is somebody's edit, and a body
that ignores it erases it just as surely as the write the refusal prevented. The refusal
exists so that you get to decide, and deciding means reading what it printed.

**Putting an older version back is this same loop.** There is no revert command and there is
none to look for: **a revert is a write whose content came from history**, so it goes down
the path every other write goes down — anchors reconciled, frontmatter validated, committed
under you, and refused rather than landed when what it would write over has moved. Three
steps, and only the last one writes.

1. **Read the history.** `corpus doc diff <id>` prints the document's path and its last
   committed change, and for a small change that diff already carries the old text. To go
   further back, read git directly: `git log --oneline -- <path>` lists the revisions that
   touched that one file, `git show <sha>:<path>` prints the file as of one of them.
2. **Work out the content you want back.** Rarely the whole old file: the version you are
   going back to predates everything that happened since, some of which should stay. Decide
   what the body should now say, exactly as you would for any other edit.
3. **Write it**, and the same choice decides how. A passage you can quote goes back as a
   **patch**: `--old` the text standing there now, `--new` the text you are restoring. Only a
   document that changed wholesale needs a read for its key and the whole body back through
   `corpus doc edit`.

```bash
corpus doc diff doc_a1b2c3
git log --oneline -- data/docs/finance/mortgage-options.md
git show 8509044:data/docs/finance/mortgage-options.md
corpus doc patch doc_a1b2c3 --from agent --old 'Rates are refreshed weekly, and' --new 'The rate sheet is republished every Monday, and'  # one passage back
patched doc_a1b2c3 — 1 occurrence replaced
corpus doc show doc_a1b2c3  # or, when the whole shape has to go back: a read for the key
key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471
corpus doc edit doc_a1b2c3 --key 1de897f0cf4fbed1d926cbb25754001ac5c6dd1e6e0be82e67b066fdf0c6d471 --from agent <<'CORPUS_EOF'
The body as it read before the change you are undoing.
CORPUS_EOF
```

**Read from git, never write to it.** `git log`, `git show` and `git diff` are reads, and
you are good at them. `git checkout`, `git restore`, `git revert`, `git add` and `git commit`
are writes into the workspace behind the server's back, and the server is the sole writer —
every change you make goes through the CLI, this one included.

**What git hands you is the whole file; what the write takes is the body.** Everything down
to and including the closing `---` is frontmatter the server owns — the id, the timestamps,
the tags, the `anchors` map — so pasting the file in as a body writes that frontmatter into
the document a second time, as text. Send only what follows it.

**A bounded revert is a patch, and a patch cannot make that mistake.** Undoing one paragraph
is exactly what the verb is for: quote what the document says now, give what it used to say,
and only those bytes move. There is no whole file in your hands to paste by accident, because
a patch matches body text and writes body text — the frontmatter git handed you is not part of
what either half can touch. Keep the whole-body edit for a revert that puts back the shape of
a document rather than a passage of it.

**The key is what makes a revert safe**, and it is the whole difference between this and a
command that puts an old file back. The content came from history, but the write still
presents the key of the version you *just read* — so a revert that would clobber a change
made since that read is refused with exit `9` and the current text in front of you, instead
of landing on top of it. The age of the content is never the question; what happened after
your read is. A patched revert is guarded the same way by the excerpt it quotes: a passage
somebody has since rewritten is not there to match any more, so the refusal comes back with
the count rather than the old words landing on top of theirs. Reverting is a change like any
other, so say so in the reply: name the document, what you put back, and what it said before.

The same loop puts back a skill you edited badly — a skill is a document (the orchestrate
skill's *Skills and subagents are documents* says so). It works
as long as the loop is still running. When the loop itself is what broke, nobody is there to
run this, and the way back is the operator's: see the orchestrate skill's *If the loop
breaks*.

**Someone is editing this — a courtesy, with a named response.** A read also says when a
person has an edit session open on the document:

```
someone is editing this — a person has an edit session open on doc_a1b2c3 right now.
```

Nothing is refused for it and a write would land. It is information, not a gate, and what it
asks for is politeness rather than obedience: a document somebody is typing in is about to
change, so a write beside them answers a version that is already going, and it arrives under
their cursor while they are mid-sentence. Prefer to leave the document alone and come back —
and where the work is a claimed event, coming back has a name: **defer it**, in this order.

```bash
corpus thread reply th_4b8e2c --from agent --model "Sonnet" <<'CORPUS_EOF'
You're editing [[doc_a1b2c3]] right now, so I've left it alone. The change is
ready and lands on its own once you're done in there.
CORPUS_EOF
# nothing changed, so that reply carries no trace line
corpus queue defer evt_7c1d9a --blocked-on doc_a1b2c3 --reason "a person is editing doc_a1b2c3"
```

Reply first — a person is watching a pending indicator — then defer. When the subagent found
the session, the sequence is unchanged: it has normally posted that reply already and
reported what it saw; you make the defer call. A deferral is a postponement, not a failure:
the event moves to `deferred/`, `corpus queue status` counts it under `deferred`, never
`failed`, and the console shows it waiting rather than broken. Say it that way in the reply
too — you stood aside, you were not stopped, and telling a person their editing blocked you
is both untrue and an invitation to close a document they are still using.

`--blocked-on` is required, and it is load-bearing: it names the **document being edited** —
never the thread — because that session ending on exactly that document is what returns the
event to `pending`. Name the wrong document and the event parks forever, waiting on a session
nobody is in. The right value is always the id of the document you stood aside from.

Re-entry is automatic. When the editing session on the blocked-on document **ends**, the
server returns the event to `pending` by itself and a parked `corpus queue idle` unparks — no
operator action, no retry, nothing for you to watch. `corpus job retry` remains only as the
by-hand override for a deferral automatic re-entry did not reach: a session that ended out of
band, or a deferral that named the wrong document.

Deferring is a judgement, so it has an edge. A trivial delta on a document somebody is
reworking — a tag, a status, an archive — merges and is fine to land; a body rewrite is what
the courtesy is about. And where there is no claimed event to defer, there is nothing to
park: finish the rest of the work, leave that one document, and say in the reply what is
waiting on it.

**A board is a document, so building one is writing a document.** The board bar shows
`type: board` documents in their `order`. A board's own frontmatter lists its `columns` — the
ids of the `type: view` documents that draw them, in display order. A view is a saved query
and nothing more: it has no place of its own, and the same view may sit on two boards. So
**"pin me a view" is two writes, and the second one is what pins it**: create the view, then
put its id in a board's `columns`.

```bash
corpus doc create --type view --title "Unresolved finance" --folder views --evergreen true --query type=thread --query status=open --query tag=finance --from agent
created doc_v9f2a1 at data/docs/views/unresolved-finance.md
corpus doc show doc_seedboardattention
corpus doc edit doc_seedboardattention --columns doc_seedattention,doc_seedinbox,doc_seedopenthreads,doc_v9f2a1 --from agent
edited doc_seedboardattention
```

**`--columns` is the whole list, in order, and never an append.** It sets the key to exactly
what you pass, so read the board first and send its current ids with yours added — a list that
drops a column takes that column off the board, silently and successfully. The read is whole:
`columns` is frontmatter, outside every section. Removing a column
is the same write with one id left out, and reordering is the same ids in another order. The
view document itself is untouched by all three: taking a view off a board deletes nothing.

**The order of the board bar is one act, and `corpus board order` is that act.** Name every
board in the bar, first tab first: the verb gives them `1 … n` in the order given and lands
the whole renumbering as a single commit. Positions come from the list, so there is no number
to compute, no gap and no tie that could need resolving. A board already sitting where the
list puts it is not written, so a bar handed back the way it already stood writes nothing at
all. Boards the list does not name keep the `order` they carry, which is what lets you state
the order of the boards a person can see without inventing positions for archived ones.

```bash
corpus board order doc_seedboardfiles doc_seedboardattention doc_seedboardbystatus --from agent
doc_seedboardfiles      1  moved
doc_seedboardattention  2  moved
doc_seedboardbystatus   3  moved
ordered 3 boards — 3 boards moved, in one commit 53629b8b6141d4508a5fdc8a3b79414d84c580fb
```

Count the `moved` rows rather than the ids you sent when you report how many boards moved. An
id naming no document, an id naming something that is not a board, and an id named twice are
each refused before anything is written — a board has one position, so a repeat is not an
order anybody could carry out. Nothing lands by halves.

**Do not reorder a bar with `corpus doc edit <id> --order N` per board.** `--order` is still
the key and still right on **one** board — a board you are creating, or one you are moving on
its own. Across a bar it is a single act spelled as several writes, and what you get back
then depends on timing you do not control. Run consecutively, the writes fold into one commit
named after whichever board happened to be last, so an act over three boards is recorded as
an edit to one. Let more than the commit window pass between two of them and the same reorder
lands as two commits, or three, none of which names the act at all. `corpus board order`
makes one commit every time, because that is a property of the verb rather than of how fast
you typed.

`--default-open true` marks the board that a browser opens onto and that receives every open
naming no board. **At most one board carries it**: setting it clears the
flag from whichever board held it, in the same commit, and the write names that board on a
line of its own. Archiving a board is `corpus doc archive` like any document. **One board is
always showing, and the CLI does not enforce that for you** — the board bar refuses to archive
the last board, and the same archive from here lands, at exit 0, leaving a workspace with no
board on it. Count the boards before you archive one.

**A kanban is a board over one field, and it is one document.** Its `kanban` block names the
`field` — `stage` or `status` — and the `stages` in display order, one column each. Its
columns are derived from those stages and are **not** view documents, so a kanban carries no
`columns` at all. `--query` is the scope every column is drawn from, narrowed per column by
that column's own stage, and a document in scope with no value for the field sits in the first
column.

```bash
corpus doc create --type board --title "Triage" --folder boards --evergreen true --order 4 --query type=note --kanban '{"field":"stage","stages":["triage","doing","done"],"transitions":{"triage":["doing"],"doing":["done","triage"]},"status":{"done":"resolved"}}' --from agent
```

**Leaving `transitions` out is not the same as writing it empty, and the difference is the
whole board.** Omit the key and the graph is the linear funnel: each stage leads to its
neighbours, both ways, which is what most boards want. Write `transitions: {}` and the graph
is one along which nothing may be dragged anywhere. Write neither by accident: decide which
one the request asked for. The graph binds a drag and binds nothing else — anything it forbids
is still done by setting the field, which is the next paragraph.

**Moving a document along a workflow is `--stage`, and it is a different field from
`--status`.** `stage` says where in a workflow a document sits, and it is free-form: its
values are named by the kanban boards that use it, so two boards over the same documents
should share one vocabulary. `status` says whether work remains. Neither ever substitutes for
the other, and writing a status never moves a stage.

```bash
corpus doc edit doc_a1b2c3 --stage doing --from agent
edited doc_a1b2c3
doc_a1b2c3 is now resolved: Triage (doc_b7c3d9) maps stage `done` to that status.
```

**A stage may write a status too, so read past the confirmation.** While a document is in a
kanban, its stage decides its status through that board's explicit map: entering a mapped
stage writes that status in the same commit, and entering an unmapped one writes `open`. When
that happens the CLI prints the server's sentence about it on a **separate line after**
`edited <id>`, naming the board that decided. The confirmation is therefore not always the
last line of the output, and a second effect nobody read is a second effect nobody reported.
Read the whole output, and say in the reply what the stage did to the status.


## The turns you post yourself — canvases and fences

Anything a reply hands over for reuse elsewhere — a prepared prompt, a command line, a
config snippet — sits alone in a fenced block whose info string labels it (`prompt`,
`command`), one deliverable per fence, prose outside it: the board renders that fence as a
**copyable canvas** titled by the label. The comment skill states the convention; it binds
the turns you post yourself just as it binds a subagent's.
**A fence closes only on a line that is nothing but backticks**, and both halves of that
follow from it. **Wider than anything inside** — longest backtick run in the payload, plus
one: a three-backtick fence closes at the payload's own three backticks, and the deliverable
arrives as several canvases with prose leaking between them. **Closed on a line of its own** —
a run left at the end of the payload's last content line closes nothing, so the fence stays
open to the end of the turn, and a turn heading inside a fence is not a delimiter: every
later heading is swallowed, and the next person's reply disappears into the body of yours
with no error anywhere. This is not a corner case for you: the payload you hand over most
often is a **prompt written for a subagent**, which is markdown and usually contains fenced
examples of its own. Check the payload before you write the fence and the newline before you
close it, every time. The comment skill carries both halves with worked shapes, so its
subagents read them there; yours is the copy that binds the fences you write yourself.
