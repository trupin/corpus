# Evaluation: CLI-004

**Date**: 2026-07-27
**Sprint**: sprint-006 (`issues/sprints/sprint-006.md`)
**Verdict**: PASS

Tested black-box with the **built binary** (`apps/cli/dist/bin/corpus.js`, rebuilt from a clean
`npm run build`) against real `corpus init` workspaces on **8930** and **8932**, servers started
by `corpus server start`. **Zero stubs anywhere in this evaluation** — every parking, wake and
transition claim below was measured against a real socket, and every `comment.created` came from
SERVER-006's real thread write path, which supersedes CLI-004's deferred substitute evidence.
Timings measured with real wall clock; request counts read from the server's own access log
(`.corpus/server.log`).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | Adjudications-as-implemented table, deferrals with reasons, per-block evidence, exit-code table, gate figures, cleanup. |
| Commands are specific and concrete      | PASS   | Real invocations, real `od -c` byte dumps, real measured latencies, verbatim stderr. |
| Real E2E (not mocked)                   | PASS   | Built bin (not `tsx`) against `corpus server start` on 8915. The stub `node:http` server is confined to unit tests and the log says so explicitly ("a stub is never E2E evidence for a parking claim" is honoured). |
| Scenarios cover acceptance criteria     | PASS   | Every AC mapped; the two deferrals (`comment.created` producer, TEST-121…132) were correctly ordered behind SERVER-006 and are **now discharged in this evaluation**. |
| Application restarted after changes     | PASS   | The `docs/cli.md` fixed-point and registry-load checks force a rebuild; TEST-117 restarts the server mid-poll as part of the evidence. |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus.** Worktree `.claude/worktrees/cli-004`." |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. The one behaviour change beyond design (`IDLE_RETRY_BACKOFF_MS` 500 ms → 2 s) **is** logged as an observed failure first, with the measured restart durations (0.757/0.744/0.746 s) that justify it — better than required. |

**Independent spot-checks**: the `--wait 0` figure (log 1.217 s, I measured **1.203 s**), the
`docs/cli.md` md5 (log `a51a89038bc3634e4a8642736903deff`, I measured the same and it is now a
committed fixed point), the `{"events":[]}` byte dump, the `no lock held on <doc>.` wording, the
`server not running for this workspace — run \`corpus server start\`` message verbatim, the
monotonic window shrink after a restart, and every JSON key set in the TEST-81 table. All matched.

## Criteria Results

