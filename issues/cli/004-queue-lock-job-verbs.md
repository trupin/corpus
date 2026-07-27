# [CLI-004] Queue, lock and job verbs — the agent loop surface

## Domain
cli

## Status
done

## Priority
P0

## Model
opus — semantics are pinned by SPEC.md §7 and Architecture Decision 4 (HTTP long-poll parking); the work is precise client-side loop mechanics, not design.

## Dependencies
- Depends on: CLI-001, SERVER-008, SERVER-009
- Blocks: AGENT-002

## Spec References
- SPEC.md §7 (event queue and agent loop — `queue idle|claim-all|complete|fail|abandon|reap-stale|halt|resume`, document locks and `lock break|reap`, job logs and the console feed)
- SPEC.md §9.2 (HTTP API — queue, jobs, lock endpoints)
- CLAUDE.md — Architecture Decision 4 (`corpus queue idle` long-polls the server instead of `fs.watch`, same zero-token parking semantics, ~8 min rearm)

## Summary
Ship the surface the product agent's orchestrate skill runs on: `corpus queue idle` (HTTP long-poll parking), `claim-all`, `complete|fail|abandon`, `reap-stale`, `halt|resume`, plus `corpus lock break|reap` and `corpus job log`. These commands are not read by humans — they are read by an agent loop, so the **output contract is the feature**: stable JSON shapes, quiet success, exit codes that mean exactly one thing, and an `idle` that costs zero tokens while parked and returns the instant work arrives.

SPEC.md §7 still describes `idle` as blocking on `fs.watch` of `.corpus/queue/pending/`. That is superseded: the CLI holds an HTTP long-poll against the server's idle endpoint. The observable semantics are unchanged — park cheaply, return immediately on a pending event, rearm after ~8 minutes with a clean exit so the skill loop re-invokes.

