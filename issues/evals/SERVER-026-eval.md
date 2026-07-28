# Evaluation: SERVER-026

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

Real `corpus init` workspace on **8955**, real daemon, `curl` + on-disk inspection + `git log`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                        |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Nine labelled probes (E2E-1…E2E-9) plus a full check suite.                                                  |
| Commands are specific and concrete      | PASS   | Real ids (`doc_o3unhrwy`, `th_vgf7kag6`), real diffs, real timestamps, named scratch dir and pid.            |
| Real E2E (not mocked)                   | PASS   | Real server process, real workspace, real watcher, real `db rebuild`.                                        |
| Scenarios cover acceptance criteria     | PASS   | All three ACs covered end to end.                                                                            |
| Application restarted after changes     | PASS   | Server started fresh against the built tree; `db doctor` read after every phase.                             |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus" — matches the recommendation.                                                         |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug.                                                                                                   |

## Criteria Results

| #   | Criterion                                                        | Result | Observed                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Seed views' view keys visible via one bounded query               | PASS   | `?pinned=true&type=view&sort=order` → the three seed views with `pinned/order/query/column/extra/parentTitle`. Seed files unedited (verified by `cat` before the query).                                              |
| 2   | `extra` round-trips disk → row                                    | PASS   | `POST` with `extra.{items,board,note}` wrote them as **top-level YAML keys beside the core ones** — no `extra:` mapping anywhere in the file. Reproduced the log's E2E-2 output shape exactly.                        |
| 3   | Update is a byte-preserving shallow merge patch                   | PASS   | `PUT {"extra":{"board":{lane:done,…}}}` produced a **two-line** diff: `updated` and `lane`. `items:`, `note:`, `swimlane:` and every other line byte-identical. A following `{"extra":{"note":null}}` removed exactly `note:` and left `lane: done` alone. |
| 4   | Create writes only what the request named                         | PASS   | A plain `note` created with no view keys has no `pinned:`/`order:`/`query:`/`column:` lines; its frontmatter is §5's canonical block.                                                                                 |
| 5   | Contract's 400s surface unchanged; refusals write nothing         | PASS   | `extra.title` → 400 with `json.extra.title`; `column: "todosboard"` → 400 with `json.column`. `data/docs/inbox` unchanged after both.                                                                                 |
| 6   | View keys through create and update                               | PASS   | `POST` with `order: 1.5` landed a midpoint and re-sorted the board; `PUT {"order":null,"column":null}` deleted exactly those two lines and moved the column to the end (placed, not dropped).                         |
| 7   | `parentTitle` is a live join                                      | PASS   | thread → `"Mortgage errands"`; rename parent → `"Mortgage errands, revised"`; `DELETE` parent → `parentTitle: null` with `parent` retained. Never a stored copy.                                                     |
| 8   | Out-of-band edits and rebuild agree                               | PASS   | Hand-writing four pinned views onto disk projected them within ~3 s via the watcher; `POST /api/db/rebuild` reproduced identical answers from files alone (`{"documents":17,…,"skipped":[]}`).                        |
| 9   | `order` sort tiebreak: nulls last, then title, then id            | PASS   | 10/20/20/absent sorted deterministically and identically across 3 browser renders.                                                                                                                                   |
| 10  | Full gate green as the coupled unit                               | PASS   | Build green; generated-artifact drift check green **twice in a row** at the branch tip.                                                                                                                               |

## Honesty Audit

Sampled E2E-1, E2E-2, E2E-3, E2E-4, E2E-5/6 and E2E-7 and re-ran each. **All reproduced**, including
the exact two-line merge-patch diff shape and the `parentTitle` rename/delete sequence. No
contradiction found.

## Findings (non-blocking)

- **FIND-1 (uncommitted file at the branch tip).** `git status --short` on `phase-3-ui` reports
  ` M SPEC.md` — a §9.1 `documents(...)` column-list update naming `pinned, sort_order, query_json,
  column_ref, extra_json`. It is this issue's change (schema version 2 → 3) and it is **not in
  `d0268db`**. Sprint TEST-138 requires `git status` to show only intended files; the orchestrator
  should fold this into the coupled commit rather than let it ride into an unrelated one.

## Summary

10 of 10 criteria passed. The consumer half is correct and the byte-preservation claim — the
riskiest one in the issue — holds under a real diff. PASS.
