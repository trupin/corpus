# Evaluation: AGENT-001

**Date**: 2026-07-26
**Sprint**: sprint-001 (Phase 1 — Foundations)
**Verdict**: PASS (13 of 13 acceptance tests pass, including TEST-61, which the log had
deferred and which I ran)

Verification followed sprint-001's Verification Environment for AGENT-001: file-tree
inspection of `assets/workspace/`, gitignore semantics probed in a fresh scratch `git init`
repository, and a simulated install (`cp -R` + the documented rename/filter rules) into a
scratch directory outside the repo. All template content was parsed with the real `yaml`
library through SERVER-001's `parseDocument` and validated through its real `checkCorpus`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, with a deferral list and a "Deviations" section.                                                                                      |
| Commands are specific and concrete      | PASS   | Real `git check-ignore -v` output with rule line numbers, real `git ls-files`, real `find`/`shasum` diffs.                                     |
| Real E2E (not mocked)                   | PASS   | Real scratch git repo, real `cp -R` install, real `npm run format` write-mode run. Within the sprint's stated environment, this is the real thing. |
| Scenarios cover acceptance criteria     | PASS   | TEST-49…60 all evidenced. TEST-61 deferred (see below) but now passes.                                                                         |
| Application restarted after changes     | PASS   | N/A (static assets); the log records a real mid-run correction to the gitignore rule after a probe failed, then re-evidences from the corrected rule. |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus (Opus 5, 1M context)".                                                                                                  |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                |