## Acceptance Criteria
- [x] `corpus queue idle [--wait <seconds>]` _(flag renamed by adjudication 1)_ long-polls the server's idle endpoint and returns **the instant** a pending event lands, printing a minimal event summary (id, type) — or the full event with `--json`. Measured latency from enqueue to return is well under a second on localhost.
- [x] The rearm window defaults to ~8 minutes (`--wait` overrides). When it elapses with no event, `idle` exits **0** with no event payload (`{"idle":true,"reason":"timeout"}` under `--json`) so the orchestrate skill's loop re-invokes it. A timeout is not an error.
- [x] The window is implemented as successive long-poll requests (per-request wait capped at the server's maximum, e.g. 60–90 s) until the total window elapses — so intermediate timeouts are invisible to the caller.
- [x] While the queue is **halted** (`.corpus/HALT`), `idle` parks for its full window and returns as a timeout — it never returns events; `claim-all` returns an empty batch.
- [x] `corpus queue claim-all` prints exactly **one JSON batch** on stdout (`{"events":[…]}`) with or without `--json`, and exits 0 — including when the batch is empty (`{"events":[]}`). It never prints prose to stdout.
- [x] `corpus queue complete <id>`, `corpus queue fail <id> [--reason <text>]`, `corpus queue abandon <id>` transition the event server-side; unknown id → server error, exit 5; already-in-that-state → reported, exit 0.
- [x] `corpus queue reap-stale` _(no `--older-than`; struck by adjudication 3)_ recovers stuck `in-progress` events and prints (or `--json` lists) what was reaped; zero reaped is a silent exit 0.
- [x] `corpus queue halt` and `corpus queue resume` toggle the kill switch and are idempotent; `corpus queue status` (or `halt --status`) reports the current halt state — pick one and document it in the registry.
- [x] `corpus lock break <docId>` force-releases a document lock (the CLI-side twin of the UI's force-unlock button) and `corpus lock reap` clears expired locks; both report what changed and are idempotent.
- [x] `corpus job log <eventId> "<line>"` appends a progress line to that job's log stream (also accepts the line from stdin when the positional is omitted); success is silent, exit 0. It must be cheap enough to call many times per job.
- [x] `idle` interrupted by SIGINT exits **0** cleanly (in-flight request aborted, no stack trace, no partial JSON) — Ctrl-C during parking is normal operator behaviour.
- [x] A server restart mid-poll is retried **once** (backoff widened to 2 s — a real restart takes ~0.75 s and 500 ms retried into the gap; see the E2E log); a second consecutive transport failure exits 4 loudly with the "run `corpus server start`" guidance.
- [x] All JSON shapes emitted by these commands are documented in the registry examples and therefore in the generated `docs/cli.md`; changing a shape without regenerating fails the drift check.
- [x] Vitest coverage for the long-poll loop (event, timeout, halt, restart-retry, SIGINT), the claim-all empty batch, and exit-code mapping.

## Sprint-006 Adjudications (binding, 2026-07-27)

Orchestrator decisions — implement exactly these; full reasoning in `issues/sprints/sprint-006.md`:

1. **The idle wait flag is `--wait <seconds>`** (not `--timeout`, which is the global transport flag and collides at registry load) and the long-poll request carries its OWN AbortSignal so the 10 s transport timeout never aborts a 480 s park. AGENT-002's skill text will use this name.
2. **`corpus lock break` sends `actor: user`** — it is an operator recovery command run by a human terminal, not part of the agent loop (the server is user-only on break by adjudication); say so in the verb help.
3. **`reap-stale` takes no `--older-than`** (the contract declares no such param — it would be silently ignored).
4. **The segmenting loop collapses** to single requests while MAX_IDLE_TIMEOUT_SECONDS is 480 — implement the simple form, keep the rearm loop shape for when the constant diverges.
5. **The db rebuild/reopen handoff moves to CLI-003** (its routes arrive via the CONTRACT-006 rider + SERVER-017 mount).

6. **Verb-surface adjudication at harvest (2026-07-27)**: the shipped surface includes lock acquire/release/list and job list/retry/abandon — sprint-006's Out-of-Scope strike loses to this issue's own title and ACs ("Queue, lock, job verbs"); the verbs are tested and registry-documented, and UI-011/CLI-003 consume rather than re-create them. The `ReapStaleResult` missing `failed` field is recorded as a CONTRACT-007 rider candidate.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/{idle,claim-all,complete,fail,abandon,reap-stale,halt,resume}.ts`
- `apps/cli/src/commands/queue/poll.ts` — the long-poll window loop (abortable, retry-once, halt-aware)
- `apps/cli/src/commands/lock/{break,reap}.ts`
- `apps/cli/src/commands/job/log.ts`
- `apps/cli/src/registry/index.ts` — register the `queue`, `lock`, `job` topics
- `apps/cli/src/signals.ts` — SIGINT/SIGTERM handling that resolves in-flight aborts into clean exits
- `docs/cli.md` — regenerated
- colocated `*.test.ts`

### Key Implementation Details

- **`corpus queue halt [--reason <text>]`** _(SERVER-008 fix handoff, 2026-07-27)_: the contract's halt body carries an optional `reason` recorded in the `.corpus/HALT` sentinel; the verb must pass `--reason` through the JSON body (bare halt sends no body — do not send `{"reason":""}`, the server 400s blank reasons).


- **`corpus db rebuild`'s reopen handoff moved to CLI-003** _(adjudication 5)_: no `db` verb is built here.

**Poll loop.** `pollWindow({ client, totalMs, signal })`: compute a deadline, then loop issuing `GET /api/queue/idle?wait=<segmentSeconds>` with an `AbortController` whose timeout is the segment cap plus a margin. Server responses are one of: `{ event }` → return it immediately; `{ idle: true }` (segment expired, or halted) → continue if time remains; transport failure → retry once after ~500 ms, then fail. The remaining window shrinks monotonically; never extend past the deadline. The default `totalMs` is 8 minutes; the segment cap comes from the server's advertised maximum (SERVER-008) with a client-side fallback.

**Zero-token parking.** The command must produce **no output at all** while parked — no heartbeat lines, no dots. The whole point is that the agent's context grows by one line per 8-minute window.

**Halt handling.** Halted is a server-side state; the client does not read `.corpus/HALT` (it may not even be on the same machine later). The server's idle response distinguishes "halted" from "no events"; `idle` treats both as park-and-continue, but `--json` output preserves the distinction in the final timeout object (`reason: "halted" | "timeout"`) so the skill can log why it woke.

**Signals.** Install handlers for SIGINT/SIGTERM at command start: abort the controller, skip any further retries, flush nothing, `process.exit(0)`. Remove the handlers when the command completes so tests don't leak listeners.

**claim-all output contract.** Always a single-line JSON object on stdout, nothing else, even in human mode — this command exists for machine consumption and the batch is the payload. Document that explicitly in the registry description so nobody "improves" it with a summary line.

**`job log` cost.** One `POST` with a tiny body; no workspace re-resolution beyond the standard dispatcher path; no `--json` output on success. Accept the line from stdin when the positional argument is absent so hooks can pipe into it.

**Idempotence everywhere.** `complete` on an already-completed event, `halt` when halted, `lock break` on an unlocked document, `reap-stale` with nothing stale: all exit 0 with a stated no-op. The agent loop must never crash on a duplicated call after a retry.

### Edge Cases
- `idle` returns an event, but the agent crashes before `claim-all` → the event stays `pending`; the next `idle` returns it again. `idle` must therefore be **non-destructive** (it observes, it does not claim).
- Multiple `idle` clients on the same workspace (two agent processes) → both may wake; `claim-all` is the atomic step, so a wake with an empty subsequent batch is normal and must exit 0 silently.
- `claim-all` returning a very large batch → single JSON line may be long; do not paginate, do not pretty-print (one line keeps the agent's parsing trivial).
- Server restarts between `idle` and `claim-all` → normal HTTP error path (exit 4/5); the skill re-enters the loop.
- SIGINT arriving in the retry backoff window → exit 0 immediately, do not complete the backoff.
- Clock skew / long GC pause pushing past the deadline mid-request → finish the in-flight request; return its result if it carries an event, otherwise time out.
- `--timeout 0` → single non-blocking check (useful for tests and for a "is there anything queued?" probe); document it.
- `job log` with a line containing newlines → the server owns JSONL framing; the CLI sends the raw string and must not split it itself.

## Testing Strategy
Vitest in `apps/cli`, colocated, against a **real** `node:http` stub server on an ephemeral port that can be scripted per-test (hold a request open, respond late, close the socket mid-request, restart on the same port):
- `queue/poll.test.ts` — event arrives mid-segment → returns immediately with the event; all segments expire → single timeout result within the window, exit 0; halted responses → `reason: "halted"`; socket closed mid-poll once → retries and succeeds; closed twice → exit 4.
- `queue/idle.test.ts` — no stdout output while parked (capture and assert empty until resolution); `--timeout 0` performs exactly one request; SIGINT (dispatched to the handler under test) resolves to exit 0 with no output.
- `queue/claim-all.test.ts` — empty batch prints `{"events":[]}` and nothing else; non-empty batch is a single parseable line in both modes.
- `queue/transitions.test.ts` — complete/fail/abandon/reap-stale/halt/resume request shapes and idempotent no-op output.
- `lock/*.test.ts`, `job/log.test.ts` — request shape, silent success, stdin-sourced line.
- Timing assertions use fake timers where possible; the "returns immediately" assertion uses a real elapsed-time bound (< 1 s) against the stub.

## E2E Verification Plan

### Verification Steps
1. Real workspace + real server (`corpus init`, `corpus server start`), installed binary for every command.
2. Parking: in terminal A run `time corpus queue idle --json`. In terminal B, enqueue a real event by posting an `@agent` comment through the API (`POST /api/threads` / `POST /api/threads/:id/turns` with the agent flag). Terminal A returns within a second with the event JSON; `time` confirms it, and nothing was printed while parked.
3. Rearm: run `corpus queue idle --timeout 20` with an empty queue → exits 0 after ~20 s printing the timeout object; `echo $?` → 0.
4. Non-destructive `idle`: after step 2, run `corpus queue claim-all` → the same event id appears in the batch (proving `idle` did not consume it), and `.corpus/queue/in-progress/` now holds it.
5. `corpus queue claim-all` again → `{"events":[]}`, exit 0.
6. `corpus queue complete <id>` → the file moves to `processed/`; run it again → no-op message, exit 0. Repeat the flow with `fail --reason "…"` → `failed/`, and `abandon` → `abandoned/`.
7. Halt: `corpus queue halt`, enqueue another event, run `corpus queue idle --timeout 15` → parks and times out with `reason: "halted"`; `corpus queue claim-all` → empty batch. `corpus queue resume` → the next `idle` returns the pending event.
8. SIGINT: start `corpus queue idle`, Ctrl-C after a few seconds → clean exit, `echo $?` → 0, no stack trace.
9. Server restart mid-poll: start `corpus queue idle`, `corpus server stop && corpus server start` → observe the single retry recovering the window; then `corpus server stop` alone → the command exits 4 with the "run `corpus server start`" message.
10. Stale recovery: claim an event and kill the consumer, then `corpus queue reap-stale --older-than 1s` → the event returns to `pending`; confirm on disk.
11. Locks: acquire a document lock through the server (agent edit in flight, or `POST` the lock endpoint), confirm the UI/API shows it, then `corpus lock break <docId>` → lock cleared, break recorded in the audit trail. Create an expired lock and run `corpus lock reap` → cleared.
12. Job logs: `corpus job log <eventId> "step 1: reading thread"` twice → both lines appear in `.corpus/jobs/<eventId>.jsonl` and stream into `GET /api/jobs/:id/log`; the UI console row (if running) shows the latest line live.
13. Pipe every JSON-emitting command through `jq .` → all parse.

## E2E Verification Log

**Implemented on: opus.** Worktree `.claude/worktrees/cli-004`.
**Real application**: the built bin `apps/cli/dist/bin/corpus.js` (not `tsx`), against a real
`corpus init` workspace `/private/tmp/corpus-c004-mjLm4F` whose server was started by
`corpus server start` on **port 8915** (sprint-006's assigned range). Scratch prefix
`/tmp/corpus-c004-XXXXXX`. Every figure below is measured, not estimated.

### Adjudications as implemented

| Adjudication | Shipped as |
| --- | --- |
| 1 — parking flag | `--wait <seconds>`, default `480` from `DEFAULT_IDLE_TIMEOUT_SECONDS`. The global `--timeout` keeps its transport meaning. |
| 1 — own AbortSignal | The poll goes through a new `CliClient.untimedApi`, see "Escalation 1". |
| 2 — `lock break` actor | Sent with `x-corpus-author: user`, stated in the verb's help. |
| 3 — `reap-stale` | No `--older-than`; help says the threshold is the server's. |
| 4 — segmenting loop | `min(remaining, MAX_IDLE_TIMEOUT_SECONDS)`, imported not literal. One request at the default; capped at 480 for a longer window. |
| 5 — `db` handoff | Not implemented here; belongs to CLI-003. |
| Open Conflict 10 | Expiry reason comes from one extra `GET /api/queue/status`. |
| Open Conflict 12 | Transitions print state (`event <id> is complete.`), never a claimed move. |
| Open Conflict 13 | `claim-all` uses `out.write` in human mode, `out.emit` under `--json`; `Output.write`'s doc comment names it as the second legitimate caller. |
| Open Conflict 15 | `corpus queue status`, not `halt --status`. |

### Deferred, with substitute evidence

- **A `comment.created` produced by the product** — `DEFERRED → SERVER-006`. That issue is not
  in this worktree: `grep -rn "enqueue(" apps/server/src | grep -v test` returns only
  `queue/service.ts:153` (the definition), so **nothing in the shipped server enqueues**, exactly
  as the sprint's merge order predicts. Substitute: real `evt_*.json` files written into
  `.corpus/queue/pending/` of the real workspace, read by the real server. This is stronger than
  it sounds for the parking claim — it is the path that proved the 142 ms wake below.
- **TEST-121…132 (the cross-issue centrepiece)** — `DEFERRED → SERVER-006` + the integration run,
  per the sprint's own ordering ("CLI-004 third, rebased onto SERVER-006").
- **TEST-106's audit-trail assertion** was still verified, on a user-held lock (see Locks).

### Reproduction (bugs only)
_N/A — feature issue._

### Post-Implementation Verification

#### Surface, help and docs (TEST-77…81)

```
$ node apps/cli/dist/bin/corpus.js --help
Topics:
  server  Manage this workspace's server process.
  queue   Park on, claim and settle the agent's event queue.
  lock    Coordinate who may edit a document.
  job     Follow and settle the agent's work in progress.

$ corpus queue --help
Verbs: idle, claim-all, complete, fail, abandon, reap-stale, halt, resume, status
$ corpus lock --help   → break, reap, list, acquire, release
$ corpus job  --help   → log, list, retry, abandon
```

The registry loads at import (TEST-77) — an earlier iteration proved the check is live: an
example written as `echo "…" | corpus job log …` failed module load with
`corpus job log example 2 is not a \`corpus …\` command line`, and the bin refused to run at all
until it was fixed.

`docs/cli.md` regenerates to a **fixed point**: `md5 -q docs/cli.md` is
`a51a89038bc3634e4a8642736903deff` before and after `npm run docs:cli -w apps/cli`.
`scripts/check-generated-artifacts.ts` reports the API contract green and `docs/cli.md` as
differing **from HEAD only** — its regeneration half (hash before vs. after) passes, which is why
the failure prints a `git diff` summary rather than the "regeneration changed it" message. That
half goes green the moment the file is committed with the rest of the issue; it cannot be green
while the work is deliberately left uncommitted.

#### Parking (TEST-82…91)

```
$ corpus queue idle --wait 20 --json     # 20 s park, empty queue, streams captured to files
at t+8s   process alive: yes   stdout bytes: 0   stderr bytes: 0
exit code: 0   elapsed: 20s
stdout: {"idle":true,"reason":"timeout"}   stderr: []
```

**Parking is byte-silent** (TEST-83) and the timeout is a clean exit 0 at exactly the window
(TEST-84).

```
$ corpus queue idle --wait 30 --json &   # parked, then a real event file lands at t+3s
{"events":[{"id":"evt_aaaa0001","type":"comment.created","created":"2026-07-27T10:00:00Z",
            "source":"e2e","payload":{"threadId":"th_aaaa0001","parentId":null}}]}
wake latency after drop: 0.142s      exit 0
```

**142 ms** from event to return (TEST-82). Afterwards `.corpus/queue/pending/` still holds
`evt_aaaa0001.json` and `in-progress/` is empty — **idle observed, it did not claim** — and a
second `idle` returned the same event again (TEST-87).

Request counts, read out of the server's own access log (`.corpus/server.log`):

| Invocation | Requests the server saw |
| --- | --- |
| `corpus queue idle` (default window) | `GET /api/queue/idle timeout=480` — **one** (TEST-85) |
| `corpus queue idle --wait 600` | `GET /api/queue/idle timeout=480` — capped at the server's max, so a longer window segments |
| `corpus queue idle --wait 0 --json` | `GET /api/queue/idle timeout=1` **then** `GET /api/queue/status` |

`--wait 0` is one poll plus the reason probe, and it measured **1.217 s** — not instant, because
`IdleQuerySchema.timeout` is `min(1)` and the server honours that second (TEST-90; the log states
what went on the wire, as the sprint asked). The window shrinks monotonically: after the restart
below, the resumed poll asked `timeout=16` on a 25 s window rather than starting over.

Halt (TEST-88/89):

```
$ corpus queue halt --reason "maintenance window"
queue halted (maintenance window) — pending 0, in-progress 0, processed 1, failed 1, abandoned 1
$ cat .corpus/HALT
{ "at": "2026-07-27T11:01:36Z", "reason": "maintenance window" }
$ corpus queue halt                      # bare re-halt: no body, sentinel loses the reason
$ cat .corpus/HALT
{ "at": "2026-07-27T11:01:37Z" }
# an event enqueued while halted still lands: evt_dddd0004.json in pending/
$ corpus queue idle --wait 8 --json  →  {"idle":true,"reason":"halted"}      exit 0
$ corpus queue claim-all             →  {"events":[]}                        exit 0
$ corpus queue resume  (twice)       →  exit 0, exit 0; sentinel gone
$ corpus queue idle --wait 10 --json →  the same evt_dddd0004
```

Two idle clients on one workspace (TEST-91): both returned the event, both exit 0; the winner's
`claim-all` carried it and the **loser's returned `{"events":[]}` silently, exit 0**.

#### claim-all (TEST-92…95)

```
$ corpus queue claim-all | od -c        (empty queue, human mode)
0000000    {   "   e   v   e   n   t   s   "   :   [   ]   }  \n
```

Byte-identical under `--json`. After claiming: `pending: 0  in-progress: 1`. A **200-event**
batch came out as **1 line, 30013 bytes**, `jq -r '.events | length'` → `200`, and the next call
was `{"events":[]}` (TEST-95).

#### Transitions (TEST-96…100)

```
$ corpus queue complete evt_aaaa0001    → event evt_aaaa0001 is complete.   exit 0
  .corpus/queue/processed/evt_aaaa0001.json exists; in-progress: 0
$ corpus queue complete evt_aaaa0001    → event evt_aaaa0001 is complete.   exit 0   (identical)
$ corpus queue fail evt_bbbb0002 --reason "hook rejected"  → failed/, on disk: "error":"hook rejected"
$ corpus queue fail  (bare)             → request body empty, never {"reason":""}
$ corpus queue abandon evt_cccc0003     → DELETE /api/queue/{id}; file is in abandoned/, not gone
$ corpus queue complete evt_zzzz9999    → exit 5, stdout empty
  stderr: corpus: 404 not_found: no queue event evt_zzzz9999
  --json stderr: {"error":{"code":"not_found","message":"404 not_found: no queue event evt_zzzz9999"}}
```

#### halt/status/reap-stale (TEST-101…105)

`queue status --json` → `{"halted":false,"pending":0,"inProgress":0,"processed":1,"failed":1,"abandoned":1}`,
matching the per-directory `evt_*.json` counts. `reap-stale` with nothing stale printed **nothing**
and exited 0 (`{"reaped":[]}` under `--json`). A claimed event whose `in-progress` file was aged to
`2020-01-01` was recovered after a server restart:

```
$ corpus queue reap-stale  → returned 1 stale event(s) to pending: evt_eeee0005
$ corpus queue idle --wait 5 --json → the same event, back in pending
```

`POST /api/queue/reap-stale` went out with **no query string** — the threshold is the server's.

#### Locks (TEST-106…110, TEST-124)

```
$ corpus lock acquire doc_seedattention --ttl 300 → locked … for agent, lease 300s
$ curl -X PUT /api/docs/doc_seedattention -H 'x-corpus-author: user'   → http=423
  {"code":"locked","message":"doc_seedattention is being edited by agent…","lock":{…}}
$ corpus lock release … ; user takes the lock over HTTP (201)
$ corpus lock acquire doc_seedattention   → exit 5
  corpus: 409 conflict: doc_seedattention is locked by user until its lease expires
    {"docId":"doc_seedattention","holder":"user","acquired":"…","ttl":300}
$ curl -X PUT /api/docs/doc_seedattention -H 'x-corpus-author: agent' → http=423
$ corpus lock break doc_seedattention --json
  {"docId":"doc_seedattention","broken":true,"holder":"user"}                    exit 0
  .corpus/locks/doc_seedattention.json gone; corpus lock list → no locks held.
$ curl -X PUT … -H 'x-corpus-author: agent' → http=200      (the path re-opened)
$ corpus lock break doc_seedattention        → no lock held on doc_seedattention.   exit 0
$ corpus lock break doc_seedattention --json → {"docId":"doc_seedattention","broken":false} exit 0
```

The break is in the audit trail as a **user**-authored commit, which is also the proof the actor
override works — an agent-actor break would have been a 403:

```
$ git log --format='%an <%ae> %s'
agent <agent@corpus.local> doc edit: Attention (doc_seedattention) by agent
user <user@corpus.local>  lock: force-break on doc_seedattention (was user) by user
user <user@corpus.local>  workspace: initialize corpus workspace by user
```

`lock reap`: a live 300 s lease survived (`no expired locks.`, lock still listed); a 1 s lease was
cleared (`cleared 1 expired lock(s): doc_seedattention`) and the second call reported nothing,
exit 0.

#### Job logs (TEST-111…114)

```
$ corpus job log evt_aaaa0001 "step 1: reading the thread"   → exit 0, stdout EMPTY
$ echo "step 2: writing the reply" | corpus job log evt_aaaa0001  → exit 0, stdout EMPTY
$ cat .corpus/jobs/evt_aaaa0001.jsonl
{"ts":"…","source":"cli","line":"step 1: reading the thread"}
{"ts":"…","source":"cli","line":"step 2: writing the reply"}
$ curl -H "Authorization: Bearer <token>" /api/jobs/evt_aaaa0001/log
{"lines":[…two…],"nextCursor":2}
```

The tokenless hole and the CLI are **separate paths**, both exercised (TEST-114):

```
$ curl -X POST /api/jobs/evt_aaaa0001/log -d '{"line":"from a hook, no token"}'   # NO Authorization
http=201   {"eventId":"evt_aaaa0001","appended":true}
$ corpus job log evt_aaaa0001 "step 3" --json  → {"eventId":"evt_aaaa0001","appended":true}
  (the request carried Authorization: Bearer … — the CLI does not strip its token to imitate a hook)
$ curl -H "Authorization: …" /api/jobs/evt_aaaa0001/log
{"n":4,"nextCursor":4,"lines":["step 1: reading the thread","step 2: writing the reply",
                               "from a hook, no token","step 3"]}
$ curl /api/jobs/evt_aaaa0001/log            # tokenless READ
http=401
```

Interior newlines are the server's problem: `corpus job log <id> "a\nb"` went out as **one**
request with the raw string (unit-tested; the CLI never splits).

#### Signals, transport, exit codes (TEST-115…119)

```
SIGINT  during a park: exit=0  stdout=[]  stderr=[]   shutdown latency 0.027s
SIGTERM during a park: exit=0  stdout=[]  stderr=[]   shutdown latency 0.034s
```

No stack trace, no partial JSON, nothing left in `in-progress/` by the parks themselves.

```
A) corpus server stop && corpus server start under a parked `idle --wait 25`
   → idle alive: yes; exit 0 with {"idle":true,"reason":"timeout"} after the full window,
     the resumed poll asking timeout=16 (the remaining window, not a fresh one)
B) corpus server stop alone under a parked idle
   → exit 4, stdout empty, stderr verbatim:
     {"error":{"code":"server_unreachable",
               "message":"server not running for this workspace — run `corpus server start`"}}
```

**(A) failed the first time and is the one behaviour change this issue made beyond its design**:
with the specified 500 ms backoff the single retry landed *inside* the restart gap and reported a
live workspace as unreachable (exit 4). A real `corpus server stop && corpus server start` measures
**0.757 / 0.744 / 0.746 s** on this machine, so `IDLE_RETRY_BACKOFF_MS` is now **2 s** — still one
retry, still "short" (0.4% of the window it interrupts), but sized against the failure it exists
for. TEST-117 passes only because of that change.

Exit-code table, all observed, no new code introduced:

| Code | Observed on |
| --- | --- |
| 0 | every success, plus timeout, halted timeout, SIGINT/SIGTERM, `lock break` on an unlocked doc, repeated transitions |
| 2 | `corpus queue nope`, `corpus queue complete` (missing `<event-id>`), `corpus queue idle --window 5` |
| 3 | `corpus queue status` run from `/tmp` — "not inside a Corpus workspace — run `corpus init` here or pass --workspace" |
| 4 | server stopped under a parked idle |
| 5 | unknown event id (404), lock conflict (409, with the holder in details) |

Errors never touched stdout in either mode; under `--json` stderr carried `{"error":{…}}` and
stdout stayed empty.

`--timeout` and `--wait` are genuinely independent: `corpus queue idle --timeout 250 --wait 0 --json`
exits **0** with the timeout object. Before the `untimedApi` fix that command — and every park
longer than ten seconds — aborted at the transport timeout.

Every JSON-emitting verb piped through `jq` (TEST-81):

```
queue status    ["abandoned","failed","halted","inProgress","pending","processed"]
queue claim-all ["events"]     queue reap-stale ["reaped"]    queue idle --wait 0 ["idle","reason"]
lock list       ["locks"]      lock reap        ["reaped"]    lock break ["broken","docId"]
job list        ["jobs"]       job log          ["appended","eventId"]
```

#### Gate

`npm run build && npm run lint && npm run format:check && npm run typecheck && npm run test:coverage`
— all green from the worktree:

- **169 test files, 2888 tests, 0 failures** (CLI alone: 40 files, 411 tests).
- Coverage **98.81% lines / 98.81% statements / 99.32% functions / 95.07% branches** — the 90% gate
  passes on all four.
- ESLint clean (one real finding fixed rather than suppressed: `unbound-method` on the test
  harness's `stdout`/`stderr` handles).
- Prettier clean; `tsc --noEmit` clean in all five workspaces.

#### Cleanup

Server stopped by pid via `corpus server stop`; every backgrounded `idle` was started with node's
own pid captured and killed by pid (`kill -INT <pid>`), never `pkill`. `lsof -nP -iTCP:8915` free;
`pgrep -fl "corpus.js queue idle"` empty; the scratch workspace was removed by its captured path
only.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain — the agent loop's contract with the server)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-004]` prefix
