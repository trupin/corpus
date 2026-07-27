# Evaluation: CLI-002

**Date**: 2026-07-27
**Sprint**: sprint-003 (TEST-58 … TEST-78, plus cross-issue TEST-79/83/84/86)
**Verdict**: PASS

Evaluator environment: the **real built binary** on PATH
(`ln -sf apps/cli/dist/bin/corpus.js /tmp/eval-s3-bin/corpus`, `which corpus` →
`/tmp/eval-s3-bin/corpus`, `corpus --version` → `0.0.0`) — never `tsx src/…`. Ports
`8840`–`8858`, **8765 left free and verified free at the end**. Scratch workspaces
`mktemp -d /tmp/eval-s3-*`. Every exit code read with `echo $?`; every server stopped through
`corpus server stop` or by pid. No `pkill`/`killall`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                            |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | TEST-58 … TEST-78 individually, plus an Environment section, Implementation Notes and a follow-up fix section.                                                    |
| Commands are specific and concrete      | PASS   | Exact command lines, exact output text, exact exit codes, real pids, real commit hashes.                                                                          |
| Real E2E (not mocked)                   | PASS   | The built `dist/bin/corpus.js` on PATH; the daemon confirmed by `ps` to be the real `apps/server/src/main.ts`. No filesystem mocking.                             |
| Scenarios cover acceptance criteria     | PASS   | Every AC maps to a numbered test; the one deferral (`npm pack`) is named with its substitute.                                                                     |
| Application restarted after changes     | PASS   | Start/stop/restart cycles throughout; the follow-up fix re-verified end to end against a fresh daemon.                                                            |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus.** Worktree `.claude/worktrees/cli-002`."                                                                                                 |
| Reproduction logged before fix (bugs)   | PASS   | The follow-up `GIT_*` leak carries a genuine **pre-fix** reproduction (`GIT_DIR=/tmp/fake-git-dir … → 2 failed / 6 passed`) before the fix and 9 passed after — the right order. |

**Log vs. observation.** Every claim I re-ran reproduced. The log's substitution of a PATH
symlink for `npm link` (to avoid mutating a shared npm prefix) is the same artifact and is
disclosed; I used the same approach independently and reached the same results. The one thing
the log states that I want to correct for the record is cosmetic: TEST-65's log says `ls -A`
showed "only the pre-seeded `.git`" — I confirmed that directly with `/bin/ls -A` (a filtered
`ls` had briefly made it look otherwise on my first pass; the implementation is correct).

## Criteria Results

