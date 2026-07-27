# Evaluation: SERVER-009

**Date**: 2026-07-27
**Sprint**: sprint-005 (TEST-56…TEST-99, plus TEST-118…TEST-120, TEST-123)
**Verdict**: PASS

Evaluated against the final merged state of `phase-2-server-cli` (HEAD `879a443`), including the
"Harvest Reconciliation over SERVER-005" that discharged the write-guard deferral. Real
`corpus init` workspaces, real servers on 127.0.0.1:8890 and :8891, real `curl`, real `git`, real
`sqlite3`, real `curl -N` SSE. Where sprint prose and the issue's "Sprint-005 Adjudications"
conflict, the adjudication governs.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                        |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Main log plus a "Harvest Reconciliation over SERVER-005" section with its own combined E2E probe.                                                                             |
| Commands are specific and concrete      | PASS   | Exact request/response pairs with real ids, real timestamps, real commit shas, byte counts (`8192`, `4194495`), and named constants.                                          |
| Real E2E (not mocked)                   | PASS   | Real server processes, real sockets, real `curl -N`, real git repository, real `sqlite3`. The hardening claims are backed by real requests, not middleware unit calls.        |
| Scenarios cover acceptance criteria     | PASS   | All ACs covered. Three deferrals are declared, all sprint-pre-authorized, each with its authorized substitute recorded.                                                       |
| Application restarted after changes     | PASS   | Both the original run and the post-harvest combined probe start a fresh server; ports verified free afterwards.                                                               |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus.**"                                                                                                                                                  |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug. Correctly marked.                                                                                                                                        |

**Honesty spot-check.** Claims I re-derived independently rather than accepting: the TTL clamp
value, the `lock` object's exact key set, Origin-on-presence rejection, the auth exemption's
method-and-path exactness, the coalescing ratio, the cursor semantics, the listing row shape, and
the force-break audit commit's trailers. **All reproduced.** The one claim I could not reproduce
as written is the empty force-break commit — and the cause turned out to be a SERVER-005 defect
contaminating the index, not a SERVER-009 error (see Note 1).

One process-discipline lapse, not a behavioral defect: the harvest reconciliation's combined probe
ran on port **8765**, which the sprint reserved for the UI e2e suite and told both server issues
not to bind. It was released afterwards and nothing was harmed, but the instruction was explicit.

## Criteria Results

### Locks

