# Evaluation: CLI-006

**Date**: 2026-07-28 (round 1: FAIL · re-verification round 1: **PASS**)
**Sprint**: sprint-013 (commit `26fa6cd`; the fix it depended on is SERVER-019's `394c42d`, branch
`phase-4-agent-loop`)
**Verdict**: **PASS** (30 of 30 numbered criteria + cross-issue TEST-159/161/163/165)

> **Round 1 was FAIL** on TEST-86 — `corpus doc check` reported a false **error** for any document
> carrying a comment thread, in both the `<id>` and the `--staged` mode. The root cause was
> server-side (SERVER-019-eval FAIL-1) and, as predicted, **no CLI change was required**: CLI-006 is
> unmodified since `26fa6cd` and now passes. See **Re-verification round 1** at the end of this file.
> FAIL-1 is retained below as the historical record.

Driven against a real workspace on `9123` with a real server carrying SERVER-019's handlers, a real
scratch git repository with real staged files, and the from-source binary. Exit codes read from `$?`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                        |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test, with `git status --porcelain` matrices, `$?` values, `cmp` results and the guard's failure transcript.             |
| Commands are specific and concrete      | PASS   | Real ids, real five-file staged matrix, real 2 MB blob, real probe file added and deleted.                                    |
| Real E2E (not mocked)                   | PASS   | Real workspace `/tmp/corpus-s013-cli006-JBhmHx`, real server on `9107`, real scratch git repo reached by explicit `-C`.       |
| Scenarios cover acceptance criteria     | PASS   | TEST-86…115 all addressed, plus cross-issue 161/163.                                                                         |
| Application restarted after changes     | PASS   | Server started for the session and stopped by the lifecycle verb (`stopped (pid 46927)`), `9107` re-verified free.            |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (cli-dev, worktree `.claude/worktrees/agent-ad4bc7c8525066e48`)".                                    |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                |

Notable honesty: the log volunteers four deviations (the variadic-positional registry extension,
`{ids}` cannot report `duplicate-id`, the transcribed document-root table, nested skills), and quotes
the **red** artifact-drift output verbatim with its reason.

## Criteria Results

