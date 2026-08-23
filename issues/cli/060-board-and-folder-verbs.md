# [CLI-060] Board flags, `--stage`, `--unset`, and `corpus folder` verbs; `--pinned` and view `--order` go

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, CONTRACT-075, CONTRACT-076, SERVER-138, SERVER-136, SERVER-137
- Blocks: CLI-061, AGENT-042 (skill text cites the verbs)

## Spec References
- SPEC.md §2.3 — "The `corpus` CLI — one registry, self-documenting"
- SPEC.md §9.2 — folder routes, the document row
- SPEC.md §10 — boards as documents, kanban boards

## Summary
The agent's whole surface is the CLI, and the agent must be able to build a board, a kanban, and a stage change with it. This issue adds the flags for every new field, removes the two that no longer exist, adds `--unset <key>` (the migration in CLI-061 needs it), and adds `corpus folder rename|archive|unarchive|delete`. `docs/cli.md` regenerates from the registry.

## Acceptance Criteria
- [x] `corpus doc create --type board --title T [--columns id,id] [--order N] [--default-open] [--kanban '<json>'] [--query '<json>']`.
- [x] `corpus doc edit <id> --columns id,id | --order N | --default-open true|false | --kanban '<json>' | --stage <value> | --unset <key> [--unset <key>...]`; `--unset` removes a frontmatter key (core or extra) and refuses for `id`, `type`, `created`.
- [x] `--pinned` is gone from create, edit and the list filters; `--order` is gone from views' documentation and is documented as a board's position; passing `--pinned` fails with "removed in <version>: a board lists its columns — see `corpus upgrade`".
- [x] `corpus doc list --stage <value>` filters; `corpus doc show` prints `stage`, `columns`, `kanban`, `default-open`, `order` when present.
- [x] `corpus folder rename <from> <to>`, `corpus folder archive <path>`, `corpus folder unarchive <path>`, `corpus folder delete <path> --yes`; `delete` without `--yes` prints the documents it would delete and exits 2; every verb prints the documents the server reported, one per line, token-frugal like `doc list`.
- [x] When a `--stage` edit's response reports a status change too, the output says so on its own line.
- [x] `corpus reflect` asks for a reflection now (`POST /api/workspace/reflect`, CONTRACT-076): prints the event id and the window's `since`; when the answer is `pending: true` it says so and prints that event's id, exit 0 (asking for what is already happening is not an error). `corpus reflect --status` prints the clock, the pending state, the changed count and the quiet window from `GET /api/workspace/reflect`.
- [x] Registry-driven `--help` at all levels; `docs/cli.md` regenerates with no diff; the drift check passes.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/create.ts`, `edit.ts` (lines ~291-529 hold `--pinned`/`--order` today), `filters.ts` (lines ~29, 73)
- `apps/cli/src/commands/folder/{rename,archive,unarchive,delete,index}.ts` — new
- `apps/cli/src/registry.ts` (or wherever verbs register) — the `folder` topic
- `docs/cli.md` — regenerated
- tests beside each, plus the registry parity test

### Key Implementation Details
- `--kanban` and `--query` take JSON because the shapes are nested and the agent writes JSON without ceremony; the help text shows one complete example each.
- `--unset` goes through the update route as an explicit "remove key" — coordinate with SERVER-138 for the body form (`{ unset: ["pinned", "order"] }` beside `changes`).
- `folder delete --yes` is the CLI's own guard; the server has none (§10: deletion asks in the UI).

### Edge Cases
- `--columns ""` sets an empty list (a board with no columns, which Files is); `--unset columns` removes the key.
- `--stage ""` is a refusal; use `--unset stage` to clear.

## Testing Strategy
Vitest with the typed client against a stub app for argument parsing and output; the registry parity test already guards help drift.

## E2E Verification Plan
### Verification Steps
1. Real server. Create a kanban board with `--kanban`, edit a document's `--stage`, see the status line in the output.
2. `corpus folder rename inbox triage` → output lists moved ids; `corpus folder delete triage` → exit 2 with the list; `--yes` → deleted.
3. `npm run docs:cli` (or the repo's generator) → no diff.

## E2E Verification Log

cli-dev, 2026-08-22, on **opus**. Real workspace at `/tmp/corpus-cli060-ws`
(`corpus init --port 8791`), real server (`corpus server start`, pid 67883),
built CLI (`node apps/cli/dist/bin/corpus.js`). Port 8765 was never touched.
SERVER-137 had landed on the source tree by the time reflection was reached, so
`corpus reflect` is verified against a real server too.

**Boards, kanban, `--stage`, `--unset`, `--pinned`.**

```
$ corpus doc create --type board --title "Attention board" --folder views --evergreen true \
    --columns doc_seedattention,doc_seedinbox --order 1 --default-open true --from agent
