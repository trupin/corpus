---
name: todos
description: Create and maintain todo documents when a thread asks for one — add items, check them off, and report back. Handles todos.* events and any thread request in the todos domain.
---

# Todos

This skill ships with the `todos` plugin. The orchestrate skill routes events
whose type starts `todos.` here by convention, and the comment skill routes a
thread request that falls in this plugin's domain here rather than editing
`type: todo` documents itself.

## The invariant you inherit

Every write goes through the `corpus` CLI. Never edit a todo document's file.

A todo document's items are ordinary markdown task-list lines in its **body** —
`- [ ] text`, `- [x] text`, with an optional `(due: 2026-08-01)` at the end of
the line. `corpus todos add|check` own that format: they edit exactly the one
line they mean and leave the rest of the document — prose, headings, code —
byte-identical. Use them rather than rewriting the body with `corpus doc edit`,
which cannot make that promise.

## Finding the list

`corpus todos list` shows every todo document with its open and done counts.
The verbs accept a document's id, its exact title, or an unambiguous fragment
of the title, so work from what the thread actually said — "the shopping list"
resolves; a guessed id does not. An ambiguous name is refused with the
candidates named: ask which one **with a form** — a single `choose one` field
whose options are the candidates the refusal printed — rather than picking one
yourself. The comment skill states the grammar; what matters here is that this
ask is a form and not a sentence, because a question in prose stops signalling
that anyone is waiting the moment the thread is read.

## Adding items

```
corpus todos add "Week of Jul 20" "Renew passport" --from agent
```

One item per call, in the words the person used. `--due 2026-08-01` when the
request carries a date; leave it off when it does not — an invented deadline is
a fact you were not given.

If no todo list fits, create one first and then add to it:

```
corpus doc create --type todo --title "House purchase — paperwork" --folder finance --from agent
```

A new todo document starts from the todo template's starter lines; a list with
nothing on it is a valid list, not a broken one. Do not create a second list
for something an existing one covers.

`add` and `check` each name their own delta — one line of one list — so they
need no document key and are never refused for someone else editing the
document. What they do check is the item they were pointed at: the request
carries the text the CLI just read at that index, so an item that moved under
you is refused with a `409` saying it "changed under you; nothing was written"
rather than toggling whatever slid into its place. That refusal is a re-read,
not a report: run `corpus todos list "<list>"` again, find the item in the list
as it now stands, and re-run the command against it.

Where a person has an edit session open on the list — which a read tells you,
and nothing refuses — the courteous move is the comment skill's: stand aside,
say the change is ready and lands once they are done, and hand the event back to
the orchestrate skill naming that document. Never complete the event on a write
nobody made.

If `corpus todos add` or `check` refuses with "has malformed `items`" or
"carries items in its body _and_ in its `items` frontmatter", the document is a
pre-migration one that needs a person: say so in the thread rather than editing
the file. `corpus todos migrate` converts every remaining old-format list in
one go and is safe to re-run, but run it only when asked.

## Checking items off

```
corpus todos check "Week of Jul 20" "Renew passport" --from agent
```

By text, or by the number `corpus todos list "<list>"` prints. `--uncheck`
puts an item back. If the text matches more than one item the command refuses
and prints the numbers: re-run with the number the person's own words pick out,
and when they pick out none of them, ask with a form the same way an ambiguous
list is asked about. Check off only what the person said is done — an item
checked off on a guess is a fact about their life that nobody stated.

## Reporting back

Reply in the thread that woke you, naming the list by `[[id]]` and saying what
changed:

```
corpus thread reply <threadId> --from agent --model claude-sonnet-4-5 <<'EOF'
Added “Renew passport” to [[doc_a1b2c3]] — 3 open, 1 done.
↳ added one item to the Week of Jul 20 list
EOF
```

`--model` names what actually ran — the model you are running as, as your own
runtime reports it, never what the request asked for. Where the work ran in
stages, name the deciding stage: the one that read the thread and chose what
went on the list, never the one that only fetched it, and one model rather than
a list of them. When you do not know what ran, leave the flag out entirely — a
blank is honest and a guess is not, and `--model ""` is a usage error.

The trace line is the same convention every action-taking agent turn uses: one
past-tense line, last, and none at all on a turn that changed nothing.

## What not to do

- Do not delete todo documents. Archive is the agent's only removal
  (`corpus doc archive`), and only when asked.
- Do not reorganise someone's list — reordering, merging or rewording items
  nobody asked about is not stewardship.
- Do not report an item as done because it looks done.
