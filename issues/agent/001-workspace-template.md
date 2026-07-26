# [AGENT-001] Workspace template: skills layout, seed documents, config

## Domain

agent

## Status

in_progress

## Priority

P1

## Model

opus — structure derivable from spec; skill prose lands in AGENT-002/003.

## Dependencies

- Depends on: SHARED-001
- Blocks: CLI-002, AGENT-002

## Spec References

- SPEC.md §4 (repository layout) — as revised by SHARED-001 for the tool/workspace split: `data/`, `.corpus/`, `.claude/` are **workspace** contents, not repo contents
- SPEC.md §7 (skills and agent definitions are documents) — `.claude/skills/**/SKILL.md` as `type: skill`, `.claude/agents/*.md` as `type: agent-def`, dual frontmatter, archiving disables
- SPEC.md §11 (seed columns, templates) — columns are pinned `type: view` documents with `order`; the seed ships Attention / Inbox / Open threads, deletable like any document; templates are `type: template` documents with `for: <doc-type>`
- SPEC.md §5 (document model) — canonical frontmatter every seed document must satisfy
- CLAUDE.md — "Product vs. dev harness" (`assets/workspace/` is **product** code), Architecture Decisions 1 (tool/workspace split) and 2 (server is sole writer)

## Summary

Populate `assets/workspace/` — the directory `corpus init` copies verbatim into a new user workspace — with the complete, install-ready skeleton of a Corpus workspace: the product agent's `.claude/` tree (orchestrate + comment skill files, subagent-persona directory), the `data/` document root with starter templates and the three seed pinned view documents (Attention, Inbox, Open threads), the workspace `.gitignore`, and an operator-facing README. This issue ships **structure, not judgment**: the two `SKILL.md` files are valid, non-harmful skeletons whose real behavioral prose arrives in AGENT-002 (orchestrate) and AGENT-003 (comment).

The deliverable is also a **contract for CLI-002**: the tree, the copy rules (which names are rewritten on install, which files are filtered out), and what `corpus init` must generate rather than copy (`.corpus/config.json` with the generated port and bearer token, the queue directory skeleton, the git repo and its initial commit). CLI-002 copies the tree wholesale and applies those rules — it must not encode knowledge of individual seed files.

## Acceptance Criteria

- [x] `assets/workspace/` contains the full template tree (below), and every file in it is byte-for-byte what a fresh workspace should contain — no placeholder markers, no `TODO`, no `<fill me>` tokens anywhere in the tree.
- [x] Dot-prefixed names are **not** used in the template. `claude/` installs as `.claude/`, `gitignore` installs as `.gitignore`. `.gitkeep` is the single permitted dot-prefixed name and is filtered out during the copy. A unit test enforces both rules.
- [x] `claude/skills/orchestrate/SKILL.md` and `claude/skills/comment/SKILL.md` exist as valid skeletons: YAML frontmatter carrying **both** Claude Code fields (`name`, `description`) and Corpus fields (`id`, `type: skill`, `title`, `status`, `created`, `updated`, `tags`, `evergreen`), with `name` equal to the containing directory name; body contains the required section headings and the CLI-only invariant, and nothing that would mislead an operator who initializes a workspace before AGENT-002/003 land.
- [x] `claude/agents/` exists (empty but for `.gitkeep`) and is documented as the home of `type: agent-def` subagent-persona documents that become `@<subagent>` autocomplete targets.
- [x] `data/docs/inbox/` and `data/threads/` exist (empty but for `.gitkeep`) — quick creation lands in `inbox/`, threads are flat under `data/threads/`.
- [x] `data/docs/templates/note.md` exists as a `type: template` document with `for: note`; it is the minimum, and any additional templates follow the same shape.
- [x] Three seed pinned view documents exist under `data/docs/views/` as **ordinary deletable documents**: Attention (`query: { needs: me }`, `order: 1`), Inbox (`query: { folder: inbox }`, `order: 2`), Open threads (`query: { type: thread, status: open }`, `order: 3`) — each `type: view`, `pinned: true`, with a one-paragraph body explaining what the column shows.
- [x] Every document in the template carries complete §5 frontmatter (`id`, `type`, `title`, `created`, `updated`, `tags`, `status`, `anchors`) and `evergreen: true` (seed content must never age into Attention as stale), and every `id` is unique across the tree.
- [x] `gitignore` ignores `.corpus/` runtime state — `cache.db`, `jobs/`, `attachments/`, `locks/`, `seen.json`, `HALT` — while **keeping the queue directory skeleton tracked** so a clone of a workspace still has `.corpus/queue/{pending,in-progress,processed,failed,abandoned}/`.
- [x] `README.md` (workspace root) explains the operator loop in under a page: start the server, start `claude`, `/orchestrate`, where the board is, the HALT toggle, and the `corpus skill rollback <name>` recovery path.
- [x] `docs/workspace-template.md` (repo-side, **not** copied) documents the tree, the install-time rename/filter rules, and the list of things `corpus init` generates rather than copies — the contract CLI-002 implements.
- [x] `npm test` covers the template: required paths present, every markdown file's frontmatter parses and validates, ids unique, no dot-prefixed entries (except `.gitkeep`), no placeholder markers, seed views carry `pinned`/`order`/`query` with contiguous orders starting at 1, skill frontmatter carries both field sets with `name` matching its directory.
- [ ] Every seed document passes `corpus doc check` in a real initialized workspace (recorded in the E2E log). — **DEFERRED → CLI-002**: the CLI does not exist in Phase 1 (sprint-001 Verification Environment). Interim guarantee and the deferral rationale are in the E2E log.

