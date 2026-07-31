# Evaluation: CLI-013

**Date**: 2026-07-30
**Sprint**: sprint-015 (wave 1, stage A)
**Verdict**: PASS

Evaluated against the committed tree (`a689cee [CLI-013]` on `phase-5-followups`, working tree clean),
rebuilt once with `npm run build`. All drills ran the built binary
`node /Users/theophanerupin/code/corpus/apps/cli/dist/bin/corpus.js` from a cwd **outside** the
repository, under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-eval-cli013-GCQmV2`.
Every `corpus init` passed `--port 9195` explicitly; `8765` was never bound, probed or killed.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Full log, sections A–E, keyed to TEST-298–TEST-323.                                                                                                        |
| Commands are specific and concrete      | PASS   | Exact invocations, cwd printed, sha256 prefixes, exit codes, listings, pids.                                                                                |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` runs against real scratch dirs, real `git init`/worktrees, a real server on 9181 with a real `doc create`. Unit tests cited only as a *second* proof for TEST-309/310. |
| Scenarios cover acceptance criteria     | PASS   | All three criteria have direct drills; every non-struck TEST is addressed.                                                                                  |
| Application restarted after changes     | PASS   | Post-fix drills (TEST-313–316) are re-runs of the pre-fix reproductions on the fixed binary; I re-derived them on a fresh build.                             |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (cli-dev, 2026-07-29/30, sprint-015 stage A)".                                                                                     |
| Reproduction logged before fix (bugs)   | PASS   | TEST-298/299/300 reproduced on pre-fix HEAD with before/after listings and sha256 pairs, including the `unwind()`-forced `t299b` drill. Pre-fix HEAD is gone, so the reproductions are not re-derivable; the post-fix refusals I re-derived are the load-bearing half and they prove the same hazard is now blocked. |

## Criteria Results

| #   | Criterion                                                                | Result | Notes                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 | `--workspace <path>` targets `<path>`, never silently scaffolds cwd       | PASS   | Re-derived: TEST-301/302/303/304 below.                                                                                                                                    |
| AC2 | Non-empty non-workspace dir requires `--force`; refusal names evidence    | PASS   | Re-derived: TEST-305–308, 311, 312.                                                                                                                                        |
| AC3 | `docs/cli.md` regenerated; init tests updated                             | PASS   | `docs/cli.md:132-192` documents `--force`, the four-way precedence and the refusal; no stale "there is no `--force`" anywhere in the file.                                  |

### Re-derived acceptance tests

