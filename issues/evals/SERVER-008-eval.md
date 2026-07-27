# Evaluation: SERVER-008

**Date**: 2026-07-27
**Sprint**: sprint-003 (TEST-38 … TEST-57, plus cross-issue TEST-79/82/85)
**Verdict**: FAIL

One criterion fails: **the halt `reason` is accepted, validated, and then silently
discarded**. Everything else in the queue surface passes, including the headline park/wake
behaviour and the post-merge mirror wiring.

Evaluator environment: ports `8840`/`8841`/`8858` (8765 free throughout), scratch prefixes
`/tmp/eval-s3-*`, real server processes started via the real `corpus server start` and stopped
by pid. Driven by real `curl` against a real socket, real `ls`/`cat` of
`.corpus/queue/<status>/`, and the real `sqlite3` CLI against `.corpus/cache.db`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test sections TEST-38 … TEST-57 plus an addendum clearing TEST-55/56.                                                                                                                 |
| Commands are specific and concrete      | PASS   | Real `curl` with `-w 'http=%{http_code} time=%{time_total}'`, real event ids, real timings, real on-disk JSON.                                                                             |
| Real E2E (not mocked)                   | PASS   | Real server process, two real shells for park/wake, real sockets. `app.request()` correctly confined to the unit suite.                                                                    |
| Scenarios cover acceptance criteria     | PASS   | Every TEST-38…57 addressed; deferrals named with substitute evidence rather than skipped.                                                                                                  |
| Application restarted after changes     | PASS   | Restarts exercised in TEST-54 and TEST-56, and again in the addendum.                                                                                                                      |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus**" in both the main log and the addendum.                                                                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. The addendum's "What was missing" is a fair pre-state description of the unwired mirror.                                                                                    |

**Log vs. observation — one material self-report to credit, one to correct.**

- The log flags TEST-46 itself as **"PARTIAL / contract gap — escalated"**. The contract has
  since gained the optional-reason body (`CONTRACT-002`, commit d7a2463) and the route now
  accepts it — but the server never writes it. The escalation was resolved on the contract
  side and left unresolved on the server side. That is the failure below.
- The addendum's TEST-55/56 clearances **verify true**. I reproduced both against a real
  server and a real `sqlite3`.

## Criteria Results

