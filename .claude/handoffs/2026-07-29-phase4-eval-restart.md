# Handoff: Phase 4 final evaluation restart (2026-07-29)

> **UPDATE (same day, later):** the stuck evaluator recovered via single-step resumes and
> finished — ALL 12 verdicts PASS (evals banked), statuses flipped, SERVER-032 filed,
> **PR #11 created and CI is GREEN** (https://github.com/trupin/corpus/pull/11). Steps 1–3 below
> are DONE, and the user survey (2026-07-29) resolved everything else:
>
> - **All four SPEC amendments APPROVED and APPLIED** to SPEC.md on the branch (§9.2 routes +
>   SSE token boundary, §7 deferral wording incl. the §9.2 locks bullet, §11 editor ownership,
>   §7 genesis scope). Signed off via the survey — no further sign-off needed.
> - **No npm publish, ever (user decision)**: distribution is clone + build + pack (README
>   updated with the real commands). The npm-name question is moot; `publish:dry-run` and
>   release.yml remain as CI hygiene only — never run a real publish.
> - **Retitle never renames the file** — confirmed, matches shipped behavior.
> - **Merge is PRE-AUTHORIZED**: squash-merge PR #11 as soon as the fresh fable pr-reviewer
>   verdict is APPROVE (fix CRITICAL/MAJOR findings first if any) AND CI is green on the head.
>   No further "land" prompt needed.
>
> The fresh session's ONLY remaining work: run the pr-reviewer on PR #11 (fresh, number only),
> address findings, verify CI on the final head, squash-merge, then post-land bookkeeping
> (sign-off record on main + memory update). Machine-load and gotcha rules below apply.

## Why this handoff

The sprint-014 evaluator lost six sessions to API instability (connection drops + watchdog
stalls) and the orchestrator session exhausted its 200-subagent limit. The user chose a session
restart for a fresh evaluator. Everything is committed and pushed; nothing is in flight.

## State

- Branch `phase-4-agent-loop`, all Phase 4 implementation committed (25+ issue commits).
  HEAD at the `[PLAN]` handoff commit (this file's commit). Remote in sync (verify
  `git ls-remote origin phase-4-agent-loop`).
- Repo-wide gate GREEN: merged coverage 97.34/97.34/94.92/93.17 (plugins/todos measured,
  99.4% lines); `CORPUS_UI_PORT=5281 npm run e2e` 98 specs green (3 reader-spec flakes passed
  on retry — connectivity flake, not regression).
- Evaluations complete: sprints 012 (all 3 PASS) and 013 (all 7 PASS after one fix round) —
  verdicts in issues/evals/. Sprint-014: **AGENT-003-eval.md banked, PASS** (one flag: the
  comment-skill trace edits + trace tests landed in ac3cf30 [AGENT-003] instead of c48a4c6
  [AGENT-004], contrary to sprint-014 Adjudication 10 — content correct, attribution-only;
  orchestrator accepts, disclosed in the commit message).

## What the fresh session must do

1. **Spawn a fresh evaluator (opus)** for the REMAINING verdicts — do not redo AGENT-003:
   - AGENT-004 (issues/agent-runtime/004-emit-trace-lines.md, commit c48a4c6): serve the
     retained workspace `/tmp/corpus-s014-agent004-p5fuWc` (explicit --workspace path, ports
     9180+), re-derive the trace DOM split (.turn-trace textContent lacks ↳, ::before carries
     it, file bytes carry it). → AGENT-004-eval.md
   - PLUGINS-002 (issues/plugins/002-todos-plugin.md, 787bf36): M6 delete/restore drill;
     packaged-tool rider (pack → pathless install → `corpus todos add --from agent` →
     agent-authored commit); todos column + DocPanel in a browser; `corpus todos` in
     docs/cli.md, `_fixture` absent. Scratch /tmp/corpus-s014-plugins002-tpYTyN retained.
     → PLUGINS-002-eval.md
   - Hardening combined verdict (UI-012, UI-013, UI-014, SERVER-029, SERVER-031, CLI-009,
     INFRA-009, CONTRACT-014, CONTRACT-017 — issue files are the contract; headline
     spot-check each + ≥25 re-derived claims). → HARDENING-P4-eval.md
   - Contract: issues/sprints/sprint-014.md (tests TEST-168…297, Adjudications 1–18).
     AGENT-003's transcript audit is done (clean); transcripts at
     /tmp/corpus-s014-agent003-aapyWT/ and /tmp/corpus-s014-agent004-p5fuWc/.
   - Evaluator rules: explicit workspace paths ALWAYS (a cwd-derived `corpus init` corrupted
     the repo config once — fixed; see CLI-013); VITEST_MAX_THREADS=4; scoped runs only;
     never repo-wide/coverage/e2e; kill processes by pid; 8765 stays unbound; 5173/5174 ssh.
2. **On PASS**: flip statuses to done (issue files + PLAN.md rows: AGENT-003, AGENT-004,
   PLUGINS-002, UI-012, UI-013, UI-014, SERVER-029, SERVER-031, CLI-009, INFRA-009,
   CONTRACT-014, CONTRACT-016, CONTRACT-017, SERVER-019, CLI-005, CLI-006, CLI-010,
   CONTRACT-015, INFRA-008 — the wave-2 seven are evaluated but statuses were deliberately
   left in_progress/todo pending this final pass; check each), commit evals+statuses
   ([PLAN]), push.
3. **Cut the Phase 4 PR** (/pr): branch phase-4-agent-loop → main. The PR body must surface
   HELD-FOR-USER items (below). Then babysit: CI green, fresh fable pr-reviewer (PR number
   only), fix/waive findings, and HOLD THE MERGE for the user's explicit "land" — SPEC
   amendments are present.

## HELD FOR USER at the PR

- **npm package name**: `corpus` and `corpus-cli` are squatted on npm (sprint-013
  Adjudication 9; INFRA-008 shipped provisional unpublished `corpus`; bin name unaffected).
  Candidates: an npm scope, `corpus-md`, another unscoped name. No publish authorized.
- **SPEC amendments drafted and held** (spec-writer formalizes at the PR):
  - §9.2: POST /api/check + POST /api/skills/{name}/rollback route additions
    (CONTRACT-008 log) and the SSE token-transport line (CONTRACT-014 log, verbatim draft).
  - §7: deferral wording — "stays queued" vs the shipped fail-with-deferred:-reason +
    `job retry` protocol (sprint-012 Adjudication 6; SERVER-030 filed for the honest
    transition).
  - §11: editor-ownership line (UI-014 log, verbatim draft held for sign-off).
  - §7 genesis wording: extend-plus-propose until CLI-011 lands creation.
- **Open user decision carried from Phase 3**: retitle updates `title:` but never renames
  the file.

## Ready after the PR (next phase / wave candidates)

SERVER-030 (queue defer/requeue), CLI-011 (skill create + doc list, P1), CLI-012 (plugin
seed templates), CLI-013 (init --workspace bug, P1), UI-015 (teardown callbacks),
PLUGINS-003 (item-level commenting, needs UI-014 … done), CONTRACT riders noted in
CONTRACT-014's file.

## Gotchas for the fresh session

- worktree.baseRef=head is set in .claude/settings.local.json (worktrees branch from HEAD).
- Commit-message backticks break the inline -m form under this shell — use `git commit -F -`
  with a quoted heredoc.
- One flake retry per commit gate; sweep orphan vitest/servers after ANY abnormal agent death
  (lsof allocated ports).
- rtk rewrites npx → use `node --import tsx`; from-source CLI is apps/cli/src/bin/corpus.ts.