created doc_fcyffosd — data/docs/views/attention-board.md

$ corpus doc create --type board --title "Triage" --folder views --evergreen true \
    --kanban '{"field":"stage","stages":["triage","doing","done"],"transitions":{"triage":["doing"],"doing":["done","triage"]},"status":{"done":"resolved"}}' \
    --query type=note --order 2 --from agent
created doc_og6wejis — data/docs/views/triage.md

$ corpus doc show doc_og6wejis
Triage
doc_og6wejis · board · open
key cede82980172fb3dadd6186537ce22841568f6a06f46d1857abf7a4e0cf2853b
data/docs/views/triage.md
created 2026-08-23T03:18:39Z · updated 2026-08-23T03:18:39Z
tags —
order 2
kanban over stage: triage, doing, done
  transitions triage → doing · doing → done, triage
  status done → resolved
due — · reviewed — · evergreen yes
```

The `kanban:` block landed in `data/docs/views/triage.md` as YAML structure,
verified by reading the file.

The stage/status coupling reports itself on its own line:

```
$ corpus doc edit doc_fp5fjekl --stage done --from agent
edited doc_fp5fjekl
stage `done` set status to `resolved`: this document is in the kanban Triage (doc_og6wejis), whose `kanban.status` map decides a status on entry (SPEC.md §5).
key 47ec4924b0a6b41560dc50f52638ac26dbc7bf02ac967f5b3740354a3558f0e6

$ corpus doc edit doc_og6wejis --default-open true --from agent
edited doc_og6wejis
Attention board (doc_fcyffosd) is no longer the default-open board: at most one board carries `default-open` (SPEC.md §10), and this write took it.
key b6d541d7d37561fbb907e9b3e0db12fe88a6cc9e31a85169046b5787038894c9
```

`--unset` performs the rider-2 migration, and refuses the three keys by name:

```
$ corpus doc edit doc_seedinbox --extra pinned=true --from agent   # plant a legacy key
$ grep -n "pinned\|^order" data/docs/views/inbox.md
11:pinned: true
12:order: 2
$ corpus doc edit doc_seedinbox --unset pinned --unset order --from agent
edited doc_seedinbox
$ grep -n "pinned\|^order" data/docs/views/inbox.md   # exit 1, both keys gone
$ corpus doc edit doc_seedinbox --unset pinned --from agent   # a no-op, same key back, exit 0
$ corpus doc edit doc_seedinbox --unset id --from agent
corpus: `id` cannot be unset: `id`, `type`, `created` are a document's identity, its behaviour and its birth.
  Every other frontmatter key may be removed. Drop that `--unset` and keep the rest. Nothing was sent to the server.
exit=2
```

`--pinned` is refused on every verb, at exit 2:

```
$ corpus doc list --pinned
corpus: `--pinned` was removed in 0.19.0: a board lists its columns — see `corpus upgrade`.
  A `type: view` document is a saved query and nothing more (SPEC.md §10, rider 2): it appears on a
  board because that board names its id — `corpus doc edit <board-id> --columns <id>,<id>` — and
  `corpus doc list --type board` finds the boards. A workspace whose files still carry a `pinned:`
  key is told what to run by `corpus upgrade`; the migration itself is `corpus doc edit <id> --unset pinned`.
exit=2
```

`--stage` filters, null sentinel included, and a comma is refused by the
boundary that owns the rule (exit 5, naming `json.stage`):

```
$ corpus doc list --stage done
doc_fp5fjekl  note  resolved  Mortgage options  data/docs/inbox/mortgage-options.md
$ corpus doc list --stage ,done --type note,board     # done, or unstaged — one request
doc_og6wejis  board  open      Triage
doc_fp5fjekl  note   resolved  Mortgage options
doc_fcyffosd  board  open      Attention board
$ corpus doc edit doc_fp5fjekl --stage "a,b" --from agent
corpus: 400 bad_request: request failed validation
  [{"path":"json.stage","message":"a stage may not contain a comma: …"}]
exit=5
```

Edge cases: `--query '{"type":["note","view"],"tag":"finance"}'` wrote the map as
YAML; `--columns ""` printed `columns —` on the next `doc show`; `--unset
columns` removed the key entirely.

**Folder acts.**

```
$ corpus folder rename inbox triage
doc_fp5fjekl  data/docs/triage/mortgage-options.md
doc_ywc5lrpb  data/docs/triage/rates.md
th_v5rgs34q   data/threads/th_v5rgs34q.md          # the thread, at its unchanged path
renamed inbox → triage — 3 documents

