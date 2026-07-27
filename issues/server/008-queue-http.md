# [SERVER-008] Queue over HTTP: event store + long-poll

## Domain
server

## Status
in_progress

## Priority
P0

## Model
opus — the queue mechanics are pinned by §7; the only deviation (long-poll replacing `fs.watch`) is already decided by Architecture Decision 4.

## Dependencies
- Depends on: SERVER-003, CONTRACT-002, SERVER-004 (merge order; shared app.ts + events mirror)
- Blocks: CLI-004

## Spec References
- SPEC.md §7 — "Event queue and agent loop" (queue contract, statuses, verbs, HALT sentinel)
- SPEC.md §9.1 — projection `events` table (queue mirror)
- SPEC.md §9.2 — `DELETE /api/queue/:id` (abandon)
- CLAUDE.md — Architecture Decision 4 (queue parking over HTTP: `corpus queue idle` long-polls the server, ~8 min rearm), Decision 2 (server is the sole writer)

## Summary
Implement the file-backed event queue and the HTTP surface the agent drives it through. Events remain JSON files under `.corpus/queue/<status>/<id>.json` exactly as §7 specifies, but the agent no longer watches the filesystem: `corpus queue idle` becomes a **long-poll** held open by the server until a pending event lands or the request times out (the CLI rearms roughly every 8 minutes). The server exposes claim-all, complete/fail/abandon, reap-stale, and halt/resume on top of the same file layout, mirrors every transition into the projection's `events` table, and broadcasts an invalidation so the console updates live.

## Acceptance Criteria
- [x] Events are JSON files at `.corpus/queue/<status>/<id>.json` with the §7 shape (`id`, `type`, `created`, `source`, `payload`); statuses are `pending`, `in-progress`, `processed`, `failed`, `abandoned`.
- [x] An internal `enqueue(event)` writes a pending event atomically (temp file + rename), projects it, invalidates, and wakes any parked long-poll waiter. SERVER-006 consumes this function.
- [x] The long-poll idle endpoint returns **immediately** when `pending` is non-empty, otherwise holds the request open until an event arrives or the timeout elapses. _Per Sprint-003 Adjudication 1 the timeout is **validated, not clamped**: `IdleQuerySchema` (1–480 s, default 480) rejects anything larger with a `400`._
- [x] While `.corpus/HALT` exists, idle **parks** (never returns events, times out normally) and claim-all returns an empty batch.
- [x] Claim-all atomically renames every current `pending/*` into `in-progress/` and returns them as one JSON batch; concurrent calls never hand the same event to two callers.
- [x] Complete, fail, and abandon move an event to `processed`, `failed`, and `abandoned` respectively, addressed by id; fail records the error message on the event JSON.
- [x] Reap-stale moves `in-progress` events older than a threshold back to `pending` (bumping an attempt counter) and sends events past the attempt cap to `failed`. _Threshold (900 s) and cap (3) are server-side constants; the route takes no query (Adjudication 1)._
- [x] Halt creates the `.corpus/HALT` sentinel (with reason + timestamp), resume removes it; a status endpoint reports halted state and per-status counts.
- [x] Every transition updates the projection's `events` table and broadcasts an invalidation for the queue/jobs keys. _The `events` table itself is SERVER-004's; this issue calls the `QueueMirror` seam (`upsertEvent` / `replaceAllEvents`) synchronously before responding, and `QueueInvalidate` with `[["queue"],["jobs"]]`. Both default to no-ops until SERVER-004/SERVER-007 are wired in via `createServer`'s `queueMirror` / `invalidate` deps._
- [x] The queue projection is rebuilt from the directories at boot, so a server restart never loses or duplicates events.

## Sprint-003 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-003 Open Conflicts affecting this issue — implement exactly these; full reasoning in `issues/sprints/sprint-003.md`:

