# Evaluation: CONTRACT-016 (rider)

**Date**: 2026-07-28
**Sprint**: sprint-013 (commit `81023e1`, branch `phase-4-agent-loop`) — rider adjudicated in
**Adjudication 8**
**Verdict**: **PASS** (2 of 2 acceptance criteria, plus the standing contract invariants)

CONTRACT-016 carries no numbered acceptance tests of its own; per the evaluation brief it is scored
against its issue file's acceptance criteria plus the standing contract invariants. It is also the
only issue in the batch whose value is only observable **through another issue's handler**, so it was
verified end to end against SERVER-019's live rollback route as well as against the committed
artifacts.

> **Note for the orchestrator**: the brief says "TEST-52…74 apply where relevant". Those numbers are
> INFRA-008's packaging/manifest/clean-install criteria and have no bearing on a contract rider; I
> read the instruction as meaning the standing contract invariants (the TEST-149 / TEST-152 family)
> and scored accordingly. Flagging in case a different set was intended.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Change rationale, artifact regeneration, drift analysis, a live round-trip stub, a type-level proof and a negative control.        |
| Commands are specific and concrete      | PASS   | Exact regenerate output, exact drift text, exact sha256 prefixes, exact test names for the negative control.                       |
| Real E2E (not mocked)                   | PASS   | The round-trip mounted the **shipped** `rollbackSkill` route definition on a real `OpenAPIHono` served by `@hono/node-server` on `127.0.0.1:9117` and drove it with the **generated** client. That is a real HTTP round-trip over the real wire shape, not a test client. Stronger evidence exists now: SERVER-019's real handler returns both values (below). |
| Scenarios cover acceptance criteria     | PASS   | Both ACs addressed; the `null` and non-`null` branches, the present-but-null key ordering, and the type widening are each proven.  |
| Application restarted after changes     | PASS   | Artifacts regenerated and re-hashed; the stub closed its own listener; `9117`/`8765` verified free.                                |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: **opus** (contract-dev, worktree `agent-a8142f0fd7bc5db5a`)".                                                      |
| Reproduction logged before fix (bugs)   | N/A    | Rider, not a bug.                                                                                                                  |

## Criteria Results

| #   | Criterion (from the issue file)                                                                                              | Result | Notes                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | `commit` is `string \| null` with the semantics documented; artifacts regenerated; drift green twice; client round-trips both | PASS   | Committed `openapi.json`: `SkillRollbackResult.properties.commit` = `{"type":["string","null"],"pattern":"^[0-9a-f]{7,64}$", "description": …}` and `commit` is still in `required` — **present-and-null, never absent**. The description publishes the semantics (`null` ⇔ restored but not committed; the write stands per §14; the reason is in `warnings`). Generated client type is `commit: string | null`. `check-generated-artifacts.ts` run twice by the evaluator → exit 0 both times. |
| AC2 | No other route or schema changes; no consumer files touched                                                                  | PASS   | `git show --stat 81023e1`: `packages/contract/{openapi.json, src/client/schema.generated.ts, src/openapi.test.ts, src/routes/skills.ts, src/schemas/skill.test.ts, src/schemas/skill.ts}` + PLAN.md + the issue file. Nothing outside `packages/contract`. The rollback route still declares exactly `200, 400, 401, 404` — no new status, no new shape. |

### Standing contract invariants applied

| Invariant                                    | Result | Notes                                                                                                                             |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Artifacts idempotent / drift green (TEST-149) | PASS   | Two consecutive runs, exit 0; sha256 `openapi.json` = `39ae2954924dae3671d2114b58a9b068507483b707e2c5a8146b69e8149f8124`, `schema.generated.ts` = `99e289e7488300a4b22fa3ec04f21e7636d9fc183bf83a56ffe3c464227e51e6` — the exact values the log recorded. |
| Invariant suites green and unweakened (TEST-152) | PASS | `vitest run packages/contract` → 39 files, 1191 tests green, including `openapi`, `request-body-required`, `request-defaults`, `index`, `inventory`, `routes/index`. The rider **added** 3 assertions rather than relaxing any. |
| No route amended by a non-contract agent (Adjudication 3) | PASS | The rider is the sanctioned contract change; SERVER-019 and CLI-006 consumed it without touching `packages/contract` (their diffstats confirm). |
| Wire-surface only; consumers unaffected      | PASS   | Full-repo `npm run typecheck` exit 0; `npm run lint` exit 0.                                                                       |

