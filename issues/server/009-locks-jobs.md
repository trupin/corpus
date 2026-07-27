# [SERVER-009] Document locks + job logs

## Domain
server

## Status
in_progress

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
- [x] Locks live at `.corpus/locks/<docId>.json` as `{holder: "agent" | "user", acquired, ttl}` per §7.
- [x] Acquire is idempotent for the current holder, returns 409 with the holder's identity when another party holds a live lock, and succeeds when the existing lock is expired.
- [x] Release removes the lock (only for its holder); a force-break endpoint removes it regardless of holder and records the break in the audit trail via a git commit message.
- [x] Breaking a lock that carries a deferred event id re-enqueues that event (the agent's deferred edit re-enters the queue rather than being lost).
- [x] Locks expire by TTL (default 5 min): expired locks are treated as absent by acquire and by the projection, and a reap endpoint deletes their files.
- [x] Lock state is projected into the `locks` table and every acquire/release/break/reap broadcasts an invalidation, so lock banners appear and clear live.
- [x] Document write paths honor locks: editing a document locked by the other party returns **423** with the holder, acquisition time, and TTL in the body. *(Guard mounted on the real write path during the harvest reconciliation over SERVER-005 — `locks/write-guard.test.ts` plus the combined E2E probe; the earlier `DEFERRED → SERVER-005` note is discharged.)*
- [x] Every queue event has a job; `.corpus/jobs/<eventId>.jsonl` is append-only, one JSON object per line.
- [x] `POST /api/jobs/:id/log` accepts appends **only from loopback** (for Claude Code hooks) and does not require the bearer token; non-loopback requests get 403. The CLI verb path appends through the same endpoint with its normal auth.
- [x] The server tails job files and broadcasts a coalesced invalidation for that job's keys — log **lines are never pushed over SSE** (§2 rule 3); the UI refetches `GET /api/jobs/:id/log`.
- [x] `GET /api/jobs?recent=N` returns console rows (queue mirror + last log line + originating document/thread), and `GET /api/jobs/:id/log` returns the full log (with an incremental `since` cursor).
- [x] Retry (failed → pending) and abandon are wired to the SERVER-008 queue transitions.
- [~] ~~A job's `.jsonl` file is deleted when its event is reaped, abandoned, or pruned.~~
  **Struck** by Sprint-005 Adjudication 7f: abandon, fail and reap-stale all *move* event files and
  SERVER-008 deletes none, so this AC has no trigger left. Log-file lifecycle follows a future prune
  verb; `JobLogStore.remove` exists for it.

## Sprint-005 Adjudications (binding, 2026-07-27)

Orchestrator decisions — the contract wins on all eight divergences; full reasoning in `issues/sprints/sprint-005.md`:

1. Acquire is **201 at `POST /api/locks/{docId}`**; non-holder release **403**; absent lock **404**; break is **user-only** (agent → 403); abandon **deletes nothing** (the vacuous AC is struck); job-log cursor param is **`cursor`** (not `since`); listing defaults **50/200**; unknown job id **404**. `deferredEventId` is **struck** (no wire home).
2. **Security surface, all four §7 hardening measures are ACs**: Origin-header rejection (NOT currently in `localhostOnly` — add it for this path), line cap, unknown-job refusal, plain-text render posture; the tokenless auth exemption for `POST /api/jobs/{id}/log` must be **method-and-path exact** — the GET log read stays authenticated.
3. `jobs.status` joins from the events mirror, never the log file (SERVER-004 handoff already in this file).

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

**implemented on: opus.** Not a bug — no reproduction section.

**Environment.** Real `corpus init` workspace at `/tmp/corpus-s009-fBW3Ze` (own scratch prefix),
real server process started directly (`npx tsx apps/server/src/main.ts --workspace $WS`, pid
tracked, stopped with `kill -TERM`), port **8875** (second bind **8876**), real `curl`, real
`git`, real `sqlite3`, real SSE. Baseline: `corpus init` seeds 6 documents and **one** commit
(`workspace: initialize corpus workspace by user`). `8765` was never bound; `lsof -nP
-iTCP:{8875,8876,8765} -sTCP:LISTEN` reports all free after the run.

**Constants as implemented** (recorded per the sprint's Done Criteria):
`MAX_LOG_LINE_BYTES = 8192` · `MAX_LOG_FILE_BYTES = 4194304` (4 MiB) ·
`DEFAULT_LOCK_TTL_SECONDS = 300` (contract) · `MAX_LOCK_TTL_SECONDS = 1800` (30 min, no lower
clamp — the schema's `.min(1)` is the floor).

### Locks

```
POST /api/locks/doc_seedattention  (x-corpus-author: agent)      → 201
  {"docId":"doc_seedattention","holder":"agent","acquired":"2026-07-27T06:02:08Z","ttl":300}
cat .corpus/locks/doc_seedattention.json                         → same four fields on disk
sqlite3 .corpus/cache.db "select doc_id,holder,ttl from locks"   → doc_seedattention|agent|300
POST … {"ttl":86400}   (renew, same holder)                      → 201, ttl **1800** (clamped)
POST …                 (as user, live lease)                     → 409 {"code":"conflict",
                                                                    "lock":{…holder agent…}}
DELETE …               (as user, non-holder)                     → 403 {"code":"forbidden"}
POST …/break           (x-corpus-author: agent)                  → 403 (user-only)
POST …/break           (as user)                                 → 200 {"docId":…,"released":true,
                                                                    "holder":"agent"}
POST /api/locks/doc_zzzzzzzz                                     → 404 not_found
POST /api/locks/not-an-id                                        → 400 with issues[param.docId]
```

**TTL, list and reap.** Acquired with `ttl:1`, waited 2 s real time: `GET /api/locks` → `{"locks":[]}`
while `.corpus/locks/doc_seedattention.json` was still on disk; a `user` acquire then returned
**201** (takeover without waiting for a reaper). `POST /api/locks/reap` → `{"reaped":["doc_seedattention"]}`,
file gone, second reap `{"reaped":[]}`. `POST /api/locks/reap` was handled by the reap route —
no `.corpus/locks/reap.json` was ever created.

**Audit trail (force break).** `git log --format='%an|%ae|%cn|%s'`:

```
Corpus User|user@corpus.local|Corpus Server|lock: force-break on doc_seedattention (was agent) by user
user|user@corpus.local|user|workspace: initialize corpus workspace by user
git log -1 --format=%b   → Corpus-Doc: doc_seedattention / Corpus-Actor: user / Corpus-Lock-Holder: agent
git show --stat --format= HEAD → (empty — `.corpus/` is gitignored, so `--allow-empty` is the only record)
```

**Deferred edit re-enqueued** (authorized substitute per Open Conflict 8 — nothing in the API can
set the field): a real event was claimed into `in-progress/`, a real lock file carrying
`"deferredEventId"` was written on disk, and the lock was broken over HTTP. The event file moved
back to `.corpus/queue/pending/`, `GET /api/queue/status` counted it as pending, and the break
response and `GET /api/locks` carried **no** `deferredEventId`.

**SSE (real `curl -N`).** Acquire and release each produced exactly one frame; a break produced
the lock frame plus the re-enqueue's queue frame. Every payload's only field is `keys`:

```
event: invalidate
data: {"keys":[["locks"],["locks","doc_seedattention"],["docs","doc_seedattention"]]}
data: {"keys":[["queue"],["jobs"]]}
```

**Out-of-band lock file** written with `printf >>` and then unlinked: the watcher projected the
row and dropped it (`select doc_id,holder from locks` → `doc_seedattention|user` → 0 rows).

### The security surface — all four §7 measures, real sockets

1. **Loopback only.** The product refuses a non-loopback bind outright: with `host` set to the
   machine's LAN address, the real `main.ts` exits 1 with `refusing to bind "192.168.68.52": this
   version of corpus serves loopback only`. To put a *genuinely* non-loopback peer in front of the
   guard, the real app (real `createServer`, real middleware, real workspace) was served on
   `192.168.68.52:8876` and reached over a real socket with `curl --interface 192.168.68.52`:

   ```
   POST http://192.168.68.52:8876/api/jobs/<evt>/log   (X-Forwarded-For: 127.0.0.1)
     → 403 {"code":"forbidden","message":"this endpoint accepts loopback connections only"}
   POST 127.0.0.1:8875/api/jobs/<evt>/log              (same body, loopback)
     → 201 {"eventId":"evt_c8c6fa07b7","appended":true}
   ```
   Nothing was appended by the LAN request. `X-Forwarded-For` changed nothing.
2. **`Origin` refused on presence, not value.** `Origin: http://evil.example` → **403**;
   `Origin: http://127.0.0.1:8875` → **403**. Nothing appended by either.
3. **Line cap and file cap.** A 64 KB line stored at exactly **8192** bytes ending
   `…[truncated]`; an empty `line` → 400 with issues. With the log at 4 194 495 bytes, two further
   appends returned 201, the file stopped growing, and **exactly one** notice line was written
   (`grep -c "log capped at"` → 1): `log capped at 4194304 bytes; further lines were dropped`.
   The log still read cleanly afterwards.
4. **Unknown job refused.** `evt_nosuchjob` → **404** (resolved against the queue store, not the
   mirror — an event file dropped straight into `pending/` accepted an append before the mirror
   knew it). `not-an-id` → **400** with `issues[param.id]`; `%2e%2e` never reaches the route at
   all (URL normalization) → 404. `.corpus/jobs/` did not exist after any refusal.

**Auth exemption is method-and-path exact** (real curl, no token):

```
POST /api/jobs/<evt>/log   → 201        GET /api/jobs/<evt>/log → 401 + WWW-Authenticate: Bearer
GET  /api/jobs             → 401        POST /api/locks/reap    → 401
```

### Jobs

- **Live streaming announces, never pushes.** With `curl -N` attached, **50** appends produced
  **1** coalesced `invalidate` frame — `data: {"keys":[["jobs"],["jobs","evt_c8c6fa07b7"]]}` —
  and `grep -c "step "` over the whole stream was **0**. The lines came back over HTTP.
- **Cursor.** `GET …/log` → 53 lines, `nextCursor: 53`; `?cursor=50` → the last 2 with
  `nextCursor: 52` at that point; `?cursor=9999` → `{"lines":[],"nextCursor":52}`. Every entry
  had exactly `ts` and `line` — the on-disk `source` never reached the wire.
- **Listing.** `GET /api/jobs?recent=10` returned rows with exactly
  `eventId, lastLine, originId, started, status, updated`; `status: failed` after a real
  `POST /api/queue/<id>/fail`, `originId: doc_seedattention` resolved from the payload through the
  projection. `recent=200` → 200; `recent=201` → 400; `recent=0` → 400.
- **`jobs.status` follows the queue, not the log.** After the fail (nothing appended),
  `sqlite3 … "select event_id,status from jobs"` → `evt_c8c6fa07b7|failed`.
- **Retry / abandon.** Retry → 200 with `status: pending`, the event file back in
  `.corpus/queue/pending/`, `attempts` reset, the `.jsonl` **kept** and gaining
  `{"source":"server","line":"retry requested"}`; a second retry on the now-pending job → **409**.
  Abandon → 200, event in `.corpus/queue/abandoned/`, and `.corpus/jobs/<evt>.jsonl` **still
  present** (nothing is deleted).
- **Out-of-band tail.** `printf >> .corpus/jobs/<evt>.jsonl` → the watcher updated
  `last_line` to `typed by hand` while `status` stayed `abandoned`.

### Projection health

`doctor` before rebuild → `ok: true, drift: []`; `rebuild` (6 documents) → `doctor` → `ok: true,
drift: []`, with the server running. No `count_mismatch` from the queue `.gitkeep` files, the lock
files or the job logs.

### Gates

`npm run build` OK · `npm run lint` clean (0 errors, 0 warnings) · `npm run format:check` clean ·
`npm run typecheck` clean across all 5 workspaces · `npx vitest run` **2520 passed / 0 failed**
(628 files) · coverage **98.99 % lines / 98.99 % statements / 99.31 % functions / 95.78 %
branches** — above the 90 % gate. `git status` in the worktree shows only `apps/server/**` and
this file; no fixture repository and no scratch workspace leaked into the Corpus repository.

### Deferred

- **The write-path guard's 423 (TEST-75…TEST-78)** — ~~`DEFERRED → SERVER-005`~~ **discharged in
  the harvest reconciliation below.** The original note: There is no
  document write route in this worktree (`mountDocsRoutes` binds `listDocs` and `getTree` only),
  so there is nothing to mount the guard on end to end. Substitute evidence: `createLockGuard`
  and `createLockGuardMiddleware` are exported from `apps/server/src/locks/index.js` and covered
  by `locks/guard.test.ts` through a real Hono app — holder passes, other party gets the
  contract's `LockedError` (no `expiresAt`), an expired lease blocks nothing, reads are never
  guarded. TEST-118 becomes executable once SERVER-005 merges.
- **The thread-creation exemption** — `DEFERRED → SERVER-006`, recorded as a code comment citing
  §7 at the top of `locks/guard.ts`, as the sprint authorizes.
- **`deferredEventId` set through a product action** — `DEFERRED → SERVER-006/CLI-004`; the
  authorized substitute (a real lock file written on disk, then broken over HTTP) is above.

## Harvest Reconciliation over SERVER-005 (2026-07-27, opus)

SERVER-009 was built in a parallel worktree against a tree with no document write routes and its
own `git/` module. Applied over the committed SERVER-005 write path, `apps/server/src/git/` was
resolved wholesale to SERVER-005's module (as SERVER-009's own coordination note directed) and
`apps/server/src/app.ts` arrived with conflict markers — both sides added to `CorpusServer` /
`CreateServerDeps` and both constructed subsystems. What follows is the resolution and its proof.

### 1. `app.ts` — union, with one git writer

Both sides' surface is kept: `CorpusServer` still exposes `locks` / `lockGuard`, and
`createServer` still mounts the write pipeline. Inside `if (deps.projection !== undefined)` the
order is now **git → locks → guard → lock routes → docs routes → job routes**, because the guard
is a constructor argument of the write pipeline, not a middleware bolted on afterwards.

`deps.git` changed type from SERVER-009's `GitCommitter` to SERVER-005's `AutoCommitter`, and the
`GitCommitter` / `createGitCommitter` / `commitEmpty` shim is **gone** — it duplicated
`git/commit.ts`. One `createAutoCommitter(...)` is built per server and handed to *both* the docs
workspace and `createLockService({ git })`, so there is exactly one `execFile`-based git spawner
in `apps/server` and a force break serializes against in-flight document commits on the same
`.git/index` lock (`AutoCommitter.withGitLock`).

`LockService.recordBreak` was adapted rather than wrapped: it now calls
`git.commit({ docId, actor: "user", subject, paths: [], trailers: [Corpus-Lock-Holder: …],
allowEmpty: true, squash: false })`. `allowEmpty` and `squash` already existed on `CommitRequest`
for exactly this caller; `trailers` is new — five lines in `buildTrailers`, appended after the
standard trailers — because `Corpus-Actor` says who *broke* the lock (always `user`) and nothing
expressed who *held* it. Outcome handling maps to the four `CommitOutcome` kinds: `committed` /
`amended` pass, `skipped` / `failed` are logged loudly and never fail the break (SPEC.md §14).

### 2. The guard is mounted on the write path

`createServer` builds `createLockGuard(locks)` and passes `assertWritable` into
`DocsWorkspace.assertWritable` — the seam SERVER-005 shipped with `allowAllWrites` as its default
and a test proving every write verb calls it once, before reading or writing anything. **TEST-75…
TEST-78 and TEST-118 are no longer deferred.** New file
`apps/server/src/locks/write-guard.test.ts` (4 tests, real workspace + real git repo + real
`createServer`, lock taken over HTTP): 423 with the contract's `LockedError` carrying the live
lock and file/`HEAD` untouched, release → the same PUT succeeds, holder's own writes and all
reads pass, all five write verbs refused, an expired lease refuses nothing without a reaper run.

### 3. Adjudication — git identities

Canonical spelling is CLI-002's shipped `user <user@corpus.local>` / `agent
<agent@corpus.local>`: the **name is the actor string**, not `Corpus User` / `Corpus Agent`.
`git/commit.ts`'s `ACTOR_IDENTITIES` and six assertions across `docs/{move,update,delete}.test.ts`
and `git/commit.test.ts` were aligned, so `git log --format='%an'` reads uniformly from the
`corpus init` commit onward. (SERVER-005's Technical Design line stating the old mapping, and the
`Corpus User|…` lines in its own E2E log, are superseded — noted in that issue's log.)

### 4. Adjudication — the query-key vocabulary

`apps/server/src/events/keys.ts` is now a re-export of `@corpus/contract`'s `query-keys` module
(same symbol names by design, so no import churn anywhere; `dedupeKeys` stays local since it is
server-only). The published set is now the emitted set by construction.

### Gates (re-run on the reconciled tree)

`npm run build` ✔ · `npm run lint` ✔ (0 errors, 0 warnings) · `npm run format:check` ✔ ·
`npm run typecheck` (all 5 workspaces) ✔ · `npx vitest run --coverage` → **154 files / 2 708
tests, all passing**, **statements 98.8 %, branches 95 %, functions 99.39 %, lines 98.8 %**
(gate 90 %, exit 0). New/changed tests: `locks/write-guard.test.ts` (4), the extra-trailer +
empty-commit case in `git/commit.test.ts`, a refused-audit-commit case in `locks/service.test.ts`,
and `locks/git-fixture.ts` replacing three hand-rolled `GitCommitter` fakes.

### Combined E2E probe — real server, real workspace

`corpus init /tmp/corpus-s009r-ws` (own scratch prefix) → `corpus server start --workspace …` →
pid 4939 on **8765**, `GET /api/health` → `{"status":"ok","workspace":"/tmp/corpus-s009r-ws"}`.
Everything below is `curl` against that process; the server was stopped with `corpus server stop`
and `lsof -ti :8765` reports free afterwards.

```
POST /api/docs                    (user)  → 201  doc_amsknxqn
POST /api/locks/doc_amsknxqn      (agent) → 201  {"holder":"agent","acquired":"…","ttl":300}
PUT  /api/docs/doc_amsknxqn       (user)  → 423
     {"code":"locked","message":"doc_amsknxqn is being edited by agent; the lock was
      acquired at 2026-07-27T06:49:34Z",
      "lock":{"docId":"doc_amsknxqn","holder":"agent","acquired":"…","ttl":300}}
     git log unchanged, file byte-for-byte unchanged
DELETE /api/locks/doc_amsknxqn    (agent) → 200  {"released":true,"holder":"agent"}
PUT  /api/docs/doc_amsknxqn       (user)  → 200  warnings: []   body on disk: "the user edit"
```

`git log --format='%h | %an <%ae> | %cn <%ce> | %s'` after the accepted write:

```
dcd4432 | user <user@corpus.local> | Theophane Rupin <…> | doc create: Mortgage options (doc_amsknxqn) by user
3ce555e | user <user@corpus.local> | user <user@corpus.local>   | workspace: initialize corpus workspace by user
```

The edit folded into the create commit — same document, same actor, inside `SQUASH_IDLE_MS`
(SPEC.md §4) — and `git show HEAD:data/docs/inbox/mortgage-options.md` ends in `the user edit`,
so the amend carried it. **Author is `user <user@corpus.local>`**; the committer stays the
workspace's own configured identity.

**Every write verb is guarded, reads never are** (agent holding the lock, requests as `user`):
`PUT` 423 · `POST …/move` 423 · `POST …/archive` 423 · `POST …/unarchive` 423 · `DELETE` 423 ·
`GET /api/docs/{id}` **200**. `PUT` as the holder (`agent`) → **200**, file becomes
`the holder writes`.

**Force break, through the shared committer.** Agent re-acquires, `POST /api/locks/{id}/break`
as user → 200. `git log`:

```
ee3acb0 | agent <agent@corpus.local> | doc edit: Mortgage options (doc_amsknxqn) by agent
2da9fc3 | user  <user@corpus.local>  | lock: force-break on doc_amsknxqn (was agent) by user
dcd4432 | user  <user@corpus.local>  | doc create: Mortgage options (doc_amsknxqn) by user
```

`git log -1 --format=%B HEAD~1` →
`lock: force-break on doc_amsknxqn (was agent) by user` + `Corpus-Doc: doc_amsknxqn` /
`Corpus-Actor: user` / `Corpus-Lock-Holder: agent`; `git show --stat --format='' HEAD~1` is
**empty** (nothing staged — `.corpus/` is gitignored) and it did **not** amend `dcd4432`
(`squash: false` honoured). The following agent edit committed as its own commit authored
`agent <agent@corpus.local>`.

**SSE, one attached `curl -N /events?token=…`** across the break and the agent edit:

```
:connected
event: invalidate  data: {"keys":[["locks"],["locks","doc_amsknxqn"],["docs","doc_amsknxqn"]]}   (acquire)
event: invalidate  data: {"keys":[["locks"],["locks","doc_amsknxqn"],["docs","doc_amsknxqn"]]}   (break)
event: invalidate  data: {"keys":[["docs"],["docs","doc_amsknxqn"]]}                             (agent edit)
```

Keys only, never data — and the shapes are the contract's, since `events/keys.ts` now re-exports
them. `GET /api/locks` → `{"locks":[]}`, `GET /api/jobs` → `{"jobs":[]}`,
`GET /api/queue/status` → `{"halted":false,"pending":0,…}`: the SERVER-009 surfaces survived the
merge intact.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface; localhost-only ingest is security-sensitive)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-009]` prefix
