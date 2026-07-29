# Evaluation: CONTRACT-008

**Date**: 2026-07-28
**Sprint**: sprint-012 (`issues/sprints/sprint-012.md`)
**Commit under test**: `fcb52cf [CONTRACT-008] Validation + skill-rollback routes (wire surface)`
**Verdict**: **PASS** (23/23 tests have a verdict: 23 PASS, 0 STRUCK, 0 DEFERRED)

Evaluator environment: stub `OPENAPIHono` app on `9081`, real server on `9080`, scratch
`/tmp/corpus-s012-eval-stub`. The implementing agent's scratch
`/tmp/corpus-s012-contract008-syNxga` was treated as a claimed-evidence source only.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test sections for TEST-52…74 plus three recorded escalations.                                                          |
| Commands are specific and concrete       | PASS   | Real curl transcripts with status codes, sha256 hashes of both generated artifacts, a ten-case client round-trip transcript. |
| Real E2E (not mocked)                    | PASS   | Real `corpus init` + real server (pid 76963) for the 404 before-state; **real route definitions** from built `dist/` on an `OPENAPIHono` + `@hono/node-server` on 9067, driven by the **generated** client over HTTP. Not a test client, not a mock. |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-52…74 addressed.                                                                                                |
| Application restarted after changes      | PASS   | TEST-73 captured **before any code was written** — the honest ordering. Stub listener closed and 9067 confirmed free.        |
| Actual model recorded (`implemented on:`)| PASS   | "implemented on: opus" — matches the issue's recommendation.                                                               |
| Reproduction logged before fix (bugs)    | N/A    | Feature issue, explicitly stated.                                                                                          |

**The one place the log could have cheated, it did not.** `scripts/check-generated-artifacts.ts`
compares against **HEAD**, so it could not go green before the orchestrator committed. Rather than
quietly skip TEST-67 or hand-edit the artifact, the agent recorded the red output verbatim,
explained precisely why (`555 insertions, 0 deletions` — nothing renamed or removed), and drove the
repo's own `checkGeneratedArtifacts` with only the `diffAgainstHead` half restated against a
pre-run snapshot. **I have now verified the prediction directly**: post-commit, the shipped script
is green on two consecutive runs.

---

## Honesty Audit — claims re-derived from scratch

