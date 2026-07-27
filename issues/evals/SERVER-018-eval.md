# Evaluation: SERVER-018

**Date**: 2026-07-27
**Sprint**: sprint-007
**Verdict**: PASS

Evaluated black-box against a real server process on port **8992** with a real `curl -N /events`
subscriber attached across the whole sequence, plus the zero-stub integration workspace on
**8997**. The invariant was verified by **measuring** `GET /api/tree` byte-for-byte immediately
before and immediately after every mutation and comparing that to the mutation's SSE frame —
never by reasoning about what "should" change. **77 measured mutation steps, 88 data frames.**
No source file under `apps/server` was read.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | Filled, with a pre-fix reproduction table (10 rows), verbatim pre- and post-fix frames, a 12-row audit of every tree-changing mutation, and a named out-of-scope deviation. |
| Commands are specific and concrete      | PASS   | Verbatim `data: {"keys":[…]}` frames with real ids, real folder counts either side of each mutation, real pids and ports. |
| Real E2E (not mocked)                   | PASS   | Real `corpus server start`, real `curl -N /events`, real `GET /api/tree` reads. |
| Scenarios cover acceptance criteria     | PASS   | All 4 ACs evidenced; the struck `originTitle` half is marked with its adjudication and its rider (CONTRACT-007). |
| Application restarted after changes     | PASS   | Post-fix pass is on a **fresh workspace** with a rebuilt bundle and a new server pid — not a re-read of the pre-fix run. |
| Actual model recorded (`implemented on:`) | PASS | "**implemented on: opus**". |
| Reproduction logged before fix (bugs)   | PASS   | This is the honest core of the log. It **reproduced first** and reported that *the issue's own premise was half wrong*: thread deletion already emitted `["tree"]` correctly (Open Conflict 7), while four other paths were broken — including an **over**-emission nobody had filed. Pre-fix frames are quoted verbatim. |

### Claims I re-derived independently

| Log claim | Re-derived? |
| --- | --- |
| Thread deletion already emitted `["tree"]` — "nothing to fix" (Open Conflict 7) | **Yes.** Both deletion routes carry `["tree"]` *and* the tree genuinely changed in both. No false negative exists. |
| Standalone-thread deletion over-emitted `["tree"]` pre-fix; silent post-fix | **Yes (post-fix).** Tree `cmp` identical; frame `{"keys":[["docs"],["docs","th_ctjtxpvm"],["threads","th_ctjtxpvm"]]}` — no `["tree"]`. |
| Archive / unarchive now announce (3 routes: `/archive`, `/unarchive`, `PUT status`) | **Yes**, all three, for documents **and** parented threads. |
| The archived-document corner ("measures rather than guesses") | **Yes.** Moving and deleting an archived, thread-less document produce **no** `["tree"]` and the tree is byte-identical — the case a hand-pushed key would get wrong. |
| Frames are still invalidation-only | **Yes.** All 88 frames are `event: invalidate` with the top-level field set `('keys',)` and nothing else. Seeded markers (`SECRETTITLEZZ`, `SECRETBODYZZ`, `SECRETTURNZZ`, `SECRETQUOTEZZ`, `SECRETFILEZZ`, `SECRETLOGZZ`) — verified present in the server-side content — matched **0** times each in the stream. |
| Key vocabulary unchanged | **Yes.** Distinct first segments across 88 frames: `docs`, `jobs`, `locks`, `queue`, `threads`, `tree` — a strict subset of the existing vocabulary. No new key name. |
| `docs/tree-key.test.ts` — "15 cases" | **Yes, exactly.** `npx vitest run apps/server/src/docs/tree-key.test.ts` → **PASS (15) FAIL (0)**. |
| `originTitle` is genuinely absent (Open Conflict 6) | **Yes.** `GET /api/jobs?recent=5` rows carry `{eventId,status,started,updated,lastLine,originId}` and nothing else, both `pending` and `processed`; the served `Job` schema has exactly those six properties; `grep -c originTitle` over the served OpenAPI = **0**. |

