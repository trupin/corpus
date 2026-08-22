# Sprint 004 — Phase 2 Third Batch: Live Updates, the Collection Query, and Two Pinned Fixes

**Issues**: SERVER-007, SERVER-011, SERVER-013, CONTRACT-004
**Domains**: server, contract
**Date**: 2026-07-26
**Plan phase**: Phase 2 — Server Backbone + CLI
**Branch**: `phase-2-server-cli` (agents work in pre-created worktrees cut from it)

---

## What makes this sprint different

Sprint 003 crossed the "a real workspace exists" threshold. This one crosses the
**"the workspace is alive"** threshold. After SERVER-007 lands, a file changed by a hand
outside Corpus is noticed, reconciled, re-projected and announced. After SERVER-011 lands,
that new state is queryable over HTTP through the generated typed client. Those two halves
compose into the sprint's centerpiece:

```
external editor writes data/docs/finance/mortgage.md
  → watcher debounces           (SERVER-007)
  → reconciles anchors vs git HEAD   (SERVER-007 + the SERVER-002/012/013 engine)
  → re-projects the file        (SERVER-004)
  → one SSE `invalidate` frame carrying query keys — and no data (SERVER-007)
  → GET /api/docs returns the new state, snippet-highlighted, filtered  (SERVER-011)
```

Every hop in that line is real in this sprint: a real `corpus init` workspace, a real
daemon, a real `sed`/editor write, a real `curl -N` reading real SSE frames, a real
`.corpus/cache.db`, and a real typed-client query. **No stub is authorized anywhere in that
chain.**

The other two issues are different in kind and must be treated differently:

- **SERVER-013** is an *already-adjudicated* fix. Its acceptance criteria and its authorized
  design are the product of four evaluation rounds, one revert, and a user decision. The
  tests below are a translation of those criteria into numbered form. **They do not re-open
  the design, and neither does the implementing agent.** The one authorized escape is the
  named open corner (§ SERVER-013 TEST-68): escalate with the concrete case, never ship a
  threshold.
- **CONTRACT-004** is a mechanical sweep with one enumerable judgment. Its only real
  question — *which bodies are genuinely omittable* — turns out to have four candidates, not
  the two its acceptance criteria assert. That is Open Conflict 6, and it is the single thing
  the orchestrator must decide before contract-dev starts.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue       | The real application in this sprint                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER-007  | A **real server process** (`npx tsx apps/server/src/main.ts`, or the daemon `corpus server start` spawns) on port `8815`, against a **real `corpus init` workspace**, with SSE observed by **real `curl -N`** holding a real socket, and out-of-band edits made by **real `sed -i ''` / `printf >>`** — never `app.request()`, never a simulated file event. Projection effects are read with the **`sqlite3` CLI**. |
| SERVER-011  | A **real server process** on port `8825` against a **real `corpus init` workspace** whose documents are real `.md` files on disk, projected for real, queried over **real HTTP** — by `curl` for shape assertions and at least once through the **generated typed client** (`createClient` from `@corpus/contract/client`) for the type-level claim. `app.request()` is the unit-test path only. |
| SERVER-013  | The **anchor engine as a library**, exercised by an independent generator sweep, **plus real `git init` disk fixtures** where a document is committed, edited on disk, reconciled, and the resulting frontmatter read back with `git diff`. A fix proved only by in-repo unit fixtures is not proved — the round-4 record exists because the repo suite passed while the class was open. |
| CONTRACT-004| The **generated artifacts** (`openapi.json`, `schema.generated.ts`) and **real `tsc` invocations** on scratch probe files that import the published client. A claim about compile-time behaviour that was not produced by running `tsc` is not evidence.                                                                                                        |
| Integration | All of the above composed on port `8835`, in one `corpus init` workspace, with **zero stubs in the chain**.                                                                                                                                                                                                                                                      |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports` map
into `dist/`. Each worktree is a separate checkout: run `npm install` (if `node_modules` is
absent) and `npm run build` **inside your own worktree** before any verification step. A
probe that imports another worktree's `dist/`, or a stale one, is not evidence. CONTRACT-004
in particular must rebuild `packages/contract` after regenerating, or its `tsc` probes test
the old types.

### Port allocation

Earlier ranges (`8770`–`8809`) are historical and belong to sprint-003's evidence; leave them
alone so that sprint stays re-runnable. This sprint takes fresh ranges from `8810`.

| Consumer                                 | Range         | Primary                          |
| ---------------------------------------- | ------------- | -------------------------------- |
| SERVER-007                               | `8810`–`8819` | `8815` (2nd server: `8816`)      |
| SERVER-011                               | `8820`–`8829` | `8825`                           |
| Sprint-004 integration (TEST-77…TEST-82) | `8830`–`8839` | `8835`                           |
| SERVER-013                               | —             | Needs no server and must bind none. |
| CONTRACT-004                             | —             | Needs no server and must bind none. |
| Automated tests, every workspace         | —             | `0` (ephemeral). Never hardcode. |

**Reserved — do not bind:**

- **`8765`** — the documented workspace default and the port the **UI e2e suite** claims. It
  must stay free for the whole sprint. Note that SERVER-007's issue file writes
  `localhost:8765` into its E2E steps and SERVER-011's writes it into all eleven of its
  `curl` lines: **those are illustrative, not instructions.** Substitute your assigned port.
  When starting from `corpus init`, pass `--port` explicitly so the default probe never
  reaches 8765.
- `8770`–`8809`, `8865`, `8965` — sprints 002 and 003. Leave them alone.
- **`5173`** — held by an unrelated developer process on this machine. Do not assume it is
  free and do not "fix" the Vite config's 5173 default. Playwright/Vite use
  `CORPUS_UI_PORT=5273`.

### Scratch directories — one prefix per issue

| Issue        | Prefix                                        |
| ------------ | --------------------------------------------- |
| SERVER-007   | `mktemp -d /tmp/corpus-s007-XXXXXX`           |
| SERVER-011   | `mktemp -d /tmp/corpus-s011-XXXXXX`           |
| SERVER-013   | `mktemp -d /tmp/corpus-s013-XXXXXX`           |
| CONTRACT-004 | `mktemp -d /tmp/corpus-c004-XXXXXX`           |
| Integration  | `mktemp -d /tmp/corpus-sprint004-int-XXXXXX`  |

Automated tests use `fs.mkdtemp` with the same prefix. **Never** `rm -rf /tmp/corpus-*` —
delete only paths you created and captured in a variable. SERVER-013's generator sweeps write
thousands of fixtures; keep them under your own prefix and clean up by variable.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill node`, `killall node` **kill sibling agents'
servers** and are forbidden for the duration of this sprint. Stop what you started, by pid:

```sh
npx tsx apps/server/src/main.ts & SRV=$!   ; kill -TERM "$SRV"
corpus server stop                          # or: kill -TERM "$(jq -r .pid .corpus/server.pid)"
```

SERVER-007 additionally spawns **`curl -N` clients that hold sockets open**. Track their pids
the same way (`curl … & CURL=$!`), and kill them by pid — a stray `curl` holding a stream is
what makes "the server would not shut down" look like a bug in someone else's issue. Before
declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

### Runtime gotchas that will otherwise be misread as bugs

- **Node is v25.2.1 locally; CI pins Node 22.** Global `EventSource` is **behind a flag** on
  this build. This is why SERVER-007's E2E observes SSE with **`curl -N`**, not with a Node
  `EventSource` client — do not "fix" the runtime, and do not report the flag as a defect.
  The contract's `createEventStream` helper already accepts an injected
  `eventSourceFactory` for exactly this reason; unit tests use that, E2E uses `curl`.
- **`curl` line-buffers.** Use `curl -N` (no buffering) and read the stream with a loop or
  `stdbuf`; a `curl` whose output you never drained will look like "no frames arrived".
- **jsdom's `localStorage` quirk** affects `apps/ui` only. No issue in this batch touches
  `apps/ui` or `packages/kit`.
- **`diff-match-patch`'s `Diff_Timeout` is 1 s.** SERVER-013's sweeps run the engine tens of
  thousands of times; a sweep that takes minutes is the timeout doing its job, not a hang.
  SERVER-007's out-of-band reconciliation pays this cost per external edit — budget for it in
  the latency test (TEST-24) and measure, do not assume.
- **`better-sqlite3` is a native module.** Its first install in a fresh worktree may rebuild
  against the local Node ABI; do not report that delay as a query-performance result.
- **`.gitkeep` files live inside `.corpus/queue/<status>/`.** Anything that counts or lists
  queue events counts **`evt_*.json` only**. This bit sprint-003 and it is live again here:
  SERVER-007's watcher sees `.gitkeep` writes, and SERVER-011's `failed-job` reason reads the
  `events` table.
