# Evaluation: SERVER-023

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

Rig: scratch workspace `/tmp/corpus-e008-s023-ObeeKG/ws`, `corpus init --port 8982`, real daemon
pid 85930 on 127.0.0.1:8982, every probe a real `curl` with `-D-`/`-w '%{http_code}'`. Entry
`node --import tsx apps/cli/src/bin/corpus.ts`. Server stopped by recorded pid at the end; 8982,
8983 and 8765 all verified unbound afterwards. No application source file was read; the two greps
below are greps, and every behavioural claim was exercised over HTTP.

## E2E Proof-of-Work Audit

| Check                                    | Result | Notes                                                                                                                                                                        |
| ---------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log present and substantial              | PASS   | Seven numbered sections plus a measured pre-state and a full-gate block                                                                                                       |
| `implemented on: opus` line present      | PASS   | Line 49: `**implemented on: opus**`, with ports and scratch dir named                                                                                                          |
| Commands specific and reproducible       | PASS   | Real `curl -F` invocations quoted verbatim; ids, byte counts, commit sha, git author all concrete                                                                              |
| Real E2E over real HTTP, not mocked      | PASS   | Every claim I re-ran reproduced against a fresh daemon on a different port with different ids — nothing was a transcribed unit-test assertion                                   |
| Pre-state / reproduction-before-change   | PASS   | "The pre-state, measured" records `tsc --noEmit -p apps/server/tsconfig.json` exit 2 with exactly five errors at the five sites CONTRACT-009's blast-radius table names         |
| Restarted after changes                  | PASS   | Section 3 states the caps were lowered in `.corpus/config.json` "server restarted"; my own run restarted from scratch and agrees                                                |
| Covers its own ACs                       | PASS   | All four ACs are exercised in the log and all four re-derived here                                                                                                             |
| Honest about what is NOT done            | PASS   | "Not done here, deliberately" names `POST /api/threads/{id}/turns/{ts}/form` as SERVER-016's and defers TEST-56/57/59 — accurate; the route exists in `openapi.json` unhandled  |
| Scope creep declared                     | PASS   | The `anchors/reconcile.test.ts` timing-guard change is declared as an adjudicated test-robustness item, with the `docs/update.test.ts` non-change justified by a quoted grep    |

## Log Honesty Re-derivation

Nine falsifiable claims picked and re-run independently.