### Deviations found in the log

1. **Port deviation (process, not behaviour).** The reproduction ran on 8993 (in-band) but the
   post-fix pass ran on **8956** — outside the sprint's SERVER-018 band 8990–8994. The log
   explains it as a mid-flight reallocation. Nothing reserved was touched.
2. **Test/coverage counts** in the log (3128 tests / 184 files, 98.75 % lines) differ from what I
   measure on the merged branch (**3402 / 201**, 98.72 % lines). That is the expected effect of
   SERVER-010 and CLI-003 also landing — not a contradiction.

No claim in the log failed to reproduce, and the log's most important property is that it
**corrected the issue it was filed under** rather than patching to the filed premise.

---

## Criteria Results

### The `["tree"]` invalidation key

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 127 | Reproduce, or record that there is nothing to reproduce | PASS | Both routes measured. (a) `DELETE /api/docs/th_6j7w3hb5` (parented): `finance` 2 → 1; frame `{"keys":[["docs"],["docs","th_6j7w3hb5"],["threads","th_6j7w3hb5"],["docs","doc_7luysofl"],["tree"]]}` — `["tree"]` **present**, tree **did** change. (b) `DELETE /api/threads/th_pt2ke54u/turns/<ts>` (last-turn cascade): `finance` 2 → 1; `["tree"]` **present**. **No defect reproduces on the filed path** — the issue's first premise is confirmed wrong, exactly as the log says, and no redundant key was added. |
| 128 | The invariant, stated and enforced | PASS (one documented, in-scope-excluded route) | **All 16 enumerated mutations hold**, plus ~35 adversarial probes (born-archived docs, no-op archives, orphaned threads with dangling parents, true-root docs, nested `projects/alpha/deep` with ancestor `totalCount`, same-folder moves, threads parented to an archived doc, skill/agent-def/view/template creates, seen, locks, queue verbs, and **concurrent bursts** — 5 parallel creates each got their own `["tree"]`, 5 parallel body-only PUTs got none, a mixed burst separated correctly). The **only** frame that carries `["tree"]` while `GET /api/tree` is byte-identical is `POST /api/db/rebuild` — see "Documented deviation" below. |
| 129 | Parented thread's deletion changes the tree and says so | PASS | `finance` 2 → 1 **and** `["tree"]` in the frame (quoted above). |
| 130 | Standalone thread's deletion does NOT change the tree and does NOT say so | PASS | Tree `cmp` **identical**; frame `{"keys":[["docs"],["docs","th_ctjtxpvm"],["threads","th_ctjtxpvm"]]}` — **no** `["tree"]`. This is the over-emission the issue actually fixed. |
| 131 | Creation and deletion are symmetric | PASS | Byte-identical key-set shapes: create `{"keys":[["docs"],["docs","th_6j7w3hb5"],["threads","th_6j7w3hb5"],["docs","doc_7luysofl"],["tree"]]}` / delete the same. |
| 132 | Middle-turn deletion emits no `["tree"]` | PASS | Tree identical; frame `{"keys":[["docs"],["docs","th_jm6xwzai"],["threads","th_jm6xwzai"],["docs","doc_7luysofl"]]}` — correct behaviour did not regress. |
| 132b | Archive and unarchive announce the tree change | PASS (Open Conflict 13 **taken**, not deferred) | Document: `finance` 2 → 1 on archive, 1 → 2 on unarchive, **both** frames carry `["tree"]`. **Parented thread** (`th_jm6xwzai`): 2 → 1 then 1 → 2, both frames carry `["tree"]`. Additionally `PUT /api/docs/<D> {status:archived\|open}` — a gap not in the filed issue — 2 ⇄ 1 with `["tree"]` both ways, while a body-only or title-only `PUT` carries none. |
| 133 | Key vocabulary unchanged | PASS | 88 frames; distinct first segments `docs, jobs, locks, queue, threads, tree`; distinct (segment, arity) shapes: `docs/1`×78, `docs/2`×94, `jobs/1`×10, `jobs/2`×1, `locks/1`×4, `locks/2`×2, `queue/1`×9, `threads/2`×22, `tree/1`×41. **No new key name.** `packages/contract` untouched; `query-keys.test.ts` passes unmodified (repo gate green). |
| 134 | Every frame is invalidation-only | PASS | **All 88** frames are `event: invalidate`; **all 88** have the top-level field set `('keys',)`. Grep for six seeded content markers (each verified genuinely present server-side, including an attachment filename and a job log line): **0 matches each**. Also `title` → 0 and `body` → 0 across every `data:` line. |

