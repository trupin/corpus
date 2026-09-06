# Conventions in full — help, batches, stewardship, skills as documents

The orchestrate skill's body carries each of these rules in short form, and every one of
them binds whether or not this file is open. This file is the full statement: read the
part a pass needs when the body's short form does not answer — before an unusual batch,
before reading a command's whole help, when stewardship or a skill edit is the work in
front of you — never as part of an ordinary dispatch-only pass.

## Reading a command's help — the whole rule

**Ask for `--help=brief` first.** Every command answers bare `--help` with its whole text —
prose about what the verb is for, the full description of every flag, worked examples — and
answers `--help=brief` with the synopsis, one line per argument and flag, and a last line
naming the command that prints the rest. Brief is a lookup. The whole text is a lesson. Most
of the times you reach for help you want the lookup, and the two are not close in what they
cost you: measured on this workspace's build, `corpus doc edit --help` ran to 3,126 words
against 468 for `--help=brief`, and over the twenty-five verbs these skills name it was
25,687 words against 5,023.

**A brief line names a flag; the whole text says what a wrong value costs.** The brief line
for a flag is the first sentence of its full description, so the two registers cannot
disagree about anything — but the sentences brief leaves out are the ones about consequence,
and that is what decides which register a reading needs:

- **Brief, when you know the act and are checking a name, a spelling, or which flag carries a
  value you already hold.** This is most of it, and it is the default.
- **The whole text, when a wrong value would write something you cannot see is wrong.** Three
  of this workspace's own flags say it. Brief calls `corpus doc edit --stage` where a
  document sits in a workflow, and stops before the sentence saying that a stage inside a
  kanban writes a status in the same commit — so you ask for one field and change two. Brief
  calls `corpus doc create --folder` a folder under `data/docs/`, and stops before the
  sentence saying that a folder passed with `--type thread` is validated and then has no
  effect — so the flag is accepted and does nothing. Brief calls
  `corpus doc edit --columns` the ids of a board's views in display order, and stops before
  the sentence separating `--columns ""`, an empty list, from `--unset columns`, no key at
  all. When the flag you are about to pass is one whose damage would be silent, read the
  prose.
- **Neither, when this skill already spells the command.** The worked blocks below carry the
  flags they need and say what the risky ones do. Looking a command up because it is about to
  appear in your own is a read you are paying for twice.

Escalating is cheap and deciding in advance is not, because the last line of a brief help
names the command that prints the whole text. So **start brief, and go on when the brief line
does not answer you** — never the other way round, and never on the theory that a verb you
have not used today owes you the tutorial.

## Several commands in one invocation — the whole grammar

**Every `corpus` invocation pays its startup before it does any work, so a run of commands
costs more in process starts than in the work itself.** `corpus batch` takes a JSON array of
argv on stdin — each entry exactly the words you would have given `corpus`, without the word
`corpus` — runs them in order inside one process, and reports what each one did.

```bash
corpus batch --from agent <<'CORPUS_EOF'
[["doc","patch","doc_a1b2c3","--old","6.1% as of 2026-05-02","--new","6.4% as of 2026-07-28"],
 ["job","log","evt_7c1d9a","edited doc_a1b2c3 — rate assumption 6.1% to 6.4%"],
 ["thread","reply","th_4b8e2c","--model","Opus 5","-m","Updated the assumption to 6.4%.\n↳ updated the rate assumption in [[doc_a1b2c3]]"]]
CORPUS_EOF
```

**One condition decides whether a run may go this way: no entry may need what an earlier entry
printed.** The array is fixed before the first command runs and nothing threads a result from
one entry into the next, so a key a read would have handed you, an id a creation would have
returned, a passage a read would have given you to quote — none of those exist yet when you
write the array. A run that needs one is two invocations, and the second of them may itself be
a batch. Treat that as a hazard rather than a caution: nothing refuses such an array, the
entry that needed the missing value fails on its own, and every entry around it still
succeeds, so the shape of the report looks much like a good one.

**A batch is not a transaction, and nothing in it rolls back.** Every command that succeeded
stays done, whatever fails after it. The server gathers a party's writes into one commit while
its window is open, so several of a batch's writes may well land in one git commit — measured,
three of them did. That is timing, and reading it as atomicity is how a half-applied change
gets reported to somebody as a whole one.

**So read the report, never the exit code alone.** Exit `0` says every command ran and
succeeded. Anything else is exit `11`, which says only that something went wrong. A failure
about one command — a missing id, a stale key, a refused patch — costs that command alone and
the entries after it still run. A failure about the run — the server unreachable, the token
rejected — ends the batch where it happens, and every remaining entry is reported as **never
run** rather than as failed, because each would have failed the same way.

