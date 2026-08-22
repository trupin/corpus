# Evaluation: CONTRACT-007

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PARTIAL

Evaluated at `phase-3-ui` tip `4ea3e4b` (clean tree). All live traffic ran against a real
`corpus init` workspace on **127.0.0.1:8971** (pid 50994, stopped; port verified free).
Criteria: **13 own (TEST-52…64) + 12 shared (TEST-65…76) = 25**.
**21 PASS, 3 DEFERRED → SERVER-016, 1 FAIL.**

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Includes a pre-state section, per-rider observed wire output, a standing-invariants table, and an explicit *Deferred, with the reason and the substitute evidence* block. |
| Commands specific and concrete | PASS | Named test files, quoted request/response bodies including the exact validation message, exact counts (`CARRIERS` 7→9, bodies 11→12), exact `file:line` for downstream breaks. |
| Real E2E (not mocked) | PARTIAL | The contract agent started **no server** (`apps/server` did not compile against the new contract from its worktree). The forms surface was exercised over real HTTP against a Hono app with the contract's own routes mounted — the same registration `apps/server` performs. The three riders' live half landed with SERVER-023 and **is confirmed live by this evaluation** (TEST-60/62/64 below). |
| Scenarios cover acceptance criteria | PASS | All five ACs traceable: warnings rider, `failed` rider, `originTitle` rider, form-answer schemas + route + `form.respond` payload, artifacts. |
| Application restarted after changes | N/A → PASS at tip | No app in `packages/contract`. This evaluator started a fresh daemon on the tip build and drove it with `curl`. |
| Actual model recorded (`implemented on:`) | PASS | `007-forms-surface.md:76` — **implemented on: opus**. |
| Reproduction logged before fix (bugs) | N/A → done anyway | Not a bug, but the log records the measured pre-state (no `Form*` component, no form path, `ReapStaleResult.required == ["reaped"]`, six-field `Job`, bare `ThreadSummary` on resolve/reopen). |

## Log Honesty Re-derivation

The sibling issue (CONTRACT-009) self-reports a **fabricated green typecheck** from a
`timeout … | tail` pipeline. Both logs are treated as suspect; every claim below was re-run.