1. **The contract wins, three ways**: idle responses are the declared `IdleResult` 200 / bodiless 204 shapes (this issue's `{pending:n}`/`{timedOut:true}`/`{halted:true,events:0}` sketches are superseded); a timeout above `IdleQuerySchema`'s max(480) is a 400 from the validation hook, not a clamp; `reap-stale` takes no query parameter and returns the declared `{reaped}` shape — do not implement `?olderThan=` (it would be silently ignored, making tests false-pass).
2. **Waiter registry gets a ~500 ms poll fallback** so a file appearing in `pending/` wakes parked waiters even with no in-process enqueue path. This is a permanent robustness feature (out-of-band event drops are as legitimate as out-of-band doc edits per §2.2 rule 1), not a temporary shim for SERVER-006's absence.
3. **`evt_*.json` is the only thing that counts as an event, everywhere** — `.gitkeep` files in the queue directories are invisible to counts, claims, and reaps.
4. **Merge order**: SERVER-004 lands first; this issue's Depends-on gains SERVER-004 (shared `app.ts` + events mirror).

## Technical Design

### Files to Create/Modify
- `apps/server/src/queue/store.ts` — directory layout, atomic writes/renames, read/list, status transitions, HALT sentinel
- `apps/server/src/queue/service.ts` — the `QueueService`: `enqueue()` (consumed by SERVER-006) plus idle/claim/transition/reap/halt, over one store + one waiter registry _(replaces the planned `enqueue.ts`: the operations share the store, the mirror, the invalidator and the write mutex, so they are one object rather than free functions each taking five collaborators)_
- `apps/server/src/queue/waiters.ts` — long-poll waiter registry (resolve on enqueue, abort on disconnect)
- `apps/server/src/queue/routes.ts` — handlers bound to the CONTRACT-002 queue route definitions
- `apps/server/src/queue/project.ts` — queue → `events` table mirror + boot rebuild
- `apps/server/src/queue/*.test.ts` — colocated Vitest specs
- `apps/server/src/app.ts` — mount the queue routes; rebuild the mirror on boot

### Key Implementation Details

**Layout and ids.** Ensure all five status directories exist at boot. Ids are `evt_<12 lowercase base36 chars>`; validate against `/^evt_[a-z0-9]+$/` on every id-addressed route before touching the filesystem (path-traversal defense). Writes are `write(tmp) → rename(final)` within the same directory so a reader never sees a partial file.

**Long-poll idle.** _Response shapes below are the contract's, per Adjudication 1._ The handler loops until its deadline:
1. Read what is available: `[]` while HALT is set, otherwise every parseable `pending/evt_*.json` (a corrupt file is skipped, never quarantined — `idle` is a read path).
2. Anything available → `200 {events: [...]}` immediately.
3. Otherwise park: a promise in the waiter registry, released by an in-process `enqueue`/`resume`/`reapStale`, by the ~500 ms poll (Adjudication 2), by the request's `AbortSignal`, or by the window expiring. Woken with nothing to show → park again for what is left of the window. Expired, aborted or shutting down → **`204`, no body**.

The window is `IdleQuerySchema`'s `timeout` (1–480 s, default 480); anything larger is a `400` from the validation hook. Every exit path removes the waiter and clears its timer — including a client that hung up. Idle reports *availability*; it does not claim. The agent's loop is `idle → claim-all`.

**Claim-all.** Serialize with an in-process async mutex. Snapshot `readdir(pending)`, then rename each entry into `in-progress/`, tolerating `ENOENT` (another actor or a reap raced) by skipping that file. Parse each claimed file; a malformed JSON file is moved to `failed/` with an `error` field instead of poisoning the batch. Events enqueued *during* a claim simply stay in `pending` and are returned by the next claim — no attempt to make the snapshot transactional beyond the rename loop. Returns `[]` while halted, without touching the filesystem.

**Transitions.** `complete(id)`, `fail(id, error?)`, `abandon(id)` locate the event in any status directory, rewrite the JSON with `status`, `updated`, and (for fail) `error`, and rename into the target directory. Transitioning an event already in the target status is idempotent (200). An unknown id → 404.

**Reap-stale.** `POST /api/queue/reap-stale` (threshold 900 s, cap 3, both server-side constants — Adjudication 1): for each `in-progress` file whose `updated`/mtime is older than the threshold, increment `attempts` and move back to `pending`; when `attempts` exceeds the cap (default 3), move to `failed` with `error: "stale: exceeded attempt cap"`. Returns the counts of each outcome.

**HALT.** `.corpus/HALT` holds `{reason?, at}`. Halt is idempotent (rewrites the sentinel), resume unlinks it (idempotent when absent). Halting also wakes nothing — parked waiters keep parking until their timeout, which is the correct "the agent stops picking up work" behavior.

**Projection + invalidation.** Every mutation (`enqueue` and each transition) upserts the `events` row (`id`, `type`, `status`, `created`, `payload_json`) synchronously before responding, then calls the SERVER-007 bus with the queue/jobs keys. The watcher's `.corpus/queue/` coverage remains the catch-all for out-of-band changes (someone moving a file by hand, or the CLI in a future direct-write scenario) but must not double-broadcast for server-originated writes (self-write suppression from SERVER-007).

**Boot rebuild.** On startup, clear the `events` table and re-insert from the five directories, so the mirror can never drift across a restart or a crash mid-transition.

### Edge Cases
- Two concurrent `claim-all` calls → mutex plus `ENOENT` tolerance guarantee disjoint batches and no duplicates.
- Long-poll client drops the connection (agent killed, network hiccup) → the waiter is removed via the abort signal; no leaked timers, no leaked handles.
- Events arriving mid-claim → remain pending, picked up by the next claim; any parked waiter is still woken.
- A very large pending backlog → claim-all returns everything in one batch (the agent's loop expects one batch); guard the response size only by streaming JSON if it becomes a problem, do not silently truncate.
- Duplicate enqueue of the same id → treated as an overwrite of the pending file, not a second event.
- Malformed or truncated event JSON on disk → moved to `failed` with an error, logged, never crashes claim-all or the boot rebuild.
- Id containing `..`, `/`, or URL encoding → 400 before any filesystem access.
- Halt set while a claim is in flight → the in-flight claim completes; subsequent claims return empty.
- Server restart with events in `in-progress` → they stay in-progress until reaped (that is what reap-stale is for).

## Testing Strategy
Vitest in `apps/server` against a temp workspace fixture, driving the real Hono app via `app.request()`:
- Store: enqueue writes a valid pending file; each transition moves the file to the right directory and preserves the payload.
- Long-poll: (a) returns immediately when pending is non-empty; (b) parks then resolves when an `enqueue` happens mid-wait; (c) times out with `timedOut: true` (fake timers); (d) an aborted request removes its waiter (assert the registry is empty).
- HALT: idle parks and claim-all returns `[]` while halted; both resume normal behavior after resume.
- Claim-all concurrency: enqueue 50 events, fire 5 concurrent claim-all calls, assert the union is exactly 50 with no duplicates and `pending/` is empty.
- Reap-stale: backdate an in-progress file → returns to pending with `attempts: 1`; past the cap → lands in `failed`.
- Projection mirror: after each transition, the `events` row's status matches; boot rebuild reconstructs the table from a hand-seeded directory tree.
- Invalidation: spy on the bus, assert one invalidation per transition with the queue key.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace with the bearer token exported.
2. Park: `time curl -s -X POST "localhost:8765/api/queue/idle?timeout=10" -H "Authorization: Bearer $TOKEN"` with an empty queue → returns after ~10 s with `timedOut: true`.
3. Wake: start `curl` on idle with a 60 s timeout in one terminal; in another, trigger a real enqueue by posting an `@agent` comment (`POST /api/threads`) → the idle call returns within a few hundred ms and `ls .corpus/queue/pending/` shows the event.
4. Claim: `curl -X POST localhost:8765/api/queue/claim-all -H "Authorization: Bearer $TOKEN"` → JSON batch returned; `ls .corpus/queue/pending/` empty, `ls .corpus/queue/in-progress/` holds the file.
5. Concurrency: enqueue several events, then run three `claim-all` calls in parallel (`&` + `wait`) → the union of returned ids equals the enqueued set, with no id returned twice.
6. Complete/fail/abandon: transition three different events and `ls` each status directory; `cat` a failed event and confirm the `error` field.
7. Reap: `touch -t` an in-progress file into the past, `curl -X POST .../api/queue/reap-stale?olderThan=1` → it is back in `pending` with `attempts: 1`.
8. Halt: `POST /api/queue/halt` → `ls .corpus/HALT`; claim-all returns `[]`; an idle call parks for its full timeout even with pending events present; `POST /api/queue/resume` → normal behavior returns.
9. Restart the server with events spread across statuses → `GET /api/queue/status` counts match the directories on disk.
10. Connection drop: start an idle long-poll, `kill` the curl, then enqueue an event and issue a fresh idle call → returns immediately; server logs show no unhandled rejection.

## E2E Verification Log

**implemented on: opus.** Worktree `.claude/worktrees/server-008`, port **8785**,
scratch workspace `WS=/tmp/corpus-s008-T12BoQ` (`mktemp -d /tmp/corpus-s008-XXXXXX`),
real server process `CORPUS_WORKSPACE=$WS ./node_modules/.bin/tsx apps/server/src/main.ts`,
driven by real `curl` and real `ls`/`cat`. Every queue directory was seeded with a
`.gitkeep`, exactly as an `init`-produced workspace ships them. Server processes were
stopped by pid (`kill -TERM $SRV`); no `pkill`/`killall` was used.

**Producer used (sprint-003 Open Conflict 5).** `POST /api/threads` is SERVER-006 and does
not exist yet, so events were produced by a **separate process** running the real
`enqueue()` against the same workspace (`tsx /tmp/s008-produce.mts $WS <type> <n>`). This
is strictly stronger evidence for TEST-42 than an in-process producer would be: the server
process cannot be notified in-process by another process, so every wake below went through
the ~500 ms poll fallback.

### Reproduction (bugs only)
Not applicable — new feature, not a bug fix.

### Post-Implementation Verification

**TEST-38 — five directories, §7 shape, `evt_[a-z0-9]{12}` id — PASS**
```
$ cat $WS/.corpus/queue/pending/evt_gwd2p5r2kfub.json
{ "id": "evt_gwd2p5r2kfub", "type": "comment.created", "created": "2026-07-27T01:46:36Z",
  "source": "cli", "payload": { "threadId": "th_x9y8", "i": 0 },
  "status": "pending", "updated": "2026-07-27T01:46:36Z" }
```
`pending/ in-progress/ processed/ failed/ abandoned/` all present after boot.

**TEST-39 — writes are atomic — PASS.** A reader process `readdir`+`JSON.parse`-ing
`pending/` in a tight loop while 200 events were enqueued:
`{"reads":675881,"partial":0,"tmpFilesObserved":188,"vanished":0}` — 675 881 whole-file
parses, **zero** truncated reads, and 188 `.tmp-*` files observed mid-flight (proof the
write really is temp-file-then-rename) none of which was mistaken for an event.

**TEST-40 — idle returns immediately and does not claim — PASS**
```
$ curl -sS -w 'http=%{http_code} time=%{time_total}\n' ".../api/queue/idle?timeout=60" -H "Authorization: Bearer $TOKEN"
http=200 time=0.004211
{"events":[{"id":"evt_gwd2p5r2kfub",…},{"id":"evt_scrzvdrczugy",…}]}
$ ls $WS/.corpus/queue/pending/   → .gitkeep, evt_gwd2p5r2kfub.json, evt_scrzvdrczugy.json
```

**TEST-41 — 204, empty body, full window — PASS**
`http=204 time=10.003882 size=0` for `?timeout=10`; headers show `HTTP/1.1 204 No Content`
and `wc -c` of the body is `0`.

**TEST-42 — a parked idle wakes on an out-of-band event — PASS (the headline behaviour)**
Shell A parked `?timeout=60` at t≈0; shell B wrote the file at `18:47:43.28` (t≈2.28 s);
the parked call returned `http=200 time=2.514839` with `{"events":[{"id":"evt_pkya7qh2wsv6",…}]}`
— **~240 ms** after the file appeared, from a different process, over a real socket.

**TEST-43 — a disallowed timeout is a 400, not a clamp — PASS**
```
?timeout=600 → 400 {"code":"bad_request",…,"issues":[{"path":"query.timeout","message":"Too big: expected number to be <=480"}]}
?timeout=abc → 400 {"code":"bad_request",…,"issues":[{"path":"query.timeout","message":"Invalid input: expected number, received NaN"}]}
```
Omitting `timeout` parks for the 480 s default (schema default; not held open in E2E).

**TEST-44 — a dropped client leaves nothing behind — PASS**
`curl` parked on `?timeout=300`, killed with `kill -TERM` after 2 s. Server log:
`{"method":"GET","path":"/api/queue/idle","status":204,"durationMs":1999,…}` — the request
unwound **when the client went away**, not 300 s later. A fresh idle then returned
`http=200 time=0.001888` with the newly produced event; `/api/health` 200; `grep -c
"unhandled" server.log` → 0; the only error-level line in the whole run is the deliberate
`quarantined malformed queue event`.
_(First attempt at this step hung: a background job in a non-interactive shell ignores
SIGINT, so `kill -INT` never reached `curl`. That is a harness artifact, not server
behaviour — and when the process group finally died the server did unwind the request.)_

**TEST-45 — halted: idle parks, claim-all is empty, files untouched — PASS**
With 1 event pending and `.corpus/HALT` present: `claim-all` → `{"events":[]}`,
`pending/` unchanged, `idle?timeout=10` → `http=204 time=10.005973 size=0`.

**TEST-46 — halt/resume idempotent and reported — PARTIAL / contract gap**
`halt` twice → both `200` with a `QueueStatus` (`"halted":true`); one `HALT` file, rewritten
not duplicated; `resume` twice → both `200` (`"halted":false`), sentinel gone after the
first. **The "second halt with a `reason`" half is unexecutable over HTTP**: the contract's
`haltQueue` route declares no request body or query, so there is no way to send a reason.
The server supports it (`QueueService.halt(reason)` writes `{reason, at}` — covered by
`service.test.ts` "is idempotent in both directions") and the sentinel schema carries the
optional field; adding it to the wire is a CONTRACT change. **Escalated.**

**TEST-47 — claim-all in one batch — PASS.** 3 pending → `200` with all three; `pending/`
holds only `.gitkeep`; `in-progress/` holds all three with payloads identical to what was
enqueued.

**TEST-48 — concurrent claims never double-hand — PASS.** 50 events, 5 parallel `claim-all`:
batch sizes `0,50,0,0,0`; `returned 50 unique 50 enqueued 50`; union equals the enqueued set
exactly; `pending/` ends empty.

**TEST-49 / TEST-50 — transitions, idempotency, 404 — PASS**
```
complete http=200   fail http=200   abandon http=200   complete-again http=200
unknown-id http=404 {"code":"not_found","message":"no queue event evt_doesnotexist"}
```
Files land in `processed/`, `failed/`, `abandoned/`; the failed event on disk carries
`"error": "boom"`; nothing was deleted (`abandoned/evt_mzests3uzenz.json` present).

**TEST-51 — hostile ids rejected before any filesystem access — PASS**
```
POST /api/queue/..%2F..%2Fetc%2Fpasswd/complete   → 400  issues[0].path = "param.id"
POST /api/queue/foo/complete                      → 400  issues[0].path = "param.id"
DELETE /api/queue/evt_..                          → 400  issues[0].path = "param.id"
DELETE /api/queue/..%2F..%2F.corpus%2Fconfig.json → 400  issues[0].path = "param.id"
```
A `find | stat | sort` snapshot of the whole workspace before and after was **byte-for-byte
identical**. One deviation from the test text: `DELETE /api/queue/evt_../complete` returns
**404**, not 400 — `DELETE` is declared on `/api/queue/{id}`, a single segment, so a
two-segment path matches no route at all. `DELETE /api/queue/evt_..` (the addressable form)
is the 400 above.

**TEST-52 — reap-stale — PASS.** Two in-progress files `touch -t 202607261700` (an hour+
back), the second pre-set to `attempts: 3`:
```
{"reaped":["evt_2zrbas2nw5nc"]}
pending/evt_2zrbas2nw5nc.json  → "status":"pending","attempts":1
failed/evt_gu6esrh5nmzu.json   → "attempts":4,"error":"stale: exceeded attempt cap of 3"
```
The capped event is **not** in `reaped`; the 49 untouched in-progress events were left alone.

**TEST-53 — status counts match the directories, `.gitkeep` uncounted — PASS**
```
{"halted":false,"pending":1,"inProgress":49,"processed":1,"failed":2,"abandoned":1}
evt_*.json per directory:      1        49                1           2            1
all files incl .gitkeep:       2        50                2           3            2
```

**TEST-54 — a malformed file poisons nothing — PASS.** `{ truncated` written as
`pending/evt_bad000000000.json`; `claim-all` returned the two good events and moved the bad
one to `failed/` as `{"type":"corpus.malformed", …, "payload":{"raw":"{ truncated\n"},
"error":"malformed event file: not JSON: Expected property name or '}' …"}`. A second bad
file dropped into `processed/` while the server was stopped was reported at boot
(`{"level":"error","msg":"queue boot rebuild skipped malformed events","ids":"evt_bad111111111"}`)
and the server came up normally.

**TEST-55 — mirrored before the response returns — DEFERRED → SERVER-004.** There is no
`events` table in this worktree (SERVER-004 owns the schema and had not merged when this was
implemented), so `sqlite3 … "select id,status from events"` cannot be run. Substitute
evidence: (a) the mirror seam is called **synchronously before the response** on every path —
`service.test.ts` "mirrors every transition, synchronously, before the call returns" asserts
`enqueue → pending`, `claim-all → in-progress`, `complete → processed` with no polling;
(b) the real boot rebuild was run against this workspace with a recording mirror:
`mirror rows rebuilt from the directories: {"pending":201,"in-progress":50,"processed":1,"failed":3,"abandoned":2}`,
`distinct ids: 257 of 257 rows`.

**TEST-56 — a restart never loses or duplicates — PASS (directories half; SQLite half
deferred as above).** With the server stopped, one event was hand-moved `in-progress →
pending`, another `pending → abandoned`, and a malformed file dropped into `processed/`.
After restart:
```
status:      {"halted":false,"pending":201,"inProgress":50,"processed":2,"failed":3,"abandoned":2}
directories:              201            50             2           3            2
```
Known, deliberate asymmetry worth handing to SERVER-004: the **status counts files**
(`evt_*.json`, per TEST-53) while the **mirror carries only parseable events** — the
malformed `processed/evt_bad111111111.json` is the one-row difference above. A corrupt file
showing up as drift in `db doctor` is the honest outcome; it is quarantined by the next
claim or transition.

**TEST-57 — the queue surface is behind the bearer guard — PASS.** `status`, `idle`,
`claim-all`, `halt`, `<id>/complete`, each with no token and with a wrong token: **10/10
`401`**, every one carrying `www-authenticate: Bearer` and
`{"code":"unauthorized","message":"missing or invalid workspace token — …"}`. No queue file
was touched.

**Extra — shutdown does not wait for a parked window.** With the queue halted and a `curl`
parked on `?timeout=300`, `kill -TERM $SRV` completed in **124 ms**; the parked call got a
clean `204` after 2.045 s of parking, and the log shows `shutting down` → the `204` →
`shutdown complete`. (A long poll is an *active* connection, so `server.close()` would
otherwise have blocked for the rest of the window.)

**Gate.** `npm run lint` clean; `npm run format:check` clean; `npm run typecheck` clean;
`npm run test:coverage` → **1805 passed / 89 files**, coverage total lines 99.6 %,
statements 99.6 %, functions 100 %, branches 96.3 % (gate 90 %). The queue module itself:
lines 99.4 %, branches 94.4 %.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-008]` prefix
