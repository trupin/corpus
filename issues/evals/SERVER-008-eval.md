# Evaluation: SERVER-008

**Date**: 2026-07-27
**Sprint**: sprint-003 (TEST-38 … TEST-57, plus cross-issue TEST-79/82/85)
**Verdict**: **PASS** _(round 2, after commit `46178a0`)_

- **Round 1 — FAIL.** One criterion failed: the halt `reason` was accepted, validated, and
  then silently discarded (FAIL-1 below, kept for the record).
- **Round 2 — PASS.** `46178a0` fixes it. Re-verified against a real running server, plus
  adversarial probes of the new seam and an independent falsification of the new tests. **20
  of 20 criteria now pass.** See "Round 2" at the end of this file.

Everything else in the queue surface passed in round 1 already, including the headline
park/wake behaviour and the post-merge mirror wiring.

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
| 46  | Halt and resume are idempotent and reported        | **PASS** (r2) | Round 1: FAIL-1 — the `reason` was never recorded. Round 2 after `46178a0`: sentinel carries `{at, reason}`; bare POST leaves the key absent; a second reasoned halt advances `at` and replaces the reason; blank reason 400s without touching the sentinel. |
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

> **FAIL-1 is RESOLVED as of commit `46178a0`** — re-verified in Round 2 below. Kept in full
> because the reproduction is the record of what was broken and how it was proven.

### FAIL-1: The halt `reason` is validated, accepted, and then silently discarded _(RESOLVED)_

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

---

# Round 2 — 2026-07-27, after commit `46178a0`

**Verdict**: **PASS**. FAIL-1 is fixed. **20 of 20 SERVER-008 criteria pass.**

Fresh workspace `/tmp/eval-s3-r2-E7NK9r`, port **8859** (8765 free throughout and verified
free afterwards), real `corpus init` + `corpus server start`, real `curl`, real `cat` of the
sentinel, server stopped through the CLI. `npm run build` re-run before probing.

**Scope of the change** (verified with `git show --name-only`): `apps/server/src/queue/routes.ts`
(+9/−1), `apps/server/src/queue/routes.test.ts` (+67), `apps/server/src/projection/queue-mirror.test.ts`
(±4 in one assertion). Nothing else in `apps/` moved — the fix is as narrow as round 1
predicted, and no other queue behaviour was touched.

## Round-2 probes — the TEST-46 sequence, re-run exactly

| Probe                                                                       | Result | Observed                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** Reasoned halt on a clean workspace (no sentinel)                     | PASS   | `200`; `.corpus/HALT` = `{"at":"2026-07-27T03:18:31Z","reason":"maintenance window"}`. Keys exactly `['at','reason']`. This is the exact round-1 repro, now producing the reason. |
| **P2** Resume clears                                                        | PASS   | `200`, sentinel gone.                                                                                                                                                           |
| **P3** Bare `POST` (no body, no content-type)                               | PASS   | `{"at":"…"}` — keys exactly `['at']`, **`reason` key absent, never `""`**. The raw bytes do not even contain the substring `reason` (`grep -c` → 0).                              |
| **P3b** Explicit empty JSON body `{}`                                       | PASS   | Same: `['at']` only, no `reason` key. The two "no reason given" spellings agree.                                                                                                |
| **P4** Reasoned halt, +2 s, second halt with a **different** reason         | PASS   | `at` advances `03:18:49Z` → `03:18:51Z` **and** the reason is replaced (`first-reason-ALPHA` → `second-reason-BRAVO`). Exactly **one** `HALT` file, mode `600`, no `HALT.*` siblings. |
| **P5** Blank reason `{"reason":""}`                                         | PASS   | `400 {"code":"bad_request","issues":[{"path":"json.reason","message":"Too small: expected string to have >=1 characters"}]}`; sentinel **byte-identical** (md5 `2a231018…` before and after) with size and mtime unchanged. |
| **P6** Resume ×2 after a reasoned halt                                      | PASS   | First `200` removes the sentinel; second `200` on an absent sentinel. Idempotent both directions.                                                                               |

## Adversarial probes of the new seam

| Probe                                                       | Result   | Observed                                                                                                                                                                            |
| ------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reasoned halt → **bare** re-halt while already halted        | PASS     | The sentinel is re-recorded as `{"at":"…03:19:14Z"}` — the previous reason is dropped. Judged correct; see the note below.                                                          |
| Halt while already halted with a **different** reason        | PASS     | Covered by P4 — replaced cleanly, one file, `at` advanced.                                                                                                                          |
| Reason containing `"`, `\n`, `\t`, em-dash, `café`, 🛑, `\\` | PASS     | Sentinel stays valid JSON and the reason **round-trips byte-exactly** (`repr` → `'he said "stop"\nline two\tTAB — café 🛑 \\ backslash'`). Properly serialized, not string-concatenated. |
| `{"reason":123}` / `null` / `["a"]`                          | PASS     | All `400` with `issues[0].path = "json.reason"`.                                                                                                                                    |
| `{"reason":"ok","bogus":"x"}` (unknown extra field)          | PASS     | `200`, reason recorded, extra field ignored — standard permissive-object behaviour.                                                                                                 |
| `{"reason":"   "}` (whitespace-only)                         | PASS     | `200`, sentinel holds `"   "` verbatim. Contract declares `minLength: 1` and a 3-space string satisfies it, so the server honours its published schema exactly. Noted below.        |