| #   | Criterion                                          | Result       | Notes                                                                                                                                                                                                       |
| --- | -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38  | Five status directories; §7-shaped events          | PASS         | All five present after boot on a fresh `init` workspace. `pending/evt_5pidd7vno6mt.json` parses; id matches `^evt_[a-z0-9]{12}$`; `type`/`created` (ISO 8601)/`source`/`payload` all present.               |
| 39  | Writes are atomic                                  | PASS         | Reader loop against a 200-event burst: **1 058 445** whole-file parses, **0** truncated, **121** `.tmp-*` files observed mid-flight (temp-file-then-rename proven), 0 vanished mid-read.                     |
| 40  | Idle returns immediately and does not claim        | PASS         | 2 pending → `200` in **2.6 ms** with both events; `pending/` file set byte-identical before and after.                                                                                                       |
| 41  | Idle parks and returns bodiless 204 on expiry      | PASS         | `?timeout=10` → `HTTP/1.1 204 No Content`, **10.018 s** measured, body `0` bytes.                                                                                                                            |
| 42  | Parked idle wakes within a few hundred ms          | PASS         | Parked at t=0; an event file dropped **out of band from another process** at t=2.019 s; the parked call returned `200` at t=2.576 s — **557 ms** after the file landed, over a real socket. Poll fallback works. |
| 43  | Disallowed timeout is a 400, not a silent clamp    | PASS         | `600`, `481`, `0`, `abc` → all `400 {"code":"bad_request", …, "issues":[{"path":"query.timeout", …}]}`. `timeout=1` parks and 204s.                                                                          |
| 44  | Dropped client leaves nothing behind               | PASS         | `curl` on `?timeout=300` killed at 2 s; server logged the request unwinding at `durationMs: 2014` (not 300 s). Fresh idle then returned in **1.9 ms**; `/api/health` 200; `unhandled` count 0; leak-warning count 0. |
| 45  | While halted, idle parks and claim-all is empty    | PASS         | With 1 event pending and `.corpus/HALT` present: `idle?timeout=10` → `204`, 10.016 s, 0 bytes; `claim-all` → `{"events":[]}`; `pending/` unchanged.                                                          |
| 46  | Halt and resume are idempotent and reported        | **FAIL**     | See FAIL-1. Idempotence, sentinel-rewrite and `status` reporting all pass; **the `reason` is never recorded**.                                                                                               |
| 47  | Claim-all moves everything pending in one batch    | PASS         | 3 pending → `200` with all three; `pending/` holds only `.gitkeep`; `in-progress/` holds all three with byte-identical payloads.                                                                             |
| 48  | Concurrent claims never double-hand an event       | PASS         | 50 events, 5 parallel `claim-all`: batch sizes `0,50,0,0,0`; **50 returned, 50 unique, 0 duplicates**, union == the enqueued set exactly; `pending/` ends empty.                                             |
| 49  | Complete / fail / abandon land in the right dir    | PASS         | `200` each; files in `processed/`, `failed/`, `abandoned/`. The failed event's JSON carries `"error": "boom"` (the `reason`→`error` mapping of Adjudication 7). The abandoned file still exists — a move, not a delete. |
| 50  | Transitions idempotent; unknown ids 404            | PASS         | Second `complete` on a processed event → `200` with the same body. `evt_doesnotexis` → `404 {"code":"not_found","message":"no queue event evt_doesnotexis"}`.                                                |
| 51  | Hostile ids rejected before filesystem access      | PASS         | `..%2F..%2Fetc%2Fpasswd`, `foo`, `evt_..`, `..%2F..%2F.corpus%2Fconfig.json` → `400` with `issues[0].path = "param.id"`. `DELETE /api/queue/evt_../complete` → **404** per the recorded adjudication (two-segment path matches no route). Whole-workspace `find` snapshot byte-identical before and after each. |
| 52  | Reap-stale returns stuck work; gives up past cap   | PASS         | Backdated pair → `{"reaped":["evt_4i62dii7qp4q"]}`; that event back in `pending/` with `attempts: 1`; the capped one in `failed/` with `"error":"stale: exceeded attempt cap of 3"`, `attempts: 4`, and **not** in `reaped`. 45 untouched in-progress events left alone. |
| 53  | Status counts match the directories                | PASS         | `{"pending":0,"inProgress":47,"processed":3,"failed":1,"abandoned":1}` vs. `evt_*.json` counts `0/47/3/1/1`; the `allfiles` counts are each one higher (the `.gitkeep`), so `.gitkeep` is provably uncounted. |
| 54  | A malformed event file poisons nothing             | PASS         | `{ truncated` in `pending/` → quarantined to `failed/` as `type: corpus.malformed` with the parser's message and the raw text preserved; the two good events claimed in the same call. A second bad file dropped into `processed/` while stopped → boot rebuild logged it and the server came up normally. |
| 55  | Every transition mirrored before the response      | PASS         | `sqlite3` run immediately after each `curl`, no sleep: claim-all → `in-progress`; complete → `processed` with the sibling untouched; fail → `failed`; abandon → `abandoned`; reap → `pending`. The **pending leg over HTTP** remains `DEFERRED → SERVER-006` (no enqueue endpoint exists); the boot-rebuild + integration-test substitute stands, as pre-authorized. |
| 56  | A restart never loses or duplicates events         | PASS         | Hand-moved two files across statuses while stopped, then restarted: `GET /api/queue/status` = directories = `select status,count(*) from events` **exactly** (`pending 2 / in-progress 46 / processed 3 / failed 3 / abandoned 2`), 56 files / 56 rows / 56 distinct ids. Rows follow the directory, not the file's stale `status` field. |
| 57  | Queue surface behind the bearer guard              | PASS         | `status`, `idle`, `claim-all`, `halt`, `<id>/complete` × {no token, wrong token} = **10/10 401**, every one with `www-authenticate: Bearer` and `{"code":"unauthorized", …}`. No queue file touched.        |
| 79  | Centerpiece integration (queue legs)               | PASS         | Park → out-of-band event → wake in 557 ms → claim-all → complete, all against the daemon started by `corpus server start`. See the CLI-002 verdict for the full chain.                                       |
| 82  | Queue survives a real daemon restart               | PASS         | `corpus server stop && corpus server start` with events spread across three statuses: status = directories = `events` table, 5 events, 5 distinct ids, none lost or duplicated.                              |
| 85  | A halted workspace stops the loop and nothing else | PASS         | Idle parked its full 10 s → `204`; `claim-all` → `{"events":[]}`; `corpus health` exit 0; `select count(*) from documents` → 6. HALT stops work pickup, not the server.                                       |

