# Evaluation: SERVER-025

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

Evaluated **with the orchestrator's standing adjudication**: the originally-reported boot-invalidation
race was proven non-reproducible and the "no change for the reported race" half is pre-authorized.
This eval therefore does not re-litigate half 1; it verifies that the shipped fix — the
scan-to-watcher-ready catch-up — actually works.

Real `corpus init` workspace on **8955**, real `corpus server start` daemon, real SSE client, real
writer process straddling boot.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Two-half structure with an explicit verdict table.                                                                                        |
| Commands are specific and concrete      | PASS   | 11 labelled runs with attempt counts; a JSON drift ledger; an A/B timing table with the control edit named and reverted.                  |
| Real E2E (not mocked)                   | PASS   | Real daemon, real chokidar, real `db doctor`, real `curl -N /events`. Bus-level assertions are correctly declared as the unit half.       |
| Scenarios cover acceptance criteria     | PASS   | All three ACs, with AC1 explicitly amended by evidence rather than quietly reinterpreted.                                                 |
| Application restarted after changes     | PASS   | The whole issue is boot behaviour; restarts are the experiment.                                                                           |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                                   |
| Reproduction logged before fix (bugs)   | PASS   | **Exemplary.** A fixture error (`body.results` vs `body.items`) that would have produced a *fabricated* reproduction was caught, recorded, and corrected mid-attempt. That self-correction is exactly what this section exists for. |

## Criteria Results

| #        | Criterion                                             | Result | Observed (re-derived independently)                                                                                                                                                                                             |
| -------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-113 | Race reproduced, or non-reproduction proven            | PASS   | Adjudicated pre-authorized. The log records 11/11 PRESENT with attempt counts (~4 000 connection attempts against a closed port per run), which is credible evidence the client really was first in the queue.                     |
| TEST-114 | The governing ordering stated as fact                  | PASS   | Stated with line numbers: synchronous `populateFromFiles` at `:134`, bind at `:150`. Consistent with what I observed — every document written while the server was down was present on the first successful request.               |
| TEST-115 | A regression test pins the ordering                    | PASS   | `apps/server/src/lifecycle.test.ts` shipped in `16961be` (per `git show --stat`), described as recording the projection's rows at the instant of bind.                                                                             |
| TEST-116 | The narrower window examined, reported, and closed     | PASS   | **Re-derived from scratch.** A writer wrote a well-formed document into `data/docs/window/` every 10 ms while `corpus server start` was invoked 300 ms in; after quiescence every page of `GET /api/docs?folder=window` was diffed against the writer's ledger: `{"wrote":366,"projected":366,"missing":0,"missingSpan":null}`. A second independent run against `window2/` also lost nothing. The band the log measured at 30 documents / 290 ms is gone. |
| TEST-117 | Boot broadcast reuses `REBUILD_QUERY_KEYS`             | PASS   | `REBUILD_QUERY_KEYS` is defined exactly once (`projection/routes.ts:51`), re-exported from `projection/index.ts`, and imported by `watcher/catch-up.ts:41` — consumed at `catch-up.ts:130`. No second five-key list exists anywhere in `apps/server/src`. |
| TEST-118 | Exactly one frame                                      | PASS   | SSE client attached as early as the socket allowed across a boot with the window populated. Capture: **18 frames total, exactly 1 coarse frame** — `frame[0] ":connected"`, `frame[1] event: invalidate data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}`. The other 17 are the watcher's ordinary per-document frames. No per-file storm. |
| TEST-119 | The frame carries no content                           | PASS   | Grepped the whole capture: `contains 'W2' title text: false`, `contains 'title': false`, `non-invalidate frames: 0`. Keys only.                                                                                                    |
| TEST-120 | No-subscribers case decided in writing                 | PASS   | Decided and written in the issue's Outcome section: `createSseHub` already returns early at zero subscribers, and the catch-up does not reach the bus at all unless it repaired drift — so the common case is *no frame*, not a frame into the void. One accurate sentence, as the criterion asked. |
| TEST-121 | Idempotent with the rebuild path                       | PASS   | `POST /api/db/rebuild` on the booted server returned its own single result (`{"documents":17,…,"skipped":[]}`) and the boot path did not fire again. Rebuild's blessed coarseness is undisturbed.                                   |
| TEST-122 | Boot not measurably slowed                             | PASS   | Accepted on the log's A/B table (841 ms vs 819 ms mean, inside run-to-run spread). Consistent with what I observed: boots in this eval were subjectively indistinguishable, and the catch-up is registered rather than awaited.     |
| TEST-123 | Unit suite covers whichever branch shipped             | PASS   | `watcher/catch-up.test.ts` and `watcher/attach.test.ts` shipped in `16961be`, including the no-drift silent case and the unrepairable-drift case.                                                                                  |
| TEST-124 | Verdict recorded where the next reader will find it    | PASS   | Written into the issue file's **Outcome** section (a quoted block stating what is guaranteed at boot and by whom) and into `.claude/agents/server-dev.md` (touched by `16961be`).                                                   |

## Honesty Audit

I re-derived the two claims that matter most and could not be taken on trust:

1. **The window is closed.** Reproduced independently with my own writer/ledger harness: 366
   documents written across a real boot, **0 missing**. The claim holds.
2. **Exactly one coarse frame, keys only.** Reproduced independently with my own SSE capture: 1 of 18
   frames coarse, first after `:connected`, zero content. The claim holds.

No contradiction found. The self-caught fixture error in the reproduction section raises rather than
lowers my confidence in this log.

## Summary

12 of 12 criteria passed. The issue was opened for a race that does not exist and closed with a fix
for a real 290 ms data-loss window that nobody had noticed — and the fix demonstrably works under an
independent reproduction. PASS.
