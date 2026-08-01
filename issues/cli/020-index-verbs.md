# [CLI-020] `corpus index status` / `corpus index rebuild`

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-023, SERVER-046, CLI-019
- Blocks: —

## Spec References
- SPEC.md §9.1 verbs bullet (SHARED-006 Edit 6)

## Summary
Thin typed-client verbs. `corpus index status`: one compact block — identity,
indexed/pending/failed counts, rebuild-in-progress; `--json` mirror. `corpus index
rebuild`: fires, prints the one-line acknowledgment + a hint to watch status (no
polling loop — the verb returns). Also: `corpus search` (CLI-019) now renders its
degraded-ranking note when the server reports `catching-up`/`lexical-only` — the
gating already shipped in CLI-019; this issue adds the wire-value mapping and tests.

## Acceptance Criteria
- [x] Status output compact and stable-ordered; `--json` passthrough
- [x] Rebuild returns immediately with acknowledgment; no watch loop
- [x] ~~Search note line: exact wording per state~~ **VOID (sprint-021 premise correction C15)** —
      CLI-019's `semanticIndexNote` is deliberately generic and already handles all four wire
      values; per-state wording would undo it. Corrected criterion, and what was done: the note
      fires for each of the three non-`current` values against **real** wire values, and is silent
      on `current` and on an absent field; covered by tests on both `search` and `doc related`.

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/index-maintenance/{index,status,rebuild}.ts` (new — **not**
  `commands/index/`, sprint-021 C16 / Open Conflict 7: every topic barrel is `index.ts`, so the
  directory moves and the topic stays `index` on the wire); registration in
  `registry/index.ts`; `docs/cli.md` regenerated; `commands/hygiene.test.ts` inventories extended.
  `commands/retrieval.ts` and `search.ts` are **untouched** (C15).

## Testing Strategy
apps/cli scoped: formatting against stubbed client states.

## E2E Verification Plan
Real server via the bin: status mid-drain shows honest counts; rebuild acknowledges and status reflects it; search prints the catching-up note.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Port `8806` (orchestrator's assignment, superseding
the sprint table's 8809); a slow OpenAI-shaped embedding endpoint of my own on `8816`. `8765` never
touched. Workspace: `~/.claude/jobs/4dd0ddef/tmp/s021-cli/cli-020-e2e`, `corpus init` on a real
tree, server run from source through the real bin
(`node_modules/.bin/tsx apps/cli/src/bin/corpus.ts …`), never the globally installed `corpus` — the
one time a command reached the installed binary it answered `unknown command "index"`, which is
itself the proof the verbs below came from this working tree.

### `corpus index status` through every state it can reach

**`current`** — the fresh workspace, embedded engine, warm model cache:

```
$ corpus index status
identity    local/all-MiniLM-L6-v2@384
indexed     60
pending     0
failed      0
rebuilding  no
state       current
exit=0
$ corpus index status --json
{"indexed":60,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}
```

One block, one JSON line, the same six facts in the same order — and the `--json` run prints no
human line at all (`Output.emit`/`Output.line`, asserted in `status.test.ts` as well as seen here).

**`indexing`, mid-drain, with the honest absent identity** — after pointing the workspace at the
slow fixture endpoint (9 s per batch) and firing a rebuild:

```
$ corpus index status
identity    none recorded yet
indexed     0
pending     60
failed      0
rebuilding  yes
state       indexing
$ corpus index status --json     (three consecutive polls)
{"indexed":0,"pending":60,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"}
{"indexed":0,"pending":60,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"}
{"indexed":0,"pending":60,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"}
```

The wire says `"identity":null`; the block says `none recorded yet`. Neither `null` nor `undefined`
ever reaches a human line — that is the "honest absent form", and it is the same value.

**`stale`** — an incremental backlog with no rebuild in flight, produced by creating one document
while the slow provider was configured:

```
$ corpus doc create --title "Rate assumptions" --type note --from user <<'EOF' … EOF
created doc_62fbgppv — data/docs/inbox/rate-assumptions.md
$ corpus index status
identity    openai/slow-fixture@8
indexed     60
pending     1
failed      0
rebuilding  no
state       stale
```

`pending 1` / `rebuilding no` → `stale`, exactly the mapping that separates it from `indexing`.

**`disabled`** — `"embedding": {"provider": "none"}` and a restart. Note what it does **not** do:
the counts are not zeroed, so "an index is here and nothing may use it" stays distinguishable from
a fresh workspace, and the exit code is still 0 because `disabled` is an answer, not a failure:

```
$ corpus index status
identity    openai/slow-fixture@8
indexed     61
pending     0
failed      0
rebuilding  no
state       disabled
{"indexed":61,"pending":0,"failed":0,"identity":"openai/slow-fixture@8","rebuilding":false,"state":"disabled"}
```

### `corpus index rebuild` — acknowledgment, and no loop

```
$ /usr/bin/time -p corpus index rebuild
queued a full rebuild of the semantic index — 60 chunks to embed, identity not yet recorded, state indexing.
it runs in the background — watch it with `corpus index status`.
real 0.34          # of which ~0.25 s is tsx starting; the 202 itself is tens of ms
exit=0
```

Against a provider taking **9 s per batch**, the verb returned in 0.34 s wall — it cannot have
waited on anything, and it printed no progress, no spinner and no second request (the unit test
pins `stub.requests` at exactly one, with zero requests to `/api/index/status`). The acknowledgment
reports only what was true at the call: 60 queued, identity not yet re-picked, `indexing`. The
ordinary timed client is used, not `db rebuild`'s untimed ten-minute one (`rebuild.test.ts` proves
it by aborting a 400 ms answer against a 25 ms transport deadline).

### The degraded note against real wire values (C15 — generic wording, unchanged)

```
$ corpus search "todos"                            # state: indexing
# ranking is degraded — the semantic index is "indexing" (SPEC.md §9.1); these results are ranked on the lexical half alone.
doc_skill61c2325d  Todos          # Todos This skill ships with the `todos` plugin. …

$ corpus search "todos" --json                     # same moment — one line, no note
{"hits":[{"id":"doc_skill61c2325d",…}],"semanticIndex":"indexing"}

$ corpus doc related doc_seedinbox                 # both rankings degrade together
# ranking is degraded — the semantic index is "indexing" (SPEC.md §9.1); …
no related documents.

$ corpus search "mortgage"                         # state: stale
# ranking is degraded — the semantic index is "stale" (SPEC.md §9.1); …

$ corpus search "mortgage"                         # state: disabled
# ranking is degraded — the semantic index is "disabled" (SPEC.md §9.1); …
```

`current` printed no note at all (first run of the session, above). `commands/retrieval.ts` was not
edited: all three states are one line by construction, which is the point C15 makes.

### Error paths, per the existing verb conventions

```
$ corpus index status                    # token corrupted in .corpus/config.json
corpus: 401 unauthorized: missing or invalid workspace token — pass `Authorization: Bearer <token>` …
  The workspace bearer token was rejected — check `token` in .corpus/config.json, …     exit=5
$ corpus index rebuild --json            # same
{"error":{"code":"unauthorized","message":"401 unauthorized: missing or invalid workspace token …"}}
                                                                                        exit=5
$ corpus index status                    # server stopped
corpus: server not running for this workspace — run `corpus server start`
  Nothing answered at http://127.0.0.1:8806.                                            exit=4
```

### Help, three levels (TEST-918)

`corpus --help` lists `index   Inspect and rebuild the semantic index.`; `corpus index --help`
renders the topic description and both verbs; `corpus index rebuild --help` renders its description,
usage and examples — all from the registry, none of it hand-written.

### Checks

`docs/cli.md` regenerated with `npm run docs:cli -w apps/cli` (and it is Prettier-clean, so the
drift test compares equal); raw `tsc --noEmit -p apps/cli/tsconfig.json` clean; eslint + prettier
clean on every touched file; `npm test -w apps/cli` → **76 files, 1055 tests, all passing**, of
which 19 are new (`index-maintenance/{index,status,rebuild}.test.ts`) plus 6 new parameterised
cases across `search.test.ts` and `doc/related.test.ts`. Both `hygiene.test.ts` inventories were
extended, and `index-maintenance` was added to `WRITE_RESTRICTED_TOPICS` — the new verbs are pure
API clients, so they are now guarded against filesystem and subprocess calls like `doc`/`thread`/`db`.

Every process started here was stopped and both ports (`8806`, `8816`) verified free.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