- **The projection's `search` table is standalone FTS5** with positional columns
  (`0 ref, 1 kind, 2 doc_id, 3 title, 4 body`). `snippet()`'s column argument is positional
  against *that* table, not against `documents`.
- **`corpus init` seeds a small corpus** (one `template`, three `view`s, two `skill`s, all
  `evergreen: true`). Every count assertion below is relative to that baseline — state the
  baseline in your log rather than assuming an empty database.

### Deferred verification is recorded, not skipped

Any test below that cannot be executed — because a dependency has not landed at the moment of
verification — is marked `DEFERRED → <issue>` in the E2E Verification Log with the reason and
the substitute evidence supplied. Silent omission is a fail. **Three deferrals are expected
and pre-authorized:**

1. SERVER-007's **auto-commit** of reconciled anchors (`DEFERRED → SERVER-005`, Open
   Conflict 4).
2. SERVER-011's seeding **through the real write endpoints** — `POST /api/docs` and
   `POST /api/threads` are SERVER-005/006 and are not in this batch (`DEFERRED → SERVER-005`,
   Open Conflict 5). The authorized substitute is real `.md` files on real disk, projected by
   the real server.
3. SERVER-011's `POST /api/threads/:id/seen` for the `unread` and `unread-reply` cases
   (`DEFERRED → SERVER-006`). The authorized substitute is a real `.corpus/seen.json` on
   disk, which SERVER-004 already projects.

---

## Acceptance Tests

### SERVER-007: Watcher + SSE invalidation

**Scope note.** `GET /events` and the bus are pure in-process machinery; the watcher is not.
Read Open Conflict 3 before deciding where the watcher starts.

#### The invalidation bus and the key vocabulary

TEST-1: A batch of changes produces one invalidation, not one per file
Given: A running server on 8815 over a real workspace, with a `curl -N` client attached to
`/events`.
When: 100 documents are written under `data/docs/` in a tight loop with `printf`.
Then: The client receives **at most 5** `invalidate` frames (one coalesced batch plus
stragglers from the debounce window), not 100, and the union of the keys across those frames
covers every document written. `select count(*) from documents` shows all 100.

TEST-2: Every emitted key is a `QueryKey` — an array, never a bare string
Given: Any invalidation from any source (watcher, queue, write path).
When: Each frame's `data` is parsed and validated with the contract's own
`InvalidatePayloadSchema`.
Then: Validation succeeds for every frame: `keys` is a non-empty array **of arrays**, each
element a `string | number | object`. A payload shaped `{"keys":["docs/doc_a1b2c3"]}` fails
this test — see Open Conflict 2 for the pinned vocabulary.

TEST-3: The queue broadcasts through the same bus, not a second channel
Given: A running server with an SSE client attached, and one `evt_*.json` in `pending/`.
When: `POST /api/queue/claim-all` then `POST /api/queue/{id}/complete` run over HTTP.
Then: Each transition produces an `invalidate` frame carrying the queue key, delivered on the
same stream as watcher invalidations. `createServer`'s existing `invalidate` dep is what
carries it — no second emitter exists.

TEST-4: A subscriber that unsubscribes stops receiving
Given: Two subscribers on the bus.
When: One unsubscribes and a further invalidation is published.
Then: The remaining subscriber receives it; the departed one receives nothing and the publish
does not throw.

#### `GET /events` — framing, auth, liveness

TEST-5: The stream is `text/event-stream` and carries only `invalidate` frames
Given: A running server.
When: `curl -sSN -D - "127.0.0.1:8815/events?token=$TOKEN"` runs while a document is edited on
disk and a queue event completes.
Then: The response headers show `content-type: text/event-stream`; every non-comment frame is
`event: invalidate` followed by a single `data:` line; no other event name appears on the
wire.

TEST-6: Both authentication forms work, and only on this route
Given: A running server.
When: `/events` is requested (a) with `Authorization: Bearer $TOKEN` and no query parameter,
(b) with `?token=$TOKEN` and no header.
Then: Both open the stream. When the same `?token=` form is used against `GET /api/docs`, the
response is **401** — the query-token exemption is `/events`-only.

TEST-7: A missing or wrong token is rejected before any frame
Given: A running server.
When: `/events` is requested with no token, then with `?token=wrong`.
Then: Both return **401** with the contract's error body; neither response has
`content-type: text/event-stream`, and no `invalidate` frame is ever emitted to them.

TEST-8: An idle stream is kept alive by a heartbeat
Given: An attached `curl -N` client and no activity in the workspace.
When: The connection is left idle for **60 s**.
Then: At least two heartbeats arrive (SSE comment lines, `:` — invisible to `EventSource`
consumers), the connection is still open, and a document edit made at t=60 s still produces
an `invalidate` frame on that same connection.

TEST-9: A dead subscriber is pruned, not 500'd
Given: Two attached clients.
When: One is killed by pid mid-stream and two further mutations occur.
Then: The surviving client receives both invalidations; the server logs no `error`-level
entry for the dead socket (an `EPIPE`/`ERR_STREAM_DESTROYED` is a prune, not a fault); a
subsequent `GET /api/health` is `200`.

TEST-10: Concurrent subscribers all see the same invalidation
Given: Three attached clients.
When: One document is edited out of band.
Then: All three receive an `invalidate` frame naming that document, with identical `keys`
content.

TEST-11: **Rule 3 is absolute** — no frame ever carries data
Given: A mutation-heavy scenario: 10 out-of-band document edits (including a document with a
600-character body and one with anchors), an unlink, a queue claim/complete cycle, a lock file
appearing under `.corpus/locks/`, and a job log line appended under `.corpus/jobs/`.
When: Every SSE frame emitted during the scenario is captured and parsed.
Then: Every payload's key set is exactly `{"keys"}` — no `doc`, `body`, `title`, `thread`,
`turn`, `job`, `event`, `payload` or any other field appears anywhere in any frame, at any
depth. A frame carrying a document title fails this test even if the title is also a valid
query key segment.

TEST-12: A client disconnecting mid-write does not disturb the server
Given: A client attached while a burst of invalidations is in flight.
When: The client's TCP connection is dropped (kill by pid) exactly during the burst.
Then: The server continues serving: a subsequent `GET /api/docs` (or `/api/health`) returns
`200`, the process is still alive, and `corpus server stop` exits cleanly with no pidfile
left behind.

#### The watcher — roots, projection, ignores

TEST-13: Every §9.1 root is watched
Given: A real `corpus init` workspace and a running server.
When: A file is created out of band in each of `data/docs/`, `data/threads/`,
`.claude/skills/<name>/SKILL.md`, `.claude/skills-archived/<name>/SKILL.md`,
`.claude/agents/<name>.md`, `.corpus/queue/pending/`, `.corpus/locks/`, and `.corpus/jobs/`.
Then: Each one produces an observable `invalidate` frame, and each one is reflected in the
projection (`documents` for the five document roots, `events`/`locks`/`jobs` for the runtime
roots) within the same window.

TEST-14: An out-of-band add and an out-of-band change both upsert
Given: A running server over a workspace with no `data/docs/finance/mortgage.md`.
When: The file is created on disk with a full frontmatter block, then its body is edited by
`sed -i ''`.
Then: After the create, `select id,type,title,path from documents where path like '%mortgage%'`
returns exactly one row (upsert, not a failed update against a missing row); after the edit,
the same row's `body_excerpt` reflects the new text and the row count is still one.

TEST-15: An unlink deletes the rows and invalidates
Given: A projected document with two threads whose `parent` is that document.
When: The document file is `rm`'d out of band.
Then: Its `documents`, `anchors`, `links` and `search` rows are gone; an `invalidate` frame
was broadcast; the two thread rows **survive** as orphaned records (§9.2) with their `parent`
intact; and the server did not crash. `GET /api/docs` no longer lists the deleted document.

TEST-16: A directory rename keeps ids stable
Given: `data/docs/finance/` containing three projected documents.
When: The directory is renamed to `data/docs/money/` out of band.
Then: After the watcher settles, the three rows carry the new `path` and the **same `id`s**;
no duplicate rows exist; `select count(*) from documents` is unchanged.

TEST-17: Editor noise and non-corpus files produce nothing
Given: A running server.
When: `data/docs/.mortgage.md.swp`, `data/docs/#mortgage.md#`, `data/docs/mortgage.md~`,
`data/docs/.DS_Store`, `data/docs/notes.txt`, and `.corpus/cache.db-wal` churn are all
written.
Then: **Zero** `invalidate` frames are emitted for them and no `documents` row appears. (An
atomic-rename save of a real document — write temp, rename over — *does* produce exactly one
invalidation; assert that too, so the ignore list is not proved by over-ignoring.)

