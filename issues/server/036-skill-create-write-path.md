# [SERVER-036] Skill-create write path (documents outside `data/docs/`)

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-020
- Blocks: CLI-011 (skill-create half)

## Spec References
- SPEC.md §7 — skill genesis; §9.2 — write paths; §14 — validation

## Summary
Sprint-015 Open Conflict 1, server half: implement `POST /api/skills` — create
`.claude/skills/{name}/SKILL.md` through the standard mutation pipeline (validate,
per-document lane, git auto-commit with acting party, projection like the rollback
handler already does for skill docs). The blocker to solve properly: `normalizeDocFolder`
unconditionally prefixes `DOCS_ROOT` and `doc move` refuses skills — creation needs a
sanctioned root-aware seam, not a bypass. Reuse the rollback handler's skills-root
conventions (path derivation, synthetic doc ids, name-pattern traversal guard, no tree
badge). Refusals: name collision 409 (incl. archived-skill collision semantics — decide
and document), validation 400, lock parity per the contract.

## Acceptance Criteria
- [x] Creation lands as a normal auto-commit, projected, SSE-invalidated; sole-writer preserved
- [x] No write path accepts arbitrary roots — the seam is skills-specific or explicitly enumerated
- [x] Collision with an installed skill → 409; the archived-skill case decided and tested
- [x] Tests per house pattern incl. traversal-guard and validation-refusal cases

## Technical Design
### Files to Create/Modify
- `apps/server/src/skills/create.ts` (+ tests), route mount, shared write-path seam touch-ups as needed

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); real-workspace integration tests as the rollback suite does.

## E2E Verification Plan
Real server + scratch workspace (subshell-cd init pattern): create → file on disk, commit authored, visible to check/rollback; collision and traversal refusals over HTTP.

## E2E Verification Log

**implemented on: opus** (2026-07-30, server-dev)

### What shipped

- `apps/server/src/skills/paths.ts` — the skills-root path derivation, shared by both verbs:
  `skillFolderPath`, `skillDocumentPath` (moved here from `rollback.ts`, which now imports it) and
  `archivedSkillFolderPath`. Pure string arithmetic; the name is validated at the boundary, never
  sanitized here.
- `apps/server/src/skills/create.ts` — `createSkill()`: re-parse the name with the contract's
  `SkillNameSchema`, take `CREATE_LANE`, refuse a taken name with `409`, mint a `doc_*` id, stamp the
  frontmatter, `validateBeforeWrite`, then one `runMutation` (atomic write → stage → auto-commit
  `skill create: <name> (<id>) by <actor>` → synchronous re-projection → invalidate
  `[["docs"], ["docs", id]]`). `mayChangeTree` deliberately unset — skills are outside `data/docs/`.
- `apps/server/src/skills/routes.ts` — mounts `contractRoutes.createSkill`, returning §14's mutation
  envelope `{ doc, warnings }` with `201`, identical to `POST /api/docs`.
- `apps/server/src/skills/create.test.ts` — 25 cases against a real workspace + real git.

**No arbitrary-root capability was added.** `normalizeDocFolder`, `resolveFolder` and
`POST /api/docs` are untouched; the only way to write under `.claude/skills/` is this enumerated
route, whose target path is `SKILLS_ROOT + <schema-validated name> + SKILL.md` with no caller input
in between. Verified live below.

### The archived-skill collision — RULED: it is a `409`

`.claude/skills-archived/<name>/` holds the name. Reasoning, and the evidence for it:

1. Archiving is §7's *reversible* organizational act. `corpus doc archive` moves
   `.claude/skills/<name>/` to `.claude/skills-archived/<name>/`; unarchiving moves it back to the
   **same** installed path. Creating a new skill over the name spends that reversibility.
2. The cost is not hypothetical and it is not local. Measured on the running server: archive
   `triage`, then place a folder at `.claude/skills/triage/` (exactly what "allow" would produce),
   then unarchive → **`400 {"code":"bad_request","message":"the archive destination already
   exists"}`** from `docs/archive.ts`'s destination guard. The failure surfaces on an unrelated verb,
   long after the create that caused it, naming a directory the operator never mentioned, and no
   automatic recovery exists — two folders competing for one installed path.
3. Refusing costs one reversible step and names it. Live:
   `409 {"code":"conflict","message":"the name \`weekly-review\` belongs to an archived skill
   (.claude/skills-archived/weekly-review exists) — unarchive it to bring it back, or choose another
   name; creating over the name would leave it unable to return"}`, and `POST
   /api/docs/{id}/unarchive` immediately afterwards answered `200` with
   `.claude/skills/weekly-review/SKILL.md`, `status: open`.

**It stays expressible either way at the contract level**, as CONTRACT-020 recorded: refusing is the
declared `409`, allowing would have been the plain `201`. Reversing this ruling later needs no
contract change — only `assertNameFree`'s second check.

An *installed* name is likewise `409`, including a name held by a symlink (§10 symlinks plugin
skills into `.claude/skills/`) and by a **broken** symlink — hence `lstatSync` rather than
`existsSync`, since the latter cannot see a dangling link that `mkdir` still cannot create through.

