# Evaluation: CONTRACT-009

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PARTIAL

Evaluated at `phase-3-ui` tip `4ea3e4b` (clean tree). All live traffic ran against a real
`corpus init` workspace on **127.0.0.1:8971** (pid 50994, stopped; port verified free).
Criteria: **9 own (TEST-43…51) + 12 shared (TEST-65…76) = 21**. **20 PASS, 1 FAIL.**

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Long, sectioned, with a dedicated *What was not verified here, and why* block and a measured blast-radius table. |
| Commands specific and concrete | PASS | Exit codes read from the tool (`TSC_NOEMIT_EXIT`, `BUILD_EXIT`, `ESLINT_EXIT`…), md5 hashes per generator run, verbatim `file:line` for every downstream break. |
| Real E2E (not mocked) | PARTIAL | The contract agent started **no server** — structurally impossible from its worktree (`apps/server` did not compile against the new contract until SERVER-023). Routes were exercised over real HTTP against a Hono app with the contract routes mounted the way `apps/server` mounts them. The genuinely-live half (multipart 201, 413 on both refusal paths) landed with SERVER-023 and **is confirmed live by this evaluation** — see TEST-49. |
| Scenarios cover acceptance criteria | PASS | All three ACs traceable: multipart variant + JSON untouched, 413 on both multipart routes with the union unchanged, artifacts regenerated and round-tripped. |
| Application restarted after changes | N/A → PASS at tip | No app to restart in `packages/contract`. This evaluator started a fresh daemon at the tip build and drove it with `curl`. |
| Actual model recorded (`implemented on:`) | PASS | `009-thread-multipart-rider.md:68` — **implemented on: opus**. |
| Reproduction logged before fix (bugs) | N/A | Feature/rider, not a bug. |

## Log Honesty Re-derivation

The log self-reports that an earlier pass **fabricated a green typecheck** through a
`timeout … | tail` pipeline that returned `tail`'s exit code. Every claim below was re-run.