TEST-18: An out-of-band `evt_*.json` becomes an `events` row without a restart
Given: A running server with a parked `GET /api/queue/idle` long poll (the mirror-wiring
handoff scenario).
When: A well-formed `evt_*.json` is dropped into `.corpus/queue/pending/` by another process.
Then: The parked poll wakes; **and** an `events` row exists for it *before* any claim and
*without* a restart; `doctor` reports **no** `count_mismatch`; the `.gitkeep` files in the
three status directories produce no rows and no drift.

#### Self-write suppression

TEST-19: A server-originated write projects once
Given: A running server, a spy on the projection path (unit) plus an SSE client (E2E).
When: A mutation is performed through the API — in this batch, a queue transition
(`claim-all` → `complete`), which moves real files under `.corpus/queue/`.
Then: **Exactly one** invalidation is observed for that mutation, and the affected file is
projected exactly once. Two invalidations for one API call (one from the write path, one from
the watcher) fails this test.

TEST-20: Suppression matches on content, not on path
Given: A server write to a file registered as a self-write.
When: An external process writes **different** content to the same path within the
suppression TTL.
Then: The external write is **not** suppressed: it is projected and invalidated. (Register
the self-write, then `printf` different bytes to the same path immediately, and assert the
new content reached the projection.)

#### Out-of-band anchor reconciliation (§6 catch-all)

TEST-21: An external edit around an anchored sentence remaps the selector on disk
Given: A `corpus init` workspace with a committed document carrying
`anchors: {anc_k4f7: {exact, prefix, suffix}}` whose `exact` resolves in the committed body.
When: The sentence *containing* the anchored text is edited on disk with `sed -i ''` (the
anchored words themselves partially rewritten), and the watcher settles.
Then: `cat` of the file shows the `anchors` map updated — the new `exact` is the text now
spanned by the anchor's mapped range, with `prefix`/`suffix` recomputed from the new
surroundings — and the `anchors` row in the projection carries a non-NULL `resolved_offset`.
The thread is **not** orphaned.

TEST-22: `git show HEAD:<path>` is the `oldBody`, and its absence is handled
Given: (a) A committed document; (b) a brand-new untracked document; (c) a workspace whose
git repo has **no commits at all**.
When: Each is edited/created out of band and the watcher settles.
Then: (a) reconciles against the committed version, as in TEST-21. (b) and (c) skip
reconciliation and project normally — no throw, no error log, no anchors clobbered, and the
row appears. A stack trace in the server log fails this test.

TEST-23: The anchor write-back does not loop
Given: The TEST-21 scenario.
When: The watcher's reconciliation writes the updated frontmatter back to the file.
Then: The write-back does not trigger a further reconciliation pass: the total number of
`invalidate` frames for the edit is bounded (≤ 3), the file reaches a fixed point (a second
`cat` after 2 s is byte-identical to the first), and the server log shows no repeated
reconcile entries for that path.

TEST-24: An external edit is visible as an SSE frame well under 250 ms
Given: A running server with an attached `curl -N` client, and a warm workspace (the
watcher already running, at least one prior edit performed so no first-run cost is measured).
When: `date +%s%3N` is captured, a one-line `printf >>` appends to a projected document, and
the arrival time of the resulting `invalidate` frame is captured.
Then: The elapsed time is **under 250 ms**, measured and recorded as a number in the E2E log
across **at least 5 runs** (report min/median/max, not one lucky sample). Report separately,
without failing, the same measurement for a document **with anchors** (which pays
reconciliation + `git show`) — that number is data for SERVER-005's budget, and if it exceeds
250 ms it is escalated, not silently accepted.

---

### SERVER-011: Collection query endpoint — filters, FTS, `needs=me`, tree

**Scope note.** The shipped `DocsQuerySchema` and `DocRow` are the authority for every
parameter name, value domain and response field. SERVER-011's issue prose disagrees with the
contract in eleven places (Open Conflict 1) — the tests below are written against the
**contract**, and the issue file is corrected before implementation. A server that emits a
shape its own contract does not declare defeats §9.3.

#### The envelope

TEST-25: The response is `{items, page}`, exactly
Given: A seeded workspace and a running server on 8825.
When: `curl "127.0.0.1:8825/api/docs" -H "Authorization: Bearer $TOKEN" | jq 'keys'`.
Then: Exactly `["items","page"]`. `page` is `{total, limit, offset}` with `limit` 50 and
`offset` 0 by default. A flat `{items,total,limit,offset}` envelope fails this test.

TEST-26: A row is exactly `DocRow`
Given: Any result set.
When: Each row's keys are compared against the contract's `DocRowSchema`, and the whole
response is parsed with it.
Then: Every row carries `id, type, title, path, status, tags, created, updated, due,
reviewed, evergreen, excerpt, attention, snippets` — no more, no fewer. `attention` is
present (possibly empty) on **every** response, not only under `needs=`; `snippets` is
present and empty when `q` is absent. An extra `staleness` or `thread` field fails this test
(see Open Conflict 7).

TEST-27: An empty corpus answers honestly
Given: A workspace whose `documents` table is empty.
When: `GET /api/docs` and `GET /api/tree`.
Then: `{"items":[],"page":{"total":0,"limit":50,"offset":0}}` and `{"folders":[]}`. Neither
is a 404 and neither is a 500.

#### Filters

TEST-28: `type` is comma-separated and ORs
Given: A corpus with notes, views, templates and threads.
When: `?type=note,view`.
Then: Exactly the notes and views come back; threads and templates do not; `page.total`
matches the row count for a small corpus.

TEST-29: Archived is excluded by default and returned on request
Given: A corpus with one document whose `status` is `archived`.
When: `GET /api/docs`, then `?status=archived`, then `?status=open`.
Then: The first omits it; the second returns **only** it; the third omits it. Note the
contract's `status` is a **single enum**, so `?status=open,archived` is a **400** (TEST-53),
not a union — the "archived chip" is `status=archived`.

TEST-30: `tag` is comma-separated, ORs, and is case-insensitive
Given: Documents tagged `finance`, `urgent`, and one tagged both.
When: `?tag=finance,urgent`, then `?tag=Finance`.
Then: The first returns all three (union, not intersection — the contract's stated grammar);
the second returns the same rows as `?tag=finance`.

TEST-31: `folder` scopes to a prefix, includes descendants, and pulls in threads
Given: `data/docs/finance/mortgage.md`, `data/docs/finance/2026/q1.md`,
`data/docs/legal/nda.md`, and a thread whose `parent` is `mortgage.md`.
When: `?folder=finance`, then `?folder=finance/2026`, then `?folder=` on the root.
Then: The first returns both finance documents **and** the thread (§10 folder scoping); the
second returns only `q1.md`; the root returns everything under `data/docs/`. A folder that
does not exist returns `{"items":[],"page":{"total":0,...}}` — **not** a 404. A trailing
slash (`?folder=finance/`) behaves identically to `?folder=finance`.

TEST-32: Thread-only filters no-op for non-thread types rather than emptying the result
Given: A corpus with 4 notes and 3 threads, one thread parented to a known document.
When: `?parent=<docId>`, `?agent=engaged`, `?author=agent`, `?unread=true` — each on its own,
with no `type` filter.
Then: In every case the **non-thread rows are unaffected** (all 4 notes still appear) and the
thread rows are narrowed by the filter. A response containing only threads fails this test;
so does an empty response.

TEST-33: `parent` and `agent` narrow threads correctly
Given: Threads with `agent` values `none`, `requested` and `engaged`, two of them parented to
the same document.
When: `?type=thread&parent=<docId>`, then `?type=thread&agent=engaged`.
Then: Exactly the two parented threads; then exactly the engaged one.

TEST-34: `references` reads the `links` table
Given: `doc_A` whose body contains `[[doc_B]]`, and `doc_C` which does not.
When: `?references=doc_B`.
Then: Exactly `doc_A`. Adding `[[doc_B]]` to `doc_C` on disk and re-projecting makes `doc_C`
appear on the next query.

TEST-35: `unread` is thread-relative and treats "never seen" as unread
Given: Thread T1 with a `seen` mark newer than its last turn, thread T2 with a mark older
than its last turn, thread T3 with **no** `seen` row at all.
When: `?type=thread&unread=true`.
Then: T2 and T3 come back; T1 does not. (Seeded via a real `.corpus/seen.json` —
`DEFERRED → SERVER-006` for the `POST /api/threads/:id/seen` path.)

TEST-36: `since` filters on `updated`, strictly after
Given: Documents updated at `T-10d`, `T-1d` and `T+0`.
When: `?since=<T-2d as ISO instant>`.
Then: The `T-1d` and `T+0` documents come back; the `T-10d` one does not. A document whose
`updated` equals the boundary exactly is **excluded** (strictly after, per the contract's own
description).

TEST-37: `due` accepts a date and the three keywords
Given: Documents due yesterday, today, in 4 days, in 40 days, and one with `due: null`.
When: `?due=overdue`, `?due=today`, `?due=week`, and `?due=<an ISO date 5 days out>`.
Then: `overdue` → yesterday's only; `today` → yesterday's and today's (due on or before
today); `week` → those plus the 4-day one; the explicit date → the same set as `week` here.
The `due: null` document never appears in any of them. A `due=week` run near a month boundary
gives the same answer as an explicit ISO date computed for that boundary.

