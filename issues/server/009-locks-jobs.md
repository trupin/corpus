# [SERVER-009] Document locks + job logs

## Domain
server

## Status
todo

## Priority
P0

## Model
opus — file-backed lock and job-log patterns are pinned by §7; implementation detail only.

## Dependencies
- Depends on: SERVER-007, CONTRACT-002
- Blocks: CLI-004, UI-011

## Spec References
- SPEC.md §7 — "Document locks" and "Job logs (the console feed)"
- SPEC.md §9.1 — projection `locks` and `jobs` tables
- SPEC.md §9.2 — `GET /api/jobs?recent=`, `GET /api/jobs/:id/log`, `POST /api/jobs/:id/log` (localhost-only)
- SPEC.md §2 rule 3 — SSE carries invalidations only, never data

## Summary
Two file-backed coordination mechanisms that make the agent's work visible and safe. **Locks**: one holder per document (`.corpus/locks/<docId>.json`), acquired implicitly by the agent's edit verbs and by the user's editor session, with TTL expiry, a reaper, and a force-break escape hatch recorded in the git audit trail; write paths return 423 when the other party holds the lock, and lock state is projected and broadcast so banners appear and clear live. **Job logs**: every queue event is a job with an append-only `.corpus/jobs/<eventId>.jsonl` log fed both by the CLI verb path and by a localhost-only hook endpoint; the server tails these files and broadcasts invalidations so the console's live log stream refetches, with recent-job listing, full-log reads, retry, and abandon wired back to the queue.