| #  | Claim (log)                                                        | Re-derivation                                                                | Result       |
| -- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------ |
| 1  | `ENDPOINT_INVENTORY` gains **exactly two** entries; `+10 −2`       | `git diff fcb52cf^ fcb52cf -- inventory.ts` → 2 list entries + 1 blank + 7 docblock lines − 2 | EXACT |
| 2  | Two new resource files `routes/check.ts`, `routes/skills.ts`        | `git diff --stat`                                                            | EXACT        |
| 3  | Zero files under `apps/server`, `apps/cli`, `apps/ui`, `packages/kit`| `git diff --stat fcb52cf^ fcb52cf` → only `packages/contract/**` + the issue file | EXACT   |
| 4  | Server `CHECK_CODES` = contract enum, member for member, in order   | grepped the enum members out of `apps/server/src/core/check.ts` and compared to `openapi.json`'s `CheckFinding.code.enum` | EXACT (13/13, same order) |
| 5  | Warnings are exactly `anchor-unresolved` + `ref-unresolved`         | route/schema descriptions in the artifact + server's `warn()` helper          | CONFIRMED    |
| 6  | `POST /api/check` responses = `["200","400","401"]`                 | read from `openapi.json`                                                     | EXACT        |
| 7  | Rollback responses = `["200","400","401","404"]`                    | read from `openapi.json`                                                     | EXACT        |
| 8  | No route declares 500                                               | swept **every** path × method in the document                                | EXACT (none) |
| 9  | `/api/check` declares no header parameters at all                   | `paths["/api/check"].post.parameters` → `null`                               | EXACT        |
| 10 | Rollback carries `name` path param + `x-corpus-author` header       | read from `openapi.json`                                                     | EXACT        |
| 11 | Neither operation carries a `security` key (inherits `bearerAuth`)  | both `undefined`; doc-level `[{"bearerAuth":[]}]`                            | EXACT        |
| 12 | Request body is a two-member `anyOf`, both `additionalProperties:false` | read from the artifact                                                    | EXACT        |
| 13 | `CheckDocumentInput` = `{path(min 1), content}`, both required      | read from the artifact                                                       | EXACT        |
| 14 | `CheckFinding` = `{code, severity, docId: string\|null, path, detail}`, all required | read from the artifact                                       | EXACT        |
| 15 | `SkillRollbackResult.required = [name,docId,commit,path,warnings]`  | read from the artifact                                                       | EXACT        |
| 16 | `SkillRollbackRequest.properties = {to: string\|null, minLength 1}` | read from the artifact                                                       | EXACT        |
| 17 | 404 uses the shipped `NotFoundError` schema                         | `$ref: "#/components/schemas/NotFoundError"`                                 | EXACT        |
| 18 | Generation idempotent from a clean tree, twice                      | ran `npm run generate -w packages/contract` twice; `git status --porcelain packages/contract` empty both times | EXACT |
| 19 | The drift check turns green once committed                          | `node --import tsx scripts/check-generated-artifacts.ts` → exit 0, **twice** | CONFIRMED    |
| 20 | The drift check fails on a hand-edited route                        | I injected `DRIFT PROBE` into `routes/check.ts`'s summary → `✗ API contract is stale`, exit 1; reverted → green | CONFIRMED |
| 21 | XOR rejections (both / neither / unknown key) → 400 with the rule message | my own stub on 9081, via the generated client                          | EXACT (message identical) |
| 22 | Malformed id → 400 `Invalid string: must match pattern /^(doc\|th)_…/` | my own stub                                                              | EXACT        |
| 23 | `{ids:[]}` and `{documents:[]}` → 200 empty report                  | my own stub                                                                  | EXACT        |
| 24 | Unknown skill reaches the handler → 404 with the path param parsed  | my own stub: `No skill \`never-installed\` under .claude/skills/.`           | EXACT        |
| 25 | Wrong-cased skill name → 400 by the **param** schema                | my own stub: `Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/` | EXACT     |
| 26 | Typed narrowing: `code`/`severity` come back as closed enums        | my own stub, `r.data.errors[0].code` / `.severity`                           | CONFIRMED    |
| 27 | `@ts-expect-error` probes are the assertion                         | I made the `{ids: 3}` probe well-typed → `error TS2578: Unused '@ts-expect-error' directive.`; reverted → typecheck exit 0 | CONFIRMED |
| 28 | `packages/contract` suite: 38 files / 1167 tests                    | `vitest run packages/contract`                                               | EXACT        |
| 29 | `SPEC.md` unmodified; §9.2 names neither route                      | `git diff --stat fcb52cf^ fcb52cf -- SPEC.md` empty; `grep "api/check\|/api/skills" SPEC.md` → 0 | EXACT |
| 30 | The routes 404 on the real server (SERVER-019 before-state)         | my own server on 9080: `POST /api/check` → 404, `POST /api/skills/orchestrate/rollback` → 404, `GET /api/docs` → 200 with the same token | CONFIRMED |

**Overclaims found: none.** Every quoted artifact fragment matched the committed file, and every
runtime claim reproduced on my own ports.

**One immaterial difference**, recorded for completeness: my stub's `defaultHook` renders
`issues[].path` as `""` / `"ids.0"` where the log shows `"json"` / `"json.ids.0"`. That is my
harness's path-joining, not a contract difference — the *shape* (a single top-level issue for a
union failure, a field-level issue for a bad id) reproduced exactly.

---

## Criteria Results

### The declared surface

| #  | Criterion                                    | Result | Evidence                                                                                                                     |
| -- | -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 52 | Exactly two routes, inventory extended       | PASS   | `routes/check.ts` + `routes/skills.ts` (one file per resource); `checkDocuments`/`rollbackSkill` in `contractRoutes`; `ENDPOINT_INVENTORY` gains exactly the two entries. No other route added, renamed or removed. |
| 53 | Registration order preserved                 | PASS   | Both inserted after the `db` pair, before `streamEvents`. Neither competes with a `{param}` segment. `routes/index.test.ts`'s uniqueness/ordering assertions pass unchanged (inside the 1167). |
| 54 | The adjudicated paths                        | PASS   | `POST /api/check` and `POST /api/skills/{name}/rollback` — the skill rides the **path**, `{to?}` the body. Exactly **Adjudication 8**. |

### Validation route

