# Checkpoint: Phase 5 wave 1 landed, wave 2 starting (2026-07-30)

## State Summary

- **Branch** `phase-5-followups`, HEAD `fa5d937`, remote in sync. Working tree clean except
  one staged-worthy edit: `issues/shared/003-pr11-review-followups.md` (+1 line, the
  `ACTIVE_JOB_STATUSES` decision) — commit it with the next `[PLAN]` bookkeeping.
- **Phase 4 landed 2026-07-30** (PR #11, squash `1ab882f`, authored 2026-07-29 23:30 PT) after a
  REQUEST_CHANGES → fix → APPROVE cycle; merge was user-directed/pre-authorized. Fixed-pre-merge
  vs. deferred findings are ledgered in `issues/shared/003-pr11-review-followups.md`.
- **SHARED-004 done**: Phase 5 spec pass signed off and applied (`b4aa5b1`).
- **Sprint-015 wave 1 done, all PASS, pushed**: CLI-011, CLI-013, CLI-015, SERVER-030, SERVER-036,
  CONTRACT-020, CONTRACT-021. One evaluator fix round (SERVER-030 FAIL-1 console `blockedOn`
  rendering `5314b48`; CLI-015 FAIL-2 `queue defer` verb `8f4ee92`). Verdicts:
  `issues/evals/{CLI-011,CLI-013,SERVER-030,SPRINT-015-RIDERS}-eval.md`.
- **Wave 2 starting**: sprint-016 contract being written (does not exist yet — highest sprint file
  is `issues/sprints/sprint-015.md`; test ladder resumes after `TEST-372`, ports resume above
  `9199`). Issues: AGENT-005, AGENT-006, AGENT-007, UI-017, UI-018, UI-019, PLUGINS-003.
  Implementation via agent-runtime-dev (**fable** — AGENT-005 is delegation-design judgment),
  ui-dev, plugins-dev. **Cap 3 concurrent agents.**
- **Remaining Phase 5 after wave 2**: CLI-012, UI-015, SERVER-032, SERVER-037, SHARED-003 triage.
  Deferred beyond the phase unless capacity allows: UI-016 (react-router v8), SERVER-033
  (@hono/node-server v2).

## Session Context (not in persistent files)

- **PLAN.md row for SHARED-004 still reads `todo`** while `issues/shared/004-phase5-spec-pass.md`
  reads `done`. File is authoritative; fix the row in the next `[PLAN]` commit.
- **SHARED-004 user modifications to the spec pass** (already applied, do not relitigate):
  the _product_ orchestrator delegates **everything**, N=10 concurrent, with model tiering that
  includes Opus 5. This is the PRODUCT agent runtime only — the **dev harness cap stays ~3**.
  The empty-document auto-delete rule went in verbatim as the user worded it (drives UI-017).
- Wave-1 follow-ups already ledgered in SHARED-003 rather than filed: flaky
  `apps/server/src/queue/service.test.ts:518`; no TTL sweeper for expired lock leases (accepted);
  `assets/workspace/gitignore` "five directories" → six (fold into AGENT-005); missing
  `.corpus/queue/deferred/.gitkeep` upgrade path (fold into CLI-012).

## Operational rules — MUST carry into any fresh session

- **Port 8765 is the user's personal corpus server** (`~/cos`, global install, respawns).
  NEVER kill it, never bind it. Every `corpus init` passes `--port` explicitly (init probes
  upward from 8765). E2E is hermetic via `CORPUS_SERVER_ORIGIN`, pinned in `.githooks/pre-push`
  to `127.0.0.1:8790` by INFRA-011 (manual `npm run e2e` outside the hook is NOT pinned — set it).
- **All scratch under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`** — never `/tmp`, never
  inside the repo.
- **Run `corpus init` from outside the repo**: subshell-`cd` or `--workspace` (CLI-013 landed the
  flag; a cwd-derived init once corrupted the repo config).
- **Commit messages via `git commit -F -` heredoc** (backticks break the inline `-m` form).
- **Pre-commit runs the FULL gate on the working tree, per commit** — batch commits accordingly.
  **One flake retry per gate**, then investigate. Sweep orphan vitest workers after any abnormal
  agent death (`ps aux | grep vitest`). `VITEST_MAX_THREADS=4` everywhere.
- `worktree.baseRef=head` in `.claude/settings.local.json`; rtk rewrites `npx` → use
  `node --import tsx`; from-source CLI entry is `apps/cli/src/bin/corpus.ts`.

## Next Steps

1. Finish/bank the sprint-016 contract, then spawn wave 2 (cap 3: agent-runtime-dev on fable,
   ui-dev, plugins-dev), staggering launches so end-of-session gates don't collide.
2. Evaluate wave 2 (fresh evaluator, opus, scoped runs only), flip statuses in issue files +
   PLAN.md, commit `[PLAN]` — including the stale SHARED-004 row and the pending SHARED-003 edit.
3. Work the remaining Phase 5 backlog (CLI-012, UI-015, SERVER-032, SERVER-037, SHARED-003 triage),
   then cut the Phase 5 PR and babysit to merge: CI green on head, **fresh** pr-reviewer on Fable
   (PR number only), fix/waive CRITICAL+MAJOR, squash-merge.

_Housekeeping: `.claude/handoffs/` holds 4 files; the two 2026-07-27 checkpoints can be deleted._
