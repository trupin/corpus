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

Every write goes through the `corpus` CLI. Never edit a todo document's file,
and never hand-write its `items` frontmatter — the plugin's verbs own that
format, and a hand-edited list is one the checkbox view refuses to render.

## Finding the list

`corpus todos list` shows every todo document with its open and done counts.
The verbs accept a document's id, its exact title, or an unambiguous fragment
of the title, so work from what the thread actually said — "the shopping list"
resolves; a guessed id does not. An ambiguous name is refused with the
candidates named: ask which one rather than picking.

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

A new todo document starts empty; that is a valid list, not a broken one. Do
not create a second list for something an existing one covers.

## Checking items off

```
corpus todos check "Week of Jul 20" "Renew passport" --from agent
```

By text, or by the number `corpus todos list "<list>"` prints. `--uncheck`
puts an item back. If the text matches more than one item the command refuses
and prints the numbers — use one. Check off only what the person said is done.

## Reporting back

Reply in the thread that woke you, naming the list by `[[id]]` and saying what
changed:

```
corpus thread reply <threadId> --from agent <<'EOF'
Added “Renew passport” to [[doc_a1b2c3]] — 3 open, 1 done.
↳ added one item to the Week of Jul 20 list
EOF
```

The trace line is the same convention every action-taking agent turn uses: one
past-tense line, last, and none at all on a turn that changed nothing.

## What not to do

- Do not delete todo documents. Archive is the agent's only removal
  (`corpus doc archive`), and only when asked.
- Do not reorganise someone's list — reordering, merging or rewording items
  nobody asked about is not stewardship.
- Do not report an item as done because it looks done.