| Claim in log                                                                                                                | Re-derived? | Actual observation                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 JSON `POST /api/threads` answers `201` with `{thread, anchorId, eventId, warnings}` (the media-type-chain break is fixed) | CONFIRMED   | `HTTP/1.1 201 Created`, `KEYS ['anchorId','eventId','thread','warnings']`, `th_fqiiwrri`, `anchorId: null`, `eventId: null`, `warnings: []`. Validates against `CreateThreadResponse`                                                                                                                                                                                       |
| §2 pinned reference format, each segment percent-encoded, display text human-readable                                       | CONFIRMED   | Observed turn body byte for byte: `Is this still right? @agent\n\n![shot.png](attachments/th_ptwrryun/2026-07-28T00%3A08%3A22Z/shot.png)\n[notes.pdf](attachments/th_ptwrryun/2026-07-28T00%3A08%3A22Z/notes.pdf)` — same shape as the pinned `![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)`                                                               |
| §2 bytes land under `.corpus/attachments/<threadId>/<turnTs>/`, ts verbatim with colons                                     | CONFIRMED   | `.corpus/attachments/th_ptwrryun/2026-07-28T00:08:22Z/{shot.png,notes.pdf}`, 21 B and 10 B, `od -c` shows `PNG-BYTES-CANARY-8982` / `PDF-CANARY`. Directory name carries raw colons; the markdown link carries `%3A`                                                                                                                                                        |
| §2 served over `GET /attachments/...` with the encoded path                                                                 | CONFIRMED   | `HTTP/1.1 200 OK`, `content-type: image/png`, `content-length: 21`, `x-content-type-options: nosniff`, body byte-identical to the canary                                                                                                                                                                                                                                    |
| §2 one commit, both files, no bytes committed                                                                               | CONFIRMED   | `67a590c user <user@corpus.local> comment: new thread on doc_seedinbox (th_ptwrryun) by user`; `--name-only` = `data/docs/views/inbox.md`, `data/threads/th_ptwrryun.md` only                                                                                                                                                                                              |
| §2 SSE frame is keys-only, same as a JSON creation                                                                          | CONFIRMED   | Read live off `GET /events`: `event: invalidate` / `data: {"keys":[["docs"],["docs","th_i6lrdyc2"],["threads","th_i6lrdyc2"],["docs","doc_seedinbox"],["tree"]]}` — no `data` payload, exactly the claimed shape                                                                                                                                                             |
| §3 413 on all three routes on both refusal paths                                                                            | CONFIRMED   | Six probes, six `413`s — see the table under TEST-49. I used the **default** 25 MB / 100 MB caps with real 26 MB and 101 MB payloads rather than the log's lowered caps, and got the same verdict                                                                                                                                                                            |
| §4 reap returns the capped event in `failed`, the merely-stale one in `reaped`, disjoint                                     | CONFIRMED   | One call: `{"reaped": ["evt_vpqxudsp4juu"], "failed": ["evt_56ew5s6dzvhu"]}`. Disjoint in the same response, and the directories agree: `failed/` 1, `pending/` 1, `in-progress/` 0 (`evt_*.json` counted, `.gitkeep` excluded)                                                                                                                                              |
| §5 `resolve`/`reopen` carry a non-empty `warnings` under a failing `pre-commit`                                             | CONFIRMED   | `resolve` → `{"thread":{…"status":"resolved"…},"warnings":[{"code":"commit_failed","detail":"git commit failed: doc check: refusing"}]}`; `reopen` → same with `"git commit --amend failed: doc check: refusing"`. Commit count unchanged 7→7, `status: resolved` on disk, file left modified-and-uncommitted                                                                |
| §6 `originTitle` is populated, not merely nullable                                                                          | CONFIRMED   | `GET /api/jobs` returned `"originTitle": "Re: \"Inbox\""` and `"originTitle": "Re: under cap capture ok"`, both matching the `title:` lines in `data/threads/*.md` exactly                                                                                                                                                                                                   |
| Gate: `npm run typecheck` exit 0                                                                                            | CONFIRMED   | Re-run by me from the repo root on tip `4ea3e4b`: **`TYPECHECK_EXIT=0`**, zero `error TS` lines across all five workspaces plus `scripts/`                                                                                                                                                                                                                                  |
| Gate: `apps/server` 105 files / 2046 tests                                                                                  | CONFIRMED   | `npm test -- apps/server` → `Test Files 105 passed (105)` / `Tests 2046 passed (2046)`, exit 0. The log's numbers are exact, not rounded                                                                                                                                                                                                                                     |

Nothing in the log was contradicted.

## Criteria Results

### The issue's own acceptance criteria

| #    | Criterion                                                                                                                                | Result | Notes                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | `apps/server` compiles against the regenerated contract; all five halves implemented with colocated tests                                 | PASS   | `npm run typecheck` exit 0 (re-run, not trusted); `npm test -- apps/server` 105/2046 green. All five halves exercised at runtime below, so they are consumed and not merely compiled                                            |
| AC-2 | Multipart thread creation E2E: real curl multipart → thread with attachment references, served bytes, one commit, correct SSE keys; over-cap → 413 on both routes | PASS   | All five sub-claims re-derived independently (rows 2–7 above). "Both routes" is in fact three — `/api/threads`, `/api/threads/{id}/turns`, `/api/capture` — and all three 413                                                     |
| AC-3 | Reap/resolve/reopen/jobs responses verified E2E against the new shapes                                                                    | PASS   | All four re-derived, and each captured body formally validated against its `openapi.json` component (see the validation block below)                                                                                            |
| AC-4 | Full gate green (the combined contract+server commit is the green unit)                                                                   | PASS   | Typecheck 0 and the server suite green on tip `4ea3e4b`. I did not re-run lint/format/e2e/coverage (out of scope for this evaluation)                                                                                           |

### The sprint criteria SERVER-023 is the named follow-through for

