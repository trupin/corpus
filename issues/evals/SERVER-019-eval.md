# Evaluation: SERVER-019

**Date**: 2026-07-28 (round 1: FAIL · re-verification round 1: **PASS**)
**Sprint**: sprint-013 (commit `7ca18a1`; fix commit `394c42d`, branch `phase-4-agent-loop`)
**Verdict**: **PASS** (30 of 30 numbered criteria + cross-issue TEST-160)

> **Round 1 was FAIL** on TEST-6 — a whole-corpus rule (`anchor-unused`) was applied to document
> subsets without the seam it needed, so `/api/check` rejected documents the write path accepts.
> Fixed in `394c42d` (`anchorClaimants` seam) and re-verified from scratch; see
> **Re-verification round 1** at the end of this file. FAIL-1 is retained below as the historical
> record of what was found and how it was reproduced.

Evaluator ports `9120`–`9129`, scratch prefix `/tmp/corpus-s013-eval-`. All evidence below was
produced by driving a real `corpus init` workspace with a real server (`9122`, `9123`) via real
`curl` and the from-source CLI (`node --import tsx apps/cli/src/bin/corpus.ts`). No implementation
source was read to judge behaviour; structural claims that can only be settled by reading code are
marked `DEFERRED → source review` with the observable substitute recorded.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                             |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, per-test, with real ids, shas, HTTP codes and SSE frames.                                                 |
| Commands are specific and concrete      | PASS   | Exact `curl` bodies, `git log` output, file diffs, response payloads.                                             |
| Real E2E (not mocked)                   | PASS   | Real workspace `/tmp/corpus-s013-server019-tt3ynC`, real server on `9092`, real git repo, real SSE stream.        |
| Scenarios cover acceptance criteria     | PASS   | Every TEST-1…30 is addressed except TEST-25/26 (design-note only) — see per-test table.                           |
| Application restarted after changes     | PASS   | Log records a restart (pid 70489 → 78196) and live re-checks without restart where that is the point (TEST-11).   |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (server-dev, worktree `agent-a3469e72b770110e6`)".                                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. The 404 before-state is quoted from CONTRACT-008's evaluator run on `9080`.                        |

The log is unusually honest: it volunteers a correction to TEST-19's own wording (skill ids are
declared, not synthetic, for the shipped template), names `{ids}` cannot report `duplicate-id`, and
names nested skills as an unfixed limitation. Nothing in it was found to be overstated — see the
honesty-audit table.

## Criteria Results