| #   | Criterion                                       | Result | Notes                                                                                                                                                                                                        |
| --- | ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 58  | `init` creates the §4 tree                      | PASS   | `find . -type d` after `corpus init --port 8840`: `data/docs/{inbox,templates,views}`, `data/threads`, `.corpus/queue/{pending,in-progress,processed,failed,abandoned}`, `.corpus/{locks,jobs,attachments}`, `.claude/{skills,skills-archived,agents}`. All present, including the two directories Open Conflict 9 added. |
| 59  | Config is canonical and mode-protected          | PASS   | `{"version":1,"port":8840,"token":"…","dataDir":"data"}`, `stat -f '%Lp'` → **600**. Token 43 chars, base64url, decodes to exactly **32 bytes**, verified across four independent workspaces (all four distinct). Parsed by **both** `@corpus/server`'s and the CLI's `WorkspaceConfigSchema`, both deriving `port 8840` and `host 127.0.0.1`. |
| 60  | Template lands verbatim, renamed and filtered   | PASS   | `diff -q` **identical** for `README.md`, `data/docs/templates/note.md`, all three `data/docs/views/*.md`, both `SKILL.md` files and `.gitignore` (vs. `assets/workspace/gitignore`). No `claude/` and no unrenamed `gitignore` in the workspace. The template's three `.gitkeep`s were **not** copied; the only five in the workspace are the queue skeleton's. |
| 61  | Queue skeleton is the only tracked `.corpus`    | PASS   | `git ls-files \| grep '^\.corpus'` → exactly the five `.corpus/queue/<status>/.gitkeep`. `git check-ignore -v` attributes `config.json`, `cache.db`, `server.pid`, `server.log`, `jobs/x.jsonl` **and** `template-manifest.json` to `.gitignore:9:.corpus/*` — the template's line. `git status --porcelain` empty. |
| 62  | Queue skeleton survives a clone                 | PASS   | `git clone` → all five `.corpus/queue/<status>/` directories present in the clone.                                                                                                                            |
| 63  | One commit, authored as `user`, on `main`       | PASS   | `667094905937… user <user@corpus.local> \| user <user@corpus.local> \| workspace: initialize corpus workspace by user`; branch `main`; `rev-list --count` = 1. Author **and** committer are the workspace identity despite my own global git config. |
| 64  | Refuses to clobber, changes nothing             | PASS   | `corpus: … is already a Corpus workspace: .corpus/config.json already exists. / There is no --force.` **exit 2**; commit count still 1; config md5 unchanged. `--force` → `unknown flag "--force" for "init"`, exit 2. |
| 65  | Mid-way failure leaves nothing behind           | PASS   | Injected a failing `pre-commit` hook: `corpus: the workspace's initial commit failed: …`, exit 1. A previously **empty** target is empty again (`/bin/ls -A` → ``), and a later `corpus init` succeeds with no manual `rm -rf`. A **pre-existing** `.git` correctly survives the unwind. |
| 66  | Existing repository reused, not re-initialized  | PASS   | Repo with two commits on `trunk`: `git: reused the existing repository, added the workspace commit`, exit 0, **3 commits** with the workspace commit on top, branch still `trunk`, original `Alice <a@x.dev>` commits intact. |
| 67  | Path and environment errors are actionable      | PASS   | (a) `corpus init deep/nested` → exit 0, tree created. (b) target is a regular file → `… is not a directory.`, **exit 2**. (c) `env -i PATH=<node-only>` → `` `git` was not found on PATH, and a Corpus workspace is a git repository `` with an install hint per platform, **exit 2**, and the target verified **still empty**. |
| 68  | `--port` honoured; occupied port fails loudly   | PASS   | With a listener on 8853: `corpus: port 8853 is already in use on 127.0.0.1. / Choose another port…`, exit 2, target still empty. Elsewhere `--port 8854` wrote `"port": 8854`. `--port <n>` is registry-visible (`corpus init --help`) and documented at `docs/cli.md:106`. See the note below on the probe leg. |
| 69  | Two workspaces fully independent                | PASS   | Distinct tokens, ports 8855/8856, neither workspace's tree references the other, and **no** `~/.corpus` or `~/.config/corpus` created anywhere.                                                               |
| 70  | `init` records the template manifest            | PASS   | `.corpus/template-manifest.json` = `{version:1, tool:"0.0.0", installedAt:"…", files:[…]}`, **8 entries**, each a post-rename workspace path. I recomputed every `sha256` against the installed bytes: **0 mismatches**. Gitignored under `.corpus/*` (TEST-61). |
| 71  | `start` daemonizes and returns immediately      | PASS   | `time corpus server start` → **0.461 s**, exit 0, prints the board URL. `.corpus/server.pid` = `{"pid":16357,"port":8856,"startedAt":"…","version":"0.0.0"}`. Started from a `bash -c` that then exited: `ps -o ppid=` → **1** (reparented), and health from a fresh shell → `{"status":"ok","version":"0.0.0","uptimeSeconds":0.704,"workspace":"…"}`. |
| 72  | `start` is idempotent                           | PASS   | `already running on :8856 (pid 15128) — http://127.0.0.1:8856`, exit **0**, pid unchanged.                                                                                                                    |
| 73  | A server that cannot bind fails visibly         | PASS   | Port stolen between init and start: `corpus: the server exited during startup`, the **log tail** printed showing the run banner and `port 8857 already in use — another corpus server may be running`, exit **4**, **no pidfile written**, and `lsof` showed only the thief — no orphan child. (The log renders the `EADDRINUSE` condition as a plain-language message naming the port rather than the raw errno string; substance and actionability are there.) |
| 74  | `status` reports truth and gates scripts        | PASS   | Running → exit **0**, `running — pid 16357 on :8856, corpus 0.0.0, up 1s, …`; `--json` → exactly **one** JSON object on stdout carrying running/healthy/pid/port/startedAt/uptimeSeconds/version/detail. Stopped → `not running`, exit **6** (Adjudication 5), one JSON object on stdout with the error object on **stderr** — verified by capturing the streams separately. |
| 75  | `logs` tails and follows                        | PASS   | `-n 3` printed exactly 3 of the file's lines; the run banner `--- corpus server start <ISO> pid=… port=… ---` present. `-f` in one shell while 3 requests were made in another streamed exactly **3** new lines; `kill -INT` → exit **0**. |
| 76  | `stop` is graceful; stopping a stopped server   | PASS   | `stopped (pid 1904)` exit 0 → process gone, pidfile removed, no listener on the port. Second `corpus server stop` → `not running`, exit **0**.                                                                |
| 77  | Stale and reused pidfiles detected              | PASS   | (a) After `kill -9`: `not running (stale pidfile removed)`, exit 6, pidfile cleaned, and the next `start` succeeded with a new pid. (b) Hand-written pidfile naming a live `sleep 600`: `not running (stale pidfile removed) — pid 15735 is alive but is not this workspace's server, and was left alone`, exit 0, **the sleeper was still alive afterwards**, pidfile removed. |
| 78  | Two workspaces run simultaneously, no crossing  | PASS   | Both started; each `corpus server status` reported its own pid/port (`15117:8855`, `15128:8856`), matching `lsof`. wsA's token against wsB's port → **401**; wsB's own token → 200. With A stopped, `corpus health` in A exits **4** with "run `corpus server start`" while B kept answering (exit 0). |
| 79  | Centerpiece: nothing to something               | PASS   | See below.                                                                                                                                                                                                   |
| 83  | One config file, three readers                  | PASS   | Both `WorkspaceConfigSchema`s derive identical `{version, port, host:"127.0.0.1", token, dataDir}` from the single file, neither requiring a field `init` does not write nor rejecting one it does. The live daemon's environment (`ps eww -p <pid>`) contains **`CORPUS_WORKSPACE` and nothing else** — no `CORPUS_TOKEN`, no `CORPUS_PORT` (Adjudication 4), and **zero** `GIT_*` variables (the follow-up fix holds). |
| 84  | Two workspaces, two daemons, two projections    | PASS   | Event made pending in A only → A's queue shows `pending:1`, B's all zeros. Document projected in B only → `doc_bonly1` present in B's `cache.db`, absent from A's. Neither `cache.db` contains a byte of the other workspace's path (`strings \| grep` → 0). |
| 86  | Repo-wide gates stay green                      | PASS   | See below.                                                                                                                                                                                                   |