| #       | Criterion                                                                                                                 | Result | Notes                                                                                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-49 | The 413 declaration is reachable, not decorative — both the pre-parse `Content-Length` path and the post-parse path         | PASS   | Six probes, six 413s, at the real `DEFAULT_MAX_FILE_BYTES = 25 MB` / `DEFAULT_MAX_REQUEST_BYTES = 100 MB` caps. Under-cap controls on all three routes still `201`, so the guard is not a blanket refusal            |
| TEST-50 | The interim-400 comment is retired with the behavior                                                                        | PASS   | `grep -rn "follows in the CONTRACT rider" apps/server/src apps/cli/src packages/contract/src` → **no matches**. The surviving mentions are historical and accurate (see below)                                       |
| TEST-60 | `resolve` and `reopen` return their §14 warnings; a real resolve against a hostile git hook returns a non-empty array       | PASS   | Non-empty `warnings` over real HTTP on both verbs, with distinct details (`git commit failed:` vs `git commit --amend failed:`). Clean workspace returns `warnings: []`, so the array is computed, not hard-coded    |
| TEST-61 | Warnings ride a response wrapper, not the resource (`ThreadSummary` unchanged, list rows carry no `warnings`)               | PASS   | `ThreadSummary`'s properties are `id,title,status,parent,anchor,agent,created,updated,turnCount,lastAuthor,lastTs` — no `warnings`. `GET /api/threads/{id}` returned no `warnings` key. Only the nine mutation-response CARRIERS carry one |
| TEST-62 | A real reap that pushes an event past the attempt cap returns it in `failed` and NOT in `reaped`, over real HTTP            | PASS   | `{"reaped": ["evt_vpqxudsp4juu"], "failed": ["evt_56ew5s6dzvhu"]}` — the capped event is in `failed` and absent from `reaped` in the same response, and its file moved to `.corpus/queue/failed/`                    |
| TEST-64 | `GET /api/jobs` against a real server — populated, or valid because optional; a response failing its own schema is a FAIL   | PASS   | **First branch shipped**: the server populates the field. Both rows carry a non-null `originTitle` matching the thread's on-disk `title:`. The response validates against `Job` (all seven required keys present)   |

### Formal schema validation of every captured body

Each response was validated against its declared `openapi.json` component (`$ref` resolution,
type-arrays, `required`, `enum`, `pattern`, `items`):

```
VALID  jobs.json                      vs Job                     (both rows)
VALID  reap.json                      vs ReapStaleResult
VALID  res1.json / res2.json          vs ThreadMutationResponse  (clean + warning cases)
VALID  reo.json                       vs ThreadMutationResponse
VALID  body1.json (JSON create)       vs CreateThreadResponse
VALID  body2.json (multipart create)  vs CreateThreadResponse
VALID  r_threads_under.json           vs CreateThreadResponse
VALID  r_turns_under.json             vs AppendTurnResponse
VALID  r_capture_under.json           vs CaptureResult
VALID  all six 413 bodies             vs ValidationError
```

### The 413 matrix, at the real default caps

| route                          | post-parse (real 26 MB file, request < 100 MB) | pre-parse (real 101 MB file, `Content-Length` 105 906 612) |
| ------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/threads`            | **413** (`size_upload=27263411`, `t=0.039 s`)  | **413** (`size_upload=655360`, `t=0.0011 s`)               |
| `POST /api/threads/{id}/turns` | **413** (`size_upload=27263297`, `t=0.026 s`)  | **413** (`size_upload=655360`, `t=0.0010 s`)               |
| `POST /api/capture`            | **413** (`size_upload=27263297`, `t=0.025 s`)  | **413** (`size_upload=547928`, `t=0.0009 s`)               |

The pre-parse column is genuinely pre-parse and not an artefact of message wording: curl uploaded
about 0.6 MB of a 101 MB body before the server answered, in ~1 ms. The post-parse column consumed
the whole 27 MB body first. The two paths also produce different messages:

```
post-parse: {"code":"bad_request",
             "message":"attachment big26.bin is 27262976 bytes, over the per-file limit of 26214400 bytes (25 MB)",
             "issues":[{"path":"files","message":"attachment big26.bin is 27262976 bytes, over the per-file limit of 26214400 bytes (25 MB)"}]}
pre-parse:  {"code":"bad_request",
             "message":"the upload totals 105906612 bytes, over the per-request limit of 104857600 bytes (100 MB)",
             "issues":[{"path":"files","message":"the upload totals 105906612 bytes, over the per-request limit of 104857600 bytes (100 MB)"}]}