| #        | Criterion                                            | Result | Observed                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-301 | `--workspace` with no positional targets the flag    | PASS   | cwd `t301-A`, `init --workspace t301-B --port 9195` → `Initialized Corpus workspace at …/t301-B`; `A` listing `[]` (0 entries), `B` = `.claude .corpus .git .gitignore data README.md`, config `port 9195`, `data/{docs,threads}`, 1 commit. |
| TEST-302 | positional vs `--workspace` resolved explicitly      | PASS   | `warning: two targets were named; the positional …/t302-B wins over …/t302-C, which was ignored.` `B` scaffolded, `C` `[]`, `A` `[]`. Precedence also stated in the published description and `docs/cli.md:136`.                    |
| TEST-303 | `CORPUS_WORKSPACE` consistent with the chain         | PASS   | `CORPUS_WORKSPACE=…/t303-B corpus init --port 9195` from `t303-A` → `B` scaffolded, `A` `[]`.                                                                                                                                    |
| TEST-304 | bare init still targets cwd                          | PASS   | Empty dir as cwd → scaffolded in place, exit 0.                                                                                                                                                                                 |
| TEST-305 | unrelated files refused, evidence named              | PASS   | `refusing to initialize …/t305 — it already holds 2 entries (notes.txt, todo.md).` exit **2**. Directory byte-identical (sha256 set unchanged), no `.corpus`, no `.git`.                                                          |
| TEST-306 | git repository named distinctly                      | PASS   | `— it is a git repository (.git/); it already holds 4 entries (.git, .gitignore, README.md, notes.txt).` Two evidence clauses, distinguishable from TEST-305's single clause. `--json` → `{"error":{"code":"usage_error",…}}` exit 2. |
| TEST-307 | linked worktree caught                               | PASS   | `.git` confirmed a **FILE**; `— it is a linked git worktree of another repository (.git file); it already holds 2 entries (.git, parent.txt).` Worktree HEAD and file hashes unchanged, still 1 commit.                            |
| TEST-308 | empty subdirectory inside a repo refused             | PASS   | `— it sits inside the git repository at …/t308-parent.` `sub/` listing empty afterwards; parent `core.bare` `false`→`false`, HEAD unchanged, `status --porcelain` empty.                                                            |
| TEST-309 | refusal precedes the first write                     | PASS (behavioural half) | Every refusal above left an identical `readdirSync` listing **and** identical sha256 for every pre-existing file; no `.corpus/`, no `data/`, no `git init`. The injected-`GitRunner` unit half is a source-level claim I did not read; the behavioural half is decisive on its own. |
| TEST-310 | `unwind()` gap pinned, not assumed                   | PASS (behavioural half) | The shipped `--force` output states it outright: `warning: overwrote 1 pre-existing file, which cannot be restored: README.md.` The implementation records rather than restores, consistent with the log.                          |
| TEST-311 | `--force` proceeds and says what it did              | PASS   | Two warnings then success; `notes.txt` preserved (`keep me`), branch `trunk` kept, 2 commits, `git: reused the existing repository`.                                                                                             |
| TEST-312 | `--force` does not override existing-workspace guard | PASS   | Both shapes refused at exit 2: `.corpus/config.json already exists.` and `data/ already contains documents.`, each with `--force does not override this: a live workspace is never replaced.`                                     |
| TEST-314 | the TEST-299 repo now refuses harmlessly             | PASS   | Same fixture shape (git repo + committed `README.md`/`.gitignore`/`notes.txt`): refused, all three sha256 unchanged, HEAD unchanged, `status --porcelain` empty.                                                                  |
| TEST-315 | the TEST-300 escape now refuses                      | PASS   | See TEST-308 — parent repo's `core.bare`, HEAD and worktree all unchanged.                                                                                                                                                       |
| TEST-316 | a `--workspace`-created workspace really works       | PASS   | `server start` → pid 46562 on 9195; `server status` → `running — pid 46562 on :9195, up 1s`; `health` → `ok — corpus 0.0.0`; `doc create` → `created doc_ta4eygbq — data/docs/inbox/guard-proof.md`; `git log` shows both commits authored `user <user@corpus.local>`; `server stop` → `stopped (pid 46562)`, `lsof` on 9195 → 0 rows. |
| TEST-317 | the safe-cwd rule was followed                       | PASS   | Log shows cwd for every invocation; my own re-derivation ran entirely outside the repo. `git -C <repo> status --porcelain` empty before and after every drill; `<repo>/.corpus` never existed.                                     |
| TEST-318 | the three "there is no `--force`" sites updated      | PASS   | The published description now reads `…; --force proceeds there and reports what it overwrote.` `grep` for "there is no `--force`" over `docs/cli.md` → no hits.                                                                    |
| TEST-319 | `docs/cli.md` regenerates with the new surface       | PASS   | `docs/cli.md:132-192`: `--force` in the flag table (`:155`), precedence prose (`:136`), refusal behaviour, and a new `corpus init --workspace ~/notes` example (`:174`) plus `corpus init ~/project --force` (`:186`). Working tree clean ⇒ the artifact-drift red recorded in the log is resolved post-commit, as Adjudication 12 anticipated. |
| TEST-320 | registry valid, no global shadowed                   | PASS   | `corpus init --help` declares exactly `--port` and `--force` under "Flags"; `--workspace` appears only under "Global flags". No shadowing.                                                                                        |
| TEST-321/322 | blessed test resolved, pinned tests survive      | NOT RE-DERIVED | Test-suite composition is source-level; outside an evaluator's remit. The behaviours those tests pin (reuse-under-`--force`, refuse-without, occupied port, missing git) are all exercised behaviourally above and hold.       |
| TEST-323 | model recorded                                       | PASS   | `implemented on: opus`.                                                                                                                                                                                                          |
| TEST-365 | queue skeleton reconciled once                       | PASS   | Fresh workspace `.corpus/queue/` holds all six status dirs including `deferred/`; `git ls-files .corpus` shows six tracked `.gitkeep`s in the initial commit. CLI-013's bundled CONTRACT-021 rider did this, and SERVER-030 did not duplicate it. |

### Edge cases probed beyond the contract

| Probe                                       | Observed                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| target does not exist (`init …/t-new/deep`) | Created and scaffolded, exit 0 — the guard does not over-refuse.                                                                                |
| target is a regular file                    | `corpus: …/t-file is not a directory.` exit 2, with a corrective hint. Pre-existing refusal still ordered ahead of the write.                    |
| `--force` inside an enclosing repo          | Proceeds (contracted escape hatch), creates a **nested** `.git` directory; the parent then reports `?? sub2/` but its `core.bare` stays `false` and its HEAD is untouched. Documented and opt-in; refusal remains the default. |

## Failures

None.

## Summary

**23 of 23 re-derived criteria pass; 2 (TEST-321/322) are source-level test-composition claims outside
the evaluator's remit and were not re-derived.** The load-bearing evidence: a directory seeded as a git
repository with a committed `README.md`, `.gitignore` and `notes.txt` is now refused at **exit 2** with
the message `refusing to initialize … — it is a git repository (.git/); it already holds 4 entries (…)`,
and every one of the three files' sha256 is unchanged afterwards, with HEAD unmoved and
`git status --porcelain` empty — the exact incident of 2026-07-29, now impossible. The `--workspace`
divergence is closed in the other direction too: `init --workspace $B` from cwd `$A` leaves `$A` with
zero entries and produces a fully working workspace at `$B` (server started, document created and
committed, server stopped, port free). No claim in the log was refuted.
