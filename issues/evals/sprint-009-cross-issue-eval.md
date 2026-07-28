# Evaluation: sprint-009 cross-issue criteria (TEST-125…138)

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

One real `corpus init` workspace on **8955**, one real `corpus server start` daemon, real Chromium
against the **production-served** board (SERVER-024's mechanism — no Vite, no env var), real CLI/HTTP
mutations, real `git`, real `/events` captures. Per-issue verdicts live in
`CONTRACT-011-eval.md`, `SERVER-026-eval.md`, `SERVER-016-eval.md`, `SERVER-024-eval.md`,
`SERVER-025-eval.md`, `UI-003-eval.md`, `UI-004-eval.md`.

## Criteria Results

| #        | Criterion                                              | Implicates            | Result   | Observed                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------ | --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-125 | Board renders real rows against a real server, end to end | UI-003 + UI-004       | PASS     | One workspace carried the whole loop: documents created with the real API, aged on disk, threaded, replied to as the agent, form-answered, marked "Still current", archived from the row. Every step repainted with **no reload**; on-disk state matched the screen at each step. |
| TEST-126 | A column and a row agree about the same document          | UI-003 + UI-004       | PASS     | `doc_age120` in a `folder: finance` column: `.col-count` = number of rendered rows = `page.total` of the same query; the row's age chip `4mo`, its ladder class `row age-2`, and the raw JSON `stale: "aging"→"stale"` tier all describe the same document. No divergence between the column's filter and the row's rendering. |
| TEST-127 | The Attention column is reason-complete                   | UI-004 + SERVER-011   | PARTIAL  | Three of five `NEEDS_REASONS` were represented and each rendered the chip its `attention` array named, matching raw `?needs=me` exactly (`unread-reply`, `form`, `stale`). **`due` and `failed-job` were not seeded** in either the implementer's workspace or mine, so those two mappings remain unit-verified only — which UI-004's log states plainly rather than implying otherwise. Not counted as a failure; recorded as a coverage gap. |
| TEST-128 | Answering a form clears its Attention row live            | SERVER-016 + UI-003/4 | PASS     | Before: `?needs=form` → `[th_7eyrmy6i]`, `?needs=me` shows it with `["unread-reply","form"]`. Answered over HTTP with the board open → the row left the Attention column with **no reload**, and exactly one `form.respond` event sat in `.corpus/queue/pending/`. SERVER-016 and the board close the loop. |
| TEST-129 | The production-served board works, not just the dev one   | SERVER-024 + UI-003/4 | PASS     | **This was the primary environment for the entire UI evaluation.** `npm run build -w apps/ui` → `corpus init --port 8955` → `corpus server start` → the printed URL in a real browser. Columns rendered with real data, rows with real badges and staleness, `/events` connected (200), zero manual steps. |
| TEST-130 | A restart does not lose the board                         | SERVER-025            | PASS     | Two independent runs of a writer straddling boot (a well-formed document every 10 ms, `corpus server start` invoked 300 ms in): `{"wrote":366,"projected":366,"missing":0}`. Reconnect produced **one** coarse invalidate burst, not a storm. |
| TEST-131 | No document content ever crosses the SSE stream           | all                   | PASS     | Full `/events` capture across a boot plus ~17 watcher frames: every frame is `event: invalidate` with `keys` only. Grep for document titles → `false`; grep for the literal `title` → `false`; non-`invalidate` frames → `0`. Corroborated separately during the form-answer and board-mutation captures (zero occurrences of option text, note text or prompt text). |
| TEST-132 | Generated artifacts green at the tip                      | CONTRACT-011          | PASS     | `node --import tsx scripts/check-generated-artifacts.ts` run **twice in a row**, exit 0 both times: "✓ API contract is up to date (openapi.json, schema.generated.ts)", "✓ CLI reference is up to date (docs/cli.md)". |
| TEST-133 | The whole repo gate is green at the tip                   | all                   | DEFERRED | `npm run build` run here → green (contract → kit → cli → server + ui, `apps/ui/dist` emitted). The repo-wide `npm test` / `lint` / `typecheck` gate is explicitly the **orchestrator's single harvest run** under this machine's load discipline and was not duplicated by this evaluator. See FIND-2 on the counts each issue log states. |
| TEST-134 | The merged coverage gate holds with the board in it       | all                   | DEFERRED | Same reason — `npm run coverage` is a harvest-gate command. Not run.                                                                                                                                                 |
| TEST-135 | e2e green at the tip with the reserved ports respected    | UI-003                | PASS     | `lsof` confirmed **8765 and 5273 both unbound** before starting. `CORPUS_UI_PORT=5273 npm run e2e` → **exit 0, 20 passed (5.1 s)** — 13 shipped + 7 new `board.spec.ts` specs. The "server unreachable" assertion held (`smoke.spec.ts:229 › a failing health check fails soft with a notice in the console strip` ✓), which is only true with 8765 free. No stray dev server; `reuseExistingServer: false` started its own Vite. Both ports free afterwards. `rows.spec.ts` is absent per the adjudicated Open Conflict 12 drop. |
| TEST-136 | The kit surface UI-005/PLUGINS-001 are promised is written | UI-003 + UI-004       | PASS     | UI-003's log carries the added `CorpusClient` methods and hooks verbatim; the `Row` prop contract is written into both logs and matches the built `packages/kit/dist/row/Row.d.ts` field-for-field; UI-004's log carries the full reason-code mapping table including its two prototype quirks. The next issues consume a written contract. |
| TEST-137 | Every Open Conflict adjudicated before implementation      | all                   | PASS     | Conflicts 1 and 2 produced **filed issues with numbers** (CONTRACT-011, SERVER-026), both landed in `d0268db` before UI-003's agent started. Conflicts 5, 6, 7, 10 and 12 are each recorded in the issue file they affect (UI-004's deferrals block, SERVER-025's Outcome section, UI-003's adjudications block), not only in the sprint contract. |
| TEST-138 | Nothing left running and the repo is clean                 | all                   | PASS (with FIND-1) | After this evaluation: `lsof` reports **0 listeners on 8765, 5273 and 8955**; nothing bound in 8900–8999; no orphaned Vite or Playwright children; every scratch path created here (`/tmp/corpus-eval-s009-*`) removed by name. All five issue logs state `implemented on: opus` (CONTRACT-011: `fable`, matching its recommendation). See FIND-1 for the repo's own working tree. |