## Technical Design

### Files to Create/Modify

```
assets/workspace/
  README.md                              # operator loop, one page
  gitignore                              # installs as .gitignore
  claude/                                # installs as .claude/
    skills/
      orchestrate/SKILL.md               # skeleton; prose in AGENT-002
      comment/SKILL.md                   # skeleton; prose in AGENT-003
    agents/.gitkeep                      # subagent personas (type: agent-def)
  data/
    docs/
      inbox/.gitkeep                     # quick-creation landing folder
      templates/note.md                  # type: template, for: note
      views/
        attention.md                     # seed pinned view, order 1
        inbox.md                         # seed pinned view, order 2
        open-threads.md                  # seed pinned view, order 3
    threads/.gitkeep                      # flat thread root
```

- `docs/workspace-template.md` — repo-side contract doc (tree, copy rules, init-generated files); **not** part of the copied tree
- `scripts/workspace-template.ts` — loads and validates the template tree (exported helpers used by the test and, later, by CLI-002's init smoke test)
- `scripts/workspace-template.test.ts` — Vitest suite (root config picks it up)
- `package.json` — add `yaml` to root `devDependencies` if not already present (frontmatter parsing in the validator; §5 forbids hand-rolled parsing)
- `.prettierignore` — exclude `assets/workspace/` so Prettier never reformats template markdown (its bytes are the product)

### Key Implementation Details

**Why no dot-prefixed names.** A literal `assets/workspace/.claude/skills/orchestrate/SKILL.md` risks this repo's own Claude Code discovering the _product_ agent's skills as directory-scoped dev-harness skills — exactly the product/harness confusion CLAUDE.md forbids. Likewise a literal `.gitignore` inside `assets/workspace/` would apply to this repository. Storing them dotless and renaming at install time removes both hazards and costs one line in the copier. The rename table lives in `docs/workspace-template.md` and is the only place CLI-002 reads it from:

| template path | installed path |
| ------------- | -------------- |
| `claude/`     | `.claude/`     |
| `gitignore`   | `.gitignore`   |

Filter rule: files named `.gitkeep` are not copied (their only job is to make git track the empty directory in this repo; `corpus init` creates the directories directly).

**Seed document frontmatter.** Every template document uses fixed, readable ids (`doc_seed_attention`, `doc_seed_inbox`, `doc_seed_open_threads`, `doc_seed_template_note`, `skill_orchestrate`, `skill_comment`). Ids are unique within a workspace, and a fixed id per seed file lets the README and skills reference them stably. Confirm the id format against the revised §5 / the contract's id schema; if the schema demands a generated suffix form, escalate to the orchestrator rather than inventing a variant.

`created`/`updated` are a single fixed ISO timestamp across the template (the template's authoring date). Because the staleness ramp (§5) runs from `max(updated, reviewed)`, every seed document sets `evergreen: true` so a day-one workspace does not open with its own seed content sitting in Attention.

**Seed view shape.** A column IS a `type: view` document (§11). Its query lives under a `query:` mapping whose keys mirror the `GET /api/docs` parameters of §9.2 verbatim — `needs`, `folder`, `type`, `status`, `tag`, `q`, `sort` — so the UI can hand the mapping to the collection endpoint without translation:

```yaml
---
id: doc_seed_attention
type: view
title: Attention
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: []
status: open
anchors: {}
evergreen: true
pinned: true
order: 1
query:
  needs: me
---
Everything waiting on you: unread agent replies, unanswered forms, due or
overdue documents, documents due for review, and failed jobs. Handling the
reason clears the row.
```

`folder` values are paths relative to `data/docs/` with no leading or trailing slash (`inbox`). If SHARED-001's revised §9.2/§11 pins different names or a different nesting for the query, follow the spec and note the deviation in the issue — the spec wins.

**Skill skeletons.** Frontmatter carries both field sets in one YAML block (§7); `name` must equal the directory name or Claude Code will not discover the skill:

```yaml
---
name: orchestrate
description: Run the Corpus agent loop — claim queue events, handle them, park on idle.
id: skill_orchestrate
type: skill
title: Orchestrate
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T00:00:00Z
tags: [core]
status: open
anchors: {}
evergreen: true
---
```

The skeleton body carries the section headings AGENT-002/003 will fill (see those issues for the required section lists) plus the one invariant that must be true from day one, stated plainly: **every mutation goes through the `corpus` CLI; never hand-edit workspace files.** No `TODO` markers — a workspace initialized between this issue and AGENT-002 must read as incomplete-but-honest, not as a broken scaffold shipped to a user.

**What `corpus init` generates rather than copies** (documented, implemented by CLI-002): `.corpus/config.json` (version, port, generated bearer token, `dataDir`), the `.corpus/queue/{pending,in-progress,processed,failed,abandoned}/` skeleton, `git init` plus the initial commit, and any host-specific values. The template contains no secrets and no machine-specific paths — it is fully static, which is what makes "copy wholesale" a safe contract.

**Out of scope (deliberate).** A workspace-level `CLAUDE.md` (project instructions for the user's Claude Code instance) is not part of this issue; if it proves needed once the loop runs for real, it is a follow-up AGENT issue, and its home would be `assets/workspace/CLAUDE.md`. Plugin skills are not seeded — plugins ship their own (§10).

### Edge Cases

- **Empty directories.** Git cannot track them; `.gitkeep` files exist only for this repo and must be filtered on copy, or every new workspace ships stray files.
- **Prettier.** Without the `.prettierignore` entry, `npm run format` rewrites template markdown (list markers, wrapping) and silently changes what users receive.
- **Frontmatter key collisions.** Claude Code's `name`/`description` and Corpus's `id`/`type`/`title` share one YAML block; a document must not use `name` as a Corpus field or the two systems disagree about identity.
- **Seed views are deletable.** Nothing may hardwire their ids — the UI reads pinned view documents from the projection. Do not add a "restore defaults" mechanism; re-running `corpus init` is out of scope here.
- **`order` collisions.** Two seed views with the same `order` produce nondeterministic column order; the test asserts contiguous orders starting at 1.
- **Timestamp format.** Frontmatter timestamps must be quoted or unquoted consistently with the YAML library's round-trip so `corpus doc edit` does not produce a spurious diff on first write.
- **Coverage gate.** `scripts/workspace-template.ts` is the only source file this issue adds; the test must exercise its branches (missing file, bad frontmatter, duplicate id) so the repo-wide 90% threshold is not dragged down.

## Testing Strategy

Vitest, `scripts/workspace-template.test.ts` (root config, `npm test`):

- **Structure**: every required path from the tree above exists; no unexpected top-level entries; no entry name starts with `.` except `.gitkeep`; no file contains `TODO`, `FIXME`, `<placeholder>`, or `XXX`.
- **Frontmatter validity**: every `.md` in the tree parses with `yaml`, has the §5 core fields with correct types, `evergreen: true`, and a unique `id` across the tree.
- **Seed views**: exactly three, each `type: view` with `pinned: true`, an integer `order` forming `1..3` with no duplicates, and a non-empty `query` mapping whose keys are drawn from the `GET /api/docs` parameter set; Attention has `needs: me`, Inbox has `folder: inbox`, Open threads has `type: thread` + `status: open`.
- **Templates**: `templates/note.md` has `type: template` and `for: note`; every `type: template` document declares `for`.
- **Skills**: both `SKILL.md` files carry `name`, `description`, `id`, `type: skill`, `title`, `status`; `name` equals the parent directory name; the body states the CLI-only invariant.
- **Copy rules**: the rename table and filter list exported by `scripts/workspace-template.ts` match `docs/workspace-template.md` (so the contract and the code cannot drift).

`corpus doc check` conformance is not unit-testable here (the CLI is a separate workspace and may not exist yet) — it is verified E2E.

## E2E Verification Plan

### Reproduction Steps (bugs only)

_N/A — feature issue._

### Verification Steps

Primary path (when `corpus init` from CLI-002 and the server are available):

1. In a scratch directory outside the repo: `corpus init` → the workspace materializes with `.claude/skills/{orchestrate,comment}/SKILL.md`, `.claude/agents/`, `data/docs/{inbox,templates,views}`, `data/threads/`, `.gitignore`, `README.md`, and a generated `.corpus/config.json`.
2. `ls -a` the new workspace → no `.gitkeep`, no `claude/` or `gitignore` left un-renamed.
3. `corpus doc check` → passes for every seed document; capture the output.
4. `corpus server start` then `corpus db rebuild && corpus db doctor` → clean; `GET /api/docs?type=view` returns the three seed views with their `order`; `GET /api/docs?type=skill` returns both skills (the `.claude/skills` document root is indexed per §7).
5. Open the board → three columns in order Attention, Inbox, Open threads; each renders rows (empty is fine) and the column header matches the view document's title.
6. `git -C <workspace> status` → clean; `git log` shows the init commit; `.corpus/cache.db`, `.corpus/jobs/`, `.corpus/attachments/`, `.corpus/locks/`, `.corpus/seen.json`, `.corpus/HALT` are ignored while `.corpus/queue/*/` remains tracked.
7. Delete a seed view document through the CLI → its column disappears from the board (proving nothing is hardwired).

Fallback (only if CLI-002 has not landed when this issue is implemented): perform the copy by hand exactly as `docs/workspace-template.md` specifies (`cp -R`, apply the rename table, drop `.gitkeep`), then run whatever of steps 3–7 the available tooling supports, and record precisely which steps were deferred. **This issue is re-verified end-to-end as part of CLI-002's E2E log** — note that dependency in the log.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context).

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

Verification environment per `issues/sprints/sprint-001.md`: `corpus init` (CLI-002) and the
server do not exist yet, so the "real application" for this issue is file-tree inspection of
`assets/workspace/` plus a **simulated install** — `cp -R` + the rename/filter rules exactly
as `docs/workspace-template.md` specifies — into scratch directories outside the repository.

#### 1. Unit gate — `npm test`

```
$ npx vitest run scripts/workspace-template.test.ts
 Test Files  1 passed (1)
      Tests  34 passed (34)

$ npm test
 Test Files  24 passed (24)
      Tests  264 passed (264)
```

The 34 template tests cover: exact tree contents (TEST-49), no dot-prefixed name but
`.gitkeep` (TEST-50), no placeholder markers and no secrets/absolute paths (TEST-51), §5
frontmatter with contract-valid ids and ISO instants (TEST-52), the three seed views
(TEST-53), the note template's `for` (TEST-54), both skill skeletons (TEST-55), the
`gitignore` rules (TEST-56), and the doc↔code install contract (TEST-58). Ids are validated
against `@corpus/contract`'s shipped `DocumentIdSchema` and timestamps against
`IsoDateTimeSchema` — no second declaration of either pattern.

Adjudicated ids in use (orchestrator decision, sprint Open Conflicts item 2):
`doc_seedattention`, `doc_seedinbox`, `doc_seedopenthreads`, `doc_seedtemplatenote`,
`doc_skillorchestrate`, `doc_skillcomment`, plus `doc_seedreadme` for the workspace README
(see "Deviations" below).

#### 2. `gitignore` behavior in a real scratch git repository (TEST-56)

```
$ git init -q . && cp assets/workspace/gitignore .gitignore
$ # populate the six runtime-state paths + the five queue dirs, each with a .gitkeep
$ git check-ignore -v <path>            # runtime state — all IGNORED
.gitignore:9:.corpus/*          .corpus/cache.db
.gitignore:9:.corpus/*          .corpus/jobs/x.jsonl
.gitignore:9:.corpus/*          .corpus/attachments/th_a/1/x.png
.gitignore:9:.corpus/*          .corpus/locks/doc_a.json
.gitignore:9:.corpus/*          .corpus/seen.json
.gitignore:9:.corpus/*          .corpus/HALT
.gitignore:9:.corpus/*          .corpus/config.json
.gitignore:16:.corpus/queue/*/*.json    .corpus/queue/pending/evt_1.json

$ git check-ignore -v <queue dirs>      # all five, with and without a trailing slash
.corpus/queue/pending            not ignored
.corpus/queue/pending/           not ignored
.corpus/queue/pending/.gitkeep   not ignored
  (…identically for in-progress, processed, failed, abandoned)

$ git add -A && git commit -qm init && git ls-files
.corpus/queue/abandoned/.gitkeep
.corpus/queue/failed/.gitkeep
.corpus/queue/in-progress/.gitkeep
.corpus/queue/pending/.gitkeep
.corpus/queue/processed/.gitkeep
.gitignore
$ git status --porcelain          # empty
```

A first draft used `.corpus/queue/*/*` + `!.corpus/queue/*/.gitkeep`; that reported the
queue **directories themselves** as ignored when probed with a trailing slash
(`git check-ignore -v .corpus/queue/pending/` matched `.corpus/queue/*/*`), which fails
TEST-56's "the five queue directories remain trackable" as literally written. Narrowing the
rule to `.corpus/queue/*/*.json` — event files are `<eventId>.json` per SPEC §7 — ignores
the events and leaves both the directories and their `.gitkeep`s trackable under either
probe form. Evidence above is from the corrected rule.

#### 3. Simulated install (TEST-59)

Executed exactly the four numbered steps of `docs/workspace-template.md` → "The install
procedure" in an empty scratch directory outside the repository:

```
$ cp -R assets/workspace/. "$WS"/
$ mv "$WS/claude" "$WS/.claude"; mv "$WS/gitignore" "$WS/.gitignore"
$ find "$WS" -name '.gitkeep' -delete
$ # step 4: generate .corpus/config.json + the queue skeleton + git init & initial commit
$ git init -q . && git add -A && git commit -qm "corpus init"
13 files changed, 466 insertions(+)

$ find . -path ./.git -prune -o -print | sort
./.claude/agents
./.claude/skills/comment/SKILL.md
./.claude/skills/orchestrate/SKILL.md
./.corpus/config.json
./.corpus/queue/{abandoned,failed,in-progress,pending,processed}/.gitkeep
./.gitignore
./data/docs/inbox
./data/docs/templates/note.md
./data/docs/views/{attention,inbox,open-threads}.md
./data/threads
./README.md

$ ls -d claude gitignore 2>/dev/null           # no output — nothing left un-renamed
$ find . -name .gitkeep -not -path './.corpus/*'   # no output — no leftover markers
$ git status --porcelain                        # empty
$ grep -RIn -E 'TODO|FIXME|XXX|<placeholder>|<fill me>|lorem ipsum' .   # none found
```

The installed workspace contains no secrets, no tokens, and no machine-specific paths — the
only host-specific file, `.corpus/config.json`, was generated in step 4 and is ignored by
the installed `.gitignore`.

#### 4. Prettier never rewrites the template (TEST-60)

```
$ find assets/workspace -type f -exec shasum {} \; | sort > before.sha
$ npm run format                       # write mode, whole repo
$ find assets/workspace -type f -exec shasum {} \; | sort > after.sha
$ diff before.sha after.sha            # identical — the .prettierignore entry holds
$ npm run format:check
All matched files use Prettier code style!
```

#### 5. Repo gate

```
$ npm run lint          # eslint . — clean
$ npm run format:check  # clean
$ npm run typecheck     # 5 workspaces, exit 0
$ npx tsc -p scripts/tsconfig.json --noEmit   # exit 0
$ npm run test:coverage # 264 tests pass; All files 100% stmts/branch/funcs/lines
```

#### Deferred verification

- **`corpus doc check` on every seed document → DEFERRED → CLI-002.** The CLI does not
  exist. The sprint's stand-in is TEST-61 (SERVER-001's `parseDocument` + corpus checker over
  `assets/workspace/`), which is also **DEFERRED** here: SERVER-001 is being implemented in a
  separate worktree and its document-model library is not present in this tree. This issue's
  own validator (`scripts/workspace-template.ts`) parses every template `.md` with the real
  `yaml` library and validates ids/timestamps against the shipped contract schemas as the
  interim guarantee. This issue is re-verified end to end in CLI-002.
  **VERIFIED 2026-07-26 (evaluator):** the circular deferral (SERVER-001 → AGENT-001 → CLI-002)
  was caught in evaluation; the evaluator ran TEST-61 itself over the merged tree — SERVER-001's
  parser + checker over `assets/workspace/`: 0 errors, 0 warnings (issues/evals/AGENT-001-eval.md).
  The full `corpus doc check` re-verification still lands in CLI-002.
- **Server/board steps 4–7 of the Verification Plan → DEFERRED → CLI-002 / SERVER-003 /
  SERVER-004 / UI-003.** No server, no projection, no board exists in Phase 1: `db rebuild`,
  `db doctor`, `GET /api/docs?type=view`, `GET /api/docs?type=skill`, the three rendered
  columns, and deleting a seed view to prove nothing is hardwired all require them.
- **Claude Code actually discovering the two skills → DEFERRED → AGENT-002.** Frontmatter
  shape (`name` equal to the directory name, `description` present) is unit-asserted; a real
  `/orchestrate` run is AGENT-002's E2E.
- **Skill command accuracy against `docs/cli.md` → DEFERRED → AGENT-002/003.** `docs/cli.md`
  is generated by CLI-001 and does not exist. The skeletons therefore use only verbs SPEC.md
  names literally (§2.1, §7, §15). Two shapes are the skeletons' expectations of the CLI
  rather than spec text and must be confirmed when CLI-004 lands: the `--reason` flag on
  `corpus queue fail`, and read verbs for documents/threads (deliberately written as prose,
  not as invented command names).

#### Deviations from the issue's Technical Design

- **`README.md` carries §5 frontmatter** (`doc_seedreadme`, `type: note`). The issue's tree
  did not call for it, but TEST-52 is scoped to "every `.md` file in the template tree",
  which includes the README. Giving it frontmatter satisfies the test, costs nothing, and is
  consistent with the README's own first line ("Everything here is a markdown file with YAML
  frontmatter").
- **Seed ids** follow the orchestrator's adjudication, not the issue's `doc_seed_*` /
  `skill_*` draft (which the shipped `DocumentIdSchema` rejects). `skill` is a document
  type; skills carry `doc_` ids.
- **`yaml` is not added to root `devDependencies`** — this run was instructed not to touch
  `package.json`. It currently resolves as a transitive dependency (2.9.0, via
  `openapi3-ts` and `vite`). Escalated to the orchestrator; see the report.
- **`scripts/**/*.test.ts` added to `vitest.config.ts`'s `include`** — the issue assumed the
  root config already picked `scripts/` up; it did not. Also added `scripts/tsconfig.json`
  so eslint's type-aware rules have a project for the new files.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-001]` prefix
