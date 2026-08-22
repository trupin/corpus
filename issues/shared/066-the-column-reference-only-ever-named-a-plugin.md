# [SHARED-066] The `column` reference only ever named a plugin, and it spans four workspaces

## Domain
shared (cross-domain)

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064, UI-150, SERVER-136, CLI-060, CONTRACT-074

## Spec References
- SPEC.md **§9.1** — the projection's `documents` columns
- SPEC.md **§10** — the board's columns

## Summary

Found mid-phase, 2026-08-22, while regenerating `docs/cli.md`.

A pinned view document may carry `column: "<plugin>/<type>"`, telling the board
to render that column through a plugin's own component. **That is its only
meaning.** `apps/cli/src/commands/doc/frontmatter.ts:316` says so outright:
*"`--column` takes `<plugin>/<type>`"*.

With plugins gone the reference names nothing. It is dead frontmatter, a dead
CLI flag, a dead projection column and a dead wire field — and the goal for this
phase is *no trace*.

## Why it is filed apart rather than folded in

It spans **four workspaces and 20+ files**, including a projection column
(`column_ref`), the `documents` table in `projection/schema.ts`, a contract
field, a CLI flag with its own parser and usage error, and the UI's
`viewDoc.ts`. Each of the four domain agents would have touched a slice, and a
partial removal leaves the worst state: a field the wire still carries that
nothing writes and nothing reads.

## What to build

Remove it end to end: the `--column` flag and its parser, the frontmatter key,
the contract field, the projection column, and the UI's reading of it.

## Decisions to make and record

1. **The projection column.** `openProjection` repopulates from files on every
   boot, so dropping a column needs no migration — **verify that** rather than
   assuming it, and say whether `SCHEMA_VERSION` moves.
2. **What happens to a workspace whose view document still carries `column:`.**
   It becomes extra frontmatter, preserved verbatim and ignored — which is what
   §9.1 now says about any key the core does not define. **Confirm it does not
   fail validation**, because a user's board must not break on an old view.
3. **Whether the board loses anything a person can see.** A plugin column
   rendered a plugin's component; with none installed it already showed a
   missing-plugin card. Check what such a view renders as now — it should be an
   ordinary pinned view of its query.

## Acceptance Criteria
- [ ] No `column` reference in any workspace, wire field or generated artifact
- [ ] A view document carrying a stale `column:` still opens, still pins, and
      still renders its query
- [ ] `db rebuild && db doctor` clean
- [ ] Decision 1 answered with evidence, not assumption

## E2E Verification Log

### Server, CLI and contract half — cli-dev, **Opus 5 (1M context)**, 2026-08-22

`apps/ui` and `packages/kit` are the parallel UI agent's; nothing below touches
them.

**Workspace.** `corpus init <scratch>/ws066 --port 8791`, then a view document
planted **before the first boot**, carrying the frontmatter a pre-removal
Corpus wrote:

```
id: doc_legacyboard
type: view
title: Errands board
evergreen: true
pinned: true
order: 4
query:
  type: note
  status: open
column: todos/todos
```

**Decision 2 — a stale `column:` does not break a board.** Confirmed on a real
server, four ways.

`corpus doc show doc_legacyboard --json` — it opens, and the key is in `extra`:

```json
"pinned": true, "order": 4,
"query": { "type": "note", "status": "open" },
"extra": { "column": "todos/todos" }
```

`corpus doc list --pinned --type view --sort order --json` — it pins, and holds
its place in the board'"'"'s one column-set query:

```
doc_seedattention   | order 1 | query {'"'"'needs'"'"': '"'"'me'"'"'}                       | extra {}
doc_seedinbox       | order 2 | query {'"'"'folder'"'"': '"'"'inbox'"'"'}                   | extra {}
doc_seedopenthreads | order 3 | query {'"'"'type'"'"': '"'"'thread'"'"', '"'"'status'"'"': '"'"'open'"'"'} | extra {}
doc_legacyboard     | order 6 | query {'"'"'type'"'"': '"'"'note'"'"', '"'"'status'"'"': '"'"'open'"'"'}   | extra {'"'"'column'"'"': '"'"'todos/todos'"'"'}
```