| Claim in log | Re-derived? | Actual observation |
| --- | --- | --- |
| `vitest run packages/contract` → `33 passed (33)` / `881 passed (881)` | **CONFIRMED** | Exactly `Test Files 33 passed (33)` / `Tests 881 passed (881)`, `VITEST_EXIT=0`. |
| `tsc --noEmit` exit 0 for `packages/contract`; the rest honest | **CONFIRMED** | `npm run typecheck` at `4ea3e4b` → **`TYPECHECK_EXIT=0`**, five workspaces + `scripts/`, exit code read from the process. The one fabricated claim in this pair does not survive into the shipped state. |
| Rejecting an unoffered option gives `{"code":"bad_request","issues":[{"path":"body.option","message":"\`5.0%\` is not one of this form's options: \`6.1%\`, \`6.4%\`."}]}` | **CONFIRMED byte-for-byte** | Exercised the shipped `validateFormAnswer` from `dist/schemas/form.js` with `form = {prompt, options:["6.1%","6.4%"]}`: the returned object is exactly that, `path` included. `{option:"6.4%"}` and `{option:"6.1%", note:"matches Q2"}` both return `undefined` (accepted). |
| Fence matched **whole**: `` ```form `` matches; `formula` / `form-builder` / `formatting` / `yaml` / bare ` ``` ` do not | **CONFIRMED** | `FORM_FENCE_PATTERN.test()` → `true, false, false, false, false, false` in that order. `extractFormSource` returns `"prompt: Which?\noptions: [a, b]"` from a turn body. |
| `resolve` → `{"thread":{…,"status":"resolved"},"warnings":[{"code":"commit_failed",…}]}` | **CONFIRMED LIVE** | With a real `.git/hooks/pre-commit` exiting 1: `POST /api/threads/th_cqhyhms3/resolve` → **200** `…,"warnings":[{"code":"commit_failed","detail":"git commit --amend failed: doc check: refusing"}]`. `reopen` → `"git commit failed: doc check: refusing"`. Commit count unchanged 5 → 5 (the write stands, the drift surfaces). |
| `POST /api/queue/reap-stale` → `{"reaped":[…],"failed":[…]}`, arrays disjoint, both required | **CONFIRMED LIVE** | Clean workspace → `{"reaped":[],"failed":[]}`. A claimed event backdated to 2020 with `attempts: 3` → `{"reaped":[],"failed":["evt_ybpxlfkoish7"]}`, the file moved to `.corpus/queue/failed/`, `in-progress/` and `pending/` empty. |
| `GET /api/jobs` row carries `originTitle`; `Job.required` = the seven fields | **CONFIRMED LIVE + artifact** | `{"eventId":"evt_ybpxlfkoish7",…,"originId":"th_hu56liyz","originTitle":"Is this still right? @agent"}` — matching the thread's own title. `openapi.json` `Job.required == [eventId,status,started,updated,lastLine,originId,originTitle]`, `originTitle: {"type":["string","null"]}`. |
| `CARRIERS` 7 → 9; `ThreadSummary` itself unchanged | **CONFIRMED** | Exactly 9 components publish a `warnings` array, the two new ones being `ThreadMutationResponse` and `FormAnswerResponse`; `ThreadSummary.properties` has no `warnings` and its `required` list is the same 11 fields. |
| request-body count 11 → **12** | **CONFIRMED** | Independently counted 12 operations with a `requestBody` in `openapi.json`; the added one is `POST /api/threads/{id}/turns/{ts}/form`. |
| `parseFormRespondPayload` narrows `form.respond` and returns `undefined` for `comment.created`, `todos.moved`, and a mismatched payload | **CONFIRMED** | All four cases reproduce exactly; `FormRespondPayloadSchema` round-trips `{threadId, formTs, option, note:null}`, rejects a `doc_*` id and an **omitted** (rather than null) note. |
| `QueueEventSchema.payload` stays open (`z.record(z.string(), z.unknown())`) | **CONFIRMED** | `openapi.json` `QueueEvent.payload` is `{"type":"object","additionalProperties":{}}`; only its description changed. |
| TEST-64 `DEFERRED → SERVER-023` (server does not populate the title) | **SUPERSEDED** | The server populates it live, in the same commit. TEST-64's **first** branch shipped, not the schema-valid-because-nullable branch. |
| TEST-52's SPEC.md §6 amendment *"Not drafted here: `packages/contract` does not edit SPEC.md"* | **SUPERSEDED** | The amendment **did land in the same commit** (`SPEC.md` §6 and §7, +4/-4). The log statement was true of the contract agent's own worktree and is stale relative to the shipped commit. |

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| TEST-52 | Form fence grammar pinned, with a SPEC §6 amendment | **PASS** | Grammar written down in the Technical Design **and** shipped as a SPEC.md amendment in the same commit. §6 now pins: info string matched **whole** (`` ```formula `` / `` ```form-builder `` are ordinary code blocks); YAML carries `prompt` (non-empty) and `options` (≥1, each non-empty, all distinct); *"A form has no identity of its own: it is identified by the timestamp of the turn carrying it, so a turn carries **at most one form**"*; **single-select**; optional free-text note separate from the option. §7 gains the payload: `form.respond` … *"payload `{threadId, formTs, option, note\|null}`"*. Every item TEST-52 enumerates is covered. *(Its own text holds the amendment for user sign-off at the phase PR — that gate is still open and is the orchestrator's, not a defect here.)* |
| TEST-53 | Request schema validates against the fence it answers | **PASS** | Re-derived against the shipped `validateFormAnswer`: option `"C"` not in `[A,B]` → `bad_request` with a **non-empty** `issues` array naming `body.option`; option `"A"` accepted. `FormAnswerRequestSchema` also rejects `{note:"hmm"}` (no option) and `{option:""}`. This is fence-driven, not a static enum. |
| TEST-54 | Submission route declared and inventoried | **PASS** | `POST /api/threads/{id}/turns/{ts}/form` present in `openapi.json`; `src/routes/inventory.ts` gained exactly one line in the same commit; the standing invariant *"declares exactly the endpoints the pinned inventory names"* passes in the 881-test run — so the document and the inventory agree by assertion, not by coincidence. Summary present: *"Answer the form in an agent turn"*. |
| TEST-55 | Obeys every standing response invariant | **PASS** | Responses `['201','400','401','404']` — declares 401, declares 400, declares **no** 500 (verified: **zero** operations in the whole document declare 500). Optional `x-corpus-author` header present. `FormAnswerRequest.properties == {option, note}` — no acting party in the body. Live: request without a token → **401** `{"code":"unauthorized",…}`. |
| TEST-56 | An answer appends a real turn on disk | **DEFERRED → SERVER-016** | No handler exists; live `POST …/form` → **404** `{"code":"not_found","message":"no route matches POST /api/threads/th_hu56liyz/turns/…/form"}`. Expected per the sprint's scope adjudication (SERVER-016 out of scope). Contract-level substitute verified: route, both schemas, and the fence-driven validator all exercised. |
| TEST-57 | Exactly one `form.respond` event enqueued | **DEFERRED → SERVER-016** | Same reason. `FormRespondPayloadSchema` round-trip and `parseFormRespondPayload` narrowing verified directly instead. |
| TEST-58 | `form.respond` payload shape pinned in the contract | **PASS** | `FormRespondPayloadSchema` exported from `@corpus/contract` (`dist/schemas/form.d.ts:131`), naming `{threadId, formTs, option, note\|null}` — thread and answered form both unambiguous. Round-trip and four rejection cases reproduce. The mechanism and its reasoning are stated (declared **beside** `QueueEventSchema`, not as a union member, so §7's open `type: string` survives for plugins) and the openness is asserted: `QueueEvent.payload` is still `additionalProperties: {}`. |
| TEST-59 | Answered form leaves Attention; unanswered is in it | **DEFERRED → SERVER-016** | No handler, so the before/after cannot be observed. `GET /api/docs?needs=form` is live and answers **200** `{"items":[],…}`, so the detector endpoint exists and is queryable — only the state transition is unverifiable. |
| TEST-60 | `resolve`/`reopen` return their §11 warnings | **PASS** | Live, against a workspace whose `pre-commit` hook exits 1: both verbs → **200** with a **non-empty** `warnings` array (`commit_failed`, detail carrying the hook's stderr), thread status changed on disk, commit count unchanged. Discharged on the real server, not only in the stub. |
| TEST-61 | Warnings ride a wrapper, not the resource | **PASS** | New component `ThreadMutationResponse {thread, warnings}` mirroring `DocMutationResponse {doc, warnings}`; `ThreadSummary` byte-unchanged (no `warnings` property, same 11 required fields); both new components added to `CARRIERS` (7→9) in the same change; the *"no other component carrying a differently-shaped warnings field"* sweep still passes. |
| TEST-62 | `ReapStaleResult` gains `failed` | **PASS** | Schema: `required: ["reaped","failed"]`, both `evt_*`-patterned string arrays. Round-trip tests added (and the old single-field rejection test **strengthened** into an `it.each` over both fields). Live: an event past the attempt cap → `{"reaped":[],"failed":["evt_ybpxlfkoish7"]}` — in `failed`, **not** in `reaped`, and moved to `.corpus/queue/failed/`. |
| TEST-63 | `Job` gains a nullable origin title | **PASS** | `Job` still publishes as a plain, non-nullable, undefaulted object; `originTitle: {"type":["string","null"]}`. The rule is written in one sentence, in the schema description itself: *"**The current title of whatever `originId` names, or null.** Null exactly when `originId` is null, or when the document it names no longer exists."* |
| TEST-64 | Field does not silently become required-and-unpopulated | **PASS** | Live `GET /api/jobs` → `"originId":"th_hu56liyz","originTitle":"Is this still right? @agent"` — the **first** branch: the server populates it, so this is stronger than the "optionality permits it" allowance. Response validates against its own declared schema. |
| TEST-65 | Generation idempotent, twice | **PASS** | `check-generated-artifacts.ts` run twice back to back: `✓ API contract is up to date` / `✓ CLI reference is up to date` both times, `RUN1_EXIT=0`, `RUN2_EXIT=0`, working tree clean afterwards. |
| TEST-66 | New routes/fields reachable through the typed client | **PASS** | A `strict` probe compiled against `@corpus/contract/client` typechecks clean (`PROBE_TSC_EXIT=0`) using `POST /api/threads/{id}/turns/{ts}/form`, `FormAnswerResponse`, `ThreadMutationResponse`, `ReapStaleResult.failed`, `Job.originTitle`. Negative control: mutating the path to `/nope` yields `TS2345 … not assignable to PathsWithMethod<FetchPaths,"post">`. |
| TEST-67 | `docs/cli.md` unaffected or regenerated | **PASS** | Not among the 51 files in `4ea3e4b`; drift check green. |
| TEST-68 | Full suite passes in `packages/contract` | **PASS** | **33 files / 881 tests** (baseline 31/763). Note `npm test -w packages/contract` errors with `Missing script: "test"` — as the sprint contract itself records, that workspace has no `test` script and the suite runs from the root. |
| TEST-69 | No invariant weakened | **PASS** | Raw diff of all `packages/contract/src/**/*.test.ts` plus `src/openapi.test.ts` read line by line. Every deletion is a replacement: stubs rewired to the new mount helpers/wrappers, `toHaveLength(11)`→`(12)`, the binaries list extended by one name, and `it("rejects an id that is not an event id")` replaced by `it.each(["reaped","failed"])` — strictly stronger. `CARRIERS` gained two entries; the mandatory partition gained one. **`RULE_EXEMPTIONS` is still `{}`** (`openapi.test.ts:956`, asserted `toEqual([])` at `:1062`). |
| TEST-70 | Blast radius measured and reported | **PASS** *(note)* | The consolidated table lives in CONTRACT-009's log and is cross-referenced here; this issue's four owned sites are named with `file:line` and error codes (`queue/routes.ts:34` TS2345, `threads/routes.ts:76`/`:84` TS2345, `jobs/project.ts:85` TS2741) plus the no-compile-error CLI site. Independently corroborated by SERVER-023's own pre-state measurement of the identical five sites. Typecheck re-run by this evaluator at the tip: **exit 0**. Note: the criterion names `queue/routes.ts:35`; two agents independently measured `:34`. |
| TEST-71 | CLI printed shape change surfaced | **PASS** | Recorded in both logs: `apps/cli/src/commands/thread/status.ts:33`, output shape becomes `{thread, warnings}`, the verb's help text is now wrong, CLI-008 owns it (Open Conflict 6), `docs/cli.md` to be regenerated with the corrected description. |
| TEST-72 | Server flip filed as an issue | **PASS** | `issues/server/023-contract-rider-consumption.md` exists and is listed in `issues/PLAN.md:102`. *(Nit: PLAN.md still shows `in_progress` while the issue file says `done`.)* |
| TEST-73 | No route lost a status it can still return | **PASS** | `POST /api/threads` keeps `404` and `423`; nothing removed anywhere in the `openapi.json` diff. |
| TEST-74 | SSE description untouched | **PASS** | Zero `events`/`query-key` matches in the `openapi.json` diff; `/events`'s description still enumerates **nine** query-key shapes. |
| TEST-75 | Actor discipline unchanged | **PASS** | Form route carries the optional `x-corpus-author` header and its body is `{option, note}` only; `MultipartCreateThreadRequest` is `{parent, selector, title, text, requestsAgent, files}` — no `author`/`actor`/`from` in either. |
| TEST-76 | The two issues' commits are separable | **FAIL** | See FAIL-1. |

## Failures

### FAIL-1: the sprint's two contract issues (plus a server issue) landed as one commit

- **Criterion**: TEST-76 — *"The work lands as TWO commits, `[CONTRACT-009]` and `[CONTRACT-007]`, each with the artifacts regenerated and the drift check green at that commit. One mixed commit makes a later revert of either impossible and is a fail."*
- **Expected**: two commits, `[CONTRACT-009]` and `[CONTRACT-007]`, each independently revertable with green artifacts.
- **Observed**: one commit `4ea3e4b`,
  `[CONTRACT-007][CONTRACT-009][SERVER-023] Forms surface, multipart threads, rider consumption`,
  51 files / 3635 insertions / 336 deletions — both contract issues, the server consumption issue,
  a SPEC.md §6/§7 amendment, and a newly filed `issues/server/025-boot-projection-invalidate.md`.
  Reverting the forms surface would also revert the multipart wire path and the server.
- **Steps to reproduce**:
  ```
  git log --oneline abb6b48..4ea3e4b
  # 4ea3e4b [CONTRACT-007][CONTRACT-009][SERVER-023] Forms surface, multipart thr...
  git show --stat 4ea3e4b | tail -1
  # 51 files changed, 3635 insertions(+), 336 deletions(-)
  ```
- **Mitigating context (not a waiver)**: the contract↔server coupling was adjudicated in advance
  (SERVER-023 *"lands with the same commit as the contract changes"*, Open Conflicts 5–7). But the
  criterion asked for CONTRACT-007 and CONTRACT-009 to be separable **from each other**, which the
  agent's own log shows was achievable — it records a CONTRACT-007-only green checkpoint at
  *32 files / 844 tests* with artifacts hashed `0ca72eba…` / `3938b034…* before CONTRACT-009's first
  line. That checkpoint was never committed. Recorded as a FAIL per the criterion's explicit text;
  waiving it is the orchestrator's call.

## Summary

The forms surface is real and well-pinned. The grammar is written down in one place, it shipped as
a SPEC.md §6 amendment in the same commit (contrary to the log's own "not drafted here" note, which
is stale rather than false), and the answer validator is genuinely fence-driven: re-running the
shipped `validateFormAnswer` reproduces the log's rejection message byte for byte, `path`
`body.option` included, and `FORM_FENCE_PATTERN` correctly refuses `formula`, `form-builder`,
`formatting`, `yaml` and a bare fence. `form.respond` is pinned as a named schema **beside**
`QueueEventSchema` with the reasoning recorded, and §7's open `type: string` is preserved and
asserted.

All three riders check out live, not just on paper. `resolve` and `reopen` return a real non-empty
`warnings` array against a workspace whose `pre-commit` hook rejects the auto-commit, with the write
standing and the commit count unchanged. A reap past the attempt cap returns the event in `failed`
and not in `reaped`, with the file in `.corpus/queue/failed/`. `GET /api/jobs` returns a **populated**
`originTitle` — TEST-64's stronger branch, not the nullable escape hatch. Warnings ride a new
`ThreadMutationResponse` wrapper with `ThreadSummary` untouched, exactly as TEST-61 demanded.

Honesty audit: clean. The only fabrication in this pair is the one the sibling issue confessed to
itself, and it does not survive — an independent `npm run typecheck` at the tip exits 0 across all
five workspaces, and every sampled count, literal, message string and schema shape re-derived
exactly. Two log statements are *superseded* rather than wrong (the TEST-64 deferral and the
SPEC-amendment note), both because the orchestrator's commit did more than the contract agent's
worktree could.

TEST-56/57/59 are legitimately deferred to SERVER-016 (the route 404s live, as expected for a
contract-only landing). The single genuine failure is TEST-76: the two issues were not landed as
separable commits, despite the agent having produced a CONTRACT-007-only green checkpoint that
could have been one.

> **Orchestrator adjudication (2026-07-27): TEST-76 WAIVED.** The criterion demands separable `[CONTRACT-007]` / `[CONTRACT-009]` commits; the coupled commit was deliberate. Rationale: the two issues share one regenerated artifact set (unsplittable), the riders break `apps/server` compilation (a standalone contract commit fails the pre-commit gate — the repo's green-unit rule and Open Conflict 5's "never sits red" demand both forbid it), and the phase lands on `main` as one squash commit, so intra-branch revertability of either issue alone is not a shipped property. The tension between TEST-76 and Open Conflict 5 is resolved in favor of the green unit, consistent with the `[CONTRACT-005][SERVER-015]` precedent. Verdict effectively PASS-with-waiver.