$ corpus folder rename TRIAGE nope
corpus: 404 not_found: no folder data/docs/TRIAGE          # case is not folded
exit=5

$ corpus folder archive triage
doc_fp5fjekl  archived
doc_ywc5lrpb  archived
th_v5rgs34q   archived
archived triage — 3 documents
$ corpus folder archive triage      # again: the state after the act, all three still listed
$ corpus folder unarchive triage
doc_fp5fjekl  resolved   …   restored triage — 3 documents

$ corpus folder delete triage
corpus: refusing to delete data/docs/triage without --yes — 2 documents.
  Deleting is irreversible in the working tree (git keeps every version). Re-run with --yes, or
  archive instead: `corpus folder archive triage`. Threads on these documents are **not** deleted …
  doc_fp5fjekl  note  data/docs/triage/mortgage-options.md
  doc_ywc5lrpb  note  data/docs/triage/rates.md
exit=2

$ corpus folder delete triage --yes --from agent
corpus: deleting a folder is user-only — the agent archives, never deletes
  Archive it instead: `corpus folder archive triage`. Nothing was sent to the server.
exit=2

$ corpus folder delete triage --yes
doc_fp5fjekl
doc_ywc5lrpb
deleted triage — 2 documents
exit=0

$ corpus doc list --type thread --include-archived      # the orphaned thread survives
th_v5rgs34q  thread  resolved  Re: Mortgage options  data/threads/th_v5rgs34q.md
```

The preview lists exactly what the delete removes: the thread is present in
`GET /api/docs?folder=` and absent from both the preview and the delete's own
result, which is what the path filter in `delete.ts` is for.

**`corpus reflect`.**

```
$ corpus reflect
reflecting — evt_vcnfzlpd5o5j, window since the beginning
exit=0
$ corpus reflect                                  # a second ask joins the pending one
already reflecting — evt_vcnfzlpd5o5j, window since the beginning
exit=0
$ corpus reflect --status
reflected never — the window is the whole corpus · 8 documents changed since
reflecting now (evt_vcnfzlpd5o5j) · quiet window 30m
$ corpus reflect --json
{"eventId":"evt_vcnfzlpd5o5j","since":null,"pending":true}
$ corpus queue claim-all --json | head -1
{"events":[{"id":"evt_vcnfzlpd5o5j","type":"workspace.reflect","source":"reflect","payload":{"since":null}}],…}
```

The ask enqueues a real `workspace.reflect` event carrying its `since` payload.

**Help and docs.** `corpus --help` lists `reflect` and the `folder` topic;
`corpus folder --help` lists four verbs; `corpus folder delete --help` renders
its args and `--yes`. `npm run docs:cli -w apps/cli` regenerates `docs/cli.md`
with no further Prettier change, and `apps/cli/src/docs/generate.test.ts` (16
tests, the committed-file comparison among them) passes.

**Falsification.** Every behaviour this issue adds was broken one at a time and
its test watched go red — 24 mutations, 24 reds, no test that could not fail.
The harness applied each edit, ran the covering spec, and restored the file:
`--stage ""`'s refusal, `--columns ""` as the empty list, `--columns a,,b`'s
refusal, `--kanban`'s contract validation, `--kanban`'s absent-vs-empty
`transitions`, `--unset`'s three exclusions, `--query`'s JSON form, the
`--stage` filter's empty value, `--pinned`'s removed-flag message, the effect
warnings' own line, their exclusion from the success suffix, `columns: []`
against an absent key, `order: 0`, `stage` in `doc show`, the folder-delete
agent guard, the `--yes` guard, the preview's thread and case filter, its
paging, its empty-page stop, the folder report's rows, the rename's
unnormalised paths, reflect's pending wording, its `quiet: 0` reading, and
`--status` reading rather than asking, plus the hygiene inventory that guards
the new topic.

**Checks.** `npm run build -w apps/cli`, `tsc --noEmit -p apps/cli`, `eslint
apps/cli --max-warnings 0`, `prettier --check apps/cli/src docs/cli.md`, and
`vitest run apps/cli` — 97 files, 1668 tests, all green.

**Not verified here.** `packages/kit` does not currently build (`src/testing/
docRow.ts` still names `pinned`) — that is UI-148's, and it blocks the
repo-wide `npm run build` rather than anything in `apps/cli`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CLI-060]` prefix