### Two more decisions worth recording

- **The id is minted, not synthesized.** `doc_<base32>`, written into the file, not the projection's
  path-derived `doc_skill<hex>`. A derived id is a function of where the file sits, so archiving —
  which moves the folder — would turn the skill into a different document; that is exactly why
  `docs/archive.ts` stamps an id in before it moves anything, and why the shipped `orchestrate` and
  `comment` skills carry `id: doc_skillorchestrate` / `doc_skillcomment` explicitly. A
  server-created skill has no reason to start out fragile. **Note for CLI-011/the evaluator**:
  sprint-015's TEST-328 predicts "`doc_skill<8 hex>`"; it was written before CONTRACT-020 existed,
  and CONTRACT-020's route text (later, orchestrator-sequenced) says the server assigns `id`. The
  synthetic id remains the fallback for hand-written `SKILL.md` files that declare none — that path
  is unchanged and still tested.
- **Frontmatter carries both vocabularies, in the shipped skills' order**: `name`, `description`
  (Claude Code's discovery pair) then §5's block — `id`, `type: skill`, `title`, `created`,
  `updated`, `tags`, `status`, `anchors`. `due`/`reviewed`/`evergreen` are omitted rather than
  written as nulls: the file-level schema defaults all three, and a skill's block stays readable to
  whoever edits it. `title` defaults to `name`; an omitted `body` pre-fills from the workspace's
  `for: skill` template when one exists (`docs/templates.ts`, §11's "none → empty" otherwise).

### E2E — real server, real workspace, real git

Scratch: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-server036-gLXXea`, created with the
subshell-cd pattern; server on **9192** (pid 38315), stopped by pid at the end. `8765` never bound,
never probed, never killed — every `corpus init`/`server start` used the workspace's explicit port.

```
$ curl -X POST /api/skills -d '{"name":"weekly-review","description":"Run the weekly review over the corpus."}'
HTTP 201  {"doc":{"frontmatter":{"id":"doc_wy3a54lf","type":"skill","title":"weekly-review",…

$ cat .claude/skills/weekly-review/SKILL.md
---
name: weekly-review
description: Run the weekly review over the corpus.
id: doc_wy3a54lf
type: skill
title: weekly-review
created: 2026-07-30T14:01:06Z
updated: 2026-07-30T14:01:06Z
tags: []
status: open
anchors: {}
---

$ git log -1 --format='%H %an <%ae> :: %s'
e2d92cc… agent <agent@corpus.local> :: skill create: weekly-review (doc_wy3a54lf) by agent
$ git show --name-only --format= HEAD
.claude/skills/weekly-review/SKILL.md

$ GET /api/docs?type=skill        → doc_wy3a54lf skill .claude/skills/weekly-review/SKILL.md
                                    (+ the four pre-installed skills)
$ GET /api/docs/doc_wy3a54lf      → doc_wy3a54lf skill .claude/skills/weekly-review/SKILL.md
```

No restart anywhere: the row is readable in the same process that answered the `201`.

**Refusals over HTTP** (all leave the workspace byte-identical — `git status --porcelain` empty,
`HEAD` unmoved, nothing under `.claude/skills/`):

| request | status | body |
| --- | --- | --- |
| `weekly-review` again | `409` | `a skill named \`weekly-review\` is already installed (.claude/skills/weekly-review exists)…` |
| `comment` (shipped skill) | `409` | `…already installed (.claude/skills/comment exists)…` |
| archived name (see above) | `409` | `…belongs to an archived skill…unarchive it…` |
| `../evil`, `a/b`, `/etc/passwd`, `%2e%2e`, `a\b`, `Weekly` | `400` | `bad_request`, `issues[0].path = "json.name"`, pattern message |
| 65-character name | `400` | `Too big: expected string to have <=64 characters` (CONTRACT-020's `.max(64)` addendum) |
| missing `description` | `400` | `issues[0].path = "json.description"` |

**The seam is skills-specific — proved by trying to reach the skills root through the general
create.** `POST /api/docs` with `folder: "../outside"` → `400 folder escapes the document root`;
`folder: "/etc"` → `400 folder must be a path under data/docs`. Neither wrote anything outside
`data/docs/`.

**Composition** — `corpus skill rollback` on a server-created skill (sprint-015 TEST-331):
edit through `PUT /api/docs/{id}` (`200`) → `POST /api/skills/weekly-review/rollback` → `200`,
`docId doc_wy3a54lf`, commit `8ae99be`, body restored, id stable. History reads:

```
8ae99be agent :: skill rollback: weekly-review (doc_wy3a54lf) to e7cef50 by agent
eb7e604 agent :: doc edit: weekly-review (doc_wy3a54lf) by agent
e2d92cc agent :: skill create: weekly-review (doc_wy3a54lf) by agent
```

**Validator** (TEST-330): `POST /api/check` over every skill id → `200`, 0 errors, 0 warnings; and
from the CLI, `corpus doc check` → `checked 10 documents — no findings.` (exit 0).

### Tests

`VITEST_MAX_THREADS=4 vitest run apps/server/src/skills` → **58 passed** (25 new + rollback's 33,
green after its `skillDocumentPath` import moved to `./paths.js`). New cases cover: the file's exact
frontmatter block, the minted-id shape, commit author + subject + staged path, the invalidation
frame (and the *absence* of `["tree"]`), read-your-write projection, `?type=skill` discoverability,
`POST /api/check` cleanliness, explicit title/tags/body, template pre-fill, empty-body default, a
§14 `unresolved_ref` warning that does not fail the write, the three `409` classes (installed,
archived, symlink), nine `400` name refusals, the direct-call defence-in-depth guard, a two-create
race resolving `201`/`409` with exactly one commit, and rollback composition.

`VITEST_MAX_THREADS=4 vitest run apps/server` (one workspace-scoped run, at the end) →
**2408 passed, 4 failed**. All four failures are one case: `json-body.test.ts`'s inventory-driven
sweep asserting `POST /api/queue/{id}/defer` answers `400` to a malformed body, and the server
answers `404` because **that route has no handler yet — it is SERVER-030's**, explicitly out of
scope here. The sweep is driven by `ALL_CONTRACT_ROUTES`, so it goes red the moment the contract
declares a route the server has not mounted and green again when SERVER-030 lands. Nothing was
skipped, deleted or weakened to hide it (sprint-015 Adjudication 11).

`eslint` (skills, queue, jobs, projection) → 0 problems, no rule disabled. `prettier --check` →
clean. `npm run typecheck -w apps/server` → **exit 0**.

### Repository and machine hygiene

`git status --porcelain` shows only source edits (mine confined to `apps/server/**` plus this log and
CONTRACT-021's); no `.corpus/`, no scaffolded `data/`, no stray `.claude/skills/` entry in the repo,
and `/Users/theophanerupin/code/corpus/.corpus` absent. `lsof -nP -iTCP:9192 -sTCP:LISTEN` → free.
No state-changing git command was run against this repository by this agent.

---

## Addendum — CONTRACT-021 minimal consumption (rider, same session)

Two typecheck errors were the whole assignment; a live bug was found under the first one.

- **`queue/service.ts` `status()` — the mechanism, not just the field.** It mapped over
  `QUEUE_EVENT_STATUSES` and destructured the counts **positionally**, so `deferred` landing at index
  2 shifted every later count by one and dropped `abandoned` — with nothing failing to compile.
  cli-dev reproduced it live (`1/2/3/4/5/6` seeded → `{"pending":1,"inProgress":0,"processed":3,
  "failed":4,"abandoned":5}`, no `deferred` key). Now each count names its own status; a status the
  contract adds and this method forgets is a missing property on `QueueStatus`, i.e. a type error.
  Re-measured on the running server after the fix, with **distinct** counts per directory:
  `{"halted":false,"pending":1,"inProgress":2,"deferred":3,"processed":4,"failed":5,"abandoned":6}`.
  Regression test added with distinct per-status counts (a uniform fixture cannot see an offset).
- **`jobs/project.ts` — `blockedOn`/`blockedOnTitle` are `null`** on every job until SERVER-030
  populates them. Honest by construction: the blocking document is supplied at defer time
  (`DeferEventRequest.blockedOn`), nothing writes it yet, and no event can reach `deferred` before
  that transition exists. The keys are on the wire from the day the contract declares them.
- **`deferred/` on existing workspaces: yes, at boot, no upgrade step.** `QueueStore.ensureLayoutSync`
  derives the directories from the contract's status list and runs in the constructor. Proven: a
  workspace initialized with the directory, then `rm -rf .corpus/queue/deferred`, then a server
  start → the directory is back, and the events already on disk are untouched. A test pins it.
  **One residue for the CLI/infra domain, not fixed here**: `ensureLayoutSync` creates the directory
  but not its tracked `.gitkeep`, so a workspace scaffolded before CONTRACT-021 will have
  `deferred/` locally and will not carry it through a clone until `corpus init`/`corpus workspace
  upgrade` writes the `.gitkeep`. Fresh `corpus init` already does (verified: `.corpus/queue/deferred/.gitkeep`
  present). Stale "five directories" prose in `queue/` and `projection/` was corrected in passing.
- **Not done, deliberately**: the defer route handler, requeue-on-lock-release, and any CLI verb —
  all SERVER-030.

### Unrelated pre-existing defect found while proving the seam (needs an issue)

`POST /api/docs` with a **dot-prefixed folder** — `folder: ".claude/skills"` — is not refused. It
resolves to `data/docs/.claude/skills/` (containment holds; nothing escapes `data/docs/`), writes the
file, **auto-commits it**, and then answers `404 no document with id doc_a723qpav` because
`classifyPath` skips dot-segments so the projection never indexed what was just committed. Two files
were created this way during the drill (`data/docs/.claude/skills/escape.md`,
`…/skills/evil/escape.md`), each with a `doc create:` commit. A document created, committed and
permanently invisible is worth its own issue; it is untouched by SERVER-036 and predates it.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to `apps/server`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
