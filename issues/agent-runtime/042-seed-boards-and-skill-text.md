# [AGENT-042] Seed boards and a kanban; the skills and template say "a board is a document"

## Domain
agent-runtime

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (riders 2, 5, 6, 9 signed); CLI-060 for the verbs the skill text cites; SERVER-137 for the event to exist end to end

## Spec References
- SPEC.md §4 — the workspace tree and seeds
- SPEC.md §5 — `stage`
- SPEC.md §10 — boards as documents, kanban boards, the seed boards

## Summary

> **Amended 2026-08-22 (Phase 41 prep).** This issue was written before v0.18.0 removed the plugin surface and derived status (SHARED-067). The clauses that named them are struck below, and the §-citations are renumbered to the post-v0.18.0 SPEC.

The workspace template ships three pinned views and the product agent's skills say "pin me a view". After Phase 41 a column is a line in a board document and a kanban is a board over a field. This issue updates what `corpus init` installs and what the agent is told: three seed boards, seed views without `pinned`/`order`, and skill, README and docs text that describe boards, kanbans and `stage` in the agent's terms.

## Acceptance Criteria
- [x] `assets/workspace/data/docs/boards/attention.md` (`order: 1`, `columns: [doc_seedattention, doc_seedinbox, doc_seedopenthreads]`), `boards/by-status.md` (`order: 2`, `kanban: { field: status, stages: [open, resolved, archived] }`, `query: { type: note }`), `boards/files.md` (`order: 3`, `columns: []`, `default-open: true`). Stable ids in the `doc_seed…` style.
- [x] The three seed views lose `pinned` and `order`; nothing else about them changes.
- [x] `assets/workspace/README.md` lines ~29-31, 69, 77, 103 describe boards, not "three columns".
- [x] `assets/workspace/claude/skills/orchestrate/SKILL.md` (~line 1037, "documents `--pinned`, `--order`") teaches: pin a view = add its id to a board's `columns`; make a kanban = one board document with `kanban`; move a document along a workflow = `corpus doc edit --stage`; and that a stage may write a status (§5) so the agent reads the response.
- [x] `assets/workspace/claude/skills/comment/SKILL.md` mentions of "board" still read true (they do not say pinned; verify).
- [x] The orchestrate skill handles **`workspace.reflect`** (SPEC §7 rider 9): gather the window with `corpus doc list --since <payload.since>` (no `--since` when null), read what it chooses, write a changelog entry on each document it has something to say about, and post **one standalone thread** as the digest — first line names the window `since … until …`, then what moved, what it did, what it asks — and posts it even when there is nothing to say, in one line. It never treats a stage name as an instruction. The skill names the cost rule: read a document only when the list line is not enough.
- [x] `docs/workspace-template.md` (~lines 41-43) updated: the seed views are no longer "pinned … order N" but ids listed on a board document. (`docs/PLUGINS.md` was deleted by SHARED-067 and needs nothing.)
- [x] `corpus init` in a temp dir yields the three boards and the board bar shows them in order (checked with the UI once UI-148 lands; until then, `corpus doc list --type board --sort order`).

## Technical Design

### Files to Create/Modify
- `assets/workspace/data/docs/boards/*.md` — new
- `assets/workspace/data/docs/views/{attention,inbox,open-threads}.md` — strip two keys
- `assets/workspace/README.md`, `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `docs/workspace-template.md`
- any template manifest that lists seed files (the three-way rule in `corpus workspace upgrade` needs the new files known as template files)

### Key Implementation Details
- The template installer copies verbatim (scaffold.ts `planTemplateInstall`), so the new board files need no code — but the template's file list must include `boards/` for `workspace upgrade` to offer them to an existing workspace as *new* files (and CLI-061's migration then points at them instead of creating `Board`). Coordinate the title: the migration creates `Board` only when no board exists.
- Skill text is prose the agent runs on: keep the controlled-language rules the skills already follow.

### Edge Cases
- An existing workspace has its own `views/attention.md` edited: the three-way rule leaves it alone, and CLI-061's migration names the `--unset` for it.

## Testing Strategy
The existing template tests (seed parity, skill lint) plus a test that the seed boards parse and validate against the contract's board schema.

## E2E Verification Plan
### Verification Steps
1. `corpus init` in a temp dir → `ls data/docs/boards` shows three files; `corpus doc show doc_seedboardattention` prints `columns`.
2. Run the orchestrate skill's own example ("pin me a view of unresolved finance threads") in a sandbox workspace and confirm the agent edits a board document rather than writing `pinned`.

## E2E Verification Log

**agent-runtime-dev, 2026-08-22, on opus.** Every measurement below is from a real
`corpus init` into a temp directory, a real server on port **8766** (never 8765), and the
built CLI (`apps/cli/dist/bin/corpus.js`) — no fixtures, no test client.

### 1. `corpus init` installs the three boards

```
$ node apps/cli/dist/bin/corpus.js init <tmp>/ws2
  installed 19 template files, recorded in .corpus/template-manifest.json     (was 16)