```

Both match the `ValidationError` component `openapi.json` declares for `413` on all three routes,
with `code: "bad_request"` — Open Conflict 4's adjudication (reuse the existing union member, no new
`ERROR_CODES` entry) is what actually ships. Under-cap controls: `POST /api/threads` `201`,
`POST /api/threads/{id}/turns` `201`, `POST /api/capture` `201`.

The six refusals left nothing behind: `find .corpus/attachments -type f -size +1M` is empty, the
attachment file count is exactly the 7 the successful uploads produced, and `data/threads/` holds
exactly the 6 threads the successful creations produced. `corpus db doctor` afterwards:
`projection is clean — 13 documents from 13 files (3ms)`.

### TEST-50 detail

The phrase the criterion names is gone:

```
$ grep -rn "follows in the CONTRACT rider" apps/server/src apps/cli/src packages/contract/src
(no matches)
```

Two mentions of the interim 400 survive, and both describe history rather than promising a future
change — which is what the criterion asks for ("the comment is updated to describe what ships"):

- `apps/server/src/attachments/limits.ts:17-19` — "shipped an interim `400` here because `413` was
  undeclared at the time and an undeclared status is contract drift no generator would catch; **that
  reason is gone**", immediately under line 12's "**Both refusals are `413`**, on every route that
  takes files".
- `apps/server/src/attachments/limits.test.ts:52-54` — "CONTRACT-009 declared 413 on every
  file-taking route, which **retired** sprint-007 Open Conflict 5b's interim 400", above
  `expect(http.status).toBe(413)`.

Neither is stale.

### Integration Points — consumed at runtime, not merely compiled

| Site named in sprint-008                                       | Consumed at runtime?                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ReapStaleResult.failed` ← `queue/routes.ts:35`                | YES — `failed: ["evt_56ew5s6dzvhu"]` came back over HTTP with a real event in it, not an empty placeholder                |
| resolve/reopen warnings ← `threads/routes.ts`                   | YES — non-empty `warnings` on both verbs, and `[]` on a clean workspace; the value tracks the actual commit outcome        |
| `Job` origin title ← `jobs/project.ts`                          | YES — populated from the projection, matching on-disk titles. Note the sprint listed this as "SERVER-016's or a follow-up's (Out of Scope)"; SERVER-023 did it anyway, which is the stronger of TEST-64's two permitted branches |
| 413 on over-cap uploads ← `attachments/limits.ts`               | YES — six real refusals, both enforcement paths, three routes                                                             |

### Extra probes beyond the log

| Probe                                              | Observed                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multipart create with neither `text` nor `files`   | `400` `{"code":"bad_request","message":"request failed validation","issues":[{"path":"form.text","message":"A thread's first turn needs `text`, at least one file, or both."}]}` |
| Attachment-only first turn                         | `201`, body exactly `![shot.png](attachments/th_il2i7i7t/2026-07-28T00%3A15%3A11Z/shot.png)`, title `Re: Inbox` — derived from the parent, never from the URL       |
| `corpus thread resolve --json` passthrough         | `{"thread":{…},"warnings":[]}` — the documented CLI output change ships, exit 0, no CLI code needed                                                                  |

## Failures

None. No CRITICAL, MAJOR or MINOR behavioural failure was found.

Two observations that are not failures and need no action:

- **Not-a-failure 1.** The issue's AC-2 says "over-cap → 413 on **both** routes". There are three
  file-taking routes, not two. All three 413 correctly, so the implementation exceeds the criterion;
  only the criterion's wording undercounts.
- **Not-a-failure 2.** `GET /api/jobs` reported `originTitle` for a job whose event had been moved
  to `failed/` by my forced reap, reading the title live from the projection. This is the documented
  "read at response time, never stored" behaviour and matches the `Job.originTitle` description in
  `openapi.json`.

## Summary

SERVER-023 passes. All four of its own acceptance criteria and all six sprint criteria it is the
named follow-through for (TEST-49, TEST-50, TEST-60, TEST-61, TEST-62, TEST-64) hold up under
independent re-derivation on a fresh workspace, a different port and different ids.

Twelve specific claims from the E2E log were re-run and **twelve reproduced; none was contradicted**
— including the two most falsifiable: the exact test counts (105 files / 2046 tests) and the
typecheck exit code, which I re-ran myself from the repo root rather than trusting (`TYPECHECK_EXIT=0`,
zero `error TS` lines). The pinned attachment-reference byte string reproduced character for
character up to the ids and timestamps.

The strongest evidence that the four Integration Points are genuinely consumed rather than merely
compiled: each one returned a *non-trivial* value at runtime — `failed` with a real event id in it,
`warnings` non-empty under a hostile git hook and empty without one, `originTitle` matching the
on-disk `title:` lines, and 413 on both the pre-parse and post-parse enforcement paths across all
three file-taking routes, while under-cap uploads still succeed. TEST-64 shipped in its stronger
branch: the server populates the field rather than leaning on nullability, which the sprint's
Integration Points had explicitly left to a follow-up.

Verdict: **PASS** — 10 of 10 criteria.