## Findings

- **FIND-1 — one uncommitted file at the branch tip.** `git status --short` on `phase-3-ui` reports
  ` M SPEC.md`: a §9.1 `documents(...)` column-list update naming `pinned, sort_order, query_json,
  column_ref, extra_json`. It belongs to SERVER-026 (`SCHEMA_VERSION` 2 → 3) and is **not** in
  `d0268db`. TEST-138 asks for a clean tree; fold it into the coupled commit before the phase PR.

- **FIND-2 — test-count wording drifts across the five logs.** SERVER-016 reports "484 test files"
  (apps/server) and "933 test files" (repo); SERVER-025 reports "479/479 suites" and "928/928
  suites" for the same magnitudes; SERVER-026 reports "218 files / 3968 tests"; UI-004 reports "223
  files, 3962 tests". The tree has **111** `*.test.ts` under `apps/server/src` and **218**
  (`238` including `*.test.tsx`) repo-wide. SERVER-025's wording is the correct one; SERVER-016's is
  a mislabelled unit, not an invented result. Worth normalising, because TEST-96/133 ask for a
  *stated count* and two of the five are off by 4×.

- **FIND-3 — one stale deferral.** UI-004 carries `DEFERRED → CONTRACT-011` for the whole-document
  thread parent title, but CONTRACT-011 shipped `parentTitle` two commits earlier and I verified it
  populated on the wire. Detail and reproduction in `UI-004-eval.md` FIND-1. Non-blocking.

## Honesty Audit — sprint-wide

Claims were sampled from all seven logs and re-derived independently against a real server and a
real browser: CONTRACT-011 E2E-1/3/4/5; SERVER-026 E2E-1…E2E-7; SERVER-016's fixture recipe, status
table, fence refusals, payload shape and resolved-thread case; SERVER-024's TEST-97/98/103/104/105/
106/108/109; SERVER-025's window closure and single-coarse-frame claims; UI-003's sections 1, 3, 4,
5, 7, 9, 10, 11, 12, 13, 14; UI-004's sections 1–12.

**Every substantive behavioural claim reproduced.** The only contradictions found are FIND-2 (a
mislabelled unit on a count) and FIND-3 (a deferral whose precondition has since been met) — neither
is a claim that the application does something it does not do.

Two positive signals worth recording: SERVER-025's log **caught and reported its own fixture error**
(reading `body.results` where the API returns `body.items`) that would otherwise have produced a
fabricated reproduction; and UI-003's log volunteered an "honest finding" that two of its own
verification-plan steps do not behave as the plan assumed, with the correct explanation.

## Summary

11 of 14 cross-issue criteria PASS, 1 PARTIAL (TEST-127, two of five reason codes unit-verified
only, disclosed), 2 DEFERRED to the orchestrator's harvest gate (TEST-133/134) per this machine's
load discipline. All seven issues under evaluation PASS. Three non-blocking findings to close.
