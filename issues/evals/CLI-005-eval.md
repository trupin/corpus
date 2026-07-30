# Evaluation: CLI-005

**Date**: 2026-07-28
**Sprint**: sprint-013 (commit `1125981`, branch `phase-4-agent-loop`)
**Verdict**: **PASS** (21 of 21 numbered criteria)

The never-clobber drill, the dry-run byte-identity check, the single-commit assertion, `--restore`,
`--adopt`, the plugin-provenance refresh and the interrupted-upgrade case were all re-run by the
evaluator against real workspaces (`9127`, `9128`) with real edits to the tool's own
`assets/workspace/` template and to `plugins/_fixture/skills/`, both with the server stopped and with
it running. The repository's template files were backed up by path and restored byte-identically
afterwards (`git status assets/` empty).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                            |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test, with plan output, sha comparisons, `git log --name-only`, SSE frames and `--json` payloads.            |
| Commands are specific and concrete      | PASS   | Real shas (`99caef8c…`), real commit ids, real manifest listings.                                                |
| Real E2E (not mocked)                   | PASS   | Two real workspaces, a real server on `9112`, real template edits, real git.                                     |
| Scenarios cover acceptance criteria     | PASS   | TEST-116…136 all addressed; the issue's own five-step E2E plan is followed.                                      |
| Application restarted after changes     | PASS   | Both server states exercised; server stopped by the lifecycle verb (`stopped (pid 71387)`).                      |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (cli-dev, worktree `.claude/worktrees/agent-ad4bc7c8525066e48`)".                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                    |

Notable honesty: five deviations are volunteered, including the one that touches an acceptance
criterion (the manifest is gitignored, so it cannot be in the commit) with the reasoning, the unit
test that proves the other branch, and the routing of the fix to agent-runtime.

## Criteria Results