## Failures

### FAIL-1: The halt `reason` is validated, accepted, and then silently discarded

**Criterion**: TEST-46 (as superseded by the recorded adjudication — the reason arrives via
the new optional request body), and the contract the server publishes for that route.

**Expected**: The contract served at `/api/openapi.json` by the running server states, in two
places:

- `HaltQueueRequest.reason` — _"Human-readable halt reason, **recorded in the `.corpus/HALT`
  sentinel**."_
- `POST /api/queue/halt` description — _"a `reason`, when given, **is recorded in the sentinel
  beside the halt timestamp**. … a second call may replace or add the reason."_

and the sprint's TEST-46 requires `.corpus/HALT` to hold `{reason?, at}`.

**Observed**: `.corpus/HALT` never contains a `reason` under any sequence. The body is
demonstrably parsed and validated — a blank reason is rejected with
`400 {"code":"bad_request","issues":[{"path":"json.reason","message":"Too small: expected
string to have >=1 characters"}]}` — so the value reaches the handler and is then dropped. It
appears nowhere: not in the sentinel, not in the `QueueStatus` response (which has no `reason`
field), not in `.corpus/server.log`.

**Steps to reproduce** (fresh workspace, no prior sentinel):

1. `WS=$(mktemp -d /tmp/eval-s3-halt-XXXXXX); cd "$WS"`
2. `corpus init --port 8858 && corpus server start`
3. `TOKEN=$(python3 -c "import json;print(json.load(open('.corpus/config.json'))['token'])")`
4. `ls .corpus/HALT` → `No such file or directory` (no sentinel yet)
5. `curl -sS -X POST http://127.0.0.1:8858/api/queue/halt -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"maintenance window"}'`
   → `200 {"halted":true,"pending":0,"inProgress":0,"processed":0,"failed":0,"abandoned":0}`
6. `cat .corpus/HALT` →

   ```json
   {
     "at": "2026-07-27T02:57:12Z"
   }
   ```

   **No `reason` key.** `grep -c 'maintenance window' .corpus/HALT` → `0`;
   `grep -c 'maintenance window' .corpus/server.log` → `0`.

Also reproduced on the "second call adds the reason" path the route description promises: a
bare halt, then two seconds later a halt with `{"reason":"second-halt-reason-XYZ"}` — the
sentinel's `at` advances (`02:39:27Z` → `02:39:29Z`, so it *is* rewritten rather than
duplicated) while the `reason` is still absent.

**Blast radius**: the operator-facing half of HALT. A halt with no recorded reason is
indistinguishable from any other halt, so nothing in the workspace, the API or the log can
answer "why is the agent stopped?" — which is the only thing the field exists for. It also
puts the server out of agreement with its own published contract, which §9.3 makes the
authority.

**What passes within TEST-46**, so the fix is narrow: halt twice → `200` + `QueueStatus`
(`halted:true`) both times; one `HALT` file, rewritten not duplicated; resume twice → `200`
both times with the sentinel gone after the first; `GET /api/queue/status` reports `halted`
truthfully at each step.

## Summary

**19 of 20 SERVER-008 criteria pass; TEST-46 fails.** The three cross-issue criteria that fall
to this issue (TEST-79's queue legs, TEST-82, TEST-85) all pass.

The two behaviours this issue's design hinges on are solid: a parked long-poll woke **557 ms**
after an event file appeared from a different process over a real socket, and 5 concurrent
`claim-all` calls against 50 events produced 50 unique ids with zero duplicates. Atomicity,
quarantine, reap, path-traversal defence and the bearer guard are all clean, and the
post-merge mirror wiring in the addendum verifies true — every transition's `events` row is
already correct on the first `sqlite3` read after the HTTP response, with no sleep.

The single failure is a dropped field, not a design problem. `QueueService.halt(reason)`
reportedly already writes `{reason, at}` and the route now accepts the body; what is missing
is passing the parsed `reason` from the handler into that call.

**Next step**: server-dev re-does the halt leg of the E2E verification against the real running
server — a fresh workspace, `POST /api/queue/halt` with a reason body, and a `cat .corpus/HALT`
showing the reason in the sentinel — and updates the issue file's log. The existing TEST-46
entry ("PARTIAL / contract gap … Escalated") is stale: the contract gap it escalated was closed
by CONTRACT-002, and the server side was never brought along.