## TEST-79 — the centerpiece, run end to end

Executed exactly as specified, on port **8840**, in `/tmp/eval-s3-int-YBK5nz`, with the real
binary. Every step's output and exit code captured:

| Step | Command                                    | Result                                                                                                                                     |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `corpus init --port 8840`                  | exit **0** — workspace, port, token (mode 600), git on `main` with one `user` commit, 8 template files + manifest                            |
| 2    | `corpus server start`                      | exit **0**, **0.459 s**, `pid 916`, real daemon reparented to init                                                                          |
| 3    | `corpus health`                            | exit **0** — `ok — corpus 0.0.0, up 0s, workspace /private/tmp/eval-s3-int-YBK5nz`                                                          |
| 4    | `sqlite3 .corpus/cache.db "select type,count(*) …"` | `skill\|2`, `template\|1`, `view\|3` — the seed documents, **no `.gitkeep`, no `.gitignore`, no root `README.md`**                  |
| 5    | park `idle?timeout=60`, drop an event      | parked at t=0; file dropped out of band at t=2.019 s                                                                                        |
| 6    | wake                                       | `HTTP=200` at t=2.576 s — **557 ms after the event landed**, with the event in `{"events":[…]}`                                             |
| 7    | `POST /api/queue/claim-all`                | `200`, event moved to `in-progress/`; `events` row already `in-progress` on the first `sqlite3` read, no sleep                              |
| 8    | `POST /api/queue/<id>/complete`            | `200`, event moved to `processed/`; `events` row already `processed`                                                                        |
| 9    | `corpus server stop`                       | exit **0** — process gone, pidfile gone, **no listener on 8840**, and `cache.db-wal`/`-shm` checkpointed away with `integrity_check` = `ok` |