| #       | Criterion                                              | Result | Notes                                                                                                                                                     |
| ------- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-56 | Acquire creates the file and returns 201                | PASS   | `201 {"docId":…,"holder":"agent","acquired":…,"ttl":300}`; file on disk carries the same four fields (mode 600); `locks` row matches. Default TTL **300**. |
| TEST-57 | Bare/`ttl`/clamping                                     | PASS   | Bare → 300. `{"ttl":30}` → honoured. `{"ttl":0}` → **400** `issues[json.ttl]` "expected number to be >=1". `{"ttl":86400}` → **201 clamped to 1800**, and the file also reads 1800. Maximum is **1800 s (30 min)**. |
| TEST-58 | Re-acquiring your own lock renews                       | PASS   | 201, `acquired` refreshed, exactly one lock file, no 409.                                                                                                  |
| TEST-59 | Other party gets 409 naming the holder                  | PASS   | `409 {"code":"conflict","message":…,"lock":{docId,holder,acquired,ttl}}` — `lock` **present** (required). Existing file byte-unchanged.                    |
| TEST-60 | Expired lock treated as absent by acquire               | PASS   | `ttl=1`, 2 s elapsed → the other party's acquire returns **201**. No reaper involved.                                                                      |
| TEST-61 | Acquire on an absent/malformed doc                      | PASS   | `doc_zzzzzzzz` → **404**; `not-an-id` → **400** with `issues[param.docId]`. No lock file created for either.                                                |
| TEST-62 | Two concurrent acquires, exactly one winner             | PASS   | 20 rounds × 2 simultaneous acquires: **0 violations**. Every round one 201 / one 409; the file's holder always matched the winner; never corrupt.          |
| TEST-63 | `reap` is a route, not a docId                          | PASS   | `POST /api/locks/reap` → 200 `{"reaped":[…]}` handled by the reap route; **`.corpus/locks/reap.json` never created**.                                       |
| TEST-64 | Only the holder may release                             | PASS   | Non-holder → **403 forbidden** (not 409), file survives. Holder → 200 `{docId,released:true,holder}`, file gone.                                            |
| TEST-65 | Release/break of an absent lock is 404                   | PASS   | Both **404**. No file created. **No commit made** — `rev-parse HEAD` identical before and after.                                                            |
| TEST-66 | Break is user-only                                      | PASS   | `x-corpus-author: agent` → **403** "force-breaking a lock is user-only; the agent waits or defers"; the lock survives.                                     |
| TEST-67 | User break clears any holder and records the audit entry | PASS   | 200 `{docId,released:true,holder:"agent"}` — `holder` names who *held* it. File gone. Commit `user <user@corpus.local>` / `lock: force-break on <id> (was agent) by user`, trailers `Corpus-Doc` / `Corpus-Actor: user` / `Corpus-Lock-Holder: agent`, `--allow-empty`, produced by SERVER-005's committer. See Note 1 on emptiness. |
| TEST-68 | Break re-enqueues a deferred event                       | PASS   | **Verified myself** with the authorized substitute: real event claimed into `in-progress/`, `deferredEventId` written onto the real lock file, broken over HTTP → event back in `pending/` (0 left in `in-progress/`), `GET /api/queue/status` counts it, `["queue"]`/`["jobs"]` broadcast. |
| TEST-69 | `deferredEventId` never reaches the wire                 | PASS   | With the field on disk: `GET /api/locks` → `{"locks":[{docId,holder,acquired,ttl}]}` and the break response → `{docId,released,holder}`. **Zero occurrences** of `deferredEventId` in any body. |
| TEST-70 | Reap removes only expired locks and reports which        | PASS   | `{"reaped":["doc_o3ld32mf","doc_r4olkb3t"]}` — an **array of ids**, not a count. Exactly those two files gone, live lock untouched; second reap `{"reaped":[]}`. |
| TEST-71 | `GET /api/locks` hides expired leases                    | PASS   | Two live + one expired → exactly the two live, while the expired one's **file is still on disk**.                                                           |
| TEST-72 | Lock state projected; expired rows dropped               | PASS   | In TEST-71's state the `locks` table holds exactly the two live locks. Pruning is on read — characterised precisely in Note 2.                              |
| TEST-73 | Every lock transition broadcasts the pinned keys         | PASS   | Acquire / renew / release / break each emit `{"keys":[["locks"],["locks","<docId>"],["docs","<docId>"]]}`; reap emits one coalesced frame covering both reaped docs. Every payload's only field is `keys`. |
| TEST-74 | Out-of-band lock file caught by the watcher              | PASS   | `printf`-written lock file projected within ~2 s and visible in `GET /api/locks` + sqlite; `rm` reversed both. Both broadcast `["locks"]`-family keys. See Note 3. |

### The write-path guard

| #        | Criterion                                       | Result | Notes                                                                                                                                                       |
| -------- | ----------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-75  | A write by the other party is 423                | PASS   | `423 {"code":"locked","message":"<id> is being edited by agent; the lock was acquired at …","lock":{…}}`. File byte-identical, `HEAD` unchanged.             |
| TEST-76  | The guard covers every write verb; reads never blocked | PASS | `PUT`, `move`, `archive`, `unarchive`, `DELETE` → **all five 423**. `lock` key set is exactly `["acquired","docId","holder","ttl"]` — **no `expiresAt`**, matching `LockedError`. `GET /api/docs/{id}` and `GET /api/docs` → **200**. |
| TEST-77  | The holder's own writes pass                     | PASS   | As the holder: `PUT`/`move`/`archive`/`unarchive` all succeed with `agent <agent@corpus.local>` as git author. `DELETE` returns **403** — but by the *actor* rule (`"deletion is user-only; the agent archives, never deletes"`), not the lock guard. TEST-30 and SPEC §7 pin that rule; TEST-77's "all five" is sprint prose that contradicts TEST-30, and the actor rule wins. |
| TEST-78  | An expired lock blocks nothing                   | PASS   | `ttl=1`, 2 s elapsed, no reap → `PUT` as the other party returns **200** and the body lands.                                                                 |
| TEST-118 | The lock refuses the write, and the write path is the thing refused | PASS | Verified on my own workspace: agent acquires → `PUT` as user **423** with the holder → `GET` **200** → release → `PUT` as agent **200** committing as `agent <agent@corpus.local>`. |

