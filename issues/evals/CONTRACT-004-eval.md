# Evaluation: CONTRACT-004 — Mandatory request bodies are typed optional

**Date**: 2026-07-27
**Sprint**: sprint-004
**Verdict**: **PASS** (8 of 8 criteria; one minor finding on a claim, not on behaviour)

Method: the **generated artifacts** (`packages/contract/openapi.json`,
`packages/contract/src/client/schema.generated.ts`) walked programmatically, and **real `tsc`
invocations** on fresh scratch probe files that import the published `@corpus/contract/client`
through the repo's real built output. No port bound anywhere, as the sprint requires. Every
temporary mutation was restored and the working tree verified clean (`git status --porcelain` → 0
lines) at the end.

> **Harness note.** A shell hook in this environment wraps bare `tsc` and **silently truncates its
> error list** — a probe that should report 5 errors reports 2. All `tsc` output below was captured
> unfiltered. Anyone re-verifying with plain `npx tsc` will get an incomplete picture.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Full, with the pre-fix compiling probe first.                                                                |
| Commands are specific and concrete      | PASS   | Named scratch prefix, verbatim `tsc` errors with line/column, artifact MD5s, a negative-control test run.     |
| Real E2E (not mocked)                   | PASS   | Real `tsc` against real built output; the runtime-400 half is honestly marked `DEFERRED → SERVER-005` with a stated substitute (the real route on a real `OpenAPIHono`), since `POST /api/docs` has no handler yet. |
| Scenarios cover acceptance criteria     | PASS   | All eleven bodies tabulated; both divergences from the sprint prose stated rather than smuggled.              |
| Application restarted after changes     | PASS   | `packages/contract` rebuilt before the post-fix probes, as the sprint demands.                               |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                      |
| Reproduction logged before fix          | PASS   | TEST-69's pre-fix probes compiled clean at `EXIT=0`; independently corroborated below.                        |

## Criteria Results