| Claim in log | Re-derived? | Actual observation |
| --- | --- | --- |
| `tsc --noEmit` exit 0 for `packages/contract`; repo-wide typecheck otherwise honest | **CONFIRMED** | `npm run typecheck` at `4ea3e4b`: five workspaces + `scripts/`, **`TYPECHECK_EXIT=0`**. Exit code read from the process, not a pipe. The fabrication does **not** survive into the shipped state. |
| `vitest run packages/contract → 33 files / 881 tests passed` | **CONFIRMED** | `./node_modules/.bin/vitest run packages/contract` → `Test Files 33 passed (33)` / `Tests 881 passed (881)`, `VITEST_EXIT=0`. (Note: `npm test -w packages/contract` fails with `Missing script: "test"` — the workspace has no `test` script, exactly as the sprint contract states.) |
| `/api/threads post content: ['application/json','multipart/form-data'] (order significant)` | **CONFIRMED** | `openapi.json` → `list(requestBody.content.keys()) == ['application/json', 'multipart/form-data']`. |
| `/api/threads` responses `['201','400','401','404','413','423']`; `/api/capture` `['201','400','401','413']`; `/turns` `['201','400','401','404','413']` | **CONFIRMED** | Key-for-key identical, in that order, in `openapi.json`. |
| `MultipartCreateThreadRequest` publishes with **no `required` array**, and its `files` is byte-identical to capture's | **CONFIRMED** | `required` absent; `files` == `{"type":"array","items":{"type":"string","format":"binary"}}` with a description string identical to `CaptureRequest`'s and `MultipartAppendTurnRequest`'s. |
| request-body count **12**, unchanged by this issue (a media type is not a new body) | **CONFIRMED** | Independently counted 12 operations with a `requestBody` in `openapi.json`; the 12th is CONTRACT-007's form body, not this one. |
| `ERROR_CODES` unchanged (7 members); no `PayloadTooLargeError` component | **CONFIRMED** | `dist/schemas/error.js` → `['bad_request','unauthorized','forbidden','not_found','conflict','locked','internal_error']`, length 7. No `PayloadTooLargeError` among the 68 published components. |
| UI-008's byte string appears verbatim | **CONFIRMED** | `grep -F` on `![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)` → **2** occurrences in the issue file. |
| `docs/cli.md` byte-unchanged | **CONFIRMED** | `docs/cli.md` is not among the 51 files in `4ea3e4b`; drift check green. |
| `check-generated-artifacts.ts` reports `✗ API contract is stale` (working-tree-vs-HEAD, not idempotence) | **CONFIRMED, and now resolved** | At the tip the same script reports `✓ API contract is up to date` **twice in a row**, exit 0 both times — exactly the outcome the log predicted once the orchestrator committed. |
| Blast radius: `apps/server` 5 errors; `apps/cli`/`kit`/`ui` exit 0 | **NOT RE-DERIVABLE at tip** (server fix shipped in the same commit) — **corroborated** | SERVER-023's log independently measured the identical pre-state: *"exit 2, exactly five errors"* at `jobs/project.ts:85`, `queue/routes.ts:34`, `threads/routes.ts:47`, `:76`, `:84`. Two agents, same five sites. |
| TEST-49 `DEFERRED → SERVER-023`; interim 400 still shipping | **SUPERSEDED** | The flip landed in the same commit. 413 is live and verified below — the deferral is discharged, not outstanding. |

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| TEST-43 | Multipart variant mirroring capture | **PASS** | Both media types declared; `files` part shape and name (`files`) byte-identical to `CaptureRequest`'s. |
| TEST-44 | JSON form untouched | **PASS** | Live: `POST /api/threads` `{"body":"Why 6.1%? (json branch)"}` → **201**, `{thread, anchorId:null, eventId:null, warnings:[]}`. `CreateThreadRequest` component unchanged in the `openapi.json` diff (only route/body *descriptions* were extended). |
| TEST-45 | Dual-media invariant extended, not broken | **PASS** | Test diff shows a **new** sibling `it("offers both a JSON and a multipart body on thread creation, in the same order")` asserting `toEqual(["application/json","multipart/form-data"])`; the turn-append assertion is untouched; `"types the attached files as an array of binaries"` grew from 2 names to 3 (added `MultipartCreateThreadRequest`), nothing removed. |
| TEST-46 | Mandatory-body table honest | **PASS** | `toHaveLength(11)` → `toHaveLength(12)` (an updated pinned literal, allowed); `POST /api/threads` still `required: true`; multipart list grew to `[capture, threads, threads/{id}/turns]`; `RULE_EXEMPTIONS` still `{}` (`openapi.test.ts:956`, asserted at `:1062`). Live: a multipart body with neither `text` nor `files` → **400** `form.text: "A thread's first turn needs \`text\`, at least one file, or both."` |
| TEST-47 | 413 on both multipart upload routes | **PASS** | Declared on **all three** file-accepting routes and nowhere else, asserted bidirectionally by a new invariant `"declares 413 on exactly the routes that accept file uploads"`. |
| TEST-48 | Error union closed and coherent | **PASS** | 413's body is `ValidationError`/`bad_request` — no union change. Reasoning recorded in the Technical Design (status code carries the distinction; an eighth member would touch every narrowing site). A new assertion pins `not.toContain("PayloadTooLargeError")`. |
| TEST-49 | 413 reachable, not decorative | **PASS** | Live at default caps on 8971. **Post-parse** (real 27,000,000-byte file, per-file cap 25 MB): `POST /api/threads` → **413**, `/api/capture` → **413**, `/api/threads/{id}/turns` → **413**, body `{"code":"bad_request","message":"attachment over-file.bin is 27000000 bytes, over the per-file limit of 26214400 bytes (25 MB)","issues":[{"path":"files",…}]}`. **Pre-parse** (5×21,000,000 B = 105,000,000 B, request cap 100 MB): all three routes → **413** in `0.012 s` (body never consumed), `"the upload totals 105000962 bytes, over the per-request limit of 104857600 bytes (100 MB)"`. Commit count unchanged (5 → 5) across all six refusals. |
| TEST-50 | Interim-400 comment retired with the behavior | **PASS** | `grep -c` for `"CONTRACT rider"` / `"follows in the CONTRACT"` in `apps/server/src/attachments/limits.ts` → **0**, and the observed behavior is 413. No stale promise left. |
| TEST-51 | UI-008 reference format restated verbatim | **PASS** | Exact string present (2×). Independently corroborated live: a real multipart create produced `![e008-shot.png](attachments/th_hu56liyz/2026-07-28T00%3A07%3A06Z/e008-shot.png)` — same shape, colons percent-encoded, display text human-readable. |
| TEST-65 | Generation idempotent, twice | **PASS** | `node --import tsx scripts/check-generated-artifacts.ts` run twice back to back: `✓ API contract is up to date (…openapi.json, …schema.generated.ts)` / `✓ CLI reference is up to date (docs/cli.md)`, `RUN1_EXIT=0`, `RUN2_EXIT=0`; working tree clean afterwards. |
| TEST-66 | New routes/fields reachable through the typed client | **PASS** | A probe compiled against `@corpus/contract/client` with `strict` typechecks clean (`PROBE_TSC_EXIT=0`) for `POST /api/threads/{id}/turns/{ts}/form`, `FormAnswerResponse`, `ThreadMutationResponse`, `ReapStaleResult.failed`, `Job.originTitle`, `MultipartCreateThreadRequest`. Negative control: renaming the form path to `/nope` produces `TS2345 … not assignable to PathsWithMethod<FetchPaths,"post">`, so the probe is meaningful. |
| TEST-67 | `docs/cli.md` unaffected or regenerated | **PASS** | Not in the commit; check green. |
| TEST-68 | Full suite passes in `packages/contract` | **PASS** | **33 files / 881 tests**, up from the sprint's 31/763 baseline. No skips reported. |
| TEST-69 | No invariant weakened | **PASS** | Full raw diff of `packages/contract/src/**/*.test.ts` + `src/openapi.test.ts` inspected. 15+2 deleted lines total, every one a replacement: stub handlers rewired to `mountCreateThread`/the new wrappers; `toHaveLength(11)`→`(12)`; `["MultipartAppendTurnRequest","CaptureRequest"]`→ the same list **plus** `MultipartCreateThreadRequest`; `it("rejects an id that is not an event id")` replaced by an `it.each(["reaped","failed"])` covering **both** fields (strictly stronger). No `expect` loosened, no assertion dropped, **no `RULE_EXEMPTIONS` entry added** — it is still `{}`. |
| TEST-70 | Blast radius measured and reported | **PASS** *(with one note)* | Five errors captured verbatim with `file:line` and each routed to SERVER-023/CLI-008, plus the **non-compiling** hazard (`threads/routes.ts:41` must become `mountCreateThread`) which the type system cannot catch. Typecheck re-run by this evaluator at the tip: **`TYPECHECK_EXIT=0`** across all workspaces. Note: the criterion text names `queue/routes.ts:35`; both the contract agent and SERVER-023 independently measured `:34`. The sprint's line number was the estimate; the measurement is the record. |
| TEST-71 | CLI printed shape change surfaced | **PASS** | Log names `apps/cli/src/commands/thread/status.ts:33`, states `corpus thread resolve/reopen --json` now emits `{thread, warnings}`, flags the now-wrong help text (*"One JSON value: the thread summary"*), assigns it to CLI-008 (Open Conflict 6), and says `docs/cli.md` must be regenerated with the corrected description. |
| TEST-72 | Server flip filed as an issue | **PASS** | `issues/server/023-contract-rider-consumption.md` exists and appears in `issues/PLAN.md:102`. *(Bookkeeping nit, not a criterion: PLAN.md still says `in_progress` while the issue file says `done`.)* |
| TEST-73 | No route lost a status it can still return | **PASS** | `POST /api/threads` keeps `404` **and** `423` alongside the new `413`. No status removed anywhere in the `openapi.json` diff. |
| TEST-74 | SSE description untouched | **PASS** | The `openapi.json` diff contains **zero** matches for `events`/`query-key`; `/events`'s description still enumerates **nine** query-key shapes. |
| TEST-75 | Actor discipline unchanged | **PASS** | `POST /api/threads` declares the optional `x-corpus-author` header; `MultipartCreateThreadRequest`'s parts are `[parent, selector, title, text, requestsAgent, files]` — no `author`/`actor`/`from`. Live 401 without a token confirms auth still applies to the multipart branch. |
| TEST-76 | The two issues' commits are separable | **FAIL** | See FAIL-1. |