#### Full-text search

TEST-38: `q` matches titles, bodies and turn bodies
Given: A document whose **title** contains "escrow", a different document whose **body**
contains "amortization", and a thread one of whose **turns** contains the phrase
"cherry-picked assumption" (which appears nowhere else).
When: `?q=escrow`, `?q=amortization`, `?q=cherry-picked assumption`.
Then: Each returns the right row and only it. The turn hit is attributed to the **thread**
row (not to the parent document, and not as a separate row per turn).

TEST-39: Snippets are structured segments with the match flagged
Given: The TEST-38 corpus.
When: `?q=amortization`.
Then: The row's `snippets` is a non-empty array; the matching entry has `field` ∈
`{title, body, turn}` matching where the hit was, `segments` is an alternating array of
`{text, match}`, at least one segment has `match: true` and its `text` contains the query
term, and concatenating every `segments[].text` yields the readable excerpt. A `turn` snippet
additionally carries `threadId`. **No HTML appears anywhere** — a `<mark>` in the payload
fails this test (the contract chose structured segments precisely so the UI needs no
`dangerouslySetInnerHTML`).

TEST-40: Adversarial queries are sanitized, never 500
Given: A running server.
When: `?q="unbalanced`, `?q=NEAR(a b)`, `?q=a OR b`, `?q=*`, `?q=%22%22`, `?q=)))`, and a
1 KB `q`.
Then: Every one returns **200** with a well-formed envelope (possibly empty). None returns
500, and none returns an FTS syntax error in the body.

TEST-41: `sort=relevance` requires `q`
Given: A running server.
When: `?sort=relevance` with no `q`, then `?q=escrow&sort=relevance`.
Then: The first is **400** with a `bad_request` body whose `issues` array names `sort`; the
second is 200 with results ordered by FTS rank (the best-matching row first — assert the
known-best row is `items[0]`).

#### Staleness

TEST-42: Tiers are at-or-beyond, computed from `max(updated, reviewed)`
Given: Documents whose `max(updated, reviewed)` ages are 10, 45, 100 and 200 days, plus one
aged 200 days with `reviewed` set to yesterday, plus one aged 200 days with
`evergreen: true`. A fixed clock is used for the automated tests; E2E backdates real
frontmatter on disk.
When: `?stale=aging`, `?stale=stale`, `?stale=very-stale`.
Then: `aging` returns the 45/100/200-day documents (at-or-beyond, per the contract);
`stale` returns the 100/200-day ones; `very-stale` returns only the 200-day one. The
recently-`reviewed` document appears in **none** of them. The `evergreen` document appears in
**none** of them, at any tier, ever. Boundary check: a document aged **exactly** 30 days is
`aging`; exactly 90 is `stale`; exactly 180 is `very-stale`.

TEST-43: The stale Attention reason agrees with the stale filter
Given: The TEST-42 corpus.
When: `GET /api/docs` with no filters.
Then: Every row whose age puts it at `stale` or beyond carries `"stale"` in its `attention`
array, and no `evergreen` row ever does. The thresholds behind the filter and behind the
reason are the same constant — a document that `?stale=stale` returns but whose row lacks the
reason (or vice versa) fails this test.

#### `needs` — the Attention union