Its query renders. After `corpus doc create --type note --title "Buy milk"`,
running the view'"'"'s own stored query returns the row: `rows: 1 / doc_qdk6i5rs
Buy milk`.

It round-trips through a write. `corpus doc edit doc_legacyboard --order 6
--add-tag board` succeeded, and the file on disk still ends
`column: todos/todos` — the merge patch left the key byte-for-byte.

**Decision 1 — the projection column, answered by running it.**
`SCHEMA_VERSION` **moves, 19 → 20.** The bump is not a migration and is not
needed to keep the code running: `column_ref` was nullable, so a v19 database
would have gone on accepting the shorter INSERT while nothing read the column
back. It is needed because supersede-and-repopulate is the **only** way a DDL
change reaches a workspace that already has a `cache.db` — without it every
existing user keeps a dead `column_ref` forever.

Verified against the real server rather than assumed. The running workspace'"'"'s
`cache.db` was stamped back to 19 with the column re-added and a value in it,
then the server was restarted:

```
before: [... query_json, extra_json, column_ref]   stamp 19
log:    projection schema changed; rebuilding from files  {"from":19,"to":20}
log:    carried semantic embeddings across the schema change  {"carried":211}
after:  [... query_json, extra_json]                stamp 20
        documents repopulated: 11
```

The 211 carried embeddings are the point: the boot-time replacement keeps the
one thing a rebuild cannot cheaply re-derive, so the bump costs an upgrading
workspace a single pass over its files. Pinned as a unit test too —
`projection/db.test.ts`, "drops `documents.column_ref` when a v19 database is
opened (19 → 20)", modelled on the 13 → 14 case.

**Acceptance criterion — `db rebuild && db doctor`:**

```
rebuilt the projection in 37ms — 11 documents, 0 threads, 0 turns, 0 anchors, …
projection is clean — 11 documents from 11 files (6ms)
```

Clean again after the 19 → 20 boot.

**Decision 3 — what else still read it.** Nothing, in these three workspaces.
Every remaining occurrence of the word is the board-column concept (a pinned
view), an 80-column terminal, or a SQL column. Two are deliberate and were kept
with their reason restated rather than swept: `V6_DDL` in
`projection/db.test.ts` still declares `column_ref`, because a v6 database is a
fact about the past and it is the fixture that proves an upgrade drops the
column.

**The flag is gone from the surface.**

```
$ corpus doc create --type view --title X --column todos/todos
corpus: unknown flag "--column" for "create".              exit 2
$ corpus doc edit doc_legacyboard --column todos/todos
corpus: unknown flag "--column" for "edit".                exit 2
$ corpus doc create --help | grep -c -- --column   →  0
$ corpus doc edit   --help | grep -c -- --column   →  0
```

`--extra column=todos/todos` is now the way to write the key, and it is accepted
— `column` left `RESERVED_FRONTMATTER_KEYS`, which is what makes decision 2 true
rather than incidental.

**Generated artifacts.** `openapi.json`, `schema.generated.ts` and `docs/cli.md`
all regenerate cleanly and are idempotent (regenerated twice, identical md5).
`docs/cli.md` loses the two `--column <plugin/type>` rows and every `plugin`
mention; `grep -c plugin docs/cli.md` is 0. Prettier clean.

**Checks.** `packages/contract` 2630 tests pass. `apps/cli` 1570 pass.
`apps/server` passes. ESLint and Prettier clean over the three workspaces; no
rule was disabled.

**Left for the UI agent** (not touched here, by instruction): the contract
change breaks `packages/kit/src/testing/docRow.ts`, whose fixture row set
`column`, and `apps/ui`'"'"'s own reading of the key. Both were landed by the
parallel agent while this half was running, and `npm run build` is green across
every workspace as a result.