## Failures

### FAIL-1: the sprint's two contract issues (plus a server issue) landed as one commit

- **Criterion**: TEST-76 — *"The work lands as TWO commits, `[CONTRACT-009]` and `[CONTRACT-007]`, each with the artifacts regenerated and the drift check green at that commit. One mixed commit makes a later revert of either impossible and is a fail."*
- **Expected**: two commits, `[CONTRACT-009]` and `[CONTRACT-007]`, each independently revertable with green artifacts.
- **Observed**: a single commit `4ea3e4b` subject
  `[CONTRACT-007][CONTRACT-009][SERVER-023] Forms surface, multipart threads, rider consumption`,
  51 files / 3635 insertions / 336 deletions, mixing both contract issues **and** the server
  consumption issue **and** a SPEC.md amendment **and** a newly filed `issues/server/025-…`.
  Neither contract issue can now be reverted without reverting the other or the server.
- **Steps to reproduce**:
  ```
  git log --oneline abb6b48..4ea3e4b
  # 4ea3e4b [CONTRACT-007][CONTRACT-009][SERVER-023] Forms surface, multipart thr...
  # 4c3f3af [UI-002] ...
  git show --stat 4ea3e4b | tail -1
  # 51 files changed, 3635 insertions(+), 336 deletions(-)
  ```