### `originTitle` on the jobs listing

| #   | Item | Disposition |
| --- | ---- | ----------- |
| 135 | Contract carries the field before the server populates it | **STRUCK → Open Conflict 6.** Independently confirmed: the served `Job` schema is exactly `{eventId, status, started, updated, lastLine, originId}`; `grep -c originTitle` over the served OpenAPI = 0. The issue's scope adjudication records the strike and names **CONTRACT-007** as the rider. SERVER-018 correctly did **not** edit `packages/contract` (§9.3). |
| 136–138 | Thread-origin / doc-origin / null-origin titles | **STRUCK → Open Conflict 6.** Do not run. Verbatim rows observed: `{"eventId":"evt_ejyjerhgfgal","status":"processed","started":"…","updated":"…","lastLine":"SECRETLOGZZ working","originId":"th_pj7tn6zc"}` — `originId` resolves to the thread, no `originTitle` key. Re-observed on the integration workspace: `{… "lastLine":"filed the mortgage note","originId":"th_afa65myb"}`. |

### Exempt

| Item | Disposition |
| ---- | ----------- |
| The out-of-band **watcher** path | **EXEMPT → SERVER-020 (filed).** Not tested. The issue's own audit discloses it in detail and recommends the fix (`folderTreeSignature()` into the watcher's `flush()`). All 77 measured steps in this evaluation were HTTP-mutation frames. |

---

## Documented deviation (not counted as a failure)

**`POST /api/db/rebuild` emits `["tree"]` unconditionally while `GET /api/tree` is byte-identical.**
Confirmed deterministic (3×). Reproduction:

```sh
curl -sS -H "Authorization: Bearer $TOKEN" "$B/api/tree" > before.json
curl -sS -X POST -H "Authorization: Bearer $TOKEN" "$B/api/db/rebuild" > /dev/null
sleep 0.8
curl -sS -H "Authorization: Bearer $TOKEN" "$B/api/tree" > after.json
cmp before.json after.json          # TREE IDENTICAL
grep '^data: ' sse.log | tail -1    # {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}
```

**Why this is not a FAIL.** The governing invariant, as SERVER-018's own summary states it, is
about **a mutation's** invalidate frame. `db rebuild` mutates no document — it is a coarse
whole-cache broadcast owned by **SERVER-017**, and SERVER-018's audit table declares it
explicitly: *"unchanged — deliberately coarse (SERVER-017), not a per-mutation frame."* The
failure direction is over-invalidation (a spurious refetch), never staleness. It is disclosed,
adjudicated in-issue, and out of this issue's stated footprint. Flagged here so the orchestrator
can decide whether to fold it into SERVER-020 alongside the watcher.

---

## Cross-Issue (twelve-hop loop) — SERVER-018's observations

Port **8997**, one `corpus init` workspace, zero stubs, `curl -N /events` attached throughout.
Every frame below is the real thing, with `GET /api/tree` measured either side.