| #   | Criterion | Result | Notes |
| --- | --------- | ------ | ----- |
| 77  | Registry loads at import | PASS | `import('./apps/cli/dist/registry/index.js')` resolves; `validateRegistry` exported and run at load. |
| 78  | `queue`/`lock`/`job` in help | PASS | Three topics at root; `queue` → idle, claim-all, complete, fail, abandon, reap-stale, halt, resume, status; `lock` → break, reap, list, acquire, release; `job` → log, list, retry, abandon. Each verb's `--help` shows args, flags and ≥1 example. |
| 79  | No verb shadows a global | PASS | The parking flag is **`--wait <seconds>`** (default 480); global `--timeout <ms>` keeps its transport meaning. `--window` → exit 2 with the known-flag list. |
| 80  | `docs/cli.md` regenerates with no diff | PASS | md5 identical before/after **twice**; `git diff --stat docs/cli.md` empty; `check-generated-artifacts.ts` green twice in a row (both halves — the log's "differs from HEAD only" caveat is resolved now that the work is committed). |
| 81  | Every documented JSON shape parses | PASS | `queue status` → `[abandoned,failed,halted,inProgress,pending,processed]`; `claim-all` → `[events]`; `reap-stale` → `[reaped]`; `lock list` → `[locks]`; `lock reap` → `[reaped]`; `lock break` → `[broken,docId]`; `job list` → `[jobs]`; `job log` → `[appended,eventId]`; `idle --wait 0` → `[idle,reason]`. All `jq`-parse. |
| 82  | A parked idle returns the instant work lands | PASS | Parked with an empty queue; a **real** `@agent` turn through `POST /api/threads/{id}/turns` woke it in **0.087 s**, exit 0, correct event id and `type: comment.created`. |
| 83  | Parking is silent | PASS | Both streams **byte-empty** at t+8 s and t+14 s of a 20 s park; stderr empty at exit. |
| 84  | Timeout is a clean exit 0 | PASS | `--wait 20` → exited at **20.21 s**, code **0**, stdout exactly `{"idle":true,"reason":"timeout"}`, stderr empty. |
| 85  | The window is the client's, the hold the server's | PASS | Server log: default window issues **one** request, `GET /api/queue/idle?timeout=480`. `--wait 20` → one request `timeout=20` held 20001 ms. Adjudication 4 as stated. |
| 86  | Intermediate timeouts are invisible | PASS | Proven against the **real** server rather than a stub: a `--wait 25` window interrupted by a restart issued four requests (`timeout=25` 4034 ms → `timeout=19` → `timeout=17` → `timeout=15` 15010 ms) and produced **exactly one** JSON value on stdout. The window shrinks monotonically and never extends past the deadline. |
| 87  | `idle` never claims | PASS | After the wake: `pending=1, in-progress=0`; a second `idle` returned the **same** id; only `claim-all` moved it (`pending=0, in-progress=1`). |
| 88  | Halted parks and reports why | PASS | Parked the full **15.36 s**, exit 0, `{"idle":true,"reason":"halted"}` (reason obtained via one extra `GET /api/queue/status` on expiry — visible in the server log, exactly as the log states). `claim-all` → `{"events":[]}`. |
| 89  | Resume makes the same event visible | PASS | Returned the same `evt_dfgxigumrvfa` in **0.17 s**. |
| 90  | Zero window is a single probe | PASS with stated deviation | `--wait 0` → exit 0, `{"idle":true,"reason":"timeout"}`, measured **1.203 s**, and the wire carried `timeout=1` (not 0) plus the status probe — 2 requests. The sprint's "under a second / exactly ONE request" is superseded by its own NOTE (`IdleQuerySchema.timeout` has `min(1)`) and Open Conflict 10; the log states what was sent, which is what the criterion binds. |
| 91  | Two idle clients both wake | PASS | Both returned `evt_tm5alvgq5iu4`, both exit 0; winner's `claim-all` carried it, loser's returned `{"events":[]}` **silently**, exit 0. |
| 92  | Empty batch is still one JSON line | PASS | `od -c` → `{ " e v e n t s " : [ ] } \n`, 14 bytes, exit 0. No prose. |
| 93  | Same shape under `--json` | PASS | `cmp` reports the two outputs **byte-identical**. |
| 94  | Non-empty batch is one parseable line | PASS | 3 pending → 1 line, `jq '.events|length'` → 3, files moved to `in-progress/`, second call `{"events":[]}`. |
| 95  | Large batch is not paginated | PASS | 200 pending → **1 line, 28813 bytes**, `jq` parses, `.events|length` → 200, next call `{"events":[]}`. |
| 96  | `complete` moves the file, exits 0 | PASS | `event <id> is complete.`, exit 0, file in `processed/`, gone from `in-progress/`. |
| 97  | Repeating a transition is harmless | PASS | Identical output, exit 0, file untouched. It reports **state**, never a transition it cannot observe (Open Conflict 12 honoured). |
| 98  | `fail` carries a reason; bare `fail` sends no body | PASS | `--reason "hook rejected"` → on disk `"error":"hook rejected"`; bare → `"error":null` and the server did not 400, i.e. no `{"reason":""}` was sent. Both exit 0, both in `failed/`. |
| 99  | `abandon` is a DELETE and nothing is deleted | PASS | Exit 0; the file is in `abandoned/`, present on disk. |
| 100 | Unknown id is exit 5 | PASS | Human: exit 5, stdout **empty**, stderr `corpus: 404 not_found: no queue event evt_zzzz9999`. `--json`: stdout empty, stderr `{"error":{"code":"not_found","message":"…"}}`. |
| 101 | halt/resume idempotent | PASS | Four calls, all exit 0; `.corpus/HALT` present after the halts, gone after the resumes. |
| 102 | `halt --reason` reaches the sentinel | PASS | `{"at":"…","reason":"maintenance window"}`; a subsequent **bare** halt rewrote it to `{"at":"…"}` with the reason dropped — the contract's re-halt semantics, no body sent. |
| 103 | Halt state is readable | PASS | `queue status --json` → `{"halted":false,"pending":0,"inProgress":1,"processed":17,"failed":2,"abandoned":1}`, matching the per-directory `evt_*.json` counts exactly. The verb is `queue status`, not `halt --status` (Open Conflict 15). |
| 104 | `reap-stale` recovers a stranded event | PASS | An `in-progress` file aged an hour → `returned 1 stale event(s) to pending: evt_…`, exit 0, back in `pending/`. The request went out with **no query string** — no `--older-than` exists (Adjudication 3). |
| 105 | Reaping nothing is a silent exit 0 | PASS | Human mode printed **nothing** on either stream; `--json` → `{"reaped":[]}`. |
| 106 | `lock break` clears an agent-held lock | PASS | Lock file gone, `GET /api/locks` → `{"locks":[]}`, and the audit trail carries `user <user@corpus.local> lock: force-break on doc_dzo7gyuk (was agent) by user` — which is the proof Adjudication 2 (`actor: user`) shipped, since an agent actor would have 403'd. |
| 107 | `break` on an unlocked doc is a stated no-op | PASS | `no lock held on <doc>.`, exit 0; `--json` → `{"docId":"…","broken":false}`, exit 0. The agent loop cannot crash on a duplicated call. |
| 108 | `lock reap` clears expired locks | PASS | 1 s lease → `cleared 1 expired lock(s): doc_3bonaa5i`; second call `no expired locks.`, exit 0. |
| 109 | A live lock survives reaping | PASS | 300 s lease → `no expired locks.`, lock still listed by `lock list` and `GET /api/locks`. |
| 110 | Lock output is machine-readable | PASS | `lock break --json` → `{"docId","broken","holder"}`; `lock reap --json` → `{"reaped":[]}`. One JSON value each, `jq`-parsed. |
| 111 | `job log` appends and is silent | PASS | Two calls, exit 0 both, **stdout and stderr empty** in human mode; both lines in `.corpus/jobs/<E>.jsonl` in order; `GET /api/jobs/<E>/log` → 2 lines, `nextCursor: 2`. |
| 112 | The line may come from stdin | PASS | `echo "step 2: writing reply" \| corpus job log <E>` → exit 0, silent, appended exactly. |
| 113 | Newlines are the server's problem | PASS | `"$(printf 'a\nb')"` → **one** `POST /api/jobs/{id}/log` in the server log, stored as a single JSONL record with an escaped `\n`. The CLI never split it. |
| 114 | `job log` is authenticated; the hole is separate | PASS | Tokenless `POST` from loopback → 201 (documented hole); tokenless `GET` → **401**; the CLI's own call carried its bearer token and did not strip it; unknown event id → 404 → **exit 5**. |
| 115 | SIGINT during parking is a clean exit 0 | PASS | Exit 0 in **0.032 s**, no stack trace, no partial JSON, both streams empty. SIGTERM behaves identically. |
| 116 | SIGINT during the retry backoff does not wait it out | PASS | Server stopped to force the backoff, SIGINT delivered inside it → exit 0 in **0.028 s** against a 2 s backoff. Measured, not assumed. |
| 117 | One transport failure is retried; two are fatal | PASS | `server stop && server start` under a parked `--wait 25` → the process survived and the window resumed (`timeout=19/17/15`), exiting 0 with the timeout object. `server stop` alone → exit **4**, stdout empty, stderr `{"error":{"code":"server_unreachable","message":"server not running for this workspace — run \`corpus server start\`"}}` verbatim. |
| 118 | Exit-code table unchanged and honoured | PASS | 0 success · 2 unknown verb / missing arg / bad flag · 3 outside a workspace (`not inside a Corpus workspace — run \`corpus init\` here or pass --workspace`) · 4 unreachable · 5 server error. No new code; `docs/cli.md` byte-identical. |
| 119 | Errors never touch stdout | PASS | Verified in both modes across `queue complete <unknown>`, `lock break`, `job log <unknown>`: stdout empty, error on stderr, `{"error":{…}}` under `--json`. |
| 120 | No listener leaks | PASS | Full suite (183 files, 3113 tests): **zero** `MaxListenersExceededWarning`. |

### Adjudication 6 (harvest) — the verbs the sprint's Out-of-Scope strike lost to the issue's ACs

Evaluated as in-scope, all through the real bin:

| Verb | Result | Evidence |
| ---- | ------ | -------- |
| `lock acquire <doc> [--ttl]` | PASS | `locked doc_… for agent, lease 300s.`, exit 0; re-acquire by the same holder exit 0. |
| `lock release <doc>` | PASS | `released the agent lock on doc_….`, exit 0; `lock list` → `no locks held.` |
| `lock list [--json]` | PASS | Human line and `{"locks":[{docId,holder,acquired,ttl}]}`. |
| `job list [--json]` | PASS | Rows `<eventId> <status> <lastLine>`; JSON keys `[eventId,lastLine,originId,started,status,updated]`. |
| `job retry <id>` | PASS | `job <id> is pending.`, exit 0; file back in `pending/`. |
| `job abandon <id>` | PASS | `job <id> is abandoned.`, exit 0; file in `abandoned/`. |

## Cross-Issue Tests — the centrepiece

Fresh workspace, fresh git repo, server on **8932**, `curl -N /events` attached across the whole
sequence, `corpus queue idle --json` parked with its pid captured. Queue/lock/job hops through
the **real binary**; thread hops over real HTTP (`DEFERRED → CLI-003`, pre-authorized).

| Step | Observation | Result |
| ---- | ----------- | ------ |
| 1. `POST /api/threads` anchored, `requestsAgent:true` | 201 `{thread:th_a25i5orz, anchorId:anc_8855a337, eventId:evt_garguscevbd3, agent:"requested"}`; thread file + parent anchor entry on disk; **ONE** commit `user <user@corpus.local> comment: new thread on doc_a2ox32pf (th_a25i5orz) by user`, 2 files; **ONE** `evt_*.json` in `pending/`; sqlite `th_a25i5orz\|open\|requested\|1`; SSE `[["docs"],["docs","th_…"],["threads","th_…"],["docs","doc_…"],["tree"]]` then `[["queue"],["jobs"]]`, **no data**. | PASS |
| 2. the parked idle returns | exit 0, stderr empty, `events[0].id == evt_garguscevbd3`, payload `{threadId,parentId,turnTs,mentions,skills,unresolved}`; the event is **still in `pending/`**. Wake latency measured separately at 0.087 s. | PASS |
| 3. `corpus queue claim-all` | exit 0, **1 line**, `{"ids":["evt_garguscevbd3"]}`; `pending=0 in-progress=1`; SSE `[["queue"],["jobs"]]`. | PASS |
| 4. `corpus job log <evt> "reading the thread"` | exit 0, **silent** on both streams; line in `.corpus/jobs/<evt>.jsonl`; `GET /api/jobs?recent=5` → `{eventId, status:"in-progress", lastLine:"reading the thread", originId:"th_a25i5orz"}`. | PASS |
| 5. `POST /api/locks/<D>` as agent | 201 `{docId,holder:"agent",acquired,ttl:300}`; lock file present; `corpus lock list` shows it; sqlite `locks` row; SSE `[["locks"],["locks","doc_…"],["docs","doc_…"]]`. | PASS |
| 6. agent reply turn, `requestsAgent:false` | 201; ts strictly after turn 1; **`eventId: null`** — the agent's own reply does not wake the agent; ONE commit `agent <agent@corpus.local> comment: turn on th_a25i5orz by agent`. | PASS |
| 7. the thread reaches `agent: engaged` | Set by the **server** on the first agent-authored turn in a `requested` thread (Adjudication 4); file says `agent: engaged`, sqlite says `engaged`. | PASS |
| 8. `DELETE /api/locks/<D>` | 200 `{released:true,holder:"agent"}`; lock file gone; SSE on the lock keys. | PASS |
| 9. `corpus queue complete <evt>` | exit 0; file in `processed/`, `in-progress` empty; `GET /api/jobs` shows `status:"processed"` with `lastLine` intact; log still 1 line, `nextCursor:1`. | PASS |
| 10. user plain turn, `requestsAgent` omitted | 201 with **non-null** `eventId: evt_ncvd3fwlxbts` — the engaged thread re-triggered (§8); `pending=1`. | PASS |
| 11. `resolve`, then repeat step 10 | 200 `status:"resolved"`; the next plain turn → **`eventId: null`**, `pending` unchanged. The loop is closed. | PASS |

| #   | Cross-issue test | Result | Notes |
| --- | ---------------- | ------ | ----- |
| 121 | The agent loop's skeleton, end to end | PASS | All eleven steps above; no observation was "presumably fine". |
| 122 | The loop survives a halt in the middle | PASS | The comment enqueued **while halted** (halting stops consumption, not production); `idle --wait 15` parked the full **15.36 s** and reported `reason:"halted"`; `claim-all` → `{"events":[]}`; `resume` then made the event available on the next `idle`. |
| 123 | A crashed consumer is recoverable end to end | PASS | Claimed, aged, `reap-stale` → back in `pending/`; a fresh `idle` returned it; the whole loop (`claim-all` → `job log` → `complete`) re-ran on it with **no manual file surgery**. |
| 124 | A user lock defers the agent; break re-opens the path | PASS | Agent `PUT` → **423** `{code:"locked", message, lock:{docId,holder,acquired,ttl}}`; `corpus lock break` → `{"broken":true,"holder":"user"}`; the break is in the audit trail as a **user**-authored commit; the agent's `PUT` then succeeded (200). |
| 125 | Commenting on a locked document, per Adjudication 1 | PASS | With `user` holding D's lock: (a) whole-document thread by agent → **201**; (b) anchored thread by agent → **423** naming the holder; (c) turn on a thread whose parent is D → **201**; (d) standalone → **201**; (e) anchored by the **lock holder** → **201**; (f) anchor-removing last-turn deletion against the other party's lock → **423**. Exactly the split adjudicated. `locks/guard.ts`'s header comment now states this split verbatim and **matches the shipped behaviour** — the contradiction the sprint flagged is gone. |
| 126 | One producer, one consumer | PASS | `comment.created` is constructed only in `apps/server/src/threads/events.ts` (via `COMMENT_CREATED` in `threads/workspace.ts`); every other hit is a doc comment or a fixture. In `apps/cli/src` it appears **only** inside registry description strings — the CLI never constructs one. |
| 127 | Everything behind the bearer guard except the documented hole | PASS | 10 routes with no `Authorization` → **401** each (`queue/status`, `queue/claim-all`, `queue/idle`, `threads/{id}`, `POST /api/threads`, `locks`, `locks/reap`, `jobs`, `jobs/{id}/log` GET, `capture`). `POST /api/jobs/{id}/log` → 201, loopback-only and tokenless by design. |
| 128 | SSE carries invalidations, never content | PASS | 30 frames across the whole sequence, **all** `event: invalidate`, **zero** non-`{"keys":…}` data lines. Grepped the stream for `please check this`, `6.4% is more representative`, `reading the thread`, `thanks`, `one more thought`, `30-year fixed`, `while halted` → **0 matches each**. |
| 129 | The projection is fully reconstructible | PASS | Deleted `.corpus/cache.db*`, restarted: threads 4, turns 9, anchors 2, events 3, jobs 2, locks 0, seen 1, documents 11 — **counts identical**, and row-level `diff` on threads / turns / anchors / events / seen all **IDENTICAL**. |
| 130 | `git log` is a complete audit trail | PASS | Twelve commits, every one with the correct acting party as **author** (`user <user@corpus.local>` / `agent <agent@corpus.local>`), including both force-breaks as `user`. Nothing under `.corpus/` was ever committed except the five queue-skeleton `.gitkeep` files. `git status` clean. |
| 131 | No stray processes, no stray ports | PASS | All three servers stopped **by pid** via `corpus server stop`; `lsof -nP -iTCP:8930-8935 -sTCP:LISTEN` empty; **8765 free** throughout; no stray `queue idle` or `curl -N`; scratch directories removed by captured path only. |
| 132 | The repo-wide gate is green | PASS | `build`, `lint`, `format:check`, `typecheck` all exit 0. **183 test files, 3113 tests, 0 failures.** Coverage **98.75 % lines / 95 % branches / 99.37 % functions** (gate 90 %). `npm run e2e` with `CORPUS_UI_PORT=5273` → **13 passed**. `check-generated-artifacts.ts` green **twice in a row**, both `openapi.json` and `docs/cli.md`. |

## Failures

None.

## Observations (not failures)

- After a mid-poll server restart, the freshly-started server answers the first one or two
  re-polls with an **immediate 204** (`timeout=19` in 2 ms, `timeout=17` in 0 ms) before settling
  into a proper hold. Bounded — a 25 s window issued 4 requests total, not a spin — and the
  client's single-output contract held. Worth a glance if the rearm window is ever shortened.
- CLI-004's log records `ReapStaleResult` missing a `failed` field as a CONTRACT-007 rider
  candidate. Confirmed absent; nothing in this sprint depends on it.

## Summary

**44 of 44 CLI-004 criteria PASS; 12 of 12 cross-issue criteria PASS; all six
adjudication-6 verbs PASS.** The centrepiece runs: `corpus queue idle` parks silently and
survives well past the 10 s global transport timeout (the `untimedApi` fix is real — a 20 s park
completed cleanly), a real product-authored comment wakes it in 87 ms, and the full
claim → lock → job-log → agent reply → engaged → complete → resolve loop executes through the
real binary against a real server with file, git, sqlite and SSE state confirmed at every hop.
Phase 2's thesis holds and AGENT-002 has a surface to stand on. Verdict: **PASS**.