### Job log ingest — the security surface

| #       | Criterion                                        | Result | Notes                                                                                                                                                                    |
| ------- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-79 | Tokenless loopback request appends                | PASS   | No `Authorization` header, from 127.0.0.1 → **201** `{eventId,appended:true}`; exactly one valid JSON line lands in `.corpus/jobs/<evt>.jsonl`.                            |
| TEST-80 | A non-loopback request is refused                 | PASS (stronger) | The product **refuses to bind non-loopback at all**: `refusing to bind "192.168.68.52": this version of corpus serves loopback only`, server exits 1. There is therefore no reachable non-loopback peer to test against — the attack surface is closed one layer earlier than the test assumes. `X-Forwarded-For: 1.2.3.4` and `: 127.0.0.1` on loopback requests changed nothing (both still 201; XFF is never consulted). |
| TEST-81 | A browser `Origin` header is refused              | PASS   | **Verified myself** on four values — `http://evil.example`, `http://127.0.0.1:8890`, `http://localhost:8890`, `null` — **all 403** `{"code":"forbidden","message":"this endpoint refuses requests carrying an Origin header; it is not a browser API"}`. Nothing appended in any case. Rejection is on **presence**, not value; a valid bearer token does not override it. |
| TEST-82 | Line length capped and visible                    | PASS   | 64 KiB line → 201, stored at exactly **8192** bytes ending `…[truncated]`; the read returns the truncated line. `{"line":""}` → **400** with `issues[json.line]`.          |
| TEST-83 | Unknown/hostile job ids refused                   | PASS   | `evt_nosuchjob00` → **404** (resolved against the **queue store**, so an event dropped straight into `pending/` accepts appends before the mirror catches up — I confirmed this myself). `not-an-id`, `evt_..` → **400** with `issues[param.id]`. `..%2f..%2fetc` → 400; `--path-as-is ../../etc` → 404 by URL normalization. `.corpus/jobs/` gained **no file or directory** from any refusal. |
| TEST-84 | File capped; a runaway job cannot fill the disk   | PASS   | Cap **4 194 304 bytes (4 MiB)**. Past it, further appends still return 201, the file stops growing, and **exactly one** notice line is written (`grep -c "log capped at"` → 1); the log still reads cleanly. (Implementer's evidence; the line cap and the read-after-cap behaviour reproduced on my own runs.) |
| TEST-85 | The ingest route is the only unauthenticated one, POST only | PASS | **Verified myself.** No token: `POST /api/jobs/<evt>/log` → **201** with no `WWW-Authenticate`; `GET /api/jobs/<evt>/log`, `GET /api/jobs`, `POST /api/docs`, `POST /api/locks/reap` → **401**, each carrying `WWW-Authenticate: Bearer`. Method-and-path exact. |
| TEST-86 | The authenticated CLI path uses the same endpoint and file | PASS | Token-bearing append → 201, lands in the same `.jsonl` interleaved with tokenless lines; on disk they differ only by the internal `source` (`cli` vs `hook`). One append path, not two. |
| TEST-87 | Concurrent appends never interleave within a line | PASS   | 200 concurrent appends (100 tokenless / 100 authenticated) in 0.34 s: delta exactly **200** data lines, **0 malformed**, all 200 markers present, file ends with a newline. |

### Job log reads, listing, transitions

| #       | Criterion                                    | Result | Notes                                                                                                                                                          |
| ------- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-88 | Incremental cursor                            | PASS   | **Verified myself.** 3 lines → `nextCursor: 3`; append 5, `?cursor=3` → exactly those 5, `nextCursor: 8`; `?cursor=99999` → `{"lines":[],"nextCursor":8}` (not an error); a never-logged job → `{"lines":[],"nextCursor":0}` (not 404). Param is **`cursor`**. |
| TEST-89 | Wire shape is `{ts, line}` and nothing more   | PASS   | Every entry's key set is exactly `["line","ts"]`; on disk it is `["line","source","ts"]`. The internal `source` discriminator never reaches the wire.            |
| TEST-90 | Live streaming announces, never pushes         | PASS   | 50 rapid appends with `curl -N` attached → **1** coalesced frame `{"keys":[["jobs"],["jobs","<evtId>"]]}`. Grep for the appended text over the whole stream → **0** matches. All 50 lines then came back over HTTP. |
| TEST-91 | The tail updates `last_line`; status joins the events mirror | PASS | `last_line` tracks the most recent append. Changing the queue status via `POST /api/queue/<id>/fail` **without touching the log** moved `jobs.status` `pending → in-progress → failed` while `last_line` and the line count stayed put. |
| TEST-92 | Console listing row shape                     | PASS   | **Verified myself.** Key set is exactly `["eventId","lastLine","originId","started","status","updated"]` — no `type`, no nested `doc`. `originId` resolved from the event payload through the projection; `lastLine` is `null` for a job that never logged. |
| TEST-93 | `recent` defaults to 50, caps at 200           | PASS   | Bare → **50** (with 63 events present); `recent=1` → 1; `recent=200` → 200 OK; `recent=201` → **400** `issues[query.recent]` "expected number to be <=200"; `recent=0` → **400**. |
| TEST-94 | `.gitkeep` files are never jobs                | PASS   | 63 `evt_*.json` + 5 `.gitkeep` → the listing returned exactly 63; `select event_id from jobs where event_id not like 'evt_%'` empty. No `.gitkeep` document or event row on my workspace either. |
| TEST-95 | Retry moves failed → pending, refused otherwise | PASS   | **Verified myself.** Failed job → 200 `{status:"pending"}`, file back in `pending/`, `.jsonl` **kept** and gaining `{"source":"server","line":"retry requested"}`; a second retry on the now-pending job → **409 conflict**. |
| TEST-96 | Abandon moves the event and deletes nothing    | PASS   | **Verified myself.** 200, event in `abandoned/`, `.jsonl` **still present**. The struck AC (delete the log) is correctly not implemented.                        |
| TEST-97 | `abandon` and `DELETE /api/queue/{id}` agree   | PASS   | Both end in `abandoned/` with equivalent state and both broadcast the queue and jobs keys; the two routes differ only in the response projection.               |
| TEST-98 | An out-of-band job file is tailed              | PASS   | `printf >>` onto the `.jsonl` → `last_line` updated in the projection, the listing row's `updated` advanced, and `["jobs"]`/`["jobs","<evtId>"]` broadcast.      |
| TEST-99 | The whole surface leaves the projection clean  | PASS   | `rebuild` then `doctor` with the server running, after the full lock + job + document surface: `{"ok":true,"drift":[],"stats":{"files":59,"documents":59,…}}` — no drift from `.gitkeep`s, lock files, job logs, the archived skill folder or the deleted documents. |
| TEST-119 | The break's audit commit and the write path's commits are one git writer | PASS | Both come from the same committer with the same identity mapping and the same env sanitization; the break carries `squash:false` and correctly did **not** amend the preceding document commit. |
| TEST-120 | A break re-enqueues the deferred edit, and the queue announces it | PASS | Verified with TEST-68; with an SSE client attached the break emitted the lock triple **and** `{"keys":[["queue"],["jobs"]]}`. |
| TEST-123 | A job's whole life through the console        | PASS   | Real event → `claim-all` → tokenless loopback append → `POST /api/queue/<id>/fail` → listing shows `status: failed` with the appended `lastLine` and `originId` resolving to the document → `retry` returns it to `pending/` and keeps the log. Every transition broadcast the queue/jobs keys. |

## Failures

None attributable to SERVER-009.

## Notes for the record

### Note 1 — the force-break commit was observed non-empty, but the cause is a SERVER-005 defect

TEST-67 requires the force-break's audit entry to be an **empty** `--allow-empty` commit. On my
integration workspace I observed it carrying two unrelated document deletions:

```
$ git show --stat --format= HEAD      # after POST /api/locks/<id>/break
 data/docs/finance/key-vocab-probe.md | 14 --------------
 data/docs/finance/verb-chain.md      | 14 --------------
 2 files changed, 28 deletions(-)
```

This is **not** SERVER-009's doing. Both files had been deleted earlier through
`DELETE /api/docs/{id}` inside the squash window, and SERVER-005 left those deletions **staged in
the git index** without committing them (see `SERVER-005-eval.md` → FAIL-1). Any subsequent
commit by any path sweeps a staged change; the force-break commit was simply the next one. With a
clean index the break commit is genuinely empty, its subject, trailers and author are all correct,
and it does not amend the preceding commit. **SERVER-009's audit entry is correct; it is
downstream of SERVER-005's leak.** Fixing FAIL-1 removes this symptom.

**Resolved 2026-07-27 at `6e23872`.** SERVER-005's fix landed and I re-ran this probe: with a
`create → immediate DELETE` pair staged right before the break (round 1's exact trigger), the
force-break audit commit is **empty again** —

```
break commit: 619528a user <user@corpus.local> | lock: force-break on doc_gs5tlpwr (was agent) by user
$ git show --stat --format= HEAD
(no output)
```

TEST-67 now passes on its own terms with nothing to caveat.

### Note 2 — lock expiry pruning is read-triggered, and precisely so

TEST-72 passes in the state it posits (after TEST-71's `GET /api/locks`). The exact semantics I
measured:

```
acquire ttl=1 → row present (live)
wait 3s, query sqlite with NO intervening read   → row STILL PRESENT   (stale row)
GET /api/locks                                    → returns only live locks
query sqlite again                                → row PRUNED
POST /api/locks/reap                              → file and row both gone
```

So a stale row can exist transiently, but **no API surface ever exposes an expired lock** and
the write guard never blocks on one (TEST-78). This matches the sanctioned "locks expiry-prunes on
read" behaviour. Recorded because a direct `sqlite3` query taken without a preceding read will
show the stale row and looks like a defect.

### Note 3 — out-of-band lock changes omit the `["docs","<docId>"]` key

API-driven lock transitions broadcast `["locks"]`, `["locks","<docId>"]` **and**
`["docs","<docId>"]` — the third key is what makes the holder banner update in the open reader.
A lock file written or removed directly under `.corpus/locks/` broadcasts only the two
`["locks"]`-family keys. TEST-74 only requires "`["locks"]`-family invalidations", so this is
within the letter of the contract and is **not** a failure — but a reader subscribed on the
document key alone would miss an out-of-band lock change. Worth a follow-up issue for consistency.

### Note 4 — sprint self-conflict: TEST-77 vs TEST-30

TEST-77 says the holder's "same five write verbs" all succeed; TEST-30 and SPEC §7 say the agent
may never delete. When the agent holds the lock and issues `DELETE`, the actor rule fires first
(403 forbidden, naming the rule). That is the correct resolution — the lock guard is not the thing
refusing — and TEST-77's "all five" is sprint prose that predates the conflict.

### Note 5 — the contract advertises two routes the server does not serve

`POST /api/threads` and `POST /api/capture` are in `openapi.json` but return
`404 {"code":"not_found","message":"no route matches …"}`. Both are SERVER-006, explicitly out of
scope for this sprint, and the contract legitimately leads the server. Recorded only so it is not
mistaken for a regression.

## Summary

**All criteria passed** — 20 lock criteria, 5 write-guard criteria, 9 ingest/security criteria, and
14 read/listing/transition criteria, plus the four cross-issue integration tests that touch this
issue. The security surface is the strongest part: all four §7 hardening measures hold under real
sockets, the `Origin` guard rejects on presence (including a same-origin-looking value and even
with a valid token), the auth exemption is method-and-path exact with `WWW-Authenticate: Bearer`
everywhere else, and 200 concurrent appends produced zero malformed lines. Non-loopback ingest is
closed one layer earlier than the sprint assumed — the product refuses to bind non-loopback at all
— which is a stronger posture, honestly reported rather than faked.

The one observable that did not match its test (the non-empty force-break commit) traces
unambiguously to SERVER-005's staged-deletion leak and is tracked there.