- **Mitigating context (not a waiver)**: the coupling was foreseen and adjudicated — SERVER-023's
  own header says it *"lands with the same commit as the contract changes — the riders break the
  server compile until consumed"*, and the sprint's Open Conflicts 5–7 cover the sequencing. The
  criterion asked for CONTRACT-009 and CONTRACT-007 to be separable **from each other**, which was
  achievable (the agent even records a CONTRACT-007-only green checkpoint at 32 files / 844 tests)
  and was not done. Recording as a FAIL per the criterion's explicit text; whether the coupling to
  SERVER-023 is waived is the orchestrator's call, not this evaluator's.

## Summary

The wire change itself is solid and independently verified end to end. `POST /api/threads` is
genuinely dual-media with capture's exact file-part shape and the JSON branch semantically
untouched (201 observed live, with the `mountCreateThread` runtime hazard the log warned about
demonstrably avoided). 413 is declared on exactly the three file-accepting routes, reuses the
closed `bad_request` union, and — the deferral in the log notwithstanding — is **live at the tip**:
real 413s observed on all three routes on both the pre-parse `Content-Length` path (rejected in
12 ms, body never read) and the post-parse path, with no commit and no attachment directory left
behind. Artifacts are idempotent (drift check green twice), the suite is 33/881, and no invariant
was weakened anywhere in the test diff.

On the honesty question the answer is clean: the log's own confession about a `timeout … | tail`
pipeline masking `tsc` is the only fabrication, it was self-caught and corrected, and the shipped
state survives an independent `npm run typecheck` at **exit 0** across all five workspaces. Every
other sampled claim — test counts, media-type ordering, response-code sets, the byte-identical
`files` shape, the 12-body count, the 7-member error union, the verbatim UI-008 string — re-derived
exactly. Two claims are *superseded* rather than wrong: the TEST-49 deferral and the "artifacts
stale" note both resolved when the orchestrator committed.

The single failure is process, not behavior: TEST-76's two-commit requirement was not met, and the
mixed commit also swallows SERVER-023, a SPEC.md amendment and an unrelated new issue file.
Everything else passes.

> **Orchestrator adjudication (2026-07-27): TEST-76 WAIVED.** The criterion demands separable `[CONTRACT-007]` / `[CONTRACT-009]` commits; the coupled commit was deliberate. Rationale: the two issues share one regenerated artifact set (unsplittable), the riders break `apps/server` compilation (a standalone contract commit fails the pre-commit gate — the repo's green-unit rule and Open Conflict 5's "never sits red" demand both forbid it), and the phase lands on `main` as one squash commit, so intra-branch revertability of either issue alone is not a shipped property. The tension between TEST-76 and Open Conflict 5 is resolved in favor of the green unit, consistent with the `[CONTRACT-005][SERVER-015]` precedent. Verdict effectively PASS-with-waiver.
