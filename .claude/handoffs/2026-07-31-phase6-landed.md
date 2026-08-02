# Phase-End Handoff: 2026-07-31 — Phase 6 LANDED

**Supersedes** `.claude/handoffs/2026-07-31-phase6-wave1.md` (that file described mid-phase
wave-1 state; it is stale — Phase 6 has since merged).

## State Summary

- **Phase 6: LANDED.** PR #14 squash-merged to `main` as `2725f7d` (2026-07-31).
  PR #13 (`a93316e`, UI-022/023/024 dogfood polish) landed earlier the same day.
- **Nine issues done**, each evaluator-PASS and pr-reviewer APPROVE, against the
  sprint-018 contract (`issues/sprints/sprint-018.md`, TEST-581–656). Verdicts in
  `issues/evals/` (`SERVER-033`, `SERVER-038`, `CONTRACT-025`, `UI-020`, `UI-021`,
  `UI-027`, `UI-028`, `CLI-018`, `CLI-022` + the `UI-022/023/024` set from PR #13):
  - **SERVER-033** — `@hono/node-server` v2; real-listener guard tests (the value is the
    tests, not the version bump).
  - **SERVER-038 + CONTRACT-025** — doctor report-only warnings; invisible-doc recovery.
  - **UI-020** — archive/unarchive via the real POST routes + kit client (kills the
    `PUT {status}` half-state).
  - **UI-021**, **UI-027** (anchor highlights — root cause was a trailing-newline
    canonical mismatch, one byte), **UI-028** (board shortcuts yield to any open
    `role=menu`).
  - **CLI-018** (agent-writable view keys, e2e), **CLI-022** (thread create, three §6 shapes).
- **Blocked**: UI-016 (react-router v8) on **UI-029** (React 18→19). Ruling recorded in
  `issues/ui/016-*.md` and PLAN.md: react-router 8.x is React 19-only in declaration _and_
  in fact (statically imports a React 19 hook); the 7.18.2 stopgap was **rejected** (still
  carries the RSC-CSRF high, `>=7.12.0 <8.3.0`).
- **Still ready** in the Phase 6 table: UI-029 (P1), UI-030 (P2, reader ⋯ popover keyboard nav).

See `issues/PLAN.md` Phase 6 / Phase 7 tables for the authoritative status grid.

## In Flight When This Was Written

A `[SHARED-003]` ledger commit was **staged but not yet committed** (`issues/shared/003-pr11-review-followups.md`,
+13/−2) with a full commit gate running. At write time local `main` == `origin/main` == `2725f7d`.
**Verify `git log` / `git ls-remote origin main` before assuming main's tip** — that commit
(and its push) may have landed since.

## Next Session's Queue, In Order

1. **SHARED-003 triage.** The ledger in `issues/shared/003-pr11-review-followups.md` is large
   now. It contains:
   - **TWO SPEC riders needing a user sign-off round**, both already drafted in the ledger:
     §11 (⋯-menu Unarchive wording, TEST-647 / UI-020) and §14 (doctor report-only warnings
     line, CONTRACT-025).
   - **Dispositions to rule on**: Unpin PUT-archive consistency · doctor sync-git worst case ·
     margin-width numbers · thread-create warning scope · doctor `--json` stale description ·
     width-ceiling runtime measurement · esc-after-focus-close hover adoption · UI-024 stub
     Copy-only e2e gap.
2. **UI-029 → UI-016, UI-030.**
3. **Phase 7 — Retrieval A** (PLAN.md section "Phase 7 — Retrieval A"). The **first commit of
   that branch applies SHARED-006's signed 13-edit amendment** (`issues/shared/006-retrieval-spec-pass.md`,
   user sign-off 2026-07-30, "Approve all 13") to `SPEC.md`. Then:
   `CONTRACT-022` → `SERVER-040` ∥ `SERVER-041` → `CLI-019` → `AGENT-008`.
   **A sprint contract is still needed for the batch** (sprint-019, TEST-657+).

## Standing Constraints (unchanged)

- **Never touch port 8765.**
- Use `/usr/bin/grep` for negative evidence.
- **Orchestrator-only commits**, every message `[ISSUE-ID]`-prefixed; full gate per commit,
  backgrounded; **one heavy command at a time**; ~3 concurrent implementation agents max.
- **Squash-merge only**, and only on pr-reviewer APPROVE + green CI.
- **SPEC.md changes require user sign-off.**
- **No `npm publish`.**
- Worktrees: `worktree.baseRef=head` in settings.

## Housekeeping

`.claude/handoffs/` now holds 6 files. The three that matter are this one,
`2026-07-30-phase5-checkpoint.md`, and `2026-07-29-phase4-eval-restart.md`; the two
2026-07-27 checkpoints and the superseded `2026-07-31-phase6-wave1.md` can be deleted.

## Post-close note (orchestrator, 2026-07-31)

Local main carries one unpushed bookkeeping commit: `49419de [SHARED-003] Ledger PR
#14 review findings`. Two rtk-proxied `git push origin main` runs reported ok while
`git ls-remote` stayed at `2725f7d`; a raw `/usr/bin/git push` attempt was stopped
mid pre-push gate. First action next session: push main (raw git binary, then verify
`ls-remote origin main` == local HEAD) before any new work. All PR-merged work IS on
the remote — only this one ledger commit is local.