| #   | Criterion                                        | Result                          | Notes                                                                                                                                              |
| --- | ------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/api/check` is served                           | PASS                            | `POST :9122/api/check {"ids":[]}` → `200 {"ok":true,"errors":[],"warnings":[]}` (was 404 pre-CONTRACT-008-handler).                                 |
| 2   | Rollback is served                               | PASS                            | `POST /api/skills/orchestrate/rollback` → `404` carrying the **handler's** message ("no earlier committed version…"), not `no route matches`.       |
| 3   | Mount placement follows the convention           | DEFERRED → source review        | Substitute: both routes answer only with a projection present; `mountPluginRoutes` still works (`/api/x/_fixture/notes` → 200) so core mounts precede it. |
| 4   | Registration touches no other route              | PASS                            | `git show --stat 7ca18a1`: 17 files, all `apps/server/**` + the issue file. Zero under `packages/contract`.                                          |
| 5   | Unauthenticated requests refused                 | PASS                            | Both routes → `401 unauthorized` with the standard envelope.                                                                                       |
| 6   | One validator, injected like the write path      | **PASS** (round 1 FAIL → fixed in `394c42d`) | The seams are shared (`checkSeams`, one definition, two call sites). Round 1 failed because a whole-corpus rule (`anchor-unused`) was evaluated against subsets with no seam, so the check rejected what the write path accepts (**FAIL-1**). A third seam `anchorClaimants(docId, anchorId) → ids` now answers it against the live corpus unioned with the request; re-verified from scratch — see Re-verification round 1. |
| 7   | Whole-corpus rules NOT filtered to LOCAL codes   | PASS                            | Two pairs sharing `id: doc_dupe01` → `ok:false`, `duplicate-id`, "id `doc_dupe01` is also used by data/docs/one.md".                                |
| 8   | A drifted corpus is a 200, not a throw           | PASS                            | `HTTP/1.1 200 OK` with non-empty `errors` on every drifted request (duplicate-id, frontmatter-unparseable, anchor-unused).                          |
| 9   | `ok` is derived, exactly `errors.length === 0`   | PASS                            | Held on every response observed, including warning-only (`ok:true` with a non-empty `warnings`).                                                    |
| 10  | Warnings are exactly the two §14 carve-outs      | PASS                            | Observed `ref-unresolved` and `anchor-unresolved` only ever in `warnings`; never in `errors`; no other code ever in `warnings`.                     |
| 11  | `{ids}` resolves via projection, reads real file | PASS                            | `doc_h36zalhe` clean; body rewritten **on disk**; next check (no restart) returned `ref-unresolved` at the real path with the real `docId`.         |
| 12  | `{documents}` validates without touching disk    | PASS                            | `data/docs/nope.md` → `200` + `frontmatter-unparseable`; `ls` still fails; `git status --porcelain` byte-identical.                                  |
| 13  | Unknown ids are silent                           | PASS                            | `{"ids":["doc_zzzzzz"]}` → `200 {"ok":true,"errors":[],"warnings":[]}`. No 404, no synthetic finding.                                                |
| 14  | Empty collections are legal                      | PASS                            | Both `{"ids":[]}` and `{"documents":[]}` → `200 {"ok":true,…}`.                                                                                     |
| 15  | XOR rejected by the schema before the handler    | PASS                            | `{"ids":[],"documents":[]}`, `{}`, `{"foo":1}` each → `400`, one issue at path `json` carrying `CHECK_REQUEST_XOR_MESSAGE`. Handler-never-ran is pinned by the agent's counting-handler unit test (re-run green). |
| 16  | Rollback restores previous bytes, normal commit  | PASS                            | File `diff`-identical to `cba75f8`'s blob; `git log -1` → `agent <agent@corpus.local> skill rollback: orchestrate (doc_skillorchestrate) to cba75f8 by agent` + `Corpus-Doc`/`Corpus-Actor` trailers; the bad edit `03a1d49` still reachable. |
| 17  | `commit` is the new HEAD                         | PASS                            | `5cf420b3…` == `git rev-parse HEAD`, ≠ the source ref `cba75f8`.                                                                                     |
| 18  | `--to <ref>` restores that ref's version         | PASS                            | `{"to":"588b9de…"}` → file byte-identical to that blob, new commit `491e5a51…` == HEAD. `{"to":null}` and an omitted body both `200` with a fresh commit. Bad refs (`deadbeefdeadbeef`, `--git-dir=/etc`) → `400`, git never invoked with them. |
| 19  | `docId` is stable across the rollback            | PASS                            | `doc_skillorchestrate` before and after; the hand-written skill shows the synthetic form `doc_skill5959ccdb`, matching the log's own correction.    |
| 20  | Projection and SSE reflect the rollback          | PASS                            | Exactly one frame: `event: invalidate` / `{"keys":[["docs"],["docs","doc_skillorchestrate"]]}` — keys only. Immediate `GET /api/docs/{id}` already returned the restored body. |
| 21  | Unknown skill → 404, standard envelope           | PASS                            | `{"code":"not_found","message":"no skill named \`never-installed\` is installed (…)"}`.                                                              |
| 22  | An archived skill is likewise not installed      | PASS                            | Archived `fixture-notes` (moved to `.claude/skills-archived/`) → `404`.                                                                              |
| 23  | Malformed skill name rejected by the param schema| PASS                            | `Orchestrate` → `400` (`param.name`, pattern); `a/b` → `404 no route matches POST /api/skills/a/b/rollback`.                                        |
| 24  | Single-commit skill handled honestly             | PASS (Adjudication 22 ii)       | `404` — "no earlier committed version of … to restore — its history holds nothing that differs from the file on disk and validates". `git log` still one commit. |
| 25  | Every git call inside `withGitLock`              | DEFERRED → source review        | Substitute: no interleaving or index corruption observed across ~15 rollbacks with the watcher live; workspace `git status` clean afterwards.       |
| 26  | Restoration goes through `MutationPlan`/`runMutation` | DEFERRED → source review   | Substitute: the write produced one invalidate frame with the standard key shape, read-your-write projection, standard commit trailers, no duplicate watcher commit, and `git status --porcelain` empty afterwards — all indistinguishable from every other mutation. |
| 27  | `CHECK_CODES` server == contract, in order       | PASS                            | `apps/server/src/check/codes.test.ts` → 7 passed (re-run by the evaluator).                                                                          |
| 28  | The guard is load-bearing                        | PASS (agent evidence + re-run)  | Passing half re-derived. The failing half required mutating implementation source, which the evaluator does not do; the agent's transcript is specific (`"duplicate-id"` → `"duplicate-ids"`, 1 failed / 6 passed). |
| 29  | The warning split is guarded too                 | PASS                            | Included in the same 7 green tests; the agent's two negative controls are quoted with their exact assertion diffs.                                  |
| 30  | Colocated tests, nothing outside the domain      | PASS                            | Diffstat confined to `apps/server/**`; `vitest run apps/server` → **118 files, 2307 tests, all green** — the log's exact numbers.                    |
| 160 | One validator, reachable two ways (cross-issue)  | PASS                            | `grep -rn "checkCorpus(" apps/server/src` (non-test) → exactly two: `docs/write.ts:301` and `check/routes.ts:98`, both `checkSeams(projection)`. The 13 codes exist only in `core/check.ts` + the contract enum. |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                    | Re-derived?                | Finding                                                                                      |
| --- | ------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| S1  | `{"ids":[]}` → `200 {"ok":true,[],[]}`                              | Yes                        | Exact match.                                                                                  |
| S2  | Rollback's first answer is a handler 404, not a routing 404          | Yes                        | Exact message reproduced verbatim on a fresh workspace.                                       |
| S3  | Both routes `401` without a token                                   | Yes                        | Exact match.                                                                                  |
| S4  | Diff confined to `apps/server/**`                                    | Yes (`git show --stat`)    | 17 files, all in-domain.                                                                      |
| S5  | XOR → `400`, one issue at `json`                                    | Yes, all three bodies      | Exact match.                                                                                  |
| S6  | Unknown id → silent `200`                                           | Yes                        | Exact match.                                                                                  |
| S7  | `{ids}` reads the live file (no restart)                            | Yes                        | Reproduced with an on-disk rewrite.                                                           |
| S8  | `{documents}` creates no file, no git change                        | Yes                        | `ls` fails; `cmp` of `status --porcelain` identical.                                          |
| S9  | `duplicate-id` reachable through the pair form                      | Yes                        | Same detail string shape.                                                                     |
| S10 | Staged-union: a live ref not in the set does not warn               | Yes                        | Only `doc_nobody` warned; `[[doc_h36zalhe]]` did not.                                         |
| S11 | Adjudication 6 leniency: hand-written `SKILL.md` is clean           | Yes                        | Created a `name`/`description`-only skill and an agent-def; both check clean, both by id and in the whole-workspace run; `PUT` accepted the same document. |
| S12 | Rollback restores previous bytes, new commit, agent author          | Yes                        | `diff` clean vs the prior blob; author/subject/trailers reproduced.                            |
| S13 | `response.commit === rev-parse HEAD`, ≠ source ref                  | Yes                        | Exact.                                                                                        |
| S14 | Exactly one SSE `invalidate`, keys only                             | Yes                        | Frame reproduced byte-for-byte in shape.                                                       |
| S15 | `--to` refusals are `400` and git is never invoked with the value   | Yes                        | Both refusals reproduced.                                                                     |
| S16 | `commit: null` + `commit_skipped` when the blob already matches     | Yes                        | Reproduced by repeating the same `--to`.                                                       |
| S17 | Archived skill → 404                                                | Yes                        | Reproduced after a real archive through `POST /api/docs/{id}/archive`.                        |
| S18 | `vitest run apps/server` → 118 files, 2307 tests                    | Yes                        | **Exact** match, to the digit.                                                                |
| S19 | `codes.test.ts` → 7 tests passing                                   | Yes                        | Exact.                                                                                        |
| S20 | Exactly two `checkCorpus` call sites                                | Yes                        | Exact.                                                                                        |
| S21 | Rollback never rewrites history                                     | Yes                        | The rolled-back-over commit remains on `git log`.                                             |
| S22 | `commit: null` + `commit_failed` when a workspace hook rejects      | Yes — **beyond the log**   | Not claimed in the log; the evaluator proved it: with a failing workspace `pre-commit`, the rollback returned `200`, `commit:null`, `warnings:[{"code":"commit_failed","detail":"git commit failed: workspace hook: skills are frozen"}]`, and the restored file **stood** on disk. CONTRACT-016's headline case works. |

No overclaims found. Numeric claims (test counts, shas, commit ids) that could be checked all
matched exactly.

## Failures

### FAIL-1: `/api/check` reports `anchor-unused` as an **error** for documents whose anchors have live threads, whenever the request does not contain the thread documents

**Criterion**: TEST-6 ("one validator … the same implementation the write path runs"), and the
sprint's binding **Adjudication 6**: *"A document the system would accept on write must not fail
`doc check`. A divergence between the two is itself a bug."* It also breaks the sprint Done
Criterion that `corpus doc check` exit 6 only on real errors (the contract that the workspace's
future pre-commit hook is built on), and it is the `anchor-unused` analogue of the false-warning
storm Adjudication 7 exists to prevent — except at **error** severity, so it fails the check.

**Expected**: A document carrying an anchor whose thread exists in the workspace is clean. It is
clean to the write path (`PUT /api/docs/{id}` → `200`, no warnings) and clean to the whole-workspace
check (`corpus doc check` → exit 0). Therefore `POST /api/check {"ids":[<that doc>]}` and the
`{documents}` (`--staged`) form must not report it as an error.

**Observed**: Both subset forms report `anchor-unused` at error severity, so `ok:false` and the CLI
exits 6. The cross-document rule "is any thread pointing at this anchor?" is evaluated against only
the submitted set; `documentExists` covers `[[ref]]`s but nothing covers anchor→thread references,
so every document with a comment thread fails a subset check.

**Steps to reproduce** (verbatim, port `9123`, workspace `$WS`):

1. `corpus init "$WS" --port 9123 && corpus server start --workspace "$WS"`
2. `corpus doc create --type note --title "Anchored subject" -m "The quick brown fox jumps over the lazy dog."`
   → `doc_x2ohwagc` at `data/docs/inbox/anchored-subject.md`
3. Create a real anchored thread:
   `curl -X POST http://127.0.0.1:9123/api/threads -H "Authorization: Bearer $TOK" -H 'content-type: application/json' -H 'x-corpus-author: user' -d '{"parent":"doc_x2ohwagc","title":"About the fox","body":"why brown?","selector":{"exact":"quick brown fox"}}'`
   → `th_lfx7fu4k`, `anchorId: anc_d4fa0218`
4. Confirm the thread really references the anchor:
   `curl http://127.0.0.1:9123/api/threads/th_lfx7fu4k` → `parent doc_x2ohwagc anchor anc_d4fa0218 status open`
5. Confirm the **write path** accepts the document:
   `curl -X PUT http://127.0.0.1:9123/api/docs/doc_x2ohwagc … -d '{"body":"…Accepted by the write path.\n"}'`
   → `HTTP/1.1 200 OK`, `warnings: []`
6. Check the **same** document by id:
   `curl -X POST http://127.0.0.1:9123/api/check … -d '{"ids":["doc_x2ohwagc"]}'`
   →
   ```json
   {"ok": false,
    "errors": [{"code":"anchor-unused","severity":"error","docId":"doc_x2ohwagc",
                "path":"data/docs/inbox/anchored-subject.md",
                "detail":"anchor `anc_d4fa0218` has no thread referencing it"}]}
   ```
7. The same corpus, checked whole, is clean:
   `corpus doc check` → `checked 10 documents — 2 warnings, no errors.` exit `0`
8. The identical failure through the §14 pre-commit path — stage the document and run
   `corpus doc check --staged` → `error anchor-unused data/docs/inbox/anchored-subject.md: anchor
   \`anc_d4fa0218\` has no thread referencing it` … `exit=6`
9. Adding the threads to the request makes it clean, proving the cause:
   `{"ids":["doc_x2ohwagc","th_lfx7fu4k"]}` (and the two-anchor case
   `{"ids":[doc, th_a, th_b]}`) → `ok:true`, `errors: []`

**Blast radius**: every `corpus doc check <id>` and every `corpus doc check --staged` over a
commented document — i.e. the normal state of the product's central object. The workspace-side
pre-commit hook that AGENT-003/agent-runtime is about to build on exit 6 would block every commit
that touches a document with a thread.

**Not fixed here** (evaluator does not write code). The shape of the answer is the one Adjudication 7
already used for refs: a third injected seam (e.g. `anchorHasThread(docId, anchorId)` resolved
through the projection, unioned with the submitted set), or exclusion of `anchor-unused` from
subset requests. The choice is the orchestrator's/server-dev's.

## Re-verification round 1 (2026-07-28, fix commit `394c42d`)

Targeted re-run of the FAIL-1 reproduction **verbatim**, on a **fresh** workspace
(`/tmp/corpus-s013-eval-refix-OD6CeK`, port `9122`), fresh ids, from-source CLI and real `curl`. The
evaluator did not read the fix's implementation; only its observable behaviour was tested.

### The reproduction, re-run

| Step (identical to FAIL-1)                                  | Round 1                                   | Round 2                                        |
| ------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------- |
| Document `doc_nog7ylp6` + two real anchored threads `th_rpp6xhir`/`anc_76012cd5`, `th_wo7n5sct`/`anc_c9897eae` | fixture built | fixture built                                  |
| `PUT /api/docs/{id}` (write path accepts)                    | `200`, `warnings: []`                     | `200`, `warnings: []`                          |
| `POST /api/check {"ids":["<doc>"]}`                          | `ok:false` + 1 × `anchor-unused`          | **`{"ok":true,"errors":[],"warnings":[]}`**     |
| `corpus doc check <id>`                                      | exit **6**                                | **`checked 1 document — no findings.` exit 0**  |
| `corpus doc check --staged` (doc staged after a real edit)   | exit **6**                                | **`checked 1 document — no findings.` exit 0**  |
| `corpus doc check` (whole workspace)                         | exit 0                                    | **`checked 10 documents — no findings.` exit 0** (unchanged) |

Adjudication 6 now holds: what the write path accepts, the check accepts, in every mode.

### The rule still fires — negative case, all three modes

An anchor entry `anc_deadbee1` was added to the same document's frontmatter **out of band**, with no
thread anywhere claiming it, leaving the two thread-backed anchors in place:

```
$ corpus doc check doc_nog7ylp6
error anchor-unused data/docs/inbox/anchored-subject.md: anchor `anc_deadbee1` has no thread referencing it
corpus: 1 error in 1 document.                                              exit=6
$ corpus doc check
error anchor-unused … anchor `anc_deadbee1` has no thread referencing it
corpus: 1 error in 10 documents.                                            exit=6
$ git -C "$WS" add -- data/docs/inbox/anchored-subject.md && corpus doc check --staged
error anchor-unused … anchor `anc_deadbee1` has no thread referencing it     exit=6
```

Exactly **one** finding in each mode — `anc_76012cd5` and `anc_c9897eae` stay silent, so the fix
suppresses false positives without suppressing the rule. Removing the entry returned all three modes
to exit 0 (`subset exit=0 · whole exit=0 · staged exit=0`), so the behaviour is reversible and keyed
to the actual claim, not to a mode.

### A staged edit that genuinely orphans an anchor is still caught

`POST /api/check` with two `{documents}` pairs — the parent as it is on disk, and `th_rpp6xhir`'s
file with its `anchor:` line set to `null` (the shape of a staged edit that drops a highlight):

```json
{"ok": false,
 "errors": [{"code":"anchor-unused","detail":"anchor `anc_76012cd5` has no thread referencing it"},
            {"code":"anchor-unused","detail":"anchor `anc_deadbee1` has no thread referencing it"}]}
```

Only the anchor whose **submitted** thread dropped the claim is reported (plus the dangling one).
`anc_c9897eae`, whose thread was not submitted, is still vouched for by the projection. Submitted
bytes beat a stale projection row — the seam returning ids rather than a boolean is load-bearing and
was seen to be so.

### No regressions in the previously-passing behaviour

| Re-checked                                   | Result                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TEST-7 duplicate-id via pairs                 | `ok:false`, `["duplicate-id"]` — still reported                                          |
| TEST-13 unknown id                            | `{"ok":true,"errors":[],"warnings":[]}` — still silent                                    |
| TEST-12 `{documents}` touches no disk         | `frontmatter-unparseable` reported; `data/docs/nope.md` still absent; `git status --porcelain` byte-identical |
| TEST-88/10 warnings stay warnings             | `warning ref-unresolved …` + `checked 1 document — 1 warning, no errors.` exit **0**       |
| TEST-94 `--staged` changes no git state       | `git status --porcelain` before/after → **BYTE-IDENTICAL**                                |
| Scoped suite `apps/server/src/{check,core,docs,skills,git}` | **709 tests, all green**                                                    |

### Fix-log honesty audit (round 1 fix evidence)

| #   | Claim in "Fix round 1"                                          | Re-derived? | Finding                                                                     |
| --- | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| F1  | Subset `{ids}` on a commented doc → `{"ok":true,…}`             | Yes         | Exact (different ids, same result).                                          |
| F2  | `corpus doc check <id>` → `checked 1 document — no findings.` 0  | Yes         | Exact.                                                                       |
| F3  | `--staged` → exit 0 on a commented doc                          | Yes         | Exact.                                                                       |
| F4  | Whole workspace unchanged at exit 0                             | Yes         | Exact (`checked 10 documents`).                                              |
| F5  | Genuinely unused anchor fires in all three modes, one finding    | Yes         | Exact, and the two thread-backed anchors stayed silent.                      |
| F6  | Removing the entry returns all three modes to exit 0             | Yes         | Exact.                                                                       |
| F7  | Pair form: only the anchor whose submitted thread dropped it      | Yes         | Exact; the non-submitted thread's anchor stayed silent.                       |
| F8  | No contract change; CLI-006 needs no change                     | Yes         | `git show --stat 394c42d`: 7 files, all `apps/server/**` + the issue file. Zero under `packages/contract` or `apps/cli`. CLI-006 re-tested unmodified and passes. |
| F9  | Scoped run green                                                | Yes         | 709 green over the five touched areas (the fix log quotes 648 over three).    |

No overclaims.

## Summary

**Round 1**: 29 of 30 — TEST-6 failed (FAIL-1 below).
**Round 2 (fix `394c42d`)**: **30 of 30**, plus cross-issue TEST-160. The rollback half is excellent: real
bytes restored from real refs, a real attributed commit that never rewrites history, keys-only SSE,
read-your-write projection, honest 404s for "nothing to restore" and for archived skills, and
CONTRACT-016's `commit: null` reachable **both** ways (`commit_skipped` and — proven here for the
first time — `commit_failed` with the file write standing). The proof-of-work log is accurate to the
digit everywhere it could be checked.

The round-1 failure was structural rather than cosmetic: the whole-corpus validator is correctly
*not* filtered (TEST-7), but it was handed subsets without a seam for anchor→thread references, so it
contradicted the write path on the most ordinary document in the product — one that has been
commented on. The fix adds that seam in the same one expression the other two live in, and returns
**ids rather than a boolean** so the submitted set stays authoritative for what it contains: a
commented document now passes every mode, a genuinely dangling anchor still fails every mode, and a
staged edit that drops a claim is still caught. Re-verified from scratch with fresh ids, with the
previously-passing behaviour re-checked for regressions and 709 scoped tests green.

**PASS.**
