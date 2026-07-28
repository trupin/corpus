# Evaluation: CONTRACT-011

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

Evaluated black-box against a real `corpus init` workspace (`/tmp/corpus-eval-s009-ZgWb6Z`) on port
**8955**, a real `corpus server start` daemon, and `curl`. Every claim below was re-derived by this
evaluator, not read off the implementer's log.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, dated, worktree named.                                                                                              |
| Commands are specific and concrete      | PASS   | md5 hashes, exit-code variable names, per-probe E2E-1…E2E-5 labels.                                                         |
| Real E2E (not mocked)                   | PASS   | Typed client driven over `app.fetch` against real mounted `contractRoutes` — a real validation chain, not a stubbed handler. |
| Scenarios cover acceptance criteria     | PASS   | All four ACs have matching probes.                                                                                          |
| Application restarted after changes     | N/A    | Contract package: generation + typecheck are the artifacts; both re-run here and green.                                     |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: fable" — matches the Model recommendation.                                                                 |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug.                                                                                                                  |

## Criteria Results

| #       | Criterion                                             | Result | Observed                                                                                                                                                                                                             |
| ------- | ----------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1     | `extra` on DocRow + create/update; round-trips        | PASS   | `POST /api/docs` with `extra:{items,board,note}` → `201`; response `doc.frontmatter.extra` carries all three verbatim; `GET /api/docs?type=todo` returns the same object on the row.                                 |
| AC1     | No core-key shadowing                                 | PASS   | `extra:{"title":"shadow"}` → `400 {"path":"json.extra.title","message":"`title` is a core frontmatter key; core keys cannot be set or shadowed through `extra`."}` — the log's E2E-3 reproduced verbatim.            |
| AC2     | `pinned` filter + `order` sort                        | PASS   | `GET /api/docs?pinned=true&type=view&sort=order` → `total 3`, Attention@1 / Inbox@2 / Open threads@3 with `query`, `column`, `extra`, `parentTitle` on every row. Log's E2E-1 reproduced byte-for-byte.               |
| AC2     | `pinned` is a strict stringbool                       | PASS   | `?pinned=maybe` → `400 {"path":"query.pinned"}` enumerating the twelve accepted spellings. Log's E2E-5 reproduced.                                                                                                    |
| AC2     | `order` accepts midpoints; `null` clears              | PASS   | Board reorder wrote `{"order":25}` (a real midpoint) and the server accepted it; `{"order":null,"column":null}` removed exactly those two lines from the file.                                                        |
| AC2     | Documented tiebreak is real                           | PASS   | Four views at `order` 10/20/20/absent sorted `Open threads@10 · T Gamma@10 · Attention@20 · T Alpha@20 · T Beta@20 · … · T Delta@null` — order, then title, then id, nulls last. Identical across 3 reloads.          |
| AC2     | `column` shape validated at the boundary              | PASS   | `column:"todosboard"` → `400 {"path":"json.column","message":"A column reference is `\"<plugin>/<type>\"` — exactly one slash."}`                                                                                     |
| AC3     | `DocRow.parentTitle` nullable-required                | PASS   | Present on every row (`null` on non-threads). Live join proven: create → `"Mortgage errands"`; rename parent → `"Mortgage errands, revised"`; `DELETE` parent → `parent` retained, `parentTitle: null`.               |
| AC4     | Artifacts regenerated and idempotent                  | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` run twice at the branch tip: exit 0 both times, "✓ API contract is up to date", "✓ CLI reference is up to date".                                              |
| AC4     | Inventory unchanged (no new routes/bodies)            | PASS   | `git show --stat d0268db` touches `packages/contract/{openapi.json,src/...}` but adds no route file; `ENDPOINT_INVENTORY` count unchanged.                                                                            |

## Honesty Audit

Sampled E2E-1, E2E-3, E2E-4 and E2E-5 from the log and re-ran each against the real server. **All
four reproduced, including the exact error-message text.** No contradiction found.

## Findings (non-blocking)

- **FIND-1 (bookkeeping).** `issues/contract/011-extra-frontmatter-surface.md` still says
  `## Status` → `todo` although the work is committed at `d0268db` and its ACs are checked. The
  sibling SERVER-026 file says `done`.

## Summary

10 of 10 criteria passed. The extra-frontmatter surface, the `pinned`/`order` riders and
`parentTitle` all behave exactly as the log describes, verified independently against a real
server. PASS.