| #   | Criterion                                          | Result                     | Notes                                                                                                                                                                     |
| --- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 86  | `corpus doc check <id>` validates the named docs    | **PASS** (round 1 FAIL → fixed server-side in `394c42d`) | Round 1: passed for the log's fixture (a seed template) but **failed for any document with a comment thread** — the ordinary clean document (**FAIL-1**). Round 2, fresh workspace: a commented document returns `checked 1 document — no findings.`, exit **0**, in both the `<id>` and `--staged` modes, while a genuinely dangling anchor still exits 6 in all three modes. |
| 87  | Errors exit 6                                       | PASS                       | Drifted document → findings rendered as `code severity path: detail`, then `corpus: N error(s) … Fix the findings above; warnings alone would not have failed the check.`, `$? = 6`. Not 1, not 5. |
| 88  | Warnings do not fail                                | PASS                       | Warning-only document → `warning ref-unresolved …` + `checked 1 document — 1 warning, no errors.`, `$? = 0`.                                                               |
| 89  | `--json` emits the server response unchanged        | PASS                       | `cli 212 bytes` vs `curl 211 bytes`, identical modulo the CLI's trailing newline; exactly one JSON value on stdout; the error envelope goes to **stderr**; `$? = 6` regardless. |
| 90  | Whole-workspace enumerates then posts               | PASS (shape) + DEFERRED → unit test (multi-page) | Server access log for a whole-workspace run: `GET /api/docs limit=200&offset=0&includeArchived=true` followed by **one** `POST /api/check`. `MAX_PAGE_LIMIT` = 200 is used. The >200-document multi-page loop is unit-tested (`MAX_PAGE_LIMIT + 3` corpus, two GETs / one POST); reproducing it live would need a 200-document corpus and was not run. |
| 91  | Whole-workspace check covers archived documents     | PASS                       | Archived `doc_added01` (which carries a `ref-unresolved`): `GET /api/docs?limit=200` → `total 9`; `…&includeArchived=true` → `total 10`; `corpus doc check` → `checked 10 documents` and **still reports the archived document's finding**. |
| 92  | Whole-workspace check covers skills and agent-defs  | PASS                       | The enumerated set includes `.claude/skills/{orchestrate,comment,hand-written}/SKILL.md`, `.claude/skills-archived/fixture-notes/SKILL.md` and `.claude/agents/helper.md` (`doc_agentdef5b20ede8`). A hand-written skill with only `name`/`description` checks clean (Adjudication 6). |
| 93  | `--staged` collects only staged document blobs      | PASS                       | Five-file matrix built by hand in a scratch repo (`M .gitignore`, `A added.md`, `MM note.md`, ` M attention.md`, `D inbox.md`): only the two staged **document** paths were validated. The unstaged edit's marker `[[doc_unstagedghost]]` appears **only** in the whole-workspace run, never in the staged run. Content is the **index's**: `note.md` holds `anchors: {}` on disk and `not-an-anchor-id` in the index, and only the index version's `anchor-malformed`/`frontmatter-invalid` were reported. |
| 94  | `--staged` changes no git state                     | PASS                       | `git -C "$WS" status --porcelain` captured before and after → `cmp` **BYTE-IDENTICAL**.                                                                                   |
| 95  | `--staged` with nothing staged is silent, exit 0    | PASS                       | Clean index → `$? = 0`, **0 bytes** on stdout and 0 on stderr.                                                                                                             |
| 96  | `--staged` posts pairs, never ids                   | PASS                       | Proven behaviourally: the reported findings come from index content that does not exist on disk in that form, which the `{ids}` branch cannot express.                     |
| 97  | `--staged` handles a large blob                     | PASS                       | A 2,097,359-byte staged document was read and its `[[doc_bigghost]]` reported — past Node's 1 MB `execFile` default, so `maxBuffer`/`timeout` are genuinely set.           |
| 98  | `--staged` and ids are not silently combined        | PASS                       | `corpus doc check doc_x --staged` → `corpus: \`--staged\` checks the content in git's index, so it cannot be combined with document ids.` + the two-way remedy, `$? = 2`. Stated in the verb's description, hence in `docs/cli.md`. |
| 99  | `corpus skill rollback <name>` restores and reports  | PASS                       | `restored .claude/skills/orchestrate/SKILL.md in commit fda9de46… (doc_skillorchestrate)`, exit 0; file holds the previous bytes; workspace author matches.                |
| 100 | `--to <ref>` is passed through                      | PASS                       | `--to <sha> --json` → the file became `diff`-identical to that revision's blob; a new commit was made.                                                                     |
| 101 | Unknown skill → exit 5 with the stated message      | PASS                       | `corpus: 404 not_found: no skill named \`nope\` is installed (.claude/skills/nope/SKILL.md does not exist)`, `$? = 5`.                                                      |
| 102 | `--json` emits the rollback result                  | PASS                       | One JSON value, keys exactly `name,docId,commit,path,warnings` — `SkillRollbackResult` verbatim.                                                                           |
| 103 | Attribution defaults to `user`; `--from` honored     | PASS                       | No flag → `git log -1 --format='%an'` = `user`; `--from agent` → `agent`, subject `skill rollback: orchestrate (…) to 0b66743 by agent`. The verb declares no `--from` of its own (the CLI loads, so `validateRegistry` passed). |
| 104 | Both verbs registered and validated                 | PASS                       | `check` in the `doc` topic; a `skill` topic with `rollback`; `corpus --help` lists it; `validateRegistry` runs at module load on every invocation.                         |
| 105 | `docs/cli.md` regenerates with both headings         | PASS                       | ``### `corpus doc check` `` (272) and ``### `corpus skill rollback` `` (1166), both with TOC entries in the exact backticked form `parseCliDoc` matches.                    |
| 106 | The self-invalidating allowlist is emptied           | PASS                       | `scripts/workspace-template.ts:239` → `export const CLI_COMMANDS_PENDING_CLI_006: readonly string[] = [];`                                                                 |
| 107 | The allowlist's *other* test is updated too          | PASS                       | `scripts/workspace-template.test.ts:749` → `expect([...CLI_COMMANDS_PENDING_CLI_006]).toEqual([]);`. Both edits are in the same commit (Adjudication 17).                  |
| 108 | The template tree resolves without the allowlist     | PASS                       | `vitest run scripts/workspace-template.test.ts` → **62 tests green** with an empty allowlist; no skill text was changed.                                                   |
| 109 | The generated-artifact drift check is honest         | PASS                       | The log quotes the red pre-commit state verbatim with the reason, and the regenerate-and-compare half green against a snapshot. Post-commit, the evaluator ran the real check twice: `✓ API contract … ✓ CLI reference …`, exit 0 both times — the prediction held. |
| 110 | The git plumbing does not violate the hygiene guard  | PASS                       | Resolution is Adjudication 12: `apps/cli/src/staged.ts` sits beside `git-env.ts`, outside the guarded prefixes; `commands/doc/check.ts` is the only guarded module allowed to import it (`STAGED_HELPER_IMPORTERS = ["doc/check.ts"]`). The guard's other prohibitions are intact — `hygiene.test.ts` is green (12 tests) and still bans `child_process`, `exec*`/`spawn*`, and non-`client.request` calls in `doc`/`thread`/`db`. |
| 111 | The guard still fires                                | PASS (re-derived)          | The evaluator wrote a real probe `apps/cli/src/commands/doc/evalprobe.ts` calling `spawnSync("git", ["commit", …])`. Result: **4 failed / 8 passed** — `finds the modules it is supposed to be guarding`, `imports no filesystem or subprocess module`, `calls no write API and spawns no process`, `scans every command module, not a chosen few` — the same four the log reported. Probe deleted → 12 passed. |
| 112 | Every request goes through the typed client          | PASS                       | Zero `fetch(` and zero literal URLs in `commands/doc/check.ts` and `commands/skill/rollback.ts`; `client.request` present in both (2 and 1 occurrences). Only `staged.ts` touches git, read-only. |
| 113 | Unit tests cover parsing, collection, exit mapping   | PASS                       | `npm test -w apps/cli` → **62 files, 673 tests green**; `vitest run scripts` → 8 files, 203 green.                                                                        |
| 114 | E2E through the real binary against a drifted corpus | PASS                       | Independently reproduced: exact commands, exact stdout, `$?` from the shell, `git status --porcelain` before/after, server stopped, ports free, repository `git status` clean. |
| 115 | The read-only-filesystem constraint holds            | PASS                       | sha256 of all 22 files under `data/`, `.claude/` and `.corpus/` captured before and after running **all three** check modes → identical except `.corpus/server.log`, which the *server* appends its own request log to. The check writes nothing. |
| 159 | The registry survives three concurrent additions (cross) | PASS                   | All six new verbs load together (`validateRegistry` runs at module load on every CLI invocation); `docs/cli.md` contains all five new headings plus TOC entries; two consecutive regenerations left sha `1eac5be6…` unchanged; `check-generated-artifacts.ts` green against HEAD, twice; `_fixture` filtered out (0 occurrences). |
| 161 | `corpus doc check` and the server agree byte for byte (cross) | PASS             | `corpus doc check <id> --json` vs `curl -X POST /api/check -d '{"ids":["<id>"]}'` → identical modulo the trailing newline.                                                |
| 163 | The workspace template's promise is now true (cross) | PASS                      | The template tree's CLI-reference test is green **with no allowlist**; the orchestrate skill's `corpus skill rollback` reference now resolves against the regenerated `docs/cli.md`. Adjudication 5's self-invalidating hole closed itself. |
| 165 | Nothing is a second implementation of anything (cross) | PASS                     | One validator (two call sites, one `checkSeams`); `INSTALL_RENAMES` defined **twice** in source (`apps/cli/src/template/install.ts`, `scripts/workspace-template.ts`), not three times; one `PluginServerContext`; one exit-code table (`apps/cli/src/errors.ts`); one read-only git helper (`apps/cli/src/staged.ts`). |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                | Re-derived? | Finding                                                                                                     |
| --- | --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| K1  | Clean document → `checked 1 document — no findings.`, exit 0    | Yes         | Reproduced for a document with no anchors. **Not true** for a document with an anchored thread — FAIL-1.      |
| K2  | Errors exit 6 with the rendered findings + advice line          | Yes         | Exact wording reproduced.                                                                                     |
| K3  | Warnings exit 0                                                 | Yes         | Exact.                                                                                                        |
| K4  | `--json` identical to `curl` (582 vs 581 bytes)                 | Yes         | Same relationship on my fixture (212 vs 211): trailing newline only.                                          |
| K5  | Whole-workspace check enumerates with `includeArchived=true`    | Yes         | Confirmed in the server access log and by the 9-vs-10 total.                                                  |
| K6  | Archived documents are still reported                           | Yes         | Reproduced with a freshly archived document that carries a finding.                                           |
| K7  | Skills and threads are in scope                                 | Yes         | Reproduced, plus agent-defs.                                                                                  |
| K8  | The five-file staged matrix behaves as described                | Yes         | Reproduced with my own matrix; unstaged marker provably absent.                                               |
| K9  | Index content, not worktree content                             | Yes         | Reproduced with a file whose index and worktree differ.                                                       |
| K10 | `git status --porcelain` byte-identical after `--staged`        | Yes         | `cmp` identical.                                                                                              |
| K11 | Clean index → exit 0, no output                                 | Yes         | 0 bytes stdout, 0 stderr.                                                                                     |
| K12 | 2 MB staged blob succeeds                                       | Yes         | Reproduced at 2,097,359 bytes.                                                                                |
| K13 | `--staged` + ids → exit 2 with that message                     | Yes         | Exact wording reproduced.                                                                                     |
| K14 | Rollback verb output, author default, `--from`, `--to`, `--json`| Yes         | All reproduced.                                                                                               |
| K15 | Unknown skill → exit 5, server's message                        | Yes         | Exact.                                                                                                        |
| K16 | `CLI_COMMANDS_PENDING_CLI_006` is `[]` and its assertion updated| Yes         | Both lines confirmed at 239 and 749; 62 template tests green.                                                 |
| K17 | The hygiene guard fires on a probe (4 failures)                 | Yes         | Reproduced exactly — same four test names.                                                                    |
| K18 | `staged.ts` refuses non-read-only subcommands                   | Not re-derived directly | Asserted by `staged.test.ts` (green in the 673-test run). Behavioural corroboration: `--staged` never changed git state. |
| K19 | `docs/cli.md` heading forms + TOC                               | Yes         | Exact, at lines 272/1166 with TOC entries.                                                                    |
| K20 | Read-only filesystem across all three modes                     | Yes         | Reproduced; only the server's own log file differs.                                                           |
| K21 | `npm test -w apps/cli` counts                                   | Yes         | 62 files / 673 tests — the number CLI-005's log also quotes.                                                  |
| K22 | Drift check red pre-commit, green post-commit                   | Yes         | Green twice today, exit 0.                                                                                    |

