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

- [ ] `assets/workspace/` contains the full template tree (below), and every file in it is byte-for-byte what a fresh workspace should contain — no placeholder markers, no `TODO`, no `<fill me>` tokens anywhere in the tree.
- [ ] Dot-prefixed names are **not** used in the template. `claude/` installs as `.claude/`, `gitignore` installs as `.gitignore`. `.gitkeep` is the single permitted dot-prefixed name and is filtered out during the copy. A unit test enforces both rules.
- [ ] `claude/skills/orchestrate/SKILL.md` and `claude/skills/comment/SKILL.md` exist as valid skeletons: YAML frontmatter carrying **both** Claude Code fields (`name`, `description`) and Corpus fields (`id`, `type: skill`, `title`, `status`, `created`, `updated`, `tags`, `evergreen`), with `name` equal to the containing directory name; body contains the required section headings and the CLI-only invariant, and nothing that would mislead an operator who initializes a workspace before AGENT-002/003 land.
- [ ] `claude/agents/` exists (empty but for `.gitkeep`) and is documented as the home of `type: agent-def` subagent-persona documents that become `@<subagent>` autocomplete targets.
- [ ] `data/docs/inbox/` and `data/threads/` exist (empty but for `.gitkeep`) — quick creation lands in `inbox/`, threads are flat under `data/threads/`.
- [ ] `data/docs/templates/note.md` exists as a `type: template` document with `for: note`; it is the minimum, and any additional templates follow the same shape.
- [ ] Three seed pinned view documents exist under `data/docs/views/` as **ordinary deletable documents**: Attention (`query: { needs: me }`, `order: 1`), Inbox (`query: { folder: inbox }`, `order: 2`), Open threads (`query: { type: thread, status: open }`, `order: 3`) — each `type: view`, `pinned: true`, with a one-paragraph body explaining what the column shows.
- [ ] Every document in the template carries complete §5 frontmatter (`id`, `type`, `title`, `created`, `updated`, `tags`, `status`, `anchors`) and `evergreen: true` (seed content must never age into Attention as stale), and every `id` is unique across the tree.
- [ ] `gitignore` ignores `.corpus/` runtime state — `cache.db`, `jobs/`, `attachments/`, `locks/`, `seen.json`, `HALT` — while **keeping the queue directory skeleton tracked** so a clone of a workspace still has `.corpus/queue/{pending,in-progress,processed,failed,abandoned}/`.
- [ ] `README.md` (workspace root) explains the operator loop in under a page: start the server, start `claude`, `/orchestrate`, where the board is, the HALT toggle, and the `corpus skill rollback <name>` recovery path.
- [ ] `docs/workspace-template.md` (repo-side, **not** copied) documents the tree, the install-time rename/filter rules, and the list of things `corpus init` generates rather than copies — the contract CLI-002 implements.
- [ ] `npm test` covers the template: required paths present, every markdown file's frontmatter parses and validates, ids unique, no dot-prefixed entries (except `.gitkeep`), no placeholder markers, seed views carry `pinned`/`order`/`query` with contiguous orders starting at 1, skill frontmatter carries both field sets with `name` matching its directory.
- [ ] Every seed document passes `corpus doc check` in a real initialized workspace (recorded in the E2E log).

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

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-001]` prefix