**One false alarm of my own, recorded so the next reader does not chase it.** My first
formatting of the whitespace probe piped the sentinel through `tr -d '\n '`, which strips
spaces and made `"reason":"   "` render as `"reason":""` — the exact thing the fix is supposed
to prevent. Re-reading the raw file showed `"reason": "   "`, length 3. **The empty string
never occurs.** The display was wrong, not the server.

## Regression — halt still actually halts

With a reason set and **2 events pending**:

- `idle?timeout=6` parked the **full 6.01 s** and returned `204` with a 0-byte body — it never
  returned the pending events.
- `claim-all` → `{"events":[]}`; `pending/` still held both files afterwards.
- `GET /api/queue/status` → `{"halted":true,"pending":2,…}`.
- `corpus health` → `200`; `select count(*) from documents` → 6. HALT still stops work pickup
  and nothing else (TEST-85's guarantee intact).
- After `resume`, `claim-all` returned both events and the mirror read `in-progress|2`.

## Verifying the coordinator's two claims independently

**Claim 1 — "the handler now destructures `c.req.valid("json")` and passes `reason` to
`QueueService.halt`."** Confirmed, and confirmed to *matter*: I reverted the fix in place
(file backup + restore, no git state changes), re-ran `routes.test.ts`, and got

```
× halt and resume over HTTP > records the reason from the request body in the sentinel
  → expected undefined to be 'maintenance window'
× halt and resume over HTTP > re-records both fields when a second halt supplies a reason
  → expected undefined to be 'second-halt-reason-XYZ'
Tests  2 failed | 27 passed (29)
```

then restored the file and re-ran to `exit=0`, with `git status --porcelain` empty and
`git diff` on `routes.ts` clean. **The new tests genuinely bite.** The other two new cases
(bare POST leaves the reason absent; blank reason rejected without touching the sentinel) pass
both with and without the fix — that is honest, since they guard behaviour that was already
correct and could regress later, not padding to inflate a count.

**Claim 2 — "your flaky catch in queue-mirror.test.ts."** Correcting the attribution: **I
never reported a flaky test.** My round-1 run was 2113 passed / 0 failed, and the commit
message itself credits the orchestrator ("mechanical fix at commit time"), so the finding was
not mine. I checked the change for proof-integrity rather than taking it on trust:

```diff
-    expect(eventFiles("pending")).toEqual([`${badId}.json`, `${good.id}.json`]);
+    expect([...eventFiles("pending")].sort()).toEqual([`${badId}.json`, `${good.id}.json`].sort());
```

**No assertion was weakened.** `toEqual` on arrays is exact — same length, same members — and
sorting *both* sides removes only the ordering dependence while preserving set equality. The
justification holds: `good.id` is a randomly generated `evt_*` id whose lexical position
against the fixture id is a coin flip. Five consecutive runs of both suites: 5/5 green.

## Gates (round 2)

| Gate                    | Result                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run build`         | exit 0                                                                                                   |
| `npm run lint`          | exit 0                                                                                                   |
| `npm run format:check`  | exit 0                                                                                                   |
| `npm run typecheck`     | exit 0                                                                                                   |
| `npm run test:coverage` | **114 files, 2117 passed, 0 failed** (+4 vs round 1 — exactly the four new sentinel cases); coverage **99.22 % lines / 95.9 % branches / 99.63 % funcs**, unchanged and above the 90 % gate |
| Flakiness               | queue-mirror + routes suites, 5 consecutive runs, 5/5 green                                              |
| Working tree            | clean after the falsification; `routes.ts` identical to `HEAD`                                           |

## One documentation nit (not a defect, no fix required here)

The published route description reads: _"it re-records the sentinel, so a second call **may
replace or add** the reason."_ It enumerates two outcomes but the implementation has three —
a **bare** re-halt after a reasoned halt also **clears** it (probe P6).

I judge the *behaviour* correct and would not want it changed: "re-records the sentinel" is the
operative promise, a bare call carries no reason, and `at` already always reflects the latest
call rather than the first. Retaining a stale reason across a fresh bare halt would be worse —
it would misattribute the current halt to an old cause. It is the sentence that is incomplete,
not the code.

For the record, the coordinator's message described the contract as saying the reason "may be
replaced or cleared" — the published text does not contain "cleared". Whoever next touches
`packages/contract/src/routes/queue.ts` should make the description say all three outcomes so
the text and the behaviour stop disagreeing. Too small to hold a merge for; worth a one-line
follow-up.

## Round-2 summary

FAIL-1 is fixed, narrowly and correctly. The reason now reaches the sentinel; `undefined` is
preserved as absence rather than collapsed to `""`, so "halted without a reason" and "halted
for a reason" stay distinguishable on disk; replacement, blank-rejection, hostile-content
serialization and sentinel-single-file behaviour all hold; and halting still stops exactly the
agent loop and nothing else. The new tests were independently proven to fail without the fix,
and the accompanying test-ordering change was checked and does not weaken its assertion.

**SERVER-008: PASS — 20/20 criteria, plus cross-issue TEST-79/82/85.**