| #   | Criterion                                         | Result | Notes                                                                                                                                                          |
| --- | ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 69  | The gap reproduces at compile time before the fix | PASS   | `git show f965936:packages/contract/openapi.json`: **2 of 11** bodies carried an explicit `required` (`halt`, `fail`, both `false`); the other 9 were ABSENT. The pre-fix `schema.generated.ts` emitted `requestBody?:` for **all 11**, including `POST /api/docs`. At HEAD: **11 of 11** explicit, and exactly 5 are non-optional `requestBody:`. |
| 70  | Omitting a mandatory body is a compile error      | PASS   | My own probes, all five mandatory routes bare → `EXIT=2`, every error naming the missing body: `POST /api/docs`, `POST /api/capture`, `POST /api/threads` → `TS2554: Expected 2 arguments, but got 1`; `POST /api/docs/{id}/move` → `TS2345 … Property 'body' is missing … but required in type '{ body: { folder: string; } & {}; }'`; `POST /api/jobs/{id}/log` → same shape for `{ line: string; }`. The identical five **with** valid bodies compile clean (`EXIT=0`), so the probes are not passing on an unrelated type error. |
| 71  | The designed bare-`POST` routes still compile bare | PASS   | All six of `POST /api/queue/halt`, `POST /api/queue/{id}/fail`, `POST /api/threads/{id}/seen`, `POST /api/locks/{docId}`, `PUT /api/docs/{id}`, `POST /api/threads/{id}/turns` compile **bare** (`EXIT=0`) **and** with a body (`EXIT=0`). Every route not on that list fails to compile without one. 22/22 route-probes correct. |
| 72  | The class invariant is a test, not a review comment | PASS  | Negative control performed and restored: removing `required: true` from `POST /api/docs` and regenerating turned the suite red — `Tests 3 failed | 2371 passed`, failing `declares required explicitly on every one of them` (`expected [ 'POST /api/docs' ] to deeply equal []`), `declares required exactly as the schemas dictate`, and `partitions the surface…`. `tsc` also went red on the companion type probe (`TS1360`). Restored → green, tree clean. |
| 73  | Declared values match the adjudicated table       | PASS   | All **eleven** bodies tabulated independently and every row obeys the binding rule (`required: false` iff every field in the schema is optional), with one exempted row. Both divergences from the sprint's prose are correct under the issue's binding Sprint-004 Adjudication, which supersedes it: `PUT /api/docs/{id}` is `false` (all-optional schema), and turns is the exemption. All five genuinely bare-callable bodies document the bare call. |
| 74  | The multipart routes are covered too              | PASS   | `POST /api/capture` (multipart only) is `required: true`; `POST /api/threads/{id}/turns` declares both `application/json` and `multipart/form-data`. Both are walked by the same invariant — a dedicated test asserts the multipart set is exactly those two and that both declare `required` explicitly. No special-casing away. |
| 75  | Artifacts regenerated, byte-deterministic, drift-free | PASS | Generator run twice: `openapi.json` `0f927b4f15b29177301798cce6eb4605` and `schema.generated.ts` `a0f57b6b419b00451d231814bb231c7f` **unchanged across both runs and identical to the committed bytes** — `git status --short` stayed empty, so the committed bytes *are* the generated bytes. `scripts/check-generated-artifacts.ts` → **EXIT=0**, both halves green (the log's note that `diffAgainstHead` was red pre-commit is now closed, exactly as predicted). |
| 76  | Every consumer still typechecks                   | PASS   | `npm run build` EXIT=0, `npm run typecheck` EXIT=0 across all 5 workspaces. The claim that there are **no** mutating client call sites is confirmed: 0 `.POST(`/`.PUT(`/`.DELETE(`/`.PATCH(` in `apps/cli`, `apps/ui`, `apps/server`, `packages/kit`, `plugins`. Nothing was silently fixed or worked around. |

**Rider** (halt description): PASS. `haltQueue`'s description reads "…a second call may **replace,
add, or clear** the reason: a bare re-halt rewrites the sentinel without one", pinned by a test
(`expect(...).toContain("replace, add, or clear")`).

## The escalated exemption — independently confirmed as forced, not convenient

The orchestrator asked specifically whether the `RULE_EXEMPTIONS` entry for
`POST /api/threads/{id}/turns` bites. Two things were checked.

**1. The upstream defect is real.** Installed `@hono/zod-openapi@1.5.1`. An isolated fixture — a
route with two media types, exercised via `app.request()`, no port — gives:

| media types | `required` | JSON | multipart | bare |
| ----------- | ---------- | ---- | --------- | ---- |
| json + multipart | `true`  | 201 | **400** | 400 |
| json + multipart | `false` | 201 | 201 | 201 |
| json only        | `true`  | 201 | 400 | 400 |
| form only        | `true`  | 201 | 201 | 201 |

With two media types and `required: true`, both hard validators register, and the JSON schema's
`body` field is demanded of a multipart request. On the **real** route it is worse: `required: true`
gives JSON **400** *and* multipart **400** — it breaks both of the route's own forms, for the two
distinct reasons the issue names. The exemption is genuinely forced. **No unjustified deviation.**

**2. The test bites — in the direction it was built to.** Removing the entry from `RULE_EXEMPTIONS`
turns the suite red (`Tests 2 failed | 604 passed`: `declares required exactly as the schemas
dictate`, `keeps every exemption from the rule earned`). Setting the route to `required: true` and
regenerating turns it red harder (`Tests 9 failed | 597 passed`, including the 7 behavioural
failures the issue predicted in `routes/index.test.ts`, `client/upload.test.ts`,
`client/index.test.ts`). Both mutations restored; suite back to 606 passing, tree clean.

## FINDING-1 (minor, claim-accuracy — not a behavioural defect)

**What the log claims**: the exemption is pinned "with a test that fails if the exemption ever stops
being necessary".

**What is actually true**: `keeps every exemption from the rule earned` only asserts that the
*declared value still contradicts the rule*. Nothing in the suite exercises `@hono/zod-openapi`'s
behaviour. If upstream shipped a fix tomorrow, the suite would stay green with a now-unnecessary
exemption in place, and nobody would learn the workaround could be dropped.

This does not affect the shipped contract's correctness — every route declares the right value today,
and the compile probes prove it. It is a defect in the *claim about the test's reach*. The natural
guard is a fixture test asserting that a two-media-type `required: true` route still 400s the
multipart form — the exact fixture used above. Recommend either adding that guard or softening the
sentence in the issue file. Not a blocker.

## Summary

**8 of 8 criteria pass.** The class is genuinely closed: eleven of eleven request bodies now declare
`required` explicitly, the five mandatory ones are compile errors when omitted (proved with real
`tsc` output naming the missing argument, and with the same probes compiling clean once a body is
added), the six designed bare-POST routes compile both ways, the invariant test was shown to bite via
a real negative control, the artifacts are byte-deterministic and drift-free with the committed bytes
equal to the generated bytes, and every workspace typechecks with no consumer call site harmed. The
one exemption was independently reproduced against the upstream library and is forced rather than
chosen. The only finding is FINDING-1 — the exemption test does not watch upstream, so the log's
claim about it overstates its reach.