## Acceptance Criteria
- [ ] Locks live at `.corpus/locks/<docId>.json` as `{holder: "agent" | "user", acquired, ttl}` per §7.
- [ ] Acquire is idempotent for the current holder, returns 409 with the holder's identity when another party holds a live lock, and succeeds when the existing lock is expired.
- [ ] Release removes the lock (only for its holder); a force-break endpoint removes it regardless of holder and records the break in the audit trail via a git commit message.
- [ ] Breaking a lock that carries a deferred event id re-enqueues that event (the agent's deferred edit re-enters the queue rather than being lost).
- [ ] Locks expire by TTL (default 5 min): expired locks are treated as absent by acquire and by the projection, and a reap endpoint deletes their files.
- [ ] Lock state is projected into the `locks` table and every acquire/release/break/reap broadcasts an invalidation, so lock banners appear and clear live.
- [ ] Document write paths honor locks: editing a document locked by the other party returns **423** with the holder, acquisition time, and TTL in the body.
- [ ] Every queue event has a job; `.corpus/jobs/<eventId>.jsonl` is append-only, one JSON object per line.
- [ ] `POST /api/jobs/:id/log` accepts appends **only from loopback** (for Claude Code hooks) and does not require the bearer token; non-loopback requests get 403. The CLI verb path appends through the same endpoint with its normal auth.
- [ ] The server tails job files and broadcasts a coalesced invalidation for that job's keys — log **lines are never pushed over SSE** (§2 rule 3); the UI refetches `GET /api/jobs/:id/log`.
- [ ] `GET /api/jobs?recent=N` returns console rows (queue mirror + last log line + originating document/thread), and `GET /api/jobs/:id/log` returns the full log (with an incremental `since` cursor).
- [ ] Retry (failed → pending) and abandon are wired to the SERVER-008 queue transitions.
- [ ] A job's `.jsonl` file is deleted when its event is reaped, abandoned, or pruned.

## Technical Design

### Files to Create/Modify
- `apps/server/src/locks/store.ts` — read/write/expire lock files, holder checks, deferred-event field
- `apps/server/src/locks/routes.ts` — acquire / release / break / reap handlers bound to CONTRACT-002 routes
- `apps/server/src/locks/guard.ts` — `assertNotLockedByOther(docId, actor)` helper returning the 423 payload
- `apps/server/src/jobs/store.ts` — jsonl append, tail-read, `since` cursor, deletion with the event
- `apps/server/src/jobs/tail.ts` — watcher-driven coalesced invalidation for live log streaming
- `apps/server/src/jobs/routes.ts` — list / log read / log ingest / retry / abandon handlers
- `apps/server/src/jobs/project.ts` — `jobs` table rows (status from the queue mirror + `last_line`)
- `apps/server/src/locks/*.test.ts`, `apps/server/src/jobs/*.test.ts` — colocated Vitest specs
- `apps/server/src/docs/*.ts` — call the lock guard from the document write paths
- `apps/server/src/app.ts` — mount lock + job routes

### Key Implementation Details

- **`jobs.status` is joined from the `events` mirror, never read from the log file** _(SERVER-004 handoff, 2026-07-26)_: the projection pins this; the log file carries lines, not state.


**Lock lifecycle.** `acquire(docId, holder, ttl?)`: read the existing file; if absent or expired (`now > acquired + ttl`), write the new lock (temp + rename) and return it; if held by the same holder, refresh `acquired` and return 200; otherwise 409 with `{holder, acquired, ttl, expiresAt}`. `release(docId, holder)`: delete only when the holder matches (mismatch → 409; absent → 200 idempotent). The agent acquires implicitly through the CLI's edit verbs (CLI-004); the user's editor session acquires on first keystroke and releases on idle/close (UI-011). Both go through these endpoints — the server remains the sole writer of lock files.

**Force break.** `POST /api/locks/:docId/break` deletes the lock regardless of holder. Because `.corpus/` is gitignored, the audit trail entry is an explicit empty commit: `git commit --allow-empty -m "lock: force-break on <docId> (was <holder>) by user"`. If the broken lock carries `deferredEventId`, call the SERVER-008 queue to move that event back to `pending` so the deferred edit re-enters the queue. The `deferredEventId` field is set by whoever defers (the orchestrator, via the acquire/patch route) — the server just honors it.

**TTL and reaping.** Default TTL 300 s, overridable per acquire (clamp to ≤ 30 min). Expiry is evaluated on read, so an expired lock never blocks anything even before the reaper runs. `POST /api/locks/reap` unlinks every expired lock file and returns the count; the CLI's `corpus lock reap` calls it.

**Lock projection.** The `locks` table is fed both by the direct write paths (synchronously, before responding) and by the SERVER-007 watcher over `.corpus/locks/` (the out-of-band catch-all). Rows for expired locks are dropped at projection time. Each change invalidates `locks` and `locks/<docId>` plus the document's key so banners update everywhere the document is visible.

**Write-path guard.** Document body/frontmatter writes (`PUT /api/docs/:id`, delete, move, archive) call the guard with the request's actor: a live lock held by the *other* party → 423 `{error: "locked", holder, acquired, expiresAt}`. Writes by the lock's own holder pass. Anchor-entry writes performed by thread creation (SERVER-006) are **exempt** — commenting is not editing, and §7 scopes locks to editing. Note this exemption in the code with a comment citing §7.

**Job log files.** One JSON object per line: `{ts, source: "hook" | "cli" | "server", line}`. Appends use `fs.appendFile` with a trailing newline (atomic enough for single-line appends on POSIX). Cap a single line at 8 KB (truncate with an ellipsis marker) and the file at a few MB (stop appending and write one final `truncated` line) so a runaway agent cannot fill the disk.

**Localhost-only ingest.** `POST /api/jobs/:id/log` resolves the peer address from the connection (`c.env.incoming.socket.remoteAddress` under `@hono/node-server`); accept only `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`. Skip the bearer requirement for this route only (Claude Code hooks have no token) and document that in the contract. Never trust `X-Forwarded-For`.

**Live streaming without pushing data.** The watcher already covers `.corpus/jobs/`. On change, `tail.ts` reads the new tail, updates the `jobs` row's `last_line`, and emits `invalidate(["jobs", "jobs/<eventId>"])` — coalesced with a ~100 ms trailing debounce so a chatty job produces a handful of invalidations per second, not hundreds. The UI refetches `GET /api/jobs/:id/log?since=<n>` to get the lines. This is the §2 rule 3 constraint made concrete: the stream announces change, HTTP carries content.

**Jobs listing.** `GET /api/jobs?recent=N` (default 20, max 100) joins the `events` mirror with `jobs` rows: `{eventId, type, status, started, updated, lastLine, doc: {id, title, type}}` where the originating document/thread comes from the event payload (`threadId` / `parentId`), resolved through the projection so the console's "open in its home column" link works. Sorted by `updated` descending.

**Retry / abandon.** `POST /api/jobs/:id/retry` requires the event to be in `failed` (otherwise 409) and delegates to the queue: reset `attempts`, move to `pending`, keep the existing log file and append a `retry requested` line. Abandon delegates to `DELETE /api/queue/:id` and deletes the job's `.jsonl`.

**Reaping job files.** Deleting/abandoning an event, and any queue prune, unlinks `.corpus/jobs/<eventId>.jsonl` in the same operation.

### Edge Cases
- Acquire on a document id that does not exist in the projection → 404 (locks are per-document, not free-form).
- Two concurrent acquires for the same document → serialize per-doc in-process; the loser gets 409.
- Release of an already-expired lock → 200, no error.
- Break with no lock present → 200 (idempotent), no empty commit.
- Clock skew / TTL of 0 → clamp TTL to a sane minimum (30 s).
- A crashed editor holding a lock → TTL expiry plus reap; a document can never be permanently wedged.
- Log ingest for an unknown event id → the file is still created (a hook can fire before the mirror catches up), but the id must match the `evt_*` pattern; a `..`/`/` id is a 400 before any filesystem access.
- Extremely chatty job (hundreds of lines/second) → debounced invalidation, capped line length, capped file size.
- `since` cursor beyond the file length → returns an empty array, not an error.
- Concurrent appends from the hook endpoint and the CLI verb → both use `appendFile` of a single complete line; no interleaving within a line.
- Job file missing for an existing event (never logged) → listing shows an empty `lastLine`; log read returns `[]`.

## Testing Strategy
Vitest in `apps/server` against a temp workspace fixture, driving the real Hono app via `app.request()`:
- Locks: acquire/re-acquire/conflict/expired-takeover matrix; release by non-holder → 409; break clears + creates an empty commit (assert via `git log -1`); break with `deferredEventId` moves the event back to `pending`; reap removes only expired files.
- Guard: `PUT /api/docs/:id` as `user` while `agent` holds the lock → 423 with holder info; same request as the holder → 200; thread creation on a locked parent → succeeds (documented exemption).
- Projection: after each lock transition, the `locks` row matches; expired locks are absent.
- Jobs: append via the hook endpoint from a loopback request → line present in the `.jsonl`; a request with a non-loopback remote address → 403.
- Log read: `since` cursor returns only new lines; oversized line truncated; oversized file stops appending.
- Tail invalidation: append 50 lines rapidly, assert the bus received a small coalesced number of invalidations and that no payload contains log text (rule 3 regression).
- Listing: seed events + logs → `GET /api/jobs?recent=` returns rows with status, last line, and the resolved originating document.
- Retry: failed → pending (and 409 from a non-failed status); abandon deletes both the event and its log file.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace with the bearer token exported; note an existing document id.
2. Acquire as agent: `curl -X POST localhost:8765/api/locks/<docId>/acquire -H "Authorization: Bearer $TOKEN" -d '{"holder":"agent"}'` → `cat .corpus/locks/<docId>.json`.
3. Conflict: `PUT /api/docs/<docId>` with `from=user` → **423** with the holder in the body; `GET /api/docs/<docId>` still returns the document (read is never blocked).
4. Live banner signal: with `curl -N "localhost:8765/events?token=$TOKEN"` open, acquire and release → observe `invalidate` frames naming the lock keys.
5. Force break: `POST /api/locks/<docId>/break` → lock file gone; `git log -1 --format=%s` shows the `lock: force-break …` message; if a `deferredEventId` was set, `ls .corpus/queue/pending/` shows the re-enqueued event.
6. TTL: acquire with `ttl=30`, wait past it, then acquire as the other party → succeeds; `POST /api/locks/reap` → returns a count and the stale file is gone.
7. Job log via hook path (no token, loopback): `curl -X POST localhost:8765/api/jobs/<evtId>/log -d '{"line":"reading thread"}'` → `cat .corpus/jobs/<evtId>.jsonl`. Repeat from a non-loopback interface address → 403.
8. Live log: keep the SSE stream open, append 20 lines in a loop → observe a small number of coalesced `invalidate` frames, each carrying **only** keys; then `GET /api/jobs/<evtId>/log` returns all 20 lines and `?since=` returns only the new ones.
9. Console rows: run a real comment through the queue (enqueue → claim → log → fail), then `GET /api/jobs?recent=10` → the row shows status `failed`, the last line, and the originating thread.
10. Retry and abandon: `POST /api/jobs/<evtId>/retry` → event back in `.corpus/queue/pending/`; abandon another job → event in `abandoned/` and its `.jsonl` deleted.

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
- [ ] `/audit` run (P0, cross-domain surface; localhost-only ingest is security-sensitive)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-009]` prefix
