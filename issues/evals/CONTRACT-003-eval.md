# Evaluation: CONTRACT-003

**Date**: 2026-07-27
**Sprint**: N/A — not in sprint-003's acceptance tests; judged directly against
`issues/contract/003-request-default-fields-required.md`'s acceptance criteria.
**Verdict**: PASS

The contract package has no running process of its own, so its public interfaces are the two
**published artifacts** (`packages/contract/openapi.json`, `src/client/schema.generated.ts`),
the OpenAPI document a real server serves at `/api/openapi.json`, and the compile-time
behaviour a consumer sees through `tsc`. All four were driven directly; the generated client
was consumed exactly as a downstream caller would, and every audit below was written from
scratch rather than re-run from the issue's own test file.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                              |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Reproduction + Post-Implementation sections, a schema-change table, before/after generated types, a falsification check and a gate table.                           |
| Commands are specific and concrete      | PASS   | Actual `tsc` error text with TS codes and line numbers, actual sha256 digests, actual test-failure output from the deliberate falsification.                        |
| Real E2E (not mocked)                   | PASS   | For a contract package the real interfaces are the generated artifacts and `tsc`; both were driven for real. The log additionally exercises the changed schemas through real `@hono/zod-openapi` routes mounted on an `OpenAPIHono` app. |
| Scenarios cover acceptance criteria     | PASS   | All six ACs addressed, including the negative one (AC4, `requestsAgent` untouched).                                                                                |
| Application restarted after changes     | N/A→PASS | No daemon; the equivalent is regeneration from source, done twice with byte-identical output. I additionally confirmed the change is live in the document a **running server** serves. |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus. Worktree `.claude/worktrees/contract-003` (branch `wt-contract-003`)."                                                                       |
| Reproduction logged before fix (bugs)   | PASS   | This is filed as a bug and the reproduction is genuine **pre-fix**: the full-surface audit table, the pre-fix generated type showing `tags`/`status`/`due`/`evergreen` as required, and `tsc` failing with `TS2739 … EXIT=2`. |

**Two things in this log deserve credit rather than suspicion**, because both make the agent's
own work look worse:

1. It reports that the invariant **as literally worded in AC3** ("no property in a
   requestBody's `required` may carry a `default`") **passed pre-fix** and would never have
   caught the bug — the promotion happens in `openapi-typescript` and ignores the `required`
   array entirely. Rather than quietly satisfying the letter, it added the stronger invariant
   that catches the class and kept the weak one as a second guard. I confirmed both exist and
   that the strong one is the load-bearing check.
2. It documents a **falsification check**: reintroducing the bug on an untouched schema
   (`AcquireLockRequestSchema.ttl`) made the strong test fail with the exact location while
   the weak test still passed, then reverted. That is the correct way to prove a guard works.

**Log vs. observation.** The digests in the log
(`27570fb5…` / `3d089665…`) do not match what I measured today
(`d0794545…` / `17642ed3…`). That is expected and not a discrepancy: `CONTRACT-002`'s
optional-halt-reason body (commit `d7a2463`) landed on the branch **after** CONTRACT-003 was
written, changing both artifacts. What matters is the property the digests were cited for —
determinism — and I re-established it from the current tree.

## Criteria Results

| #   | Acceptance criterion                                                | Result | Notes                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Convention pinned in a schema-file comment and applied surface-wide | PASS   | `packages/contract/src/schemas/index.ts` opens with a module doc comment naming the rule ("**Optional-in, defaulted-out**"), the **mechanical** reason (`openapi-typescript` promotes any defaulted property to a required member, ignoring `required`), the split-rather-than-compromise rule with `TextQuoteSelectorSchema` / `TextQuoteSelectorRequestSchema` as the worked example, the "server-side parse wrapper, never the shared request schema" escape hatch, and a pointer to the enforcing test. Applied surface-wide per criterion 3. |
| 2   | `CreateDocRequest`'s four fields optional; `tsc` probe compiles     | PASS   | Generated type now reads `tags?: string[]`, `status?: "open" \| "resolved" \| "archived"`, `due?: string \| null`, `evergreen?: boolean`, each carrying the server-applied default in its `@description`. My own probe (written fresh, not the issue's) compiled at **EXIT=0** under `strict`: minimal create-doc `{ type, title }`, a full create-doc, a standalone `CreateThread` `{ body }`, and an anchored thread whose selector carries only `exact`. **Negative control**: omitting the genuinely-required `title` still fails with `TS2741`, so the types are not merely permissive. |
| 3   | Full-surface audit: no defaulted request field renders as required  | PASS   | I walked the OpenAPI document **served by a running server** (`GET /api/openapi.json`, 95 215 bytes), dereferencing `$ref`s with a cycle guard and descending `properties`/`items`/`allOf`/`anyOf`/`oneOf` across all **11** operations that declare a `requestBody`: **0** reachable properties carry a JSON Schema `default`, and **0** defaulted properties appear in any `required` array. The pre-fix audit in the log listed 8 offenders across `CreateDocRequest` and `CreateThreadRequest`; all are gone, and no new one has appeared on the schemas added since (including `HaltQueueRequest`). |
| 4   | Tri-state `requestsAgent` untouched — no default reintroduced       | PASS   | `requestsAgent?: boolean` in the generated type, with no `@default` annotation, and no `default` on it anywhere in the document. All three states typecheck independently: omitted, `true`, and `false`. Its description still spells out the three distinct instructions. |
| 5   | Artifacts regenerated; drift check green; generation deterministic  | PASS   | `npm run generate -w packages/contract` run **twice**; `openapi.json` sha256 `d0794545…` and `schema.generated.ts` sha256 `17642ed3…` **identical before, after the first, and after the second** run. `git diff --stat` on both artifacts: empty. `node --import tsx scripts/check-generated-artifacts.ts` → `✓ API contract is up to date` and `✓ CLI reference is up to date`, exit 0. |
| 6   | Server semantics unchanged; handoff recorded                        | PASS   | Repo-wide `npm run typecheck` passes against the regenerated client, and `npm run test:coverage` → **114 files / 2113 tests passed, 0 failed**, coverage 99.22 % lines / 95.9 % branches (gate 90 %). The handoff to SERVER-005+ is recorded concretely in the issue log — `tags ?? []`, `status ?? "open"`, `due ?? null`, `evergreen ?? false`, `folder ?? "inbox"`, `parent ?? null`, `selector ?? null`, `TextQuoteSelectorSchema.parse(selector)` for `prefix`/`suffix`, and the explicit warning that `requestsAgent` must **not** be collapsed with `??`. |

## Additional observations

**The right half of the split is genuinely untouched.** `TextQuoteSelector` — the
response/parse-side component — still emits `exact`, `prefix` and `suffix` as **required**
with both `@default` annotations intact, while the wire-side twin inlines into
`CreateThreadRequest.selector` with `prefix?`/`suffix?`. That is the "split rather than
compromise" rule working in both directions, and it is the change with the widest practical
consequence: a caller anchoring a comment no longer has to invent context strings around its
own quote.

**Scope discipline.** Query and header parameters (`limit`, `offset`, `sort`, `timeout`,
`recent`, `cursor`, `x-corpus-author`) deliberately keep their `.default()`. I confirmed the
premise: `openapi-typescript` does not promote parameter defaults, they already emit optional,
and the published `default` is what documents server behaviour to a reader of the document.
Changing them would have been churn.

**Not this issue's:** `CONTRACT-004` (filed, commit `okb476221`) covers a *different* failure
mode of the same generator — mandatory request bodies typed optional in the client. Out of
scope here and correctly separated.

## Failures

None.

## Summary

**6 of 6 acceptance criteria pass.**

The bug is fixed at the level of the class rather than the instance: the convention is written
down where the next schema author will read it, the enforcing invariant walks the whole
request surface rather than checking the four fields that happened to be broken, and that
invariant was falsified against an untouched schema to prove it bites. The published document
is clean across all 11 request-body operations, generation is byte-deterministic across
repeated runs, the drift check is green, and a freshly written `strict`-mode consumer probe —
with a negative control — compiles.