Four things about the grammar, each a refusal when you get it wrong:

- **`--from agent` goes on the batch, once.** It applies to every entry, and an entry's own
  `--from` wins over it. That is invariant 2 satisfied at the invocation rather than weakened:
  one statement of who is acting, covering everything the invocation does.
- **The batch owns stdin, so an entry cannot take a body from there.** A body rides as a `-m`
  value inside the entry, a JSON string with `\n` for its line breaks — which is fine for
  words *you* wrote and is **not** the way to carry anybody else's. Two things happen to them
  on the way in: you have to escape the value into JSON, and the array itself is usually
  arriving on a heredoc, which a value containing that heredoc's terminator ends early. An
  entry carries somebody's words the same way any other command does — `"--flag-file",
  "title=/tmp/corpus-title-evt_5a2b7c.txt"` — so the JSON holds a path you chose and nothing
  you did not. Where the array is long, write it to a file too and redirect it:
  `corpus batch < /tmp/corpus-batch-evt_5a2b7c.json` reads the same array with no heredoc
  anywhere — and the file is named for its event, under the same naming rule every file you
  write for a command follows.
- **The array itself arrives on a heredoc or a pipe**, which are the two transports read. A
  socket is never one: `spawn`, `exec` and a harness handing a child its input all give one,
  and the array is then refused at exit `2` before a byte of it is read. Anything driving this
  loop from a script has to hand the array over one of the two that are read.
- **An entry may not carry `--json`, `--help`, `--version`, `--no-color`, `--verbose` or
  `--workspace`** — those belong to the invocation — and may not be `batch` itself or
  `corpus init`. Each refuses the whole array at exit `2`, before anything runs, as do an
  empty array and one of more than two hundred commands.

**An entry that follows or long-polls holds every entry after it**, exactly as it holds a
shell: the array is one process running the entries in order, so nothing behind such an entry
runs until it returns, and one that never returns stops the array there. `corpus queue idle`
parks for its whole ~8-minute window and `corpus server logs --follow` streams until something
kills it, and those are two instances rather than the list — ask of a verb whether it returns
on its own, and keep it out when the answer is no. `idle` is doubly out: *The loop* forbids
chaining it to the claim, and an array is a chain. Dispatch is the other thing no array can
carry, for a different reason — it is not a command at all.

**The claim is an ordinary entry, and step 4 belongs in a batch.** It did not always: a
`corpus queue claim-all` inside `corpus batch --json` used to hand back `null` while claiming
the events anyway, so the loop kept its claim out of every array. That was a defect in the
batch's JSON channel rather than anything about the verb. It is fixed, and a batched claim now
carries exactly what it carries alone — the `events` list and the `inProgress` list, field for
field. So steps 2, 3 and 4 of *The loop* are one invocation:

```bash
corpus batch <<'CORPUS_EOF'
[["agents"],["queue","reap-stale"],["queue","claim-all"]]
CORPUS_EOF
```

None of the three wants what another printed, which is what makes them one array. Their
**order** still matters, and a batch keeps it: the roster is read **before** the reap (see step
2), and the reap requeues a dead session's events in time for the claim below it to collect
them. Read all three reports — they are three steps
still, and one invocation merges nothing you owe attention to. What it saves is two process
starts a pass — 1003 ms as three commands against 415 ms as one, on the machine that was
measured on.

**A batch that claims, claims — whatever the entries behind it do.** Nothing rolls back, so a
claim that succeeds ahead of an entry that fails leaves those events in `in-progress/` and
yours to settle. The run above ends on the claim for that reason: with nothing behind it,
nothing can fail behind it. Where you do put work behind a claim, the events it claimed are
yours on the report alone — dispatch what was claimed and settle each event on its own
outcome, exactly as step 9 does, rather than treating a failed tail as an unclaim. That is the
same exposure as running the commands one after another. The batch neither adds it nor removes
it, and it is no reason to leave a claim out of an array.

## The stewardship charter, elaborated

The body's bullets are the charter; these are the same bullets with their reasons and
edges. The comment skill carries the working half a dispatched subagent reads.

Leave the corpus better than you found it — opportunistically, while working events, not
only when asked. The charter binds whoever does the work, which is normally a subagent
applying the comment skill; delegation dilutes none of it. The charter:

- **Durable knowledge becomes documents.** A preference, a decision, or a fact learned in a
  thread is written into a document — created, or an existing one updated — never left
  buried in conversation. The rule: if you would need it in a future thread, write it down
  now.
- **Noticing a change is written down, not asked about.** When you notice that a document has
  changed, what you noticed goes into that document's changelog — the `## Changelog` section
  at the end of its body — and no thread is opened for it. A thread means _I need something
  from you_; the changelog means _I noticed_. This holds for every observation, the routine
  ones and the ones that look worrying alike: you open a thread only when you cannot proceed
  without a decision from the person, and then you ask for that decision with a form. It
  narrows what a noticed change may do and narrows nothing else — everywhere else you need a
  decision, a preference or a missing fact, the ask is exactly what it was. The section is
  appended to and never rewritten, so the person's own writing inside it survives; it is
  yours to maintain and theirs to edit, and neither of you owns it.