No overclaims. One presentational note shared with CLI-010: the log's `curl -sS :9107/…` host-less
form is not accepted by the curl on this machine; the results reproduce with
`http://127.0.0.1:9107/…`.

## Failures

### FAIL-1: `corpus doc check` reports `anchor-unused` as an error for any document that has a comment thread

**Criterion**: TEST-86 ("a clean document → exit 0 with a human line saying the check passed"), and
the sprint Done Criterion that `corpus doc check` exits 6 on errors and 0 on warnings — "the contract
the workspace's future pre-commit hook is built on".

**Expected**: A document whose anchors each have a live thread is clean. The whole-workspace check
agrees it is clean (exit 0), and the write path accepts it (`PUT` → 200, no warnings).

**Observed**: exit **6** with `error anchor-unused … anchor \`anc_…\` has no thread referencing it`,
in **both** subset modes:

```
$ corpus doc check doc_x2ohwagc ; echo $?
error anchor-unused data/docs/inbox/anchored-subject.md: anchor `anc_d4fa0218` has no thread referencing it
corpus: 1 error in 1 document.
  Fix the findings above; warnings alone would not have failed the check.
6

$ corpus doc check --staged ; echo $?          # the §11 pre-commit path
… error anchor-unused data/docs/inbox/anchored-subject.md: anchor `anc_d4fa0218` has no thread referencing it
6

$ corpus doc check ; echo $?                    # the same corpus, whole
checked 10 documents — 2 warnings, no errors.
0
```