| #  | Criterion                                       | Result | Evidence                                                                                                                  |
| -- | ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 55 | ids XOR pairs, enforced by the schema itself    | PASS   | The artifact carries a two-member `anyOf`, each branch `required` on its own key with `additionalProperties: false`. **Proven at runtime through the generated client**: both keys → 400, neither → 400, unknown key → 400, each with the XOR message. My stub handler never ran for these — the route's own validator did the work. |
| 56 | Pair shape reuses the validator's, field for field | PASS | `CheckDocumentInput = {path: string(min 1), content: string}` — exactly `toCheckDocument(path, raw)`'s argument list. SERVER-019's handler is the promised one-liner. |
| 57 | Empty collections are legal                     | PASS   | `{ids: []}` and `{documents: []}` both → 200 `{"ok":true,"errors":[],"warnings":[]}`, and the artifact documents "An empty array checks nothing and returns an empty report". Matches CLI-006's exit-0-silent. |
| 58 | Response separates errors from warnings, reusing `CheckReport` | PASS | `{ok, errors: CheckFinding[], warnings: CheckFinding[]}`; `Finding = {code, severity, docId: string\|null, path, detail}` — `CheckFinding`'s names verbatim. `ok` documented as "True exactly when `errors` is empty… (0, or 6 for a check-style failure)". |
| 59 | Code vocabulary matches exhaustively            | PASS   | I extracted both lists and compared: **13 members, identical, same order**. The description names the two warning codes and states "the other eleven are errors, `anchor-unused` among them". The contract cannot import the server's enum (dependency direction), so the transcription is pinned by a literal test — and the agent recommended the reciprocal assertion for SERVER-019, which **Adjudication 23** adopted. |
| 60 | Validation is read-only and says so             | PASS   | `parameters` is `null` — no actor header at all. Description: runs "the same validator every server mutation runs before writing — hooks and API share one implementation" (§14). |

### Skill-rollback route

| #  | Criterion                          | Result | Evidence                                                                                                                        |
| -- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 61 | Request and response shapes        | PASS   | Request `{to?: string \| null}` documented as "Omit it (or send null) to restore the last-known-good version". Response `{name, docId, commit, path, warnings}`; every field's meaning is in the description, including the sharp one — `commit` is "the new HEAD, not the ref the content came from" — and `docId` "never changes because ids are immutable (§5)". |
| 62 | 404 for an unknown skill, standard envelope | PASS | `"404": {$ref: NotFoundError}`; no new error shape. Condition stated ("no skill of that name is installed … archived is likewise not installed"). Proven at runtime: `never-installed` → 404. |
| 63 | Rollback is a mutation, carries the acting party | PASS | `x-corpus-author` header with `enum:["user","agent"], default:"user"` — the standard `ActorHeaderSchema`. Description: the revert "lands as a normal auto-commit". |
| 64 | Routes declare only the codes they can return | PASS | `["200","400","401"]` and `["200","400","401","404"]`. **I swept the entire document**: no operation anywhere declares 500. Neither declares a 409/423 it cannot produce, nor a 403. |

### Auth, artifacts, client

| #  | Criterion                                   | Result | Evidence                                                                                                                     |
| -- | ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 65 | Both require the workspace bearer token     | PASS   | Neither operation carries a `security` key, so both inherit the document-level `[{"bearerAuth":[]}]`. Neither joins the exempt three (`/api/health`, `/events`, `POST /api/jobs/{id}/log`). |
| 66 | Generation idempotent from a clean tree, twice | PASS | Ran twice; `git status --porcelain packages/contract` empty after **both**. |
| 67 | Drift check green twice, and demonstrably fires | PASS | Post-commit the **shipped** script is green on two consecutive runs (exit 0 both). I then hand-edited `routes/check.ts`'s summary without regenerating → `✗ API contract is stale`, exit 1; restored → green. Both halves demonstrated by me, not only by the agent. |
| 68 | `openapi.json` carries the declared shapes  | PASS   | Quoted from the committed artifact, not the source: both paths, the `anyOf` request, the 200 schemas, 400/401 on both, 404 on rollback. |
| 69 | Generated client exposes both, typed        | PASS   | `schema.generated.ts` carries both operations; the request body type is a real union. Naming convention honestly argued: the shipped surface is `client.api.<VERB>(path)` and hand-written methods exist only where `openapi-fetch` cannot serve (SSE, multipart), so a bespoke wrapper would *deviate*. **Compile-time enforcement proven load-bearing**: neutralising one `@ts-expect-error` probe produced `TS2578: Unused '@ts-expect-error' directive`. The honest limitation about `{ids:[], documents:[]}` being caught at runtime rather than compile time is recorded and is precisely what TEST-55 asks for. |
| 70 | Round-trip against a stub app, over real HTTP | PASS | **I rebuilt this check from scratch**: real `contractRoutes.checkDocuments`/`rollbackSkill` on an `OPENAPIHono` with a validation `defaultHook`, `@hono/node-server` on 9081, called by `createCorpusClient`. All ten cases reproduced — typed 200s that type-check, three XOR 400s and a field-level 400 produced by the route's validator with no handler running, a 404 proving the path param parsed and reached the handler, and typed narrowing on `code`/`severity`. Listener closed; 9081 free. |
| 71 | Zod round-trips per schema                  | PASS   | `schemas/check.test.ts` + `schemas/skill.test.ts` + `routes/{check,skills}.test.ts`. Whole workspace: **38 files / 1167 tests green** — matches the log exactly. |