**One deferral was improper, though harmless.** TEST-61 was recorded `DEFERRED → CLI-002` on
the grounds that SERVER-001's library "is not present in this tree" — true in that worktree,
but both issues are now merged onto `phase-1-foundations`, and SERVER-001's log
symmetrically deferred TEST-61 → AGENT-001. The test was left circularly deferred and never
run by anyone. I ran it: **0 errors, 0 warnings**. The log should be corrected to record it as
verified rather than deferred (the sprint asks for it in AGENT-001's log specifically).

The log's honesty is otherwise a strength: it volunteers a first-draft gitignore rule that
failed the trailing-slash probe, and three deviations from the issue's Technical Design.

## Criteria Results

| #       | Criterion                                       | Result | Observed                                                                                                                                                                          |
| ------- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-49 | The template tree is complete                   | PASS   | `find` returns exactly the 11 documented entries — `README.md`, `gitignore`, both `SKILL.md`, `claude/agents/.gitkeep`, `data/docs/inbox/.gitkeep`, `templates/note.md`, three views, `data/threads/.gitkeep` — and nothing more. |
| TEST-50 | No dot-prefixed names except `.gitkeep`         | PASS   | The only dot-prefixed entries at any depth are three files named exactly `.gitkeep`. No `.claude/`, no `.gitignore` inside the template.                                            |
| TEST-51 | No placeholder markers anywhere                 | PASS   | `grep -rInE "TODO\|FIXME\|XXX\|<placeholder>\|<fill me>\|lorem ipsum"` → none. Content reads as finished operator-facing prose.                                                     |
| TEST-52 | Every template doc is a valid §5 doc, unique id | PASS   | 7 `.md` files, 7 distinct ids, all matching `DocumentIdSchema`; every one carries `id`, `type`, `title`, `created`, `updated`, `tags` (array), `status`, `anchors` (object), `evergreen: true`; all `created`/`updated` pass `IsoDateTimeSchema`. Ids follow the orchestrator's adjudication (`doc_seedattention`, `doc_skillorchestrate`, …) — no `doc_seed_*`, no `skill_*`. |
| TEST-53 | The three seed views are well-formed columns    | PASS   | Exactly three, all `type: view`, `pinned: true`, non-empty bodies (320–428 chars). `order` = 1, 2, 3, no duplicates or gaps. Attention `{needs: me}`/1, Inbox `{folder: inbox}`/2, Open threads `{type: thread, status: open}`/3. Every `query` key is in the SPEC §9.2 parameter set; `folder` has no leading or trailing slash. |
| TEST-54 | The note template declares what it is for       | PASS   | `data/docs/templates/note.md` is `type: template` with `for: note`; it is the only `type: template` document and it declares `for`.                                                 |
| TEST-55 | Both skill skeletons are valid and discoverable | PASS   | One YAML block each (exactly two `---` fences) carrying Claude Code's `name`/`description` **and** Corpus's `id`/`type: skill`/`title`/`created`/`updated`/`tags`/`status`/`anchors`/`evergreen`; `name` equals the directory (`orchestrate`, `comment`); no Corpus field is named `name`; both bodies carry the required section headings and state the CLI-only / never-hand-edit invariant. |
| TEST-56 | Gitignore ignores runtime state, keeps the queue| PASS   | All six runtime-state paths ignored (rule `.corpus/*`, line 9), plus `.corpus/queue/pending/evt_1.json` (rule `.corpus/queue/*/*.json`, line 16). All five queue directories not ignored under **all three** probe forms (bare, trailing slash, and `.gitkeep`); after `git add -A`, `git ls-files` tracks exactly the five `.gitkeep`s + `.gitignore`, and `git status --porcelain` is empty. |
| TEST-57 | README teaches the operator loop in under a page| PASS   | 81 lines / 447 words. Covers: `corpus server start`; starting `claude` in the workspace; `/orchestrate`; the board URL and what it shows; the HALT kill switch (`corpus queue halt`, plus the console-drawer toggle) and `corpus queue resume`; and `corpus skill rollback <name>` as the recovery path. |
| TEST-58 | Install contract documented, cannot drift       | PASS   | `parseContractDoc(readContractDoc())` against `docs/workspace-template.md` yields exactly the module's `INSTALL_RENAMES` (`claude/`→`.claude/`, `gitignore`→`.gitignore`), `INSTALL_FILTERS` (`.gitkeep`) and `INIT_GENERATED` (`.corpus/config.json`, `.corpus/queue/`, `git init`). **Negative control**: tampering one row of the doc's rename table makes the comparison fail — the drift check has teeth. The doc additionally enumerates the generated config fields (version, port, bearer token, `dataDir`), the five-directory queue skeleton, and `git init` + the initial commit. |
| TEST-59 | A simulated install produces a clean workspace  | PASS   | `cp -R` + the two renames + `.gitkeep` deletion into an empty scratch dir yields `.claude/skills/{orchestrate,comment}/SKILL.md`, `.claude/agents/`, `data/docs/{inbox,templates,views}/`, `data/threads/`, `.gitignore`, `README.md`. No leftover `claude/`, no leftover `gitignore`, no `.gitkeep` anywhere. No secrets, tokens, or machine-specific absolute paths. |
| TEST-60 | Prettier never rewrites the template's bytes    | PASS   | `shasum` of every file under `assets/workspace` before and after a full `npm run format` (write mode) — identical; `npm run format:check` clean; `git status` shows no template file modified. |
| TEST-61 | Seed documents pass the real validator          | PASS   | Ran it (the log had deferred it): every `.md` in `assets/workspace/` — both `SKILL.md` files included — through `parseDocument` then `checkCorpus` with SERVER-002's `resolveAnchor` injected. **0 errors, 0 warnings.** No warnings to justify. This is the sprint's stand-in for `corpus doc check`. |

### Remaining deferrals — verified legitimate

| Deferral                                        | Destination                              | Verdict                                                                                   |
| ----------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `corpus doc check` over the workspace           | CLI-002                                  | Legitimate — the CLI does not exist; TEST-61 above is the sprint's stand-in and now passes. |
| Server/board steps (db rebuild, `GET /api/docs?type=view`, three rendered columns, deleting a view) | CLI-002 / SERVER-003 / SERVER-004 / UI-003 | Legitimate — every one requires a server, projection or board that Phase 1 does not ship.   |
| Claude Code actually discovering the two skills | AGENT-002                                | Legitimate — frontmatter shape is verified here; a real `/orchestrate` run needs the skill's behavioral prose. |
| Skill command accuracy against `docs/cli.md`    | AGENT-002/003 (confirm at CLI-004)       | Legitimate — `docs/cli.md` is generated by CLI-001 and does not exist. The two flagged shapes (`corpus queue fail --reason`, read verbs) are honestly named as expectations. |

## Failures

None.

## Summary

13 of 13 acceptance tests pass, including the cross-issue TEST-61 that had been left
circularly deferred between this issue and SERVER-001 — I ran it and the seed corpus is clean
through the real validator with the real anchor resolver injected. The install contract is
genuinely drift-proof (I proved it fails when the doc is tampered with), the gitignore gets
the subtle part right (queue directories trackable under every probe form while event JSON is
ignored), and the simulated install produces a correct workspace by hand today.

**Verdict: PASS** — with one bookkeeping request: update the E2E Verification Log to record
TEST-61 as verified (0 errors, 0 warnings) rather than `DEFERRED → CLI-002`, since both
issues are now on the same branch and the check is runnable.