**No hop in this chain is stubbed.** Real CLI binary → real detached daemon → real socket →
real SQLite file on disk → real long-poll held open by a real socket → real filesystem event.
The single deferral in the chain (the *producer* being a file drop rather than
`POST /api/threads`) is the pre-authorized Open Conflict 5 decision, and the poll fallback it
mandated is what made the wake observable — 557 ms, inside the 1 s bound.

## TEST-86 — repo-wide gates, from a clean tree

| Gate                                          | Result                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run build`                               | exit 0 (contract → kit → cli → server/ui)                                                                    |
| `npm run lint`                                | exit 0, no output                                                                                            |
| `npm run format:check`                        | exit 0 — "All matched files use Prettier code style!"                                                        |
| `npm run typecheck`                           | exit 0, all workspaces                                                                                       |
| `npm run test:coverage`                       | **114 files, 2113 tests passed, 0 failed**; coverage **99.22 % stmts / 95.9 % branch / 99.63 % funcs / 99.22 % lines** — above the 90 % gate |
| `CORPUS_UI_PORT=5273 npm run e2e`             | exit 0, **13 passed** (3.5 s)                                                                                |
| `scripts/check-generated-artifacts.ts`        | `✓ API contract is up to date` · `✓ CLI reference is up to date (docs/cli.md)`                                |
| `git status --porcelain` after all of the above | empty — nothing regenerated to a diff                                                                        |

I did not execute the pre-push hook itself (running it risks a state-changing git operation,
which is outside an evaluator's remit); every gate the hook composes passed individually above.

## Notes

### TEST-68's default-port-probe leg — not executable as Open Conflict 12 words it

The conflict recommends proving the probe "by holding 8790 with a listener and asserting the
probe steps to 8791". The probe's start is fixed at 8765 and is not configurable, so holding
8790 exercises nothing unless 8765–8789 are all occupied — and binding 8765 is forbidden this
sprint. TEST-68's own "Then" clause makes no claim about the probe, and all three of its
assertions pass. Flagging the conflict text as self-inconsistent, not the implementation as
defective. The documented default is visible at `docs/cli.md:106`
("Defaults to the first free port at or above 8765").

### `npm pack` / global install — DEFERRED → INFRA-008

Pre-authorized by Open Conflict 11. The substitute the log offers is real: the two-candidate
resolver's dev layout is exercised end to end by every test above, and `ps` confirms the
daemon `corpus server start` spawns is the genuine `apps/server/src/main.ts`.

### The `GIT_*` leak follow-up

This is the strongest piece of proof-of-work in the batch and I verified its live half
independently: `ps eww` on the running daemon shows **zero** `GIT_*` variables with
`CORPUS_WORKSPACE`, `PATH` and `HOME` intact. The pre-fix reproduction was recorded before the
fix, the regression test was confirmed to fail without the fix, and the fix was correctly
extended to the long-lived daemon rather than only the short-lived `init`.

## Failures

None.

## Summary

**21 of 21 CLI-002 criteria pass, plus all four cross-issue criteria that fall to this issue
(TEST-79, 83, 84, 86).**

The centerpiece is proven, not assumed: an empty directory became a running Corpus — real
binary, real daemon surviving its starting shell, real projection over the seed workspace,
real long-poll parking and waking 557 ms after a file landed, real claim and complete, and a
clean stop leaving no process, no pidfile and a checkpointed database.

The surface is unusually careful in the places that normally rot: the pidfile distinguishes a
dead pid from a *reused* one and leaves the stranger alive; `--json` puts exactly one value on
stdout and errors on stderr; a failed init unwinds what it created while preserving a
pre-existing `.git`; the daemon's environment carries one variable and no secret; and the
template manifest's hashes verify against the installed bytes.