### Scope discipline

| #  | Criterion                          | Result | Evidence                                                                                                                          |
| -- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 72 | No consumer changed                | PASS   | The commit touches `packages/contract/**` and the issue file only. Zero files under `apps/server`, `apps/cli`, `apps/ui`, `packages/kit`. **Adjudication 2 held.** `apps/server/src/core/check.ts` was read, never touched. |
| 73 | The server does not serve them yet | PASS   | **Reproduced on my own server (9080)**: `POST /api/check` → 404, `POST /api/skills/orchestrate/rollback` → 404, while `GET /api/health` and `GET /api/docs` → 200 with the same bearer token. Unambiguously "not mounted", not "not authorised". SERVER-019's before-state is on the record. |
| 74 | SPEC amendment drafted, not smuggled | PASS  | `SPEC.md` untouched by this commit; §9.2 names neither route (`grep` → 0). The amendment is drafted verbatim in the log for the phase PR, and `inventory.ts`'s docblock records that these two entries come from §14 and §7 rather than §9.2 with the amendment pending — so the gap is documented at the one place that would otherwise read as an unexplained extra. |

---

## Failures

None.

## Escalations carried forward (already adjudicated)

1. **No whole-workspace check request** — the route is `{ids}` XOR `{documents}` with "neither"
   rejected, so a bare `corpus doc check` has no direct wire form. **Adjudication 22** rules
   enumerate-then-post (CLI-006 paginates `GET /api/docs`, then posts `{ids}`); no third branch is
   added. The route description already states the design positively.
2. **Unknown ids are silent** — no "unknown id" member in the closed thirteen-code enum, and
   TEST-64 forbids a 404 here. **Adjudication 23** routes this to the SERVER-019 brief; the
   description says so and points callers at `GET /api/docs/{id}`.
3. **Union rejections are one top-level issue**, not field-level — a Zod property. The schema
   supplies the explanatory message rather than Zod's default `Invalid input`. SERVER-019 *may*
   unfold union sub-issues; not required. Also part of Adjudication 23's brief.

Existing contract invariants were **extended rather than weakened**, each with its reason recorded:
`/api/check` exempted from the mutating-actor-header rule via a named `READ_ONLY_POSTS` set (with
TEST-60 asserting the absence positively); `SkillRollbackResult` added to the §14 warning
`CARRIERS` while `CheckReport` joins a new `FOREIGN_WARNINGS` set with a positive test that its
`warnings` is a `CheckFinding[]`; and "uses no branching schema" became "names every branching
request body", pinned to exactly `POST /api/check: anyOf`. I checked each of these survives — the
whole suite is green and the no-500 and only-declarable-codes invariants still hold document-wide.

## Summary

**23 of 23 criteria PASS. No FAILs, no strikes, no deferrals.**

This is the cleanest of the three issues, and it earns that on the two things the contract said
mattered most. First, the vocabulary is genuinely the validator's: I extracted `CHECK_CODES` from
`apps/server/src/core/check.ts` and the enum from the committed `openapi.json` and compared them
member by member — thirteen, identical, in the same order, with the same two warnings — so
SERVER-019's handler really is `documents.map(d => toCheckDocument(d.path, d.content))` and not a
translation layer. Second, the XOR lives in the schema and not in an imagined handler: I stood up
my own stub with the real route definitions and watched three malformed bodies get rejected with
the rule's own message before any handler ran.

The scope discipline is absolute — not one byte outside `packages/contract` — and the SERVER-019
before-state is recorded against a real server on my own port. The one criterion the implementing
agent could not turn green in its worktree (the drift check, which compares against HEAD) it
handled by predicting the post-commit result and showing its work rather than skipping or faking
it; I confirmed the prediction, twice, and then made the check fail on demand.