**Steps to reproduce**: see SERVER-019-eval FAIL-1 (steps 1–9). The thread `th_lfx7fu4k` genuinely
references `anc_d4fa0218` (`curl /api/threads/th_lfx7fu4k` → `anchor anc_d4fa0218`), and adding the
thread id to the request makes the check clean — which localises the cause to the request's
document set, not to the corpus.

**Ownership**: the finding is produced by `POST /api/check`; the CLI posts what the mode requires and
renders the response unchanged (TEST-89/161 prove byte-identity). **CLI-006 needs no change if the
server grows the missing seam.** It is scored here because it is CLI-006's advertised behaviour that
fails at the user-visible boundary, and because `--staged` — the mode SPEC §11 exists for — is
structurally a subset and therefore always affected.

**Impact on the next issue**: the workspace-side pre-commit hook that agent-runtime is about to build
on exit 6 would block every commit touching a commented document.

## Re-verification round 1 (2026-07-28, after SERVER-019's fix `394c42d`)

CLI-006's own code is **unchanged since `26fa6cd`** — `git show --stat 394c42d` touches seven files,
all under `apps/server/**` plus the issue file, and zero under `apps/cli`. The verbs were re-driven
as shipped, on a fresh workspace (`/tmp/corpus-s013-eval-refix-OD6CeK`, port `9122`) with fresh ids.

