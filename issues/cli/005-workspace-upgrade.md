# [CLI-005] `corpus workspace upgrade`: refresh template files after a tool update

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — the three-way-compare semantics are pinned by the spec stub; implementation is careful file mechanics.

## Dependencies

- Depends on: CLI-002, AGENT-001
- Blocks: —

## Spec References

- SPEC.md §2.1 — "Workspace upgrade" _[TBD: CLI-005]_ (authoritative behavior)
- SPEC.md §7 — skills-as-documents, `corpus skill rollback` (recovery path)
- `docs/workspace-template.md` — the AGENT-001/CLI-002 copy contract this issue extends

## Summary

`corpus init` installs the product agent's skills from the tool's bundled template, but a later `npm update` of the tool leaves existing workspaces running the old template — core-skill fixes never reach them, and blindly re-copying would destroy skills the agent has legitimately evolved (they are the workspace's memory). Add a dedicated verb that upgrades template-provenance files safely: update what the workspace never touched, preserve and report what it did.

## Acceptance Criteria

- [x] `corpus init` writes `.corpus/template-manifest.json`: for every installed template file, its workspace-relative path (post-rename, e.g. `.claude/...`), the content hash of the installed copy, and the tool version.
- [x] `corpus workspace upgrade` three-way compares each manifest entry (baseline hash vs. current workspace file vs. new template): unmodified → overwritten with the new template copy; workspace-modified → left untouched and reported (path + one-line diff summary); deleted from workspace → reported, not reinstalled unless `--restore` is passed; new-in-template → installed.
- [x] The upgrade touches only template-provenance files (`.claude/` skills and personas, workspace README, `.gitignore`) — never anything under `data/` or `.corpus/` beyond the manifest itself.
- [x] All changes land as a single git commit in the workspace repo, attributed per the acting-party convention, with a structured message naming old → new tool version; the manifest is updated in the same commit.
- [x] Running upgrade with no template changes is a no-op ("already up to date", exit 0, no commit).
- [x] `--dry-run` prints the full plan (update / keep-modified / install / restore candidates) without writing anything.
- [x] Works with the server stopped (upgrade is a bootstrap-class operation like `init`); with the server running, the watcher picks the changes up and re-projects — verified both ways.
- [x] Registered in the CLI-001 declarative registry (help + `docs/cli.md` regenerate; drift check stays green).

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/workspace/upgrade.ts` — the verb
- `apps/cli/src/commands/init.ts` (or its module) — write the template manifest at install time
- `apps/cli/src/template/` — shared install/manifest/rename logic factored out of CLI-002's copy step so init and upgrade use one implementation
- `docs/workspace-template.md` — extend the copy contract with the manifest and upgrade semantics
- `docs/cli.md` — regenerated

### Key Implementation Details

- Reuse CLI-002's rename table (dotless template → dotfiles) — the manifest stores post-rename workspace paths; comparisons hash the template file **after** rename mapping so the pairing is stable.
- Hashing: sha-256 of file bytes. The baseline hash is the hash of what was installed (which equals the then-template's hash); "workspace-modified" means current-file hash ≠ baseline hash. Template-changed means new-template hash ≠ baseline hash. Only the (template-changed ∧ workspace-unmodified) cell overwrites.
- Like `corpus init`, this is one of the CLI's documented write exceptions (SPEC §2.2 rule 4 covers bootstrap-class operations; the upgrade writes only template-provenance files). The git commit is made by the CLI directly, same as init's initial commit.
- Workspaces created before the manifest existed: `upgrade` without a manifest treats every current template file as "modified" (conservative — reports everything, overwrites nothing) and writes a fresh manifest baseline with `--adopt`.

### Edge Cases

- Manifest lists a file the new template dropped → report as "retired"; leave the workspace copy (it may carry agent edits); drop it from the new manifest.
- A modified file whose template counterpart is unchanged → silent keep (not even reported; nothing to upgrade).
- Interrupted upgrade: stage all writes, commit once; on failure before commit, report the partial state loudly (files are in git-status, nothing is lost).
- Case-insensitive filesystems and the rename table (e.g. `claude/` vs `.claude/`) — pair by table, never by directory scan alone.

## Testing Strategy

Vitest in `apps/cli`: manifest write/read round-trip; the three-way decision matrix as a pure function (all 2×2×presence cells); rename-table pairing; no-manifest conservative mode. Filesystem tests against a temp workspace fixture.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace → `.corpus/template-manifest.json` exists and lists the installed skills.
2. Simulate a tool update by editing a file in the installed tool's template copy; run `corpus workspace upgrade --dry-run` → plan shows exactly that file as "update"; run without `--dry-run` → file updated, single commit in `git log` naming the version bump.
3. Edit `.claude/skills/comment/SKILL.md` in the workspace (simulating agent evolution), change its template counterpart too, re-run upgrade → file NOT overwritten, reported as modified; commit contains only the other changes.
4. Run upgrade again with no template changes → "already up to date", no new commit.
5. With the server running, repeat step 2 → SSE invalidation observed and the skill document re-projected (visible via `GET /api/docs?type=skill`).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

**implemented on: opus** (cli-dev, worktree `.claude/worktrees/agent-ad4bc7c8525066e48`, 2026-07-28).

Two real workspaces (`/tmp/corpus-s013-cli005-togftN`, `/tmp/corpus-s013-cli005-sSpXlg`), a real
server on `9112`, real edits to the tool's own `assets/workspace/` template, and the real
from-source binary (`node --import <repo>/node_modules/tsx/dist/loader.mjs
<worktree>/apps/cli/src/bin/corpus.ts`, wrapped as `/tmp/cli005-corpus.sh` — never `npx`).

**AC1 / TEST-116 — the manifest baseline already existed and was not reinvented.**

```
$ corpus init --port 9112
  installed 8 template files, recorded in .corpus/template-manifest.json
  installed 1 plugin skill file into .claude/skills/
$ jq -c '{version, tool, files: [.files[] | {path, source}]}' .corpus/template-manifest.json
{"version":1,"tool":"0.0.0","files":[{"path":"README.md","source":null},…,
 {"path":".claude/skills/fixture-notes/SKILL.md","source":"plugin:_fixture"}]}
```

Shape unchanged (2-space JSON, trailing newline, `{path, sha256, source?}`); the only edit to
`scaffold.ts` was moving its manifest/install helpers into the shared `apps/cli/src/template/`.

**TEST-124 — `--dry-run` writes nothing, then the real run performs exactly the printed plan.**
Tool update simulated per the issue's E2E plan by editing the installed tool's template copy
(`assets/workspace/claude/skills/orchestrate/SKILL.md`), restored byte-identically afterwards.

```
$ corpus workspace upgrade --dry-run ; echo $?
plan (tool 0.0.0 → 0.0.0):
  update  .claude/skills/orchestrate/SKILL.md
nothing was written (--dry-run).
0
```

`sha256` of all 16 files under the workspace, captured before and after: `cmp` → **byte-identical**;
`git -C "$WS" status --porcelain` unchanged; HEAD unchanged. Then:

```
$ corpus workspace upgrade --from user ; echo $?
upgrade (tool 0.0.0 → 0.0.0):
  update  .claude/skills/orchestrate/SKILL.md
wrote 1 file in commit 8c7874004aa4670a2b815b89446f01a6a4f0e974.
  .corpus/template-manifest.json was updated but is not tracked by this workspace's .gitignore,
  so it is not in that commit — the same state `corpus init` leaves it in.
0
```

**TEST-118 — the edited skill was never clobbered.** The workspace's `comment` skill was edited
(`sha256 99caef8c…`), *and* its template counterpart changed, *and* `orchestrate` changed too:

```
$ corpus workspace upgrade --from user
upgrade (tool 0.0.0-previous → 0.0.0):
  update  .claude/skills/orchestrate/SKILL.md
  keep    .claude/skills/comment/SKILL.md — modified here — 1 line only here, 1 line only in the new copy
wrote 1 file in commit 0ad92263a8e9f98e3dc01fb4c6a00e1a0afe439b.
$ shasum -a 256 .claude/skills/comment/SKILL.md
99caef8cee1292ec1bcc775e234ee2b7e0721003cc4ff435118377b851208ff1   # unchanged, byte for byte
```

A **third** run with the template changed again still refuses it: the manifest keeps the file's
**original** baseline rather than adopting its current bytes, which is what stops a later run
from reading it as untouched and overwriting it (unit-tested as its own case).

**TEST-121 / TEST-122 — one attributed commit, template paths only.**

```
$ git -C "$WS" log --format='%h %an %s' --name-only
99ff99a user workspace: upgrade template files 0.0.0 → 0.0.0 by user
  .claude/skills/orchestrate/SKILL.md
0ad9226 user workspace: upgrade template files 0.0.0-previous → 0.0.0 by user
  .claude/skills/orchestrate/SKILL.md
8c78740 user workspace: upgrade template files 0.0.0 → 0.0.0 by user
  .claude/skills/orchestrate/SKILL.md
48a7a74 user workspace: initialize corpus workspace by user
  …
```

One commit per run, author `user <user@corpus.local>`, subject naming old → new version. **Zero**
paths under `data/` and nothing under `.corpus/`. (The dev checkout is `0.0.0` everywhere, so a
real version bump was simulated by setting the workspace manifest's `tool` to `0.0.0-previous`;
the unit test asserts the subject with genuinely different versions, `0.1.0 → 0.2.0`.)

**The manifest is not in the commit, and that is not a regression — see Deviations below.**

**TEST-123 / TEST-128 — no-op, server stopped.** Fresh workspace, nothing changed, no server
running for it:

```
$ corpus workspace upgrade ; echo $?
already up to date.
0
$ git -C "$WS2" rev-list --count HEAD
1                                        # still just `corpus init`'s commit
```

**TEST-125 — `--restore`.**

```
$ rm .claude/skills/comment/SKILL.md
$ corpus workspace upgrade
  deleted .claude/skills/comment/SKILL.md — deleted from this workspace; pass --restore to reinstall it
wrote 0 files; git had nothing new to record.
$ corpus workspace upgrade --restore --json | jq -c '{written, commit, changes: [.changes[]|.action]}'
{"written":[".claude/skills/comment/SKILL.md"],"commit":null,"changes":["restore-candidate"]}
$ ls .claude/skills/comment/
SKILL.md
```

`commit: null` is honest rather than a failure: restoring a file that was deleted from the
working tree but never committed puts the tree back exactly as HEAD already has it, so there is
nothing for git to record. The verb says so in words.

**TEST-126 — a pre-manifest workspace, and `--adopt`.**

```
$ rm .corpus/template-manifest.json      # and the comment skill carries an edit nothing knows about
$ corpus workspace upgrade ; echo $?
no .corpus/template-manifest.json in this workspace — without the baseline it recorded, an
unmodified file cannot be told from an edited one, so nothing will be overwritten.
upgrade (tool unknown → 0.0.0):
  keep    .claude/skills/comment/SKILL.md — modified here — 2 lines only here, 0 lines only in the new copy
nothing was written. Re-run with --adopt to record a baseline from the files that already match.
0
$ ls .corpus/template-manifest.json
No such file or directory
$ corpus workspace upgrade --adopt
… wrote a fresh baseline manifest; files that already match the tool's copies are now tracked,
  and the ones that differ stay untracked because nothing can tell an old copy from an edited one.
$ jq -r '[.files[].path] | join("\n")' .corpus/template-manifest.json
.claude/skills/fixture-notes/SKILL.md
.claude/skills/orchestrate/SKILL.md
.gitignore
README.md
data/docs/templates/note.md
data/docs/views/attention.md
data/docs/views/inbox.md
data/docs/views/open-threads.md          # the edited comment skill is deliberately NOT here
$ shasum -a 256 .claude/skills/comment/SKILL.md
84f2fb7d…                                # unchanged
```

**TEST-119 — plugin provenance.** `corpus init` records `.claude/skills/fixture-notes/SKILL.md`
with `source: "plugin:_fixture"`, and the upgrade's source set is built the same way `corpus init`
builds it, so a plugin entry is refreshed from the plugin's own `skills/` directory. Exercised
end to end in the unit suite (a plugin skill changed in the plugin tree is updated from there,
its `--json` change carries `"source":"plugin:todos"`, and the rewritten manifest keeps the
marker), and both provenances appear in one real run's manifest above.

**TEST-129 — with the server running, the watcher re-projects.** Server up on `9112`, SSE stream
open, template changed again:

```
$ corpus workspace upgrade --from user
  update  .claude/skills/orchestrate/SKILL.md
wrote 1 file in commit 99ff99a26c0b880ed15c47fed882e182fa9940ba.
# on the SSE stream:
event: invalidate
data: {"keys":[["docs"],["docs","doc_skillorchestrate"]]}
$ curl :9112/api/docs/doc_skillorchestrate | jq -r .body | tail -1
<!-- SSE round: tool upgrade three -->
```

The write is an ordinary out-of-band edit from the server's point of view; nothing was routed
through the API.

**TEST-136 — `corpus skill rollback` covers a bad upgrade.** Straight after the upgrade above
(CLI-006's verb, landed in the same session):

```
$ tail -1 .claude/skills/orchestrate/SKILL.md
<!-- SSE round: tool upgrade three -->
$ corpus skill rollback orchestrate --from agent ; echo $?
restored .claude/skills/orchestrate/SKILL.md in commit 3238fd51a8ca5b76793d84284d93acd635e5f681 (doc_skillorchestrate)
0
$ tail -1 .claude/skills/orchestrate/SKILL.md
<!-- and orchestrate again -->            # the pre-upgrade content
```

One commit per upgrade is exactly what makes the revert targetable.

**TEST-130 / TEST-131 — factored, not duplicated a third time.** `INSTALL_RENAMES` still has
**two** definitions, not three: `apps/cli/src/commands/init/template.ts` **moved** to
`apps/cli/src/template/install.ts` (with `planPluginSkillInstall`/`templateSkillNames` moving with
it), and `corpus init` and `corpus workspace upgrade` both import it. `scripts/workspace-template.ts`
is the second, untouched, and the "three implementations agree" test moved with the module and
passes. `docs/workspace-template.md` gains an **Upgrading an installed workspace** section with
the decision table, the flags, the plugin-source rule, the retired-entry rule and the commit
semantics.

**TEST-132 — registry and docs.** `workspace` is in `registry.topics`, `validateRegistry` passes
at load, `corpus workspace --help` and `corpus workspace upgrade --help` render from the registry
(`Usage: corpus workspace upgrade [flags]` with all three flags), and `docs/cli.md` regenerates
with ``### `corpus workspace upgrade` `` plus a TOC entry. Generator output is Prettier-clean as
emitted and idempotent (`sha256 1eac5be6…` before and after a second run).
`scripts/check-generated-artifacts.ts` is red for `docs/cli.md` in the worktree because it
compares against HEAD before the orchestrator commits — the expected state, quoted verbatim in
CLI-006's log.

**TEST-133 — the write exception says so.** The verb's `description` (and therefore `docs/cli.md`)
states that it and `corpus init` are the only two commands that write workspace files directly
and commit directly, that both must work with the server stopped, why, and that "every other
document mutation goes through the server — the rule is not soft".

**TEST-134 — unit tests.** `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **62 files, 673 tests**,
green; `vitest run scripts/` → 8 files, 203 tests, green. New:
`apps/cli/src/template/plan.test.ts` (18 — every cell of baseline × workspace × incoming, plus
proof that every declared verdict is reachable), `apps/cli/src/template/manifest.test.ts` (5),
`apps/cli/src/commands/workspace/upgrade.test.ts` (16 — real temp workspaces and real git).
`npm run lint`, `npm run format:check` and `npm run typecheck` (all workspaces) are green.

**Cleanup.** `corpus server stop` → `stopped (pid 71387)`; `9112` confirmed free; the SSE curl
killed by recorded pid; `8765` untouched throughout. `assets/workspace/` restored byte-identically
(`cmp` of the sha list before/after → identical; `git status --porcelain -- assets/` empty). Both
scratch directories deleted by captured path.

### Deviations and notes

- **The manifest is not in the upgrade commit, because the workspace's own `.gitignore` excludes
  it.** AC4 says "the manifest is updated in the same commit", but the shipped template ignores
  all of `.corpus/*`, so `git add -- .corpus/template-manifest.json` is refused — and
  `corpus init` has never committed it either (`commitAll`'s `add --all` skips ignored paths).
  Rather than overriding the operator's `.gitignore` with `add -f`, the verb **asks git**
  (`check-ignore`) and includes the manifest in the pathspec exactly when the workspace tracks
  it; a unit test covers a workspace whose `.gitignore` negates the manifest and proves it lands
  in the same commit there. The human output states the outcome. **If the manifest should be
  tracked, that is a change to `assets/workspace/gitignore` and belongs to agent-runtime** — the
  code needs no change.
- **`commit: null` is a real outcome**, not only a failure: `--restore` of a file deleted but
  never committed leaves the tree identical to HEAD. `commitPaths` returns `null` rather than
  letting `git commit` fail on an empty commit.
- **A permanently-diverged file is reported on every run.** Its baseline deliberately never
  advances, so it stays "modified" — the cost of never clobbering it. `already up to date.` is
  therefore reserved for a workspace with nothing to report *and* nothing to write.
- **`--adopt` records only the files that already match** the tool's copies. Adopting a diverged
  file's current bytes as its baseline would make it read as untouched next time, and the run
  after that would overwrite exactly the edit this verb exists to protect.
- **Sole-writer check.** No escalation was needed: SPEC.md §2.1 and §2.2 rule 4 both name
  `corpus workspace upgrade` as a bootstrap-class exception that writes files directly and
  commits directly, and the issue's Technical Design says the same. The verb makes **no** server
  call at all.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-005]` prefix
