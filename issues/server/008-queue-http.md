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
- [ ] Events are JSON files at `.corpus/queue/<status>/<id>.json` with the §7 shape (`id`, `type`, `created`, `source`, `payload`); statuses are `pending`, `in-progress`, `processed`, `failed`, `abandoned`.
- [ ] An internal `enqueue(event)` writes a pending event atomically (temp file + rename), projects it, invalidates, and wakes any parked long-poll waiter. SERVER-006 consumes this function.
- [ ] The long-poll idle endpoint returns **immediately** when `pending` is non-empty, otherwise holds the request open until an event arrives or the timeout elapses; the server clamps the client's requested timeout (max ~9 min) so the CLI's ~8 min rearm always wins.
- [ ] While `.corpus/HALT` exists, idle **parks** (never returns events, times out normally) and claim-all returns an empty batch.
- [ ] Claim-all atomically renames every current `pending/*` into `in-progress/` and returns them as one JSON batch; concurrent calls never hand the same event to two callers.
- [ ] Complete, fail, and abandon move an event to `processed`, `failed`, and `abandoned` respectively, addressed by id; fail records the error message on the event JSON.
- [ ] Reap-stale moves `in-progress` events older than a threshold back to `pending` (bumping an attempt counter) and sends events past the attempt cap to `failed`.
- [ ] Halt creates the `.corpus/HALT` sentinel (with reason + timestamp), resume removes it; a status endpoint reports halted state and per-status counts.
- [ ] Every transition updates the projection's `events` table and broadcasts an invalidation for the queue/jobs keys.
- [ ] The queue projection is rebuilt from the directories at boot, so a server restart never loses or duplicates events.

## Sprint-003 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-003 Open Conflicts affecting this issue — implement exactly these; full reasoning in `issues/sprints/sprint-003.md`:

1. **The contract wins, three ways**: idle responses are the declared `IdleResult` 200 / bodiless 204 shapes (this issue's `{pending:n}`/`{timedOut:true}`/`{halted:true,events:0}` sketches are superseded); a timeout above `IdleQuerySchema`'s max(480) is a 400 from the validation hook, not a clamp; `reap-stale` takes no query parameter and returns the declared `{reaped}` shape — do not implement `?olderThan=` (it would be silently ignored, making tests false-pass).
2. **Waiter registry gets a ~500 ms poll fallback** so a file appearing in `pending/` wakes parked waiters even with no in-process enqueue path. This is a permanent robustness feature (out-of-band event drops are as legitimate as out-of-band doc edits per §2.2 rule 1), not a temporary shim for SERVER-006's absence.
3. **`evt_*.json` is the only thing that counts as an event, everywhere** — `.gitkeep` files in the queue directories are invisible to counts, claims, and reaps.
4. **Merge order**: SERVER-004 lands first; this issue's Depends-on gains SERVER-004 (shared `app.ts` + events mirror).

## Technical Design

### Files to Create/Modify
- `apps/server/src/queue/store.ts` — directory layout, atomic writes/renames, read/list, status transitions, HALT sentinel
- `apps/server/src/queue/enqueue.ts` — internal `enqueue()` used by write paths
- `apps/server/src/queue/waiters.ts` — long-poll waiter registry (resolve on enqueue, abort on disconnect)
- `apps/server/src/queue/routes.ts` — handlers bound to the CONTRACT-002 queue route definitions
- `apps/server/src/queue/project.ts` — queue → `events` table mirror + boot rebuild
- `apps/server/src/queue/*.test.ts` — colocated Vitest specs
- `apps/server/src/app.ts` — mount the queue routes; rebuild the mirror on boot

### Key Implementation Details

**Layout and ids.** Ensure all five status directories exist at boot. Ids are `evt_<12 lowercase base36 chars>`; validate against `/^evt_[a-z0-9]+$/` on every id-addressed route before touching the filesystem (path-traversal defense). Writes are `write(tmp) → rename(final)` within the same directory so a reader never sees a partial file.

**Long-poll idle.** The handler:
1. If HALT is set → skip straight to the timeout wait (park); respond `{halted: true, events: 0}` on expiry.
2. Else, count `pending/`; if > 0, respond immediately with `{pending: n}`.
3. Else register a waiter (a promise + `AbortSignal` from the request) in the waiter registry, resolved by `enqueue()`. Respond `{pending: n}` when woken, `{pending: 0, timedOut: true}` on expiry.
Clamp the requested timeout to `[1s, 9min]` (default 8 min). Always remove the waiter in a `finally` — on timeout, on wake, and on client disconnect. Idle reports *availability*; it does not claim. The agent's loop is `idle → claim-all`.

**Claim-all.** Serialize with an in-process async mutex. Snapshot `readdir(pending)`, then rename each entry into `in-progress/`, tolerating `ENOENT` (another actor or a reap raced) by skipping that file. Parse each claimed file; a malformed JSON file is moved to `failed/` with an `error` field instead of poisoning the batch. Events enqueued *during* a claim simply stay in `pending` and are returned by the next claim — no attempt to make the snapshot transactional beyond the rename loop. Returns `[]` while halted, without touching the filesystem.

**Transitions.** `complete(id)`, `fail(id, error?)`, `abandon(id)` locate the event in any status directory, rewrite the JSON with `status`, `updated`, and (for fail) `error`, and rename into the target directory. Transitioning an event already in the target status is idempotent (200). An unknown id → 404.

**Reap-stale.** `POST /api/queue/reap-stale?olderThan=<seconds>` (default 900): for each `in-progress` file whose `updated`/mtime is older than the threshold, increment `attempts` and move back to `pending`; when `attempts` exceeds the cap (default 3), move to `failed` with `error: "stale: exceeded attempt cap"`. Returns the counts of each outcome.

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
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)
_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-008]` prefix