### The failing criterion, re-run

```
$ corpus doc check doc_nog7ylp6 ; echo $?            # commented document, two anchored threads
checked 1 document — no findings.
0                                                     ← was exit 6 + 1 × anchor-unused

$ git -C "$WS" add -- data/docs/inbox/anchored-subject.md
$ corpus doc check --staged ; echo $?                 # the §11 pre-commit path
checked 1 document — no findings.
0                                                     ← was exit 6

$ corpus doc check ; echo $?                          # whole workspace, unchanged
checked 10 documents — no findings.
0
```

The exit-6 contract the workspace's future pre-commit hook is built on is now sound: a commit
touching a commented document is no longer blocked.

### The verb still fails what it should fail

With a genuinely unused anchor (`anc_deadbee1`, no thread anywhere claims it) added out of band:

| Mode                        | Output                                                                                  | Exit |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---- |
| `corpus doc check <id>`     | `error anchor-unused … anchor \`anc_deadbee1\` has no thread referencing it` + `1 error in 1 document.` | **6** |
| `corpus doc check`          | same finding + `1 error in 10 documents.`                                                | **6** |
| `corpus doc check --staged` | same finding + `1 error in 1 document.`                                                  | **6** |

Exactly one finding per mode; the two thread-backed anchors stay silent. Removing the entry returns
all three modes to exit 0. A staged edit that genuinely orphans an anchor is still caught (see
SERVER-019-eval, Re-verification round 1, "the union's other direction").

### CLI-006's own criteria re-checked for regressions

| Re-checked                                        | Result                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| TEST-87 errors exit 6                              | Unchanged — findings rendered, `$? = 6`                                    |
| TEST-88 warnings do not fail                       | `warning ref-unresolved …` + `checked 1 document — 1 warning, no errors.` `$? = 0` |
| TEST-90/91 whole-workspace enumeration             | `checked 10 documents`, `includeArchived=true` still on the wire            |
| TEST-94 `--staged` changes no git state            | `git status --porcelain` before/after → **BYTE-IDENTICAL**                  |
| TEST-95 clean index                                | exit 0, no output                                                          |
| TEST-115 read-only filesystem                      | No workspace file touched by any check mode                                 |

## Summary

**Round 1**: 29 of 30 — TEST-86 failed, inherited from `/api/check`.
**Round 2**: **30 of 30**, plus four cross-issue criteria. CLI-006's own work is strong: the `--staged` collection is
genuinely read-only (byte-identical `git status`, index content not worktree content, 2 MB blob
handled, five-file matrix filtered exactly right), the exit-code split is correct (6 on errors, 0 on
warnings, 2 on the ids+`--staged` conflict, 5 on a 404), `--json` is the server's body unchanged, the
hygiene guard was relaxed by exactly one named import and was re-proved to fire, and Adjudication 5's
self-invalidating allowlist emptied itself with both edits landing together.

The round-1 failure was inherited from `/api/check`'s handling of document subsets (SERVER-019
FAIL-1), and the prediction made in round 1 held exactly: the server grew the missing seam,
**no CLI change was needed**, and the verbs — unmodified since `26fa6cd` — now pass every mode. A
commented document checks clean by id and staged; a genuinely dangling anchor still exits 6 in all
three modes; nothing else regressed.

**PASS.**