## The rider's purpose, verified live (beyond the log)

The log proved `null` round-trips through a stub. The evaluator proved the **real** handler produces
it, both ways, against a real workspace and a real git repository:

1. **`commit_skipped`** — repeating the same `--to` rollback, so the restored content already matches
   what git records:
   ```
   POST /api/skills/orchestrate/rollback {"to":"588b9de…"}   → 200
   {"name":"orchestrate","docId":"doc_skillorchestrate","commit":null,
    "path":".claude/skills/orchestrate/SKILL.md",
    "warnings":[{"code":"commit_skipped","detail":"the restored content is already what git records for this path, so there was nothing to commit; the file on disk holds it either way"}]}
   ```
   `commit === null` verified programmatically — not `""`, not a foreign sha.

2. **`commit_failed` — §14's headline case, which is why the rider exists.** With a workspace
   `pre-commit` hook that rejects every commit:
   ```
   POST /api/skills/orchestrate/rollback {}                   → 200
   {"name":"orchestrate","docId":"doc_skillorchestrate","commit":null,
    "path":".claude/skills/orchestrate/SKILL.md",
    "warnings":[{"code":"commit_failed","detail":"git commit failed: workspace hook: skills are frozen"}]}
   ```
   …and the file write **stood**: the restored content is on disk and shows as modified in
   `git status --porcelain`. This is exactly *"the server never rolls back a file write because a
   commit failed"* — expressible on the wire only because of this rider. Option (y) from Open
   Conflict 4 (echo the pre-existing HEAD) would have put a commit that is not this restoration into
   the field the audit trail reads; option (z) (5xx) would have contradicted §14 and the route's
   declared statuses. Neither was taken.

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                     | Re-derived? | Finding                                                                                         |
| --- | --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| R1  | `commit` is `["string","null"]` with the pattern retained            | Yes         | Exact, in the committed `openapi.json`.                                                          |
| R2  | `commit` stays **required** (present-and-null)                       | Yes         | `required: ["name","docId","commit","path","warnings"]`.                                         |
| R3  | Generated client type is `commit: string | null`                     | Yes         | Confirmed in `schema.generated.ts`.                                                              |
| R4  | Artifact sha256 values                                               | Yes         | **Both exact.**                                                                                  |
| R5  | Drift check green after commit, twice                                | Yes         | Exit 0 both runs, both arms.                                                                     |
| R6  | Six-file diff, nothing outside `packages/contract`                   | Yes         | 8 paths counting PLAN.md and the issue file; 6 under `packages/contract`. Matches the claim.      |
| R7  | Two prose lines in `routes/skills.ts` reconciled                     | Yes         | The route's `commit` description now documents the `null` semantics; the diffstat shows 7 changed lines there. |
| R8  | `SkillRollbackResult` had zero consumers at rider time               | Yes         | SERVER-019 (the first consumer) landed afterwards, at `7ca18a1`.                                  |
| R9  | `vitest run packages/contract` → 38 files / 1172 tests (at the time) | Consistent  | 39 files / 1191 today; the delta is exactly CONTRACT-015's added `plugin/index.test.ts` and its 19 tests. Arithmetic checks out. |
| R10 | The three new tests are load-bearing                                 | Partially   | Reproducing the failing half means removing `.nullable()` from the shipped schema (implementation source), which the evaluator does not do. The agent's transcript names all three test titles and the exact failure count; the live handler behaviour above independently demonstrates the value the tests pin. |
| R11 | `null`, never `""`, never a foreign sha                              | Yes         | Verified through the real handler: `r.commit === null` is `true`, and the non-null case returns the **new** HEAD (`=== git rev-parse HEAD`, `≠` the source ref). |

No overclaims found.

## Failures

None.

## Summary

A one-field rider that does exactly what Adjudication 8 asked and nothing else: `commit` becomes
`string | null`, stays required so the key is always present, keeps its regex for non-null values,
publishes the semantics in its own description, reconciles the two route prose lines that would
otherwise have contradicted the schema, and touches no other route, schema or consumer. Artifacts
regenerated idempotently to the recorded shas, drift green twice, contract invariants green and
strengthened by three assertions rather than relaxed.

Most importantly, the value it exists for is now demonstrable end to end against the real server:
a workspace git hook that rejects the rollback commit yields `200` + `commit: null` +
`commit_failed`, with the restored file standing on disk — §14's rule, expressible on the wire.
**PASS.**