- **Stale content is updated** when you touch a document and find it out of date.
- **Obsolete documents are archived** — you archive, never delete; deletion is the user's
  alone.
- **Misfiled documents are moved** (`corpus doc move`) to where their content says they
  belong.
- **A folder verb serves a request that named the folder, and it never serves this
  charter.** `corpus folder archive`, `corpus folder unarchive` and `corpus folder rename`
  change every document and thread under a path in one commit — proportionate exactly when a
  person said "this folder", and out of reach of any judgment of yours about what a folder
  holds. The two bullets above stay per document for that reason: stewardship picks its
  documents one by one, and whoever picked them has to be able to name each one in the
  reply. The comment skill carries the working rule at the point the request arrives.
- **Near-duplicates are merged**: fold the lesser into the better, then archive the emptied
  one.
- **Overgrown documents are split**: create the new document, connect the two with a
  `[[ref]]`, trim the original.
- **What you steward, you found by retrieving.** The near-duplicate worth folding in and the
  better home for a misfiled document are both one `corpus search` on the subject away, and
  `corpus doc related <id>` walks out from the document already in front of you. Neither is
  ever a reason to list the tree or read documents to see what they hold: retrieve, then open
  the one id that earned it.
- **Every change is stated in the reply that occasioned it** — one line per change, naming
  the document. Where the work opened no thread to reply in, which is what reflecting on a
  user edit now does, the changelog entry is that statement. Nothing you do is silent.
- **Every turn that wrote closes with a trace line.** When a turn's work changed the corpus,
  its **final line — and only its final line —** is the arrow `↳ `, a space, then a one-line,
  past-tense report of what the work did, as in
  `↳ archived [[doc_f4e9d2]] and moved [[doc_a1b2c3]] into finance/`. It is an action report,
  not conversation. This binds every agent turn, including the ones you post yourself; a turn
  whose work changed nothing — an answer, a deferral, an apology for a failure — carries no
  trace. The comment skill states the same rule for the replies it writes.
- **Every change is traceable.** Your CLI mutations auto-commit with you as git author, so
  the git log answers "what did the agent change, and when" completely.

Scope rule: while handling an event, do the stewardship its own documents call for — the
ones the event made you read and touch. A corpus-wide sweep is separate work: do one when a
thread asks for it, and when you keep meeting the same mess, propose the sweep in a reply
instead of quietly starting it.

## Skills and subagents are documents — the consequences in full

Your skills (`.claude/skills/<name>/SKILL.md`, `type: skill`) and subagent personas
(`.claude/agents/<name>.md`, `type: agent-def`) are ordinary documents: indexed, searchable,
visible and commentable on the board, and edited through the CLI like everything else —
`corpus doc edit` on a skill is how you revise your own behavior when feedback in a thread
calls for it, and a persona is a document in exactly the same way — the file under
`.claude/agents/` is what `@<name>` resolves to, with no registry anywhere to enter it in.
**What a persona has to carry, and how one is written, is the profile skill's to state, and
it is stated there alone.** A request for an agent of somebody's own goes to `/profile`; what
you rely on here is only that the result is a document, revised and archived like any other.
Two consequences:

- An edit to **this** skill or to the comment skill takes effect on the **next**
  `/orchestrate`, not in the running session — say exactly that in the reply whenever you
  change one. The converse skill behaves the same way one level out: an edit to it reaches the
  **next listener launched**, and every listener already parked goes on running the text it
  started with, so a workspace with residents in it holds two versions until they cycle. Say
  that in the reply too, and never restart somebody's listener to hurry it along.
- A bad edit to any other skill you undo yourself, the way you undo a bad edit to any
  document: read its history, work out the wording you want back, write it with the key
  (`writing.md` beside this file). A bad edit to a **core-loop** skill can break the loop that would
  otherwise fix it — that is why the skill body's *If the loop breaks* exists, and why a change to
  `orchestrate` or `comment` is always named prominently in your reply.

## Reconciling the held list, in full

The body's rule is the decision: two actions, and never settle what you cannot
account for. This is the whole account, read when a claim reports a non-empty
held list.