$ ls data/docs/boards
attention.md  by-status.md  files.md
$ corpus doc list --type board --sort order
doc_seedboardattention  board  open  Attention  data/docs/boards/attention.md
doc_seedboardbystatus   board  open  By status  data/docs/boards/by-status.md
doc_seedboardfiles      board  open  Files      data/docs/boards/files.md
showing 1–3 of 3 documents
$ corpus doc check
checked 12 documents — no findings.
```

The board bar's own order, read off the projection under `--json`:

| id | order | columns | kanban | defaultOpen | query | extra |
| --- | --- | --- | --- | --- | --- | --- |
| `doc_seedboardattention` | 1 | `[doc_seedattention, doc_seedinbox, doc_seedopenthreads]` | null | false | null | `{}` |
| `doc_seedboardbystatus` | 2 | **null** | `{field: status, stages: [open, resolved, archived]}` | false | `{type: note}` | `{}` |
| `doc_seedboardfiles` | 3 | **`[]`** | null | **true** | null | `{}` |

`columns: null` on the kanban and `columns: []` on Files are the two different states rider 6
and rider 2 require, and the projection tells them apart. The three seed views come back with
`order: null` and `extra: {}` — neither removed key survives anywhere.

### 2. The seeds do not make a brand-new workspace report a migration against itself

```
$ corpus workspace upgrade --dry-run --from agent
already up to date.
migrations: none — every document is written the way this tool reads it.
```

CLI-061's `views-to-board` fires on exactly `pinned`/`order`, so a seed still carrying one
would have had `corpus upgrade` tell a fresh install to migrate itself. It does not.

### 3. `workspace.reflect`, end to end, walking the skill's own procedure

```
$ corpus reflect --status
reflected never — the window is the whole corpus · 11 documents changed since
$ corpus reflect --json
{"eventId":"evt_dzk3hzrtnkx7","since":null,"pending":false}
$ corpus reflect --json                    # asking twice
{"eventId":"evt_dzk3hzrtnkx7","since":null,"pending":true}   # exit 0, same event
$ corpus queue claim-all
{"events":[{"id":"evt_dzk3hzrtnkx7","type":"workspace.reflect","source":"reflect","payload":{"since":null}}],…}
$ corpus doc list                          # `since: null`, so no --since at all
… showing 1–12 of 12 documents
$ corpus thread create --title "Reflection — 23 Aug" --from agent --model claude-opus-4-1 --job evt_dzk3hzrtnkx7 <<'CORPUS_EOF'
since the beginning until 2026-08-23T04:22:00Z — a fresh workspace, nothing to report.
CORPUS_EOF
created th_rhnhwecp — standalone
$ corpus queue complete evt_dzk3hzrtnkx7
$ corpus reflect --status --json
{"reflected":"2026-08-23T04:21:51Z","pending":null,"changed":0,"lastDigest":"th_rhnhwecp","quiet":30}
```

`changed: 0` afterwards: the agent's own digest does not schedule the next reflection.

**And the `--job` rule, falsified rather than assumed.** A second reflection, digest posted
with **no** `--job`: the clock still advanced, and `last digest` stayed pointing at the
*previous* thread — `th_rhnhwecp`, not the one just posted. Exit 0, nothing said anywhere.
That silent loss is why the skill now states the three mechanical facts (no parent, `--job`,
post before completing) as a list rather than leaving them implied.

### 4. Every product claim the new skill text makes, measured

- **`--columns` is the whole list.** `corpus doc edit doc_seedboardattention --columns doc_seedopenthreads`
  → `edited`, exit 0, `columns` now `["doc_seedopenthreads"]`. Two columns gone, silently.
- **`default-open` moves.** `--default-open true` on Attention printed, on its own line:
  `Files (doc_seedboardfiles) is no longer the default-open board: …`.
- **A stage may write a status, on a separate line.** Against a real kanban over `stage` with
  `status: {done: resolved}`:
  ```
  $ corpus doc edit doc_ynlrgeet --stage done --from agent
  edited doc_ynlrgeet
  stage `done` set status to `resolved`: this document is in the kanban Triage (doc_serqplj4), …
  key a039174350b6…
  ```
  The confirmation is the **first** line, the coupling sentence the second, and the key the
  third — so a parser reading "the last line" reads the key.
- **`lastActor` is on the row.** `corpus doc list --json` carries `"lastActor":"user"` on every
  seed. The skill's cost rule cites it, and it is really there.
- **"Pin me a view" as two writes** ran end to end: `doc create --type view …` then
  `doc edit <board> --columns …,doc_pw2ih5yn`. The board picked the new column up.

### 5. One correction the E2E forced

Rider 2 says "archiving the last board is refused". Measured: `corpus doc archive` on the last
remaining board **succeeds at exit 0** and leaves a workspace with no board. That refusal is
UI-148's, client-side. The first draft of the skill and the README both stated it flatly, which
would have told an agent acting through the CLI that it was protected where it is not. Both
now say the board bar refuses it and the CLI does not, and the skill tells the agent to count
the boards first. Pinned in `scripts/workspace-template.test.ts`.

### 6. Tests, and the falsification of every one of them

```
$ npx vitest run scripts/workspace-template.test.ts apps/server/src/docs/board-query.test.ts apps/server/src/docs/board-write.test.ts
Tests  469 passed (469)
```

A green test is not evidence, so **24 mutations were applied one at a time to the real files,
the suite run against each, and the file restored** (`scratchpad/falsify.mjs`). Every mutation
turned the test that owns it red, and no mutation passed:

| # | mutation | test that went red |
| --- | --- | --- |
| 1 | a seed view keeps `pinned: true` | seed views › ships exactly three saved queries |
| 2 | Attention board reorders its columns | seed boards › puts the three seed views on the Attention board |
| 3 | a board names a view that does not ship | seed boards › names only view documents that ship |
| 4 | the kanban writes `transitions: {}` | seed boards › draws the kanban as the linear funnel |
| 5 | the kanban also carries `columns` | seed boards › draws the kanban as the linear funnel |
| 6 | a second board carries `default-open` | seed boards › carries `default-open` on exactly one board |
| 7 | Files loses its empty `columns` | seed boards › ships the Files board empty |
| 8 | a board spells `defaultOpen` | seed boards › writes the board keys as the file spells them |
| 9 | two boards share an `order` | seed boards › three boards, each with a distinct place |
| 10 | the delta list names `--pinned` again | boards › names no removed key |
| 11 | `--columns` described as an append | boards › teaches pinning a view as a write to the board |
| 12 | the two graphs collapsed into one | boards › keeps the two graphs apart |
| 13 | the stage's second output line dropped | boards › separates stage from status |
| 14 | routing table loses its `workspace.reflect` row | reflection › routes the event to a subagent |
| 15 | `since: null` gathered as an empty value | reflection › gathers the window itself |
| 16 | the cost rule goes | reflection › gathers the window itself |
| 17 | a stage becomes an instruction | reflection › never reads a stage as an instruction |
| 18 | the digest loses `--job` | reflection › posts one digest |
| 19 | the digest is parented | reflection › posts one digest |
| 20 | the empty-window digest is dropped | reflection › posts one digest |
| 21 | a worked digest says `@agent` | reflection › posts one digest |
| 22 | "post before you settle" goes | reflection › posts one digest |
| 23 | a failed reflection said to need a narrower window | reflection › says a failure leaves the clock |
| 24 | the reflection section demoted to `###` | skills › carries its required section headings **and** orchestrate › every section substantive |

The two server tests were falsified the same way: putting `pinned`/`order` back on a seed view
and taking `default-open` off Files turned **3** tests red across `board-query.test.ts` and
`board-write.test.ts`, including the new seed-board round-trip.

**No test was found that cannot fail.** The one that came closest is `seed boards › names only
view documents that ship`, which skips a board carrying no `columns` key — vacuous on its own,
but the Attention board's explicit `toEqual` (mutation 2) and the "three boards" case pin the
set from the other side.

### 7. Lint, typecheck

`prettier --check` clean on every touched file. `eslint` clean on the three TypeScript files.
`tsc --noEmit` clean for `apps/server` and `scripts/` (checked by exit code, not by the
proxy's output line). `packages/kit` does not build — `src/testing/docRow.ts` still names
`pinned`, which is UI-148's and in flight — so `npm run build` was not run whole. `contract`
and `cli` were built individually, which is all this issue's E2E needs.

Server on 8766 stopped, port confirmed free. 8765 never touched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[AGENT-042]` prefix