TEST-44: `needs=me` is the five-reason union, one row per document
Given: Five seeded situations — (1) a thread whose last turn is by `agent` and whose `seen`
mark is older, (2) a thread whose last turn is an `agent` turn containing a fenced
```` ```form ```` block with no later `user` turn, (3) a document with `due` in the past,
(4) a document at the `stale` tier and not `evergreen`, (5) a queue event moved to `failed/`
through `POST /api/queue/{id}/fail` whose payload names a document — plus one document
contrived to match **two** reasons (overdue *and* stale).
When: `?needs=me | jq '.items[] | {id, attention}'`.
Then: Six rows. Each carries exactly the reasons that apply, drawn from
`unread-reply | form | due | stale | failed-job`. The two-reason document appears **once**
with **both** reasons — not twice. `me` never appears as a value inside `attention`.

TEST-45: Each reason is individually filterable
Given: The TEST-44 corpus.
When: `?needs=unread-reply`, `?needs=form`, `?needs=due`, `?needs=stale`,
`?needs=failed-job`.
Then: Each returns exactly its own row(s), and the union of the five equals `?needs=me`'s
result set.

TEST-46: Handling the reason clears the row
Given: The TEST-44 corpus.
When: For each reason in turn: the `seen` mark is advanced past the last turn; a `user` turn
is appended after the form turn; the `due` date is moved into the future; `reviewed` is set to
now; the failed event is retried or abandoned. Then `?needs=me` is re-run.
Then: Each handled row disappears from the union on the next query, and the reason disappears
from that document's `attention` array in an unfiltered `GET /api/docs`.

TEST-47: `needs` composes by intersection with the other filters
Given: The TEST-44 corpus, with the overdue document under `data/docs/finance/`.
When: `?needs=me&folder=finance`.
Then: Only the Attention rows inside that folder come back — the union is narrowed, not
replaced. `?needs=me&status=archived` returns archived rows **only if they match a reason**.

#### Sorting, pagination and the tree

TEST-48: Every declared sort works and the default is `-updated`
Given: A corpus with distinct `updated`, `created`, `due` and `title` values.
When: `?sort=` each of `updated, -updated, created, -created, due, title`, and one call with
no `sort` at all.
Then: Each ordering is correct and ascending/descending as its name says; the no-`sort` call
matches `?sort=-updated`. A `?sort=last-activity` is a **400** — it is not in the contract's
enum.

TEST-49: Pagination is stable across ties
Given: 10 documents, at least 4 of which share an identical `updated` value.
When: `?limit=5&offset=0` then `?limit=5&offset=5` under the default sort.
Then: The two pages are **disjoint** and their union is all 10 with no gaps and no
duplicates, and re-running both pages produces byte-identical id sequences (a stable
tiebreak, `documents.id`, is in the ORDER BY).

TEST-50: `limit` above the cap is a 400, not a clamp
Given: A running server.
When: `?limit=201`, then `?limit=200`, then `?limit=0`, then `?offset=-1`.
Then: `201` → **400** with `issues` naming `limit`; `200` → 200; `0` → 400; `-1` → 400. (The
contract's `.max(200)` is a validation bound, not a clamp — see Open Conflict 1.)

TEST-51: `GET /api/tree` returns the folder tree with both counts
Given: `data/docs/inbox/` (2 documents), `data/docs/finance/` (1 document),
`data/docs/finance/2026/` (3 documents), `data/docs/templates/` and `data/docs/views/` from
the seed.
When: `curl "…/api/tree" | jq`.
Then: The shape is `{"folders":[…]}` with each node
`{path, name, count, totalCount, children}`; `finance` has `count: 1` and `totalCount: 4`;
`finance/2026` has `count: 3, totalCount: 3`; `path` is relative to `data/docs/` (`finance/2026`,
not an absolute path, and not `data/docs/finance/2026`); `name` is the last segment.

TEST-52: Tree counts agree with the list they scope
Given: The TEST-51 corpus plus a thread parented to the `finance` document.
When: The `finance` node's `totalCount` is compared with
`?folder=finance&limit=200 | jq '.page.total'`.
Then: They agree, with the documented rule stated in the log: threads are **not** tree nodes
but **do** count toward their parent's folder — so a folder column's badge and its list
length match. The counts are derived from the projection, not from a filesystem walk (verify
by deleting a file from disk without re-projecting: the tree still reports the projected
count until the watcher settles).

#### Validation and errors

TEST-53: Unknown filter **values** are 400s with `issues`, never silent no-ops
Given: A running server.
When: `?stale=ancient`, `?type=` (empty), `?agent=maybe`, `?needs=everyone`,
`?due=next-tuesday`, `?since=not-a-date`, `?unread=perhaps`.
Then: Each is **400** with an `ApiError` body whose `error` is `bad_request` and whose
`issues` array is **present and non-empty**, naming the offending parameter. An empty result
set with 200 fails this test. (The `issues`-required note in SERVER-011's issue file applies
to every server-generated 400, not only zod-hook ones.)

TEST-54: An unknown filter **name** is ignored, not an error
Given: A running server.
When: `?colour=blue&type=note`.
Then: **200**, with the same result set as `?type=note` alone. Unknown query parameters are
not part of the contract's grammar and are not rejected.

TEST-55: Both endpoints are behind the bearer guard
Given: A running server.
When: `GET /api/docs` and `GET /api/tree` with no `Authorization` header.
Then: Both are **401** with the contract's error body — and neither leaks a row count or a
folder name in the response.

#### Performance

TEST-56: One statement per request, and it is fast enough to type against
Given: A workspace of **2000 documents** (generated on disk and projected).
When: `?q=<term>&type=note&tag=finance&folder=finance&sort=-updated&limit=50` is timed, and
the query plan is inspected (`EXPLAIN QUERY PLAN`).
Then: The request completes in **under 100 ms** warm (report min/median/max over 5 runs), the
result comes from a **single** SELECT plus one COUNT (assert by statement count, not by
reading the source), and the plan shows index use rather than a full scan on the common
filters. `?needs=me` on the same corpus is reported too — under 250 ms, and if it is not,
that is escalated with the plan attached rather than optimized by adding a durable column
without an issue.

---

### SERVER-013: Anchor engine — the substitution class

**This issue's design is closed.** The primary discriminator (survivor location: INSERT →
relocation → void and re-place; EQUAL → pre-existing duplicate → trust the mapper) is
user-authorized. Similarity thresholds are off the table in both directions. The baseline for
every A/B below is the **currently shipped engine** — SERVER-012 rounds 1–2, with round 3
(`lacksKinship`) reverted. Do not A/B against the reverted round 3.

TEST-57: The class reproduces on disk before any code changes
Given: A real `git init` workspace with the round-4 hiring/cash fixture — six wholly-distinct
paragraphs, one anchor on P1, paragraphs #4 and #6 swapped — committed, then edited on disk.
When: Reconciliation runs on the pre-fix engine and the resulting frontmatter is read back
with `git diff`.
Then: The anchor's `exact` is observably **another paragraph's text** while its own original
text survives verbatim elsewhere in the new body. The exact before/after selectors are pasted
into the E2E log. A fix logged without this reproduction is not accepted.

TEST-58: The pre-fix rate is measured, not assumed
Given: An **independent-shape generator** — swap, rotate, reverse and shuffle of
wholly-distinct paragraphs, ≥ 1000 documents / ≥ 3000 anchors, mixed whole-paragraph and
sub-span anchors — run against the shipped engine.
When: The round-4 substitution predicate is evaluated: *the anchor's resulting `exact` is
unrelated to its original **and** the original survives verbatim in `newBody` at a location
the mapper did not choose.*
Then: A non-zero baseline count is recorded in the log with its denominator. "The repo sweep
found nothing" is not a baseline — the repo suite passed for four rounds while this class was
open.

TEST-59: **Substitution → 0**
Given: The TEST-58 generator, same seeds, post-fix engine.
When: The same predicate is evaluated.
Then: **Zero** violations, across every shape family. The count, the denominator and the
seed are recorded so the run is reproducible.

TEST-60: TEST-67(c) passes under the corrected predicate, both variants
Given: The cut-and-paste fixtures from sprint-002's TEST-67 row (c), in both the
one-paragraph-insert and two-paragraph-insert variants.
When: Reconciliation runs.
Then: Each anchor resolves to the range holding **its own** moved text — not merely "some
range containing the text" (`newBody.includes(exact)` is the discredited predicate from the
round-2 evaluation and may not be used as the assertion).

TEST-61: TEST-63 with duplicates stays remapped — the anti-goal is round 3
Given: The eval file's shrink-with-duplicate set: an anchored passage edited in place (shrunk
to a few words, and separately a heavy rewrite at ~0.35 similarity and a medium one at ~0.72)
while a **verbatim copy of the original** sits elsewhere in the document; ≥ 600 documents.
When: Reconciliation runs.
Then: **Zero** orphans across the set. Every one is `remapped`, and every one lands on the
**in-place edited** text — never on the duplicate. (Round 3 orphaned 404/600 here; that is the
named regression this test exists to prevent.) The boundary-crossing-delete-with-duplicate
variant is included and also stays remapped.

TEST-62: An INSERT-overlapping survivor voids the slice and re-places the anchor
Given: A reorder in which the anchor's own `exact` survives verbatim at a location that
overlaps text this edit **inserted**.
When: Reconciliation runs.
Then: The rewritten slice is voided and the anchor is re-placed through the existing
verification chain (`resolveAnchorExact` + `touchesInsertion`, orphan last, selector
byte-preserved on orphan), landing on the survivor. The decision is observable from the
outcome — no similarity value is computed anywhere on this path.

TEST-63: A survivor wholly inside EQUAL text leaves the mapper's slice alone
Given: The TEST-61 shape — the survivor is a pre-existing duplicate sitting in unedited text.
When: Reconciliation runs.
Then: The mapper's slice is trusted and the anchor stays on the in-place edit. This is the
SERVER-002 in-place-edit adjudication holding; a fix that orphans here fails TEST-61 too.

TEST-64: A non-unique survivor goes through the uniqueness rules
Given: A reorder in which the anchor's `exact` survives verbatim at **two or more** locations
in `newBody`.
When: Reconciliation runs.
Then: Re-placement goes through the chain's uniqueness rules; genuine ambiguity **orphans**
with the selector byte-preserved. It never picks one occurrence arbitrarily and never picks
by similarity.

TEST-65: True duplication during a reorder leaves the mapper's choice standing
Given: Both the mapped location **and** an INSERT location hold verbatim copies of the
anchor's text.
When: Reconciliation runs.
Then: The mapper's choice stands — there is no evidence it is wrong — and the outcome is
byte-identical to the shipped engine's.

TEST-66: Everything outside the substitution class is byte-identical to the shipped engine
Given: A 3-way-style A/B (shipped engine vs post-fix engine) over the full must-hold set:
cross-anchor **capture = 0** and **collision = 0**; straddled cases; the SERVER-002 round-3
doppelgänger scenarios (68a, 68b, and the must-not-fix 68c); the four deletion scenarios (66/1–4);
cut-and-paste re-attachment; the escalating-context sequence including row 4; the
nested-anchor exemption, plain and reordered; musical chairs (two anchors on byte-identical
paragraphs → distinct, order-preserving ranges); reorder-plus-genuine-deletion (deleted
anchors orphan while survivors re-attach to their own text); and the **M1 on-disk matrix**.
When: Both engines run the same fixtures.
Then: Every outcome is **byte-identical** — same classification, same selector bytes, same
orphan set. Any flip outside the substitution class is a regression and fails this test, and
the A/B table goes in the E2E log.

TEST-67: The standing engine bars hold
Given: The post-fix engine.
When: Determinism (200 runs of one fixture), order-independence (≥ 4 permutations of anchor
key order), input immutability (inputs deep-frozen), purity (no I/O, no clock, no randomness),
and performance at 50/100/200/400 anchors plus the 1 MB / 50-anchor and 200-scattered-edit
budgets are exercised.
Then: One distinct result per fixture, identical across permutations, inputs unmutated, zero
impure imports, and the perf ratio against the shipped engine stays within the same order of
magnitude (report the ratios).

TEST-68: No similarity constant was introduced, and the open corner was escalated if reached
Given: The post-fix source.
When: The diff is inspected for new numeric thresholds and for uses of the fuzzy/similarity
path in the discriminator.
Then: **No new similarity constant exists** and the discriminator reads no similarity score.
If the EQUAL-survivor-plus-unrelated-slice corner could not be closed causally, the E2E log
carries an **escalation** with the concrete failing case and its measured rate — not a
threshold, and not a silent acceptance.

---

### CONTRACT-004: Mandatory request bodies are typed optional

**Read Open Conflict 6 first.** The issue's parenthetical "currently exactly `halt` and
`fail`" is factually wrong — four request-body schemas are wholly optional, not two. TEST-71
is written against the orchestrator's adjudication; the rest of the tests hold whichever way
it goes.

TEST-69: The gap reproduces at compile time before the fix
Given: A scratch `.ts` file that constructs the generated client and calls
`client.POST("/api/docs")` with **no** second argument, and another calling
`client.POST("/api/threads")` with no body.
When: `npx tsc --noEmit` runs against the pre-fix contract build.
Then: Both **compile clean** — and the log records that, plus a real runtime `curl -X POST
/api/docs` with no body returning **400**, which is the mismatch the issue exists to close.

TEST-70: After the fix, omitting a mandatory body is a compile error
Given: The same two probe files, post-fix, against a **rebuilt** `packages/contract`.
When: `npx tsc --noEmit` runs.
Then: Both **fail to compile**, with an error that points at the missing body argument. The
actual `tsc` output is pasted into the log. Adding a valid body makes each compile again —
assert that too, so the probe is not passing because of an unrelated type error.

TEST-71: The designed bare-`POST` routes still compile bare
Given: Probe calls with no body for **`POST /api/queue/halt`** and
**`POST /api/queue/{id}/fail`** — plus, if the orchestrator adjudicates Open Conflict 6 that
way, `POST /api/threads/{id}/seen` and `POST /api/locks/{docId}`.
When: `npx tsc --noEmit` runs post-fix.
Then: Every route on the adjudicated bare-POST list compiles with no body **and** compiles
with one; every route not on that list fails to compile without one. The adjudicated list is
restated verbatim in the E2E log.

TEST-72: The class invariant is a test, not a review comment
Given: The generated OpenAPI document.
When: A test walks every path × method and inspects each operation that declares a
`requestBody`.
Then: **Every** such operation carries an explicit `required` key (`true` or `false`). No
operation relies on OpenAPI's implicit default. Deleting a `required: true` from any route
makes this test fail — verify that by temporarily removing one and re-running.

TEST-73: The declared values match the adjudicated table exactly
Given: The generated document.
When: The `required` value of every request body is tabulated.
Then: The table matches the adjudication, route for route: the mandatory set (at minimum
`POST /api/docs`, `PUT /api/docs/{id}`, `POST /api/docs/{id}/move`, `POST /api/capture`,
`POST /api/threads`, `POST /api/threads/{id}/turns`, `POST /api/jobs/{id}/log`) is
`required: true`, and the bare-POST set is `required: false` with a description sentence
saying so. Eleven bodies exist in the surface; all eleven appear in the table.

TEST-74: The multipart routes are covered too
Given: `POST /api/capture` and `POST /api/threads/{id}/turns`, which declare
`multipart/form-data` bodies.
When: The invariant and the table are applied.
Then: They are treated identically to the JSON routes — a multipart body is a body, and an
omitted `required` on one is the same defect.

TEST-75: Artifacts are regenerated, byte-deterministic, and drift-free
Given: The post-fix contract.
When: The generator is run **twice** in a row and `git diff` is taken after each; then the
repo's drift check runs.
Then: The second run produces **no diff at all** (byte-deterministic), the drift check is
green, and `openapi.json` and `schema.generated.ts` are both committed in the same change as
the route edits. A hand-edited artifact fails this test.

TEST-76: Every consumer still typechecks
Given: The post-fix contract, rebuilt.
When: `npm run build && npm run typecheck` runs across all workspaces.
Then: Green. Any call site in `apps/cli` or `apps/ui` that breaks is **reported explicitly in
the log** as a latent runtime 400 that the type system just caught — fixed in place only if
the correction is a one-line body addition, otherwise escalated to the orchestrator rather
than worked around by relaxing `required`.

---

### Cross-issue integration

TEST-77: **The centerpiece — an outside edit becomes a queryable, announced fact**
Given: A real `corpus init` workspace on port 8835, a running daemon, a `curl -N` client on
`/events`, and a document `data/docs/finance/mortgage.md` **committed to git** carrying one
anchor whose `exact` resolves, and a thread in `data/threads/` pointing at that anchor.
When: This exact sequence runs, with output and timings captured:

```sh
WS=$(mktemp -d /tmp/corpus-sprint004-int-XXXXXX); cd "$WS"
corpus init --port 8835
corpus server start
# … seed mortgage.md (with an anchor) + its thread on disk, commit them …
curl -sSN "127.0.0.1:8835/events?token=$TOKEN" > /tmp/sse.$$ & SSE=$!
T0=$(date +%s%3N)
sed -i '' 's/6\.1%/6.4%/' data/docs/finance/mortgage.md      # a real outside editor
# … wait for the frame …
curl -sS "127.0.0.1:8835/api/docs?q=6.4" -H "Authorization: Bearer $TOKEN" | jq
curl -sS "127.0.0.1:8835/api/docs?folder=finance" -H "Authorization: Bearer $TOKEN" | jq
sqlite3 .corpus/cache.db "select anchor_id, resolved_offset from anchors"
kill -TERM "$SSE"; corpus server stop
```

Then: **Every hop is real and every hop fires.** One `invalidate` frame arrives within
250 ms of `T0` carrying only `keys`; the file's frontmatter shows the anchor's selector
**remapped** to the edited sentence (not orphaned); `resolved_offset` is non-NULL; the
`?q=6.4` query returns the document with a `snippets` entry whose matched segment contains
`6.4`; `?folder=finance` returns both the document **and** its thread; and
`corpus server stop` leaves no process and no pidfile. **No hop in this chain is stubbed.**
This test is what makes SERVER-007 and SERVER-011 a batch.

TEST-78: The key the watcher emits is the key that names the query that changed
Given: The TEST-77 workspace.
When: Three different changes are made in turn — a document body edit, a thread turn appended
on disk, and a queue event completed over HTTP — and the `keys` of each resulting frame are
recorded.
Then: Each frame's keys are drawn from the pinned vocabulary (Open Conflict 2), they name the
resource that actually changed (a document edit invalidates the docs collection and that
document, not `jobs`), and each is a valid `QueryKey` array. The vocabulary as emitted is
written into the E2E log verbatim — UI-002 and UI-003 will mirror these exact arrays.

TEST-79: A failed job surfaces in Attention and is announced
Given: The TEST-77 workspace with an `evt_*.json` whose payload names the seeded document.
When: `claim-all`, then `POST /api/queue/{id}/fail`, then `?needs=me`.
Then: The SSE stream carries an `invalidate` frame for the transition; `?needs=me` returns a
row carrying `"failed-job"` in `attention`; abandoning or retrying the event and re-querying
clears it. Every count along the way counts `evt_*.json` only — the `.gitkeep` files never
appear as events and never produce a `doctor` `count_mismatch`.

TEST-80: There is exactly one anchor engine
Given: SERVER-013 merged, and the TEST-77 out-of-band edit scenario.
When: An external edit is made whose shape is one of SERVER-013's substitution fixtures (a
reorder of distinct paragraphs where the anchored text survives verbatim elsewhere).
Then: The watcher's reconciliation produces the **same** outcome as SERVER-013's library-level
test for that fixture — the anchor lands on its own text. The watcher calls the shared
`reconcileAnchors`; a second copy of the logic anywhere in `apps/server` fails this test.

TEST-81: `rebuild && doctor` is clean after the whole chain
Given: The TEST-77 workspace after every step above, with the server **running**.
When: A rebuild runs, then `doctor`.
Then: `doctor` reports `ok` with no drift — including no `count_mismatch` from the queue
`.gitkeep` files, none from the failed event, and none from the anchor write-back the watcher
performed.

TEST-82: The repo-wide gates stay green
Given: All four issues landed and merged onto the phase branch.
When: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
`npm test` run from a clean tree, followed by `npm run e2e` with `CORPUS_UI_PORT=5273`.
Then: All pass with no regression against the pre-sprint baseline, combined coverage stays at
or above the 90 % gate, `openapi.json` regenerates with no diff, `docs/cli.md` regenerates
with no diff, and the pre-push hook passes end to end.

---

## Out of Scope

Nothing below belongs to this sprint. An agent building one of these has drifted; an
evaluator failing an issue for lacking one is wrong.

**Watcher / SSE (SERVER-007)**

- **Document and thread write endpoints.** `POST /api/docs`, `PUT /api/docs/:id`,
  `POST /api/threads`, `POST /api/threads/:id/turns` — SERVER-005/006. SERVER-007 ships the
  bus those paths will call; it implements none of them.
- **Git auto-commit.** The `reconcile:` commit after an out-of-band anchor write-back is
  SERVER-005's git module (Open Conflict 4). SERVER-007 may read git (`git show HEAD:<path>`)
  because it needs `oldBody`; it does not become a second git **writer**.
- **Job log tailing and `GET /api/jobs`** — SERVER-009. SERVER-007 watches `.corpus/jobs/`
  and invalidates; it serves no job content.
- **The UI's SSE consumption**, TanStack Query key wiring, reconnection/backoff in the browser
  — UI-002. The contract's `createEventStream` already exists and is not modified here.
- **Publishing the key vocabulary as typed contract surface** — a follow-up CONTRACT issue
  (Open Conflict 2). SERVER-007 keeps the strings in `events/keys.ts`.
- Re-opening the anchor adjudications (the diff is advisory; in-place-edit evidence outranks a
  verbatim duplicate elsewhere; deleted-claim verification is exact-only plus
  insertion-overlap; fuzzy never runs on deletion-shaped claims). SERVER-007 **consumes** the
  engine.

**Collection query (SERVER-011)**

- **Every other `/api/docs` verb**: create, read-one, update, delete, move, archive/unarchive
  — SERVER-005. SERVER-011 implements exactly `GET /api/docs` and `GET /api/tree`.
- **`GET /api/threads/:id`**, seen marks, resolve/reopen — SERVER-006.
- **Adding fields to `DocRow`** (a `staleness` tier, thread sub-fields) — a CONTRACT issue,
  not a server extra (Open Conflict 7). The server may not emit undeclared fields.
- **Changing the query grammar** — parameter names, value domains, the `limit` cap, CSV vs
  single-valued, the sort enum. All CONTRACT (Open Conflict 1). A missing parameter is an
  escalation, never an untyped extra.
- **Board columns, the search overlay, saved views, filter chips** — UI-003.
- **Plugin document types** in the tree or the type filter — PLUGINS.

**Anchor substitution class (SERVER-013)**

- **Re-opening the authorized design.** The survivor-location discriminator is user-approved.
  Similarity thresholds are off the table in both directions, and re-attempting `lacksKinship`
  in any form is out of scope.
- **Re-litigating SERVER-012 rounds 1–2.** Slice truncation and the cross-anchor
  capture/collision pass are shipped and must not regress; they are must-holds, not targets.
- **The write path consuming the engine** — SERVER-005, which this issue explicitly gates.
- Anything under `apps/server/src/projection/`, `routes/`, `queue/` or `watcher/`. SERVER-013
  is `src/anchors/` only (plus its cross-reference note in SERVER-012's issue file).

**Request bodies (CONTRACT-004)**

- **Changing any request or response schema's fields.** This issue changes `required` on the
  body wrapper and nothing else. A field that "should have been optional" is a separate issue.
- **Adding, removing or renaming routes.** The endpoint inventory is unchanged.
- **Fixing consumer call sites beyond a one-line body addition** — escalate instead
  (TEST-76).
- **The `?token=` query-parameter exemption**, the SSE route's shape, or the `503` question —
  Open Conflict 8, and a separate contract change if the orchestrator wants it.

---

## Integration Points

**SERVER-007 → SERVER-011 (the live-query loop).**
SERVER-007 produces: an `invalidate` frame after every out-of-band change, emitted **after**
the affected file has been re-projected. SERVER-011 consumes: nothing at compile time — but
its correctness claim in TEST-77 depends on that ordering. **The contract between them is
ordering, not types**: a frame that arrives before the projection is updated would make the
UI refetch stale data, so the watcher projects first and broadcasts second, exactly as the
write paths do.

**SERVER-007 → SERVER-011 (the seeding mechanism).**
Because the write endpoints are not in this batch, SERVER-007's watcher is what makes
SERVER-011's corpus real: files written on disk become rows without a restart. Until
SERVER-007 merges, SERVER-011 seeds by writing files and restarting the server (boot
repopulation, SERVER-004). Both are honest; the restart form is recorded as such.

**SERVER-013 → SERVER-007 (one engine).**
SERVER-013 produces: `reconcileAnchors(oldBody, newBody, anchors)` with the substitution class
closed. SERVER-007 consumes it for out-of-band edits, with `git show HEAD:<path>` as
`oldBody`. Shared type: the existing `AnchorSelector` / reconciliation result from
`apps/server/src/anchors/`. **Neither changes the other's files.** TEST-80 is the joint proof.

**CONTRACT-004 → everyone (regenerated artifacts).**
CONTRACT-004 produces: `openapi.json` and `schema.generated.ts` in which mandatory bodies are
non-optional. SERVER-011 consumes the client only for its typed-client E2E probe, and only on
**GET** routes — which carry no request body — so **CONTRACT-004 changes nothing SERVER-011
depends on**.

**Merge order (recommendation).**

1. **CONTRACT-004 first.** It touches only `packages/contract`, it is orthogonal to both
   server issues, and landing it first means every later worktree rebuilds against the honest
   types once instead of twice. Its only cross-domain risk (consumer call sites) is near zero:
   there are currently **no** `.POST(`/`.PUT(`/`.DELETE(` call sites in `apps/cli` or
   `apps/ui`.
2. **SERVER-007 second.** It owns the `app.ts`/`lifecycle.ts` wiring (the bus, the `/events`
   mount, the watcher's attach seam) — the one file region the two server issues share.
3. **SERVER-011 third**, rebased onto SERVER-007, adding its route mount through the seam
   SERVER-007 established. This ordering also means SERVER-011's E2E can use the live watcher
   for seeding instead of restarts.
4. **SERVER-013 anywhere** — it is `src/anchors/`-only and conflicts with nothing. Land it as
   soon as it is green; it unblocks SERVER-005.

If the orchestrator prefers SERVER-011 first, the seam (Open Conflict 3) must be pinned by
the orchestrator **before** either agent starts, or both will invent one.

---

## Open Conflicts — orchestrator decision required before implementation

Eight disagreements between the issue files, the shipped contract, the codebase and the spec,
in rough order of blast radius. Each carries a recommendation; the orchestrator adjudicates
**before** the domain agents start, and each adjudication is written back into the affected
issue file(s).

**1. SERVER-011's issue prose contradicts the shipped query contract in eleven places.**
`DocsQuerySchema` shipped with CONTRACT-002 and is what the generated client promises. The
issue file describes a different grammar:

| # | SERVER-011 says | The contract says |
| - | --------------- | ----------------- |
| a | `status` repeatable/CSV; `status=open,archived` | single enum; CSV is a **400** |
| b | `tag` multiple values **ANDed** | CSV values **OR** together |
| c | `stale` repeatable, includes `fresh` | single tier `aging\|stale\|very-stale`, **at-or-beyond** |
| d | `sort=last-activity` (default), `updated`, `created`, `due`, `title` | `updated, -updated, created, -created, due, title, relevance`; default `-updated`; `relevance` requires `q` |
| e | an `awaiting=form` parameter | no such parameter — it is `needs=form` |
| f | `since` matches `max(updated, reviewed) >= ?` | matches `updated` **strictly after** |
| g | `needs` reasons named `unanswered-form`, `stale-review` | `form`, `stale` |
| h | rows carry `reasons` | rows carry `attention` |
| i | rows carry a `snippet` string with `<mark>` | rows carry `snippets[]` of `{field, threadId?, segments[{text, match}]}` — **no HTML** |
| j | envelope `{items, total, limit, offset}` | `{items, page:{total, limit, offset}}` |
| k | `limit` above the cap is **clamped** | `.max(200)` — 201 is a **400** |

**Recommendation: the contract wins on all eleven** — the same call sprints 002 and 003 made
three times. §9.3 is explicit that the server cannot serve a shape its contract does not
declare, and the generated client's types are already published. The issue file's prose is
corrected before implementation; the acceptance tests above are already written against the
contract. Any of these that the orchestrator genuinely wants changed is a **CONTRACT issue**
filed now and sequenced before SERVER-011 — not a server-side deviation.

**2. The SSE payload shape: `{keys: string[]}` vs the shipped `InvalidatePayload`.**
SERVER-007's AC says the payload is `{keys: string[]}` and its key vocabulary is flat strings
(`docs`, `docs/<id>`, `threads/<id>`, `tree`, `queue`, `jobs`, `jobs/<eventId>`, `locks`,
`locks/<docId>`). The shipped `InvalidatePayloadSchema` is `{keys: QueryKey[]}` where
`QueryKey = (string | number | Record<string, unknown>)[]` — **an array of arrays** — with
`.min(1)`. The UI-001 shell's `createEventStream` **parses every frame with that schema and
reports a malformed-frame error otherwise**, so a flat-string payload does not merely differ:
it is rejected by the consumer that already exists.

**Recommendation: the contract wins**, and the vocabulary becomes arrays, one segment per
path component:

```
["docs"]                    ["docs", "<docId>"]        ["tree"]
["threads", "<threadId>"]   ["queue"]                  ["jobs"]
["jobs", "<eventId>"]       ["locks"]                  ["locks", "<docId>"]
```

This is also the shape TanStack Query actually invalidates on (`queryKey: ["docs", id]`),
which is the whole point of rule 3. SERVER-007 keeps the strings in `events/keys.ts` and the
E2E log records the emitted vocabulary verbatim (TEST-78) so UI-002 can mirror it. **File a
follow-up CONTRACT issue** to publish the vocabulary as typed helpers before UI-002 consumes
it — mirroring by hand across a domain boundary is exactly the drift §9.3 exists to kill.

**3. `createServer` is documented as a pure function of its config — and both server issues
need to break that.**
`createServer` "reads no environment and touches no filesystem"; the projection is opened in
`lifecycle.ts` by `attachProjection(server)` **after** the app is built, and `app.ts` declares
`registerDisposer` as the seam. But SERVER-011's route handlers need the `ProjectionDb` at
request time, and SERVER-007's watcher needs the workspace filesystem — and **both issue files
list `app.ts` in their Files to Modify**. Two agents will otherwise invent two different seams
in the same file.

**Recommendation: pin one seam, and pin it before either agent starts.** Open the projection
in `lifecycle.ts` **before** `createServer` and pass the handle in as a dep
(`createServer(config, { projection })`), keeping `createServer` free of filesystem access —
it receives a handle rather than opening one. The queue-mirror attach and the disposer
registration stay where they are. Then:

- `mountDocsRoutes(app, projection)` is a plain registration inside `createServer`, exactly
  like the existing `mountQueueRoutes(app, queue)`.
- The watcher attaches from `lifecycle.ts` alongside the projection (it is filesystem-bound
  and lifecycle-scoped), registering its disposer; `/events` and the bus mount inside
  `createServer` (both are pure in-process machinery).

**SERVER-007 lands the seam change** (per the merge order above) and SERVER-011 consumes it.
If the orchestrator reverses the order, SERVER-011 lands it instead — but exactly one of them
does, and it is decided here rather than discovered at merge.

**4. SERVER-007 is asked to auto-commit, and there is no git writer in the server yet.**
Its AC says remapped anchors are "written back to the file's frontmatter **and
auto-committed**" with a `reconcile:` message. There is no git module anywhere in
`apps/server/src` — auto-commit with acting-party authorship is SERVER-005's, and SERVER-005
is blocked by SERVER-013 in this very sprint.

**Recommendation: split the AC.** SERVER-007 ships (a) a small **read-only** `git show
HEAD:<path>` helper, which it genuinely needs for `oldBody`, and (b) the frontmatter
write-back through the existing `setFrontmatterFields` path, registered as a self-write. The
**commit is deferred to SERVER-005** (`DEFERRED → SERVER-005` in the E2E log), because git
authorship is a property of the write path (§4) and a second git writer in the watcher is
exactly the duplication the sole-writer decision forbids.

State the consequence honestly rather than hiding it: until SERVER-005 lands, `HEAD` only
advances when someone commits manually, so a second out-of-band edit reconciles against an
older `oldBody`. That degrades gracefully — it is still a valid `oldBody → newBody` diff,
just a wider one — and TEST-22's "no HEAD version" arm already covers the extreme. Adjust
SERVER-007's AC and its E2E step 5 accordingly.

**5. Nothing in this batch can create a document or a thread through a product action.**
SERVER-011's E2E step 1 says to seed "through the real write endpoints so the projection is
genuine" — but `POST /api/docs` and `POST /api/threads` are SERVER-005/006 and are not in
this batch. Likewise `POST /api/threads/:id/seen` (needed for `unread` and `unread-reply`) is
SERVER-006. As written, most of SERVER-011's E2E plan is unexecutable.

**Recommendation: seed from real files, and say so.** Real `.md` files with real frontmatter,
written into a real `corpus init` workspace, projected by the real server — either through
SERVER-007's watcher (once merged) or by a real server restart (boot repopulation, which
SERVER-004 already does). Seen marks come from a real `.corpus/seen.json`, which SERVER-004
projects. Failed jobs **can** be produced for real: drop an `evt_*.json` in `pending/`, then
`claim-all` and `POST /api/queue/{id}/fail` over HTTP. This keeps every hop real except the
one that does not exist yet, and each substitution is logged as `DEFERRED → SERVER-005/006`.
This is the same call sprint-003 made for its Open Conflict 5 and it held up.

**6. CONTRACT-004's "genuinely mandatory" set is enumerable — and the issue enumerates it
wrong.** The AC asserts the bare-POST routes are "currently exactly `halt` and `fail`". In
fact **four** request-body schemas are wholly optional:

| Route | Schema | All fields optional? |
| ----- | ------ | -------------------- |
| `POST /api/queue/halt` | `HaltQueueRequest {reason?}` | yes — already `required: false` |
| `POST /api/queue/{id}/fail` | `FailEventRequest {reason?}` | yes — already `required: false` |
| `POST /api/threads/{id}/seen` | `MarkSeenRequest {lastSeenTs?}` | **yes** — and the schema documents the bare-call default ("defaults to the thread's last turn, which is what opening a thread means") |
| `POST /api/locks/{docId}` | `AcquireLockRequest {ttl?}` | **yes** — defaults to `DEFAULT_LOCK_TTL_SECONDS` |
| `PUT /api/docs/{id}` | `UpdateDocRequest` | **yes**, technically — every field is optional, though a bare `PUT` names no change and is never a call anyone means |

The other six (`POST /api/docs`, `POST /api/docs/{id}/move`, `POST /api/capture`,
`POST /api/threads`, `POST /api/threads/{id}/turns`, `POST /api/jobs/{id}/log`) each have at
least one required field, so omitting the body can never succeed.

**Recommendation: adopt a stated rule instead of a list.** `required: true` wherever omitting
the body could never produce the caller's intent; `required: false` only where a bare `POST`
is a **designed, documented** call. That yields: `required: false` for `halt`, `fail`,
`seen` and `acquire lock` (all four document their bare-call behaviour in the schema itself);
`required: true` for the other seven, **including `PUT /api/docs/{id}`** despite its
all-optional schema — a `PUT` with no body is not a designed call, and its description gains
a sentence saying so. The invariant test (TEST-72) and the compile probes (TEST-70/71) all
hold under this rule; the AC's parenthetical is corrected to name the rule rather than the
count. If the orchestrator prefers the AC's literal reading (only `halt`/`fail` bare), that
is also coherent — it forces `{}` at four call sites — but it must be **decided**, because
TEST-71's list is written from the adjudication.

**7. Two of SERVER-011's ACs cannot be satisfied inside the shipped contract.**
`DocRow` is `docRowBaseShape + attention + snippets`. It carries **no staleness tier** and
**no thread fields** — no `parent`, `agent`, `anchor` quote, `turnCount`, `lastAuthor`,
`lastTs` or `unread`. But SERVER-011's ACs require "every row carries its staleness tier" and
"thread fields when `type = thread`", and SPEC §10 says thread rows render an anchor quote,
a last-turn preview and unread/pending indicators.

**Recommendation: implement the contract, and file the gap as a CONTRACT issue now.**
SERVER-011 emits exactly `DocRow` (TEST-26 fails it otherwise), and the two ACs are struck
from the issue file with a pointer to a new **CONTRACT-005: `DocRow` carries the staleness
tier and thread row fields**, sequenced **before UI-003**, which is the consumer that actually
needs them. The practical loss in the meantime is small and worth stating: the row already
carries `updated`, `reviewed` and `evergreen` (from which the tier is derivable) and an
`attention` array that includes `"stale"` at the stale tier, so only the `aging` shade and
thread-row rendering are blocked — both UI-003 concerns, both downstream. Filing it now rather
than letting the server emit undeclared fields is the difference between a known gap and
silent drift.

**8. SERVER-007's subscriber cap wants to return a response its contract does not declare.**
The design says to bound the registry (~32 subscribers) and "reject beyond it with 503".
`GET /events` declares `200`, `400` and `401` only.

**Recommendation: drop the hard cap for v1.** This is a single-user, loopback-bound app whose
UI opens exactly one stream; the real protection is the pruning of dead subscribers, which is
already an AC and is tested (TEST-9). If a cap is wanted, adding `503` to the route is a
one-line CONTRACT change — file it, do not smuggle an undeclared status code past §9.3.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above PASSES in the evaluator's verdict**, with deferrals recorded
  as `DEFERRED → <issue>` plus their substitute evidence — never silently omitted.
- Each issue's **E2E Verification Log** carries concrete evidence: real commands, real output,
  real ports from its assigned range, real scratch paths from its own prefix, and the model it
  ran on. SERVER-013 additionally carries its **pre-fix reproduction** (TEST-57) and its
  measured **pre-fix rate with denominator and seed** (TEST-58); CONTRACT-004 carries its
  **pre-fix compiling probe** (TEST-69).
- The eight adjudications the orchestrator makes here (Open Conflicts 1–8) are **written back
  into the affected issue files** before implementation starts, and any conflict resolved as
  "the contract wins" that the orchestrator wants changed has a **CONTRACT issue filed**, not
  a server-side deviation.
- `/test` passes with no regressions; combined coverage stays at or above the 90 % gate.
- `/lint` passes (ESLint, Prettier, `tsc --noEmit`) across every workspace.
- `openapi.json` and the generated client regenerate with **no diff**; the drift check is
  green twice in a row.
- TEST-82's repo-wide gate run is green from a clean tree, including `npm run e2e` with
  `CORPUS_UI_PORT=5273`.
- No stray process and no stray port: every server and every `curl -N` started during
  verification was stopped **by pid**, and `lsof` confirms the assigned ranges are free.