| Hop | Mutation | Tree measured | Frame | Verdict |
| --- | -------- | ------------- | ----- | ------- |
| 1 | `doc create --folder finance` | `finance` absent → count 1 (**changed**) | `{"keys":[["docs"],["docs","doc_ufzxjwcl"],["tree"]]}` | PASS |
| 2 | `POST /api/threads` parented + anchored | `finance` 1 → 2 (**changed**) | `{"keys":[["docs"],["docs","th_afa65myb"],["threads","th_afa65myb"],["docs","doc_ufzxjwcl"],["tree"]]}` | PASS |
| 4 | `thread reply --from agent` | unchanged | `{"keys":[["docs"],["docs","th_afa65myb"],["threads","th_afa65myb"],["docs","doc_ufzxjwcl"]]}` — no `["tree"]` | PASS |
| 8 | `doc edit` (body replace) | unchanged | `{"keys":[["docs"],["docs","doc_ufzxjwcl"]]}` — no `["tree"]` | PASS |
| 10a | `thread resolve` | unchanged | no `["tree"]` | PASS |
| 10b | `doc archive` | `finance` 2 → 1 (**changed**) | `{"keys":[["docs"],["docs","doc_ufzxjwcl"],["tree"]]}` — **Open Conflict 13 taken; the archive frame announces** | PASS |
| 12 | `doc delete --from user --yes` | `finance` folder disappears (**changed**) | `{"keys":[["docs"],["docs","doc_ufzxjwcl"],["tree"]]}` | PASS |
| 141 | `POST /api/capture` (multipart) | `inbox` absent → 2 (**changed**) | frame carries `["tree"]` | PASS |
| 143 | Whole-stream content grep | — | 0 matches for the document title, both turn bodies, the job log line, the anchor quote **and the attachment filename**; every frame `event: invalidate` with `keys` only | PASS |
| 151 | Repo gate | — | lint ✓ format ✓ typecheck ✓ **3402/3402 tests** ✓ coverage 98.72 % ✓ e2e 13 passed ✓ `check-generated-artifacts.ts` green twice ✓ | PASS |
| 152 | Adjudications recorded | — | SERVER-018's log records Open Conflicts 6, 7 and 13 with decision + rationale, names the CONTRACT-007 rider for the struck half, names SERVER-020 for the watcher deviation, and states the model | PASS |

---

## Failures

None.

## Observations (not failures)

1. **`POST /api/db/rebuild`** — the one route where a `["tree"]` key rides a byte-identical tree.
   Disclosed in-issue and owned by SERVER-017; see "Documented deviation".
2. **No `["seen"]` key exists.** `POST /api/threads/<id>/seen` emits
   `[["docs"],["threads",id],["docs",parentId]]`. Not a new key name, so TEST-133 is unaffected,
   but the vocabulary's "nine shapes" and what the routes actually emit are worth a cross-check
   when UI-0xx subscribes to read state.
3. **No-op mutations emit no frame at all** (archiving an already-archived document, moving to
   the same folder, `PUT {status:archived}` on an archived doc). Correct under the invariant,
   and worth knowing for anyone who expects one frame per request.
4. **Port deviation**: the post-fix pass ran on 8956 rather than the assigned 8990–8994.

## Summary

**11 of 11 executable acceptance tests PASS**; 4 (TEST-135…138, `originTitle`) are
`STRUCK → Open Conflict 6`, with the field's genuine absence independently confirmed against the
served contract and the rider (CONTRACT-007) filed; the watcher path is `EXEMPT → SERVER-020`.

The fix is stronger than the issue it was filed under. The implementer reproduced first, found
the filed premise half wrong, said so, and replaced seven hand-pushed `TREE_KEY` call sites with
a measured signature compare — so the invariant is satisfied *by construction* rather than by
seven files agreeing with `docs/tree.ts`. My independent sweep of 77 measured mutations,
including concurrency bursts and the archived-document corner that a hand-pushed key gets wrong,
found the biconditional holding everywhere except the one coarse cache-rebuild broadcast the
issue had already disclosed as out of scope.
