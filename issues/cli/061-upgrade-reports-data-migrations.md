# [CLI-061] `corpus upgrade` and `corpus workspace upgrade` report the data migrations a workspace needs, as commands an agent can run

## Domain
cli

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, CLI-060
- Blocks: —

## Spec References
- SPEC.md §2.4 — "Upgrading" (rider 8: migrations reported as commands, never performed)
- SPEC.md §10 — boards as documents

## Summary
Phase 41 removes `pinned` and stops reading `order` on views. An existing workspace has three seed views and possibly more that carry both, and after the upgrade its board is empty. The user's decision (2026-08-22): no silent migration; the upgrade commands say what to do, written for the agent that runs them. This issue adds a **migration registry** to the CLI — each entry a detector over the workspace's files and an instruction writer — and a **migrations** section in both upgrade reports. The first entry is "pinned views without a board". Every later breaking change adds an entry; the registry is the rule.

## Acceptance Criteria
- [x] `corpus workspace upgrade` and `corpus upgrade` end with a `migrations` section, listed distinctly from updates and conflicts, in the same agent-readable shape conflicts use (one block per migration, a one-line statement of what the tool no longer reads, then the commands, one per line, ready to paste).
- [x] Detection reads `data/docs/**/*.md` frontmatter from disk, read-only, with the server stopped or running.
- [x] Migration `views-to-board`: fires when any `type: view` document carries `pinned: true` or `order` **and** no `type: board` document lists it. Instructions: one `corpus doc create --type board --title Board --columns <ids in the views' order>` when no board exists, or `corpus doc edit <board> --columns <existing + missing>` when one does; then one `corpus doc edit <view> --unset pinned --unset order` per view. The stated order follows the views' `order`, nulls last, then title.
- [x] The section is empty and says so when nothing fires; the exit code is unchanged by migrations (a migration is the agent's work, not the upgrade's failure).
- [x] `--json` (if the upgrade commands have it; add it if not) carries `migrations: [{ id, statement, commands: [] }]`.
- [x] The registry has a unit test per entry and a test that an entry with no detector hit prints nothing.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/migrations/registry.ts` — `interface Migration { id; detect(workspace): Hit | null; instruct(hit): string[] }`
- `apps/cli/src/migrations/views-to-board.ts` — the first entry
- `apps/cli/src/commands/upgrade/index.ts` and `apps/cli/src/commands/workspace/upgrade.ts` — the section, after the conflicts block
- `apps/cli/src/migrations/*.test.ts`

### Key Implementation Details
- Frontmatter reading uses the same YAML library the server uses (§5: never hand-rolled); the CLI already depends on it for `init`.
- Instructions are printed as the exact argv a person or agent pastes; quote titles.
- The report wording follows §2.4's existing voice: "These files are written for a version of the tool that no longer reads them as they are. Run the commands below, or ask the agent to."

### Edge Cases
- A view listed by an archived board: still counts as listed (the board can be restored).
- Views with `pinned: false` and no `order`: nothing to do; the key is harmless in `extra`, but the instruction still offers `--unset pinned` as a tidy-up under a separate "optional" line.

## Testing Strategy
Vitest with temp workspaces: seed files with `pinned`, with and without a board, archived board, no views.

## E2E Verification Plan
### Verification Steps
1. `corpus init` with the *previous* template (check out the v0.16.0 seeds into a temp workspace), install this build, run `corpus workspace upgrade`.
2. The report's migrations section names the three seed views and prints the `doc create --type board` and three `--unset` commands.
3. Paste them with the server running; run the upgrade again; the section is empty.

## E2E Verification Log

**cli-dev, 2026-08-22, on opus (`claude-opus-5[1m]`).** Real built CLI
(`apps/cli/dist/bin/corpus.js` after `npm run build -w apps/cli`), real
workspaces made by `corpus init`, real server on ports **8791** and **8792**
(never 8765). The seed template at this commit still ships three `pinned: true`
views and no board — AGENT-042 has not landed — so a fresh `corpus init` **is**
the pre-Phase-41 state the issue asks for, and no v0.16.0 checkout was needed.

### 1. The state before

```
$ corpus init --port 8791
Initialized Corpus workspace at …/e2e/ws
  installed 16 template files, recorded in .corpus/template-manifest.json
$ grep -n 'pinned\|^order' data/docs/views/*.md
data/docs/views/attention.md:11:pinned: true
data/docs/views/attention.md:12:order: 1
data/docs/views/inbox.md:11:pinned: true
data/docs/views/inbox.md:12:order: 2
data/docs/views/open-threads.md:11:pinned: true
data/docs/views/open-threads.md:12:order: 3
$ ls data/docs/
inbox/  templates/  views/          # no boards/ — the board bar would be empty
```

### 2. The report, **with the server stopped**

```
$ corpus workspace upgrade
already up to date.

1 data migration — these files are written for a version of the tool that no longer reads them as they are. Run the commands below, or ask the agent to. Nothing here was performed:
  views-to-board: `pinned` and a view's `order` are no longer read — a column appears on a board because that board's own `columns` list names its id (SPEC.md §10, rider 2) — and 3 view documents here still rely on them, with no board document in this workspace to list them, so the board bar is empty.
    corpus doc create --type board --title "Board" --folder boards --columns doc_seedattention,doc_seedinbox,doc_seedopenthreads --default-open true
    corpus doc edit doc_seedattention --unset pinned --unset order
    corpus doc edit doc_seedinbox --unset pinned --unset order
    corpus doc edit doc_seedopenthreads --unset pinned --unset order
EXIT=0
```

`already up to date.` is the **template** half — the migrations section prints
beside it, which is the case the issue's fourth criterion is about.

### 3. Pasting it, with the server running

```
$ corpus server start
corpus 0.18.0 listening on http://127.0.0.1:8791 (pid 71955)
$ corpus doc create --type board --title "Board" --folder boards --columns doc_seedattention,doc_seedinbox,doc_seedopenthreads --default-open true
created doc_nllq4wy7 — data/docs/boards/board.md          EXIT=0
$ corpus doc edit doc_seedattention --unset pinned --unset order    EXIT=0
$ corpus doc edit doc_seedinbox --unset pinned --unset order        EXIT=0
$ corpus doc edit doc_seedopenthreads --unset pinned --unset order  EXIT=0
```

The `boards/` folder did not exist; the server created it. The board on disk:

```
$ cat data/docs/boards/board.md
id: doc_nllq4wy7
type: board
title: Board
columns:
  - doc_seedattention
  - doc_seedinbox
  - doc_seedopenthreads
default-open: true
```

**A working board, not merely a `pinned`-free workspace** — read back through
the API rather than off disk:

```
$ corpus doc list --type board --json
"columns": ["doc_seedattention","doc_seedinbox","doc_seedopenthreads"], "defaultOpen": true
$ corpus doc list --type view --json
doc_seedattention | Attention    | order= None | extra= {}
doc_seedinbox     | Inbox        | order= None | extra= {}
doc_seedopenthreads | Open threads | order= None | extra= {}
```

### 4. The section is empty afterwards, and a re-run is harmless

```
$ corpus workspace upgrade
already up to date.
migrations: none — every document is written the way this tool reads it.
$ corpus doc edit doc_seedattention --unset pinned --unset order   # again
edited doc_seedattention                                   RERUN_EXIT=0
$ corpus workspace upgrade --json | jq .migrations
[]
```

### 5. `corpus upgrade --check` reports the same thing (second workspace, 8792)

```
$ corpus upgrade --check
corpus 0.18.0 is the latest release

1 data migration — these files are written for a version of the tool that no longer reads them as they are. …
    corpus doc create --type board --title "Board" --folder boards --columns doc_seedattention,doc_seedinbox,doc_seedopenthreads --default-open true
    corpus doc edit doc_seedattention --unset pinned --unset order
    …
nothing was downloaded, installed or written (--check).
EXIT=0
```

### 6. `--from agent`, and the `--json` shape

```
$ corpus workspace upgrade --from agent
    corpus doc create --type board --title "Board" … --default-open true --from agent
    corpus doc edit doc_seedattention --unset pinned --unset order --from agent
$ corpus workspace upgrade --json --from agent
"migrations": [{ "id": "views-to-board", "statement": "…", "commands": [ … ], "optional": [] }]
```

### 7. The optional tidy-up line, and the existing-board branch

```
$ corpus doc edit doc_seedopenthreads --extra pinned=false --unset order
$ corpus workspace upgrade
  views-to-board: … and 2 view documents here still rely on them, with no board document …
    corpus doc create --type board --title "Board" --folder boards --columns doc_seedattention,doc_seedinbox --default-open true
    corpus doc edit doc_seedattention --unset pinned --unset order
    corpus doc edit doc_seedinbox --unset pinned --unset order
    optional — these keys are dead weight, and nothing breaks if they stay:
      corpus doc edit doc_seedopenthreads --unset pinned --unset order

$ corpus doc create --type board --title "Existing" --folder boards --columns doc_seedattention --default-open true
created doc_qlc544ii — data/docs/boards/existing.md
$ corpus workspace upgrade
  views-to-board: … 1 view document here still relies on them, while no board lists it.
    corpus doc edit doc_qlc544ii --columns doc_seedattention,doc_seedinbox
    corpus doc edit doc_seedinbox --unset pinned --unset order
    optional — …
$ corpus doc edit doc_qlc544ii --columns doc_seedattention,doc_seedinbox
$ corpus doc edit doc_seedinbox --unset pinned --unset order
$ corpus workspace upgrade
already up to date.
migrations: none — every document is written the way this tool reads it.
```

The extended board on disk keeps `doc_seedattention` first and appends
`doc_seedinbox` — nothing already on the board moved.

### 8. The two messages agree

```
$ corpus doc edit doc_seedattention --pinned true
corpus: `--pinned` was removed in 0.19.0: a board lists its columns — see `corpus upgrade`.
  … the migration itself is `corpus doc edit <id> --unset pinned`.
```

Same verb, same flag, and `corpus upgrade` prints exactly that command with
`--unset order` beside it.

### Checks

- `npm run build -w packages/contract` and `-w apps/cli` — clean.
  `npm run build` at the root is **blocked by `packages/kit`** (`src/testing/docRow.ts`
  still names `pinned`, UI-148's, in flight), so the CLI was built on its own.
- `npm run typecheck -w apps/cli` — exit 0.
- `./node_modules/.bin/eslint apps/cli/src --max-warnings 0` — exit 0.
- `./node_modules/.bin/prettier --check "apps/cli/src/**/*.ts" docs/cli.md` — exit 0.
  (`npx prettier` runs through the `rtk` proxy, which printed "All files formatted
  correctly" and then exited **1**; the direct binary is what was believed.)
- `VITEST_MAX_THREADS=4 vitest run apps/cli` — **100 files, 1727 tests, all pass.**
- `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`, never hand-edited.

### Falsification

Every behaviour was broken in place and its test watched go red. 19 mutations,
each applied, run, and reverted (`scratchpad/falsify/run.py`):

| Mutation | Verdict |
| --- | --- |
| the detector never fires | RED |
| a view a board already lists is still reported as stranded | RED |
| an archived board stops counting as listing its views | RED |
| the created board loses `--default-open true` | RED |
| the unset command drops `--unset order` | RED |
| `order` nulls sort first instead of last | RED |
| a kanban board receives view columns | RED |
| `--from agent` is never written | RED |
| the empty section is dropped instead of saying `none` | RED |
| `corpus workspace upgrade` stops printing the section | RED |
| `corpus upgrade` stops printing it after an install | RED |
| `corpus upgrade` stops carrying the `migrations` key | RED |
| the report stops carrying the `migrations` key | RED |
| the frontmatter reader stops stripping `\r` | RED |
| an unparsable file fails the whole read | RED |
| `dataDir` ignored — `corpus workspace upgrade` | RED (see below) |
| `dataDir` ignored — `corpus upgrade --check` | RED (see below) |
| `dataDir` ignored — `corpus upgrade` already-current path | RED (see below) |
| `dataDir` ignored — `corpus upgrade` install path | RED (see below) |

**One test could not fail on the first pass and was fixed.** Hardcoding
`dataDir` to `"data"` in both verbs left the suite green: `corpus.test.ts` tested
`readWorkspaceCorpus(root, "corpus-data")` directly and nothing tested that the
verbs *pass* the workspace's own `dataDir` down. Two tests were added — one per
verb, the second covering all three of `corpus upgrade`'s request sites — and
all four mutations then went red.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-061]` prefix