**`inProgress` is a different list from the one you just claimed, and never work to do
again.** It is `in-progress/` as it stood *before* this call's moves, so the events of this
batch are never in it: every row is something the server was already holding for you. Each
row names the event's `id` and `type`, the thread or document it came from (`originId`,
`originTitle`), and `heldSince` as an instant you age against your own clock. The list is
capped at the 20 most recently claimed and says so rather than trailing off — `total` is how
many are really held, `truncated` is true when the cap bit, and
`corpus job list --status in-progress` shows the whole set. In human mode that same list is
also printed as a readable block on stderr, ages rendered as `held 3h`; under `--json` the
block is suppressed and the field alone carries it. Nothing is printed at all when nothing
is held, which is the ordinary case. `corpus queue idle` reports the same field on the
returns that carry work.

**Read every row, and take exactly one of two actions on it.** This is the loop's own
check on itself: the way a job gets stuck is almost never a crash, it is you finishing the
work and never making the settling call, and nothing else in the loop shows you the server's
view of it.

- **You already did this work** — the reply is posted, the edits landed, the subagent
  reported, and the only thing missing was the settling call. Settle it now with the
  ordinary verbs and **do not do the work again**: `corpus queue complete evt_2e4f8b`, or
  `corpus queue fail evt_2e4f8b --reason "the parent document doc_f4e9d2 was deleted"` when
  the work itself is what failed. Record it, so the console's story matches:
  `corpus job log evt_2e4f8b "settled late — the reply on th_9d2f7a was already posted"`.
- **You are still working it** — a subagent you dispatched has not reported yet. Leave it
  exactly where it is. The row disappears from the next claim the moment you record that
  subagent's outcome.

**Never settle an event you cannot account for.** Reconciliation is your judgement about
your own work, and it is the only judgement available: the work happened in your context and
nowhere else, which is precisely why the server reports this list and settles nothing on it
by itself. A row you do not recognise — another session's, or residue from a run whose
context is gone — is left where it is. Completing it to make the list shorter tells the
server a job was done that nobody did; if that work is in fact still running somewhere, it
kills that run's accounting silently, and the person waiting on it gets no reply and no
failed row to explain the silence. A list that stays long is a visible problem. A list
tidied by guesswork is an invisible one, and the invisible failure is much the worse of the
two — so shortening the list is never a reason to settle anything.

**You are not the cleanup for sessions that died, either.** The loop's opening
`corpus queue reap-stale` is what returns a stranded event to `pending/` once the staleness
window passes, and it is a **requeue**: an event nobody can account for is done again rather
than dropped. Nothing is lost by leaving an unfamiliar row alone, which is what makes
guessing about it unnecessary as well as harmful.

**`corpus queue reap-stale` takes no lane, and reaching all of them is the point rather than
a trespass.** Staleness is staleness: work stranded by a resident that died is stuck whoever
claimed it, and a reaper scoped to your lane would leave it unrecoverable by the only agent
still running. It does not re-route what it recovers — a reaped event goes back to `pending/`
on **the lane it was claimed from**, and that lane's own agent is who may then see it — a
reaped event returns to the conversation it belongs to, not to you. So run it every pass, and know that it is yours alone to run: a resident never
does, because requeuing another lane's held work is not something a lane owner can account
for.

## Routing edge cases, in full

**Structured targets.** The payload carries structured `mentions` and `skills` fields,
parsed by the server at post time. `@<subagent>` (a `type: agent-def` document under
`.claude/agents/`) is a directive to route the work to that persona; `/<skill>` is a
directive to apply that skill; the two combine. A missing or archived target is never
silently ignored: do the work as well as you can and state in the reply that the named
target was not found. A generic `@agent` names no target — triage it yourself.

**An event type with no row.** The Routing table is the whole of what this loop dispatches,
and a type outside it can still reach a claim: a queue carried over from a workspace older
than this skill, an event somebody wrote into `pending/` by hand, a server emitting
something this skill predates. Fail it with the type quoted in the reason —
`corpus queue fail evt_2e4f8b --reason "unknown event type: ledger.reconciled"` — so the
console row says exactly what arrived and nothing sits pending on a handler that does not
exist. Two things you never do with such an event. **Never complete it**: a completed event
is work somebody is entitled to think was done. **Never derive a handler from its name** — a type
you do not recognise names no skill, and dispatching on the shape of the string answers
somebody with work nobody asked for.

**Gone context.** If an event's thread or parent document no longer exists (the user
deleted it), fail with a reason naming the missing id. Never recreate deleted content.

**A report after resolution.** If the originating thread was resolved while the subagent
worked, deliver the result in a reply that says the thread was resolved meanwhile —
finish work that still has value, and never reopen the thread unilaterally.