| #   | Criterion                                                 | Result                | Notes                                                                                                                                                            |
| --- | --------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 116 | The manifest baseline already exists, not re-invented      | PASS                  | Fresh `corpus init` writes `{version: 1, tool: "0.0.0", installedAt, files: [{path, sha256, source?}]}` with 9 entries, including `.claude/skills/fixture-notes/SKILL.md` marked `plugin:_fixture`. 2-space JSON, trailing newline — both preserved. |
| 117 | The decision matrix is a pure function, fully covered      | PASS                  | `apps/cli/src/template/plan.test.ts` runs green inside the 673-test `apps/cli` suite; every verdict the evaluator could reach behaviourally was reached: update, keep-modified, silent-keep, deleted/restore-candidate, install, adopt. |
| 118 | Only (template-changed ∧ workspace-unmodified) overwrites  | PASS                  | With `orchestrate` and `comment` both changed in the template and `comment` also edited in the workspace: `orchestrate` was overwritten (byte-identical to the new template copy); the edited `comment` stayed **`9d265145ecf691778c5b9d882620f9536c01dfea9784c589f4e8057aacdfbd23`** before and after — byte for byte — and was reported (`keep … — modified here — 1 line only here, 1 line only in the new copy`). |
| 119 | Plugin-sourced entries are refreshed from the plugin        | PASS                  | One run exercised both provenances: `.claude/skills/fixture-notes/SKILL.md [plugin:_fixture]` came out `diff`-identical to `plugins/_fixture/skills/fixture-notes/SKILL.md`, while `.claude/skills/orchestrate/SKILL.md` came out identical to `assets/workspace/claude/skills/orchestrate/SKILL.md`. The plan line names the source. |
| 120 | Pairing uses the rename table, never a directory scan       | PASS                  | `claude/skills/comment/SKILL.md` pairs with `.claude/skills/comment/SKILL.md` and `gitignore` with `.gitignore` (both appear in the manifest under their installed names); `.gitkeep` files are never installed and never compared (absent from the manifest, present in the template). Correct on this case-insensitive filesystem. |
| 121 | The upgrade touches only template-provenance files          | PASS                  | `git log --name-only` for the upgrade commit lists exactly `.claude/skills/fixture-notes/SKILL.md` and `.claude/skills/orchestrate/SKILL.md`. **Zero** paths under `data/`; nothing under `.corpus/`.                                       |
| 122 | One attributed commit naming old → new version              | PASS                  | `50297e0 user <user@corpus.local> workspace: upgrade template files 0.0.0 → 0.0.0 by user` — one commit for a two-file change. Manifest handling: see Deviation note below (Adjudication 23). |
| 123 | A no-op upgrade says so and makes no commit                 | PASS                  | Pristine workspace: `already up to date.`, `$? = 0`, `rev-list --count HEAD` still `1`. No empty commit.                                                                                                                                    |
| 124 | `--dry-run` writes nothing; the real run performs the plan   | PASS                  | sha256 of **all 16 workspace files** before and after `--dry-run` → `cmp` byte-identical; `git status --porcelain` unchanged; HEAD unchanged. The subsequent real run performed exactly the three printed lines (2 updates + 1 keep). |
| 125 | `--restore` reinstalls deleted files, and only with the flag | PASS                  | After deleting `comment/SKILL.md`: plain run → `deleted … pass --restore to reinstall it`, `wrote 0 files`; `--restore --json` → `{"written":[".claude/skills/comment/SKILL.md"],…,"changes":["restore-candidate"]}`, file back on disk and present in the rewritten manifest. |
| 126 | A pre-manifest workspace is conservative; `--adopt` baselines | PASS                 | With the manifest removed: the verb explains itself, reports the diverged file, **writes nothing**, makes no commit, and leaves no manifest. `--adopt` then wrote a baseline of the 8 files that already match — deliberately **excluding** the edited `comment` skill, whose bytes (`a0a4ba4a…`) are unchanged. Nothing lost either way. |
| 127 | An interrupted upgrade loses nothing                        | PASS                  | Simulated a real failure between writes and commit by installing a rejecting workspace `pre-commit` hook: `corpus: the workspace upgrade commit failed: workspace hook: skills are frozen The upgraded files are written and uncommitted — nothing was lost.` + `git -C … status` advice + the `written` list; `$? = 1`; HEAD unchanged; both files present and visible in `git status --porcelain`. Reported loudly, no rollback of the writes. |
| 128 | It works with the server stopped                            | PASS                  | Verified on a workspace with nothing bound on its port (`lsof` → 0): upgrade ran, no server call at all.                                                                                                                                    |
| 129 | With the server running, the watcher re-projects            | PASS                  | Server up on `9128`, SSE attached: the upgrade produced `event: invalidate` / `{"keys":[["docs"],["docs","doc_skillorchestrate"]]}` and `GET /api/docs/doc_skillorchestrate` returned the new body (`<!-- tool update: orchestrate v3 -->`). The writes are ordinary out-of-band edits; nothing was routed through the API. |
| 130 | The install logic is factored, not duplicated a third time  | PASS                  | `INSTALL_RENAMES` has exactly **two** source definitions: `apps/cli/src/template/install.ts:36` and `scripts/workspace-template.ts:38`. `commands/init/template.ts` is gone (moved), and both `init` and `upgrade` consume the shared module. |
| 131 | `docs/workspace-template.md` gains the upgrade semantics    | PASS                  | New `## Upgrading an installed workspace` section (line 174) covering the decision table, the flags, the plugin-source rule, retired entries and commit semantics. The "three implementations agree" test moved with the module and passes. |
| 132 | The `workspace` topic is registered and documented          | PASS                  | `workspace` appears in `corpus --help`'s topic list; `corpus workspace --help` and `corpus workspace upgrade --help` render from the registry with all three flags; ``### `corpus workspace upgrade` `` at `docs/cli.md:1357` with a TOC entry; regeneration idempotent (sha `1eac5be6…`). |
| 133 | The verb is a documented write exception, and says so       | PASS                  | The description in `docs/cli.md` states: *"This command and `corpus init` are the only two that write workspace files directly and commit directly (SPEC.md §2.2 rule 4) … Every other document mutation goes through the server — the rule is not soft."* |
| 134 | Unit tests cover the matrix and filesystem behaviour        | PASS                  | `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **62 files, 673 tests green** — the log's exact numbers; `vitest run scripts` → 8 files, **203** green — also exact.                                                                          |
| 135 | E2E follows the issue's five steps, both server states      | PASS                  | The evaluator re-ran the whole plan independently (init → simulated tool update → dry-run → run → modify-and-collide → re-run → no-op → server running), with `git log` after each commit-producing step and a clean repository at the end. |
| 136 | The upgrade never bypasses `corpus skill rollback`          | PASS                  | Straight after an upgrade overwrote `orchestrate`, `corpus skill rollback orchestrate --from agent` restored the **pre-upgrade** content (`<!-- tool update: orchestrate v2 -->` replacing `v3`), exit 0, as a new attributed commit. One commit per upgrade is what makes it targetable. |
| 164 | The three-way install contract still agrees (cross)         | PASS                  | `apps/cli/src/template/install.test.ts` (inside the 673 green) and `scripts/workspace-template.test.ts` (62 green) both pass; `corpus init` from the packaged tarball produces exactly the documented tree (INFRA-008 TEST-71).             |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                   | Re-derived? | Finding                                                                                          |
| --- | ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| U1  | `corpus init` reports "installed 8 template files" + 1 plugin skill | Yes         | Exact.                                                                                            |
| U2  | Manifest shape `{version, tool, files:[{path,sha256,source?}]}`     | Yes         | Exact, including the `plugin:_fixture` marker and the 2-space/trailing-newline formatting.        |
| U3  | `--dry-run` plan format and "nothing was written (--dry-run)."      | Yes         | Exact wording.                                                                                    |
| U4  | `--dry-run` leaves the workspace byte-identical                     | Yes         | 16-file sha list, `cmp` identical.                                                                |
| U5  | Real run's output format `wrote N file(s) in commit <sha>.`         | Yes         | Exact, including the gitignored-manifest sentence.                                                |
| U6  | The edited skill is byte-identical after the upgrade                | Yes         | Same sha before and after, on my own edit.                                                        |
| U7  | The manifest keeps the *original* baseline for a diverged file      | Yes         | A third run still reported `keep`, never adopting the current bytes.                              |
| U8  | One commit per run, template paths only                             | Yes         | `--name-only` confirms.                                                                           |
| U9  | `already up to date.` + no commit                                   | Yes         | Reproduced on a genuinely current workspace.                                                      |
| U10 | `--restore` reinstalls and records in the manifest                  | Yes         | Reproduced (my run produced a real commit rather than `commit:null`, because in my case the deletion was not already recorded in HEAD — both outcomes are the documented behaviour of `commitPaths`). |
| U11 | Pre-manifest conservative mode + `--adopt` wording                  | Yes         | Both messages reproduced verbatim, and the edited file is excluded from the adopted baseline.     |
| U12 | Plugin-sourced refresh comes from the plugin tree                   | Yes         | Reproduced with a real edit to `plugins/_fixture/skills/…` and to `assets/workspace/…` in one run. |
| U13 | SSE `invalidate` + re-projection with the server running            | Yes         | Frame and body reproduced.                                                                        |
| U14 | `skill rollback` undoes a bad upgrade                               | Yes         | Reproduced.                                                                                       |
| U15 | `INSTALL_RENAMES` still has two definitions, not three              | Yes         | Exact.                                                                                            |
| U16 | `npm test -w apps/cli` → 62 files / 673 tests                       | Yes         | **Exact.**                                                                                        |
| U17 | `vitest run scripts/` → 8 files / 203 tests                         | Yes         | **Exact.**                                                                                        |
| U18 | `docs/cli.md` sha `1eac5be6…`                                       | Yes         | **Exact** — `1eac5be6917343c158486abd71aa87a30989ce250cb9810d168f807e1eefadd2`.                     |
| U19 | The interrupted-upgrade path reports loudly                         | Yes — **beyond the log** | The log asserts the design; the evaluator forced a real commit failure and confirmed the message, exit 1, unchanged HEAD and the files left in `git status`. |
| U20 | `assets/workspace/` restored byte-identically after the session     | Yes         | The evaluator did the same and confirmed `git status assets/` empty.                              |

No overclaims found.

## Deviations reviewed

- **AC4's "the manifest is updated in the same commit"** is satisfied conditionally: the shipped
  template gitignores `.corpus/*`, so `git add -- .corpus/template-manifest.json` is refused. The verb
  asks git (`check-ignore`) and includes the manifest exactly when the workspace tracks it, rather
  than forcing it with `add -f`; the human output says so on every run. This is **Adjudication 23**,
  which accepts the behaviour and routes the "should the template un-ignore it?" question to
  agent-runtime. Confirmed in my runs: the message is printed, the manifest is updated on disk, and
  `corpus init` leaves it in the same untracked state.
- **`already up to date.` is reserved** for a workspace with nothing to report *and* nothing to write;
  a permanently-diverged file is reported on every run (`wrote 0 files; git had nothing new to
  record.`). Both branches were observed and both make no commit, which is what TEST-123 protects.

## Failures

None.

## Summary

21 of 21, plus cross-issue TEST-164. The verb does the one thing it exists to do: with the same file
changed in the template *and* edited in the workspace, the edited copy came through byte-for-byte
identical and was reported, while the untouched sibling was updated — and the manifest deliberately
keeps the old baseline so a later run cannot mistake the divergence for a fresh file. `--dry-run`
wrote nothing at all (16-file sha comparison), the real run performed exactly the printed plan in one
attributed commit naming old → new version, plugin-sourced entries came from the plugin and
template-sourced entries from the template in the same run, it works with the server stopped and is
picked up by the watcher when it is running, and a forced commit failure left every write in place
and said so loudly. **PASS.**
