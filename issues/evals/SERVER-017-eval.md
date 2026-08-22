# Evaluation: SERVER-017

**Date**: 2026-07-27
**Sprint**: N/A (no `issues/sprints/` contract names SERVER-017)
**Commit under test**: `c7d9d73` on `phase-2-server-cli`
**Verdict**: **PASS**

## Environment

Real `corpus init` workspace at `/tmp/corpus-e017-ws`, real daemon started through the shipped
lifecycle verb (`node --import tsx apps/cli/src/bin/corpus.ts server start --workspace …`), port
**8960**, pid **21566**. Every request below is real `curl` against `http://127.0.0.1:8960` carrying
the workspace bearer token from `.corpus/config.json`. No source file under `apps/server/` was read.
Contract shapes were read from `packages/contract/src/{routes,schemas}/db.ts` and the committed
`packages/contract/openapi.json`; spec from `SPEC.md` §9.1/§9.2/§11. Server stopped by recorded pid;
ports 8960–8969 verified free at exit.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                          |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Eight numbered sections plus a gate line; no placeholder text.                                                                                                                                 |
| Commands are specific and concrete      | PASS   | Names the workspace path, the port (8950), the transport (`curl`), inode numbers (`64561290` → `64561435`), and quotes raw response bodies rather than summarising them.                        |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` workspace, real server process, real `curl`, real `git log`, real `sqlite3` against the on-disk file. No test client, fixture, or in-memory database appears in the evidence. |
| Scenarios cover acceptance criteria     | PASS   | Both AC lines are covered: mount+auth+reopen+doctor shape (items 1–3, 6), and rebuild-over-a-live-server with immediate query correctness and clean/dirty doctor (items 1–4, 8).                 |
| Application restarted after changes     | PASS   | Item 4 and item 8 exercise state that only exists after a rebuild on the *running* process; the log states the server was started from source for the session.                                  |
| Actual model recorded (implemented on:) | PASS   | `**implemented on: opus**` on the first line of the log.                                                                                                                                       |
| Reproduction logged before fix (bugs)   | N/A    | New surface, not a bug fix. The log still justifies the regression risk by naming two tests that fail when `reopenAround` is stubbed to a passthrough — more than N/A required.                  |

**Independent corroboration.** Every quantitative claim in the log that I could re-derive on a fresh
workspace reproduced: the single five-key SSE frame (item 5), `path: null` on `count_mismatch`
(item 3), `401`/`401` unauthenticated and `400` on `x-corpus-author: robot` with the exact issue
string (item 6), zero git commits and zero `cache.db.rebuild-*` leftovers (item 7), and the
post-rebuild write path with the `agent <agent@corpus.local>` git author (item 8). The log is
credible.

---

## Criteria Results

| #   | Criterion                                                                                                   | Result | Notes                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /api/db/rebuild` rebuilds from files; same process immediately serves correct, file-consistent data     | PASS   | Inode moved on every rebuild; the running process answered the *new* file immediately. See Test 1, 3, 8.                                   |
| 1b  | Writes after rebuild still work E2E: `POST /api/docs` → 201 → file on disk → git author → readable at once    | PASS   | `201`, file at `data/docs/notes/written-after-a-rebuild.md`, `agent <agent@corpus.local>`, `GET /api/docs/:id` `200`. See Test 8.          |
| 2   | `POST /api/db/doctor`… `GET /api/db/doctor` reports `ok:true` on a healthy workspace, CONTRACT-006 shape      | PASS   | Exact key set, no extras, `ok ⟺ drift == []`, `path` present-and-`null` on `count_mismatch`. See Test 2, 4, 9.                             |
| 3   | Rebuild emits exactly ONE SSE invalidate frame with the five coarse keys                                     | PASS   | Three independent `curl -N` captures, each exactly one frame `{"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}`. See Test 5.      |
| 4   | Rebuild creates no git commit and leaves no `cache.db.rebuild-*` temp files                                  | PASS   | ~20 rebuilds; commit count only ever moved for document writes. `find` over the whole workspace finds no temp. See Test 6.                 |
| 5   | Auth: both routes `401` without token; actor agent/user/absent accepted; invalid actor → `400`               | PASS   | `401` for missing *and* wrong token on both. Rebuild `200/200/200` for agent/user/absent, `400` for `robot` and empty. See Test 7.         |
| 6   | Queue integrity across rebuild: hand-dropped `evt_*.json` → rebuild → claim moves `pending/` → `in-progress/` | PASS   | Both a pre-rebuild and a post-rebuild hand-dropped event survived and claimed correctly on the post-rebuild process. See Test 10, 11.      |
| 7   | db routes absent (404) when the server runs without a projection                                             | N/A    | No no-projection mode is reachable from outside — see "Criterion 7" below. Not tested rather than tested by reading source.                |

**Extras probed beyond the stated criteria** (all PASS): concurrent rebuilds, FTS/`search` survival,
the lock service and its `423` write guard across a rebuild, `skipped[]` on malformed and duplicate
files, out-of-band file add/delete, a parked `queue idle` long-poll held across a rebuild, wrong-method
and stray-body requests, and SSE hub survival. Detail in "Additional probes".

---

## Evidence

### Test 1 — rebuild moves the file and the live process follows it

Pre-rebuild state of a workspace holding 3 created notes + 1 thread + 6 seed docs:

```
inode before: 64827695
POST /api/db/rebuild  → HTTP 200
{"documents":10,"threads":1,"turns":1,"anchors":0,"links":3,"events":0,"jobs":0,"locks":0,
 "seen":0,"durationMs":10,"path":"/tmp/corpus-e017-ws/.corpus/cache.db","skipped":[]}
inode after:  64886646
```

The *immediately following* `GET /api/docs` on the same process returned all 10 rows, each path
matching a real file on disk:

```
th_jwhw7b6h  thread    data/threads/th_jwhw7b6h.md
doc_4kizb5dp note      data/docs/notes/doc-alpha.md
doc_fbewdb2m note      data/docs/notes/doc-gamma.md
doc_uc4re6qo note      data/docs/notes/doc-beta.md
doc_seed*    view/tmpl data/docs/{views,templates}/*.md
doc_skill*   skill     .claude/skills/*/SKILL.md
```

### Test 2 — doctor clean

```
GET /api/db/doctor → 200
{"ok":true,"drift":[],"stats":{"files":10,"documents":10,"hashed":0,"parsed":0,"durationMs":2}}
```

`hashed: 0` and `parsed: 0` on a warm workspace, matching the schema's documented cheapness claim.

### Test 3 — drift induced in the derived cache, then healed on the live process

`cache.db` is a derived artifact, so mutating it directly is a legitimate black-box move (the watcher
cannot heal it — no file changed). Out of band, via the `sqlite3` CLI:

```
DELETE FROM documents WHERE id='doc_uc4re6qo';   -- and its file_hashes row
INSERT INTO documents (…) VALUES ('doc_ghost99', …, 'data/docs/notes/ghost.md', …);
```

The running server immediately reflected the corruption — proof its handle is on *that* file:

```
GET /api/docs → total 10, ids include doc_ghost99, doc_uc4re6qo absent
```

A third drift was added by dropping a real `evt_*.json` into `.corpus/queue/pending/` (watcher
projected it: `events` had 1 row, `queue/status` `pending:1`) and then `DELETE FROM events;`.

`GET /api/db/doctor` → `200`, all three kinds reported:

```json
{
  "ok": false,
  "drift": [
    {
      "kind": "missing_row",
      "path": "data/docs/notes/doc-beta.md",
      "detail": "… is a document under a root but has no `documents` row"
    },
    {
      "kind": "orphan_row",
      "path": "data/docs/notes/ghost.md",
      "detail": "… is projected as doc_ghost99 but no such file exists under any root"
    },
    {
      "kind": "count_mismatch",
      "path": null,
      "detail": ".corpus/queue holds 1 evt_*.json file(s) but the projection has 0 event row(s)"
    }
  ],
  "stats": { "files": 10, "documents": 10, "hashed": 0, "parsed": 1, "durationMs": 2 }
}
```

`"path": null` is present, not omitted — CONTRACT-006's nullable-not-optional adaptation, confirmed
on the wire.

One `POST /api/db/rebuild` (inode `64886646` → `64971534`) healed all three, and the *immediate*
follow-up reads on the same process were correct:

```
rebuild → {"documents":10,…,"events":1,…,"skipped":[]}
GET /api/docs   → doc_ghost99 gone, doc_uc4re6qo back, total 10
GET /api/db/doctor → {"ok":true,"drift":[],…}
```

### Test 4 — response shapes match the contract exactly

Key-set diff against `RebuildResultSchema` / `DoctorReportSchema` / `DoctorStatsSchema`:

```
rebuild keys == ['anchors','documents','durationMs','events','jobs','links','locks','path',
                 'seen','skipped','threads','turns']   missing: []  extra: []
rebuild types ok: all counts int ≥ 0 | path str | skipped list
doctor  keys == ['drift','ok','stats']                 missing: []  extra: []
stats   keys == ['documents','durationMs','files','hashed','parsed']  missing: []  extra: []
ok <=> empty drift: True
```

The committed `packages/contract/openapi.json` declares exactly what the server serves:
`/api/db/rebuild` → `post`, responses `200/400/401`; `/api/db/doctor` → `get`, responses `200/401`.

### Test 5 — exactly one SSE invalidate frame, five coarse keys

`curl -sN "http://127.0.0.1:8960/events?token=…"` attached ~1.8 s before the rebuild, held ~2.5 s
after. Full stream body, run 1:

```
:connected

event: invalidate
data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}
```

Run 2 (the healing rebuild of Test 3) produced a byte-identical single frame. Run 3 is the decisive
one — the same connection saw the watcher's own frame *before* the rebuild and a document-write frame
*after* it, with the rebuild's single coarse frame between them:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_fbewdb2m"],["tree"],["docs","doc_oobnew001"]]}   ← watcher, out-of-band edits

event: invalidate
data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}                        ← the rebuild, once

event: invalidate
data: {"keys":[["docs"],["docs","doc_b2jbwv2u"],["tree"]]}                             ← post-rebuild doc write
```

That the third frame arrived on the same connection also proves the SSE hub survived the handle swap.

### Test 6 — no commit, no leftovers

Roughly twenty rebuilds were issued over the session. The commit count moved **only** for document
writes and never for a rebuild:

| Moment                             | Commits | HEAD subject                                  |
| ---------------------------------- | ------- | --------------------------------------------- |
| after 3 doc creates + 1 thread     | 5       | `comment: new thread on doc_4kizb5dp …`       |
| after rebuild #1 and #2            | 5       | unchanged (`3882608`)                         |
| after `POST /api/docs`             | 6       | `doc create: Written after a rebuild …`       |
| after 3 more rebuilds              | 6       | unchanged (`b730cdc`)                         |
| after 6 concurrent rebuilds        | 6       | unchanged                                     |

Leftovers, checked after every rebuild and once exhaustively at the end:

```
find . -name "*rebuild-*" -not -path "./.git/*"
  → ./data/docs/notes/after-rebuild-sse-probe.md      (a document I created; no db temp)
ls -a .corpus/ | grep -i rebuild                       → (none)
/tmp/*cache.db* , /var/folders/**/T/*cache.db*         → (none)
```

`.corpus/` at exit held only `cache.db`, `cache.db-wal`, `cache.db-shm`, `config.json`, `server.log`,
`server.pid`, `template-manifest.json`, and the four standing directories.

### Test 7 — auth and actor

```
doctor  no token   → 401 {"code":"unauthorized","message":"missing or invalid workspace token — pass `Authorization: Bearer <token>` …"}
rebuild no token   → 401 (same body)
doctor  bad token  → 401
rebuild bad token  → 401

rebuild x-corpus-author: user   → 200
rebuild x-corpus-author: agent  → 200
rebuild (header absent)         → 200   (server log records actor "user" — DEFAULT_ACTOR, per ActorHeaderSchema)
rebuild x-corpus-author: robot  → 400 {"code":"bad_request","message":"request failed validation",
                                       "issues":[{"path":"header.x-corpus-author",
                                                  "message":"Invalid option: expected one of \"user\"|\"agent\""}]}
rebuild x-corpus-author: (empty)→ 400 (same issue)
doctor  x-corpus-author: robot  → 200   ← correct: doctorDb declares no ActorHeaderSchema, so the header is not validated
```

The doctor case is a deliberate check, not an oversight: `packages/contract/src/routes/db.ts` gives
`request: { headers: ActorHeaderSchema }` to `rebuildDb` only, and doctor mutates nothing. Serving
`200` there is contract-faithful; a `400` would have been the deviation.

Wrong method and stray body:

```
GET  /api/db/rebuild → 404 {"code":"not_found","message":"no route matches GET /api/db/rebuild"}
POST /api/db/doctor  → 404 {"code":"not_found","message":"no route matches POST /api/db/doctor"}
POST /api/db/rebuild with {"junk":true} → 200  (no request body is declared; the extra body is ignored, not rejected)
```

### Test 8 — the write path survives the swap

After the rebuilds, on the same process:

```
POST /api/docs  x-corpus-author: agent  → 201, id doc_uw7xalwj
ls data/docs/notes/                     → written-after-a-rebuild.md present
git log -1 --format='%an <%ae> | %s'
  → agent <agent@corpus.local> | doc create: Written after a rebuild (doc_uw7xalwj) by agent
GET /api/docs/doc_uw7xalwj              → 200, path "data/docs/notes/written-after-a-rebuild.md"
GET /api/docs                           → total 11, includes doc_uw7xalwj
GET /api/db/doctor                      → {"ok":true,…,"files":11,"documents":11}
```

Lock guard, git writer and projector all reached the reopened connection through handles captured at
mount time.

### Test 9 — `skipped[]` and the remaining drift kinds

Two hostile files dropped into `data/docs/notes/`: one with broken YAML frontmatter, one duplicating
`doc_4kizb5dp`'s id. Doctor reported both (`unparseable`, `duplicate_id`, `files:13 documents:11`),
and the rebuild **did not fail** — it reported them:

```json
"skipped": [
  {
    "path": "data/docs/notes/broken.md",
    "reason": "data/docs/notes/broken.md:3: invalid YAML frontmatter: …"
  },
  {
    "path": "data/docs/notes/dup-alpha.md",
    "reason": "duplicate id doc_4kizb5dp, already projected from data/docs/notes/doc-alpha.md"
  }
]
```

The valid `doc-alpha.md` kept the id (first by path order), exactly as `DriftKindSchema` documents.

### Test 10 — queue integrity across rebuild (hand-dropped event)

A hand-crafted `evt_e017drop01.json` was dropped into `.corpus/queue/pending/`, then survived a
rebuild (`events: 1` in the rebuild counts, `queue/status` `pending:1`). Claiming on the post-rebuild
process:

```
POST /api/queue/claim-all → 200
{"events":[{"id":"evt_e017drop01","type":"comment.created","created":"2026-07-27T14:55:00Z",
            "source":"cli","payload":{"threadId":"th_jwhw7b6h","note":"hand-dropped for SERVER-017 eval"}}]}

ls .corpus/queue/pending/     → (only .gitkeep)
ls .corpus/queue/in-progress/ → evt_e017drop01.json
sqlite3 cache.db "select id,status from events" → evt_e017drop01|in-progress
GET /api/queue/status → {"halted":false,"pending":0,"inProgress":1,…}
```

The file moved `pending/ → in-progress/` and the post-rebuild projection reflects it.

### Test 11 — a parked long-poll held across a rebuild

`GET /api/queue/idle?timeout=20` was parked, a rebuild was issued while it was parked, then a *new*
event was dropped into `pending/` after the rebuild:

```
rebuild while parked → 200 {"documents":12,…,"events":1,…}
idle                 → 200 {"events":[{"id":"evt_e017after02",…,"payload":{"note":"post-rebuild wake"}}]}
claim-all            → 200 (same event)
ls in-progress/      → evt_e017after02.json  evt_e017drop01.json
events table         → evt_e017after02|in-progress ; evt_e017drop01|in-progress
doctor               → {"ok":true,"drift":[],…}
```

The parked client neither errored nor was dropped, and woke on an event the rebound reader found.

---

## Additional probes

- **Concurrent rebuilds.** Six `POST /api/db/rebuild` and six `GET /api/docs` fired simultaneously:
  all twelve returned `200`, all six rebuild bodies were identical, all six reads returned `total 11`,
  `GET /api/health` stayed `200`, `doctor` stayed `ok:true`, no temp files, no new commits, and the
  server log contains **zero** `error` or `warn` lines across 148 lines and the whole session.
- **FTS survives the swap.** `GET /api/docs?q=alpha` returned the same 2 hits with intact snippet
  segmentation (`{"text":"alpha","match":true}`) immediately after a rebuild — the `search` virtual
  table is re-derived, not orphaned.
- **Locks survive the swap and still guard writes.** `POST /api/locks/doc_4kizb5dp` as `agent` → `201`;
  the rebuild counted `locks: 1` and `GET /api/locks` returned the lock unchanged afterwards; a `user`
  `PUT /api/docs/doc_4kizb5dp` then returned `423 {"code":"locked", …}` and `DELETE /api/locks/…`
  released cleanly. The lock service reaches the reopened connection.
- **Out-of-band file changes.** Deleting `doc-gamma.md` and adding `oob-new.md` directly on disk, then
  rebuilding: the post-rebuild read showed `doc_fbewdb2m` gone and `doc_oobnew001` present, `links`
  dropped from 2 to 1 (the deleted file's `[[ref]]`), and doctor stayed clean.
- **`GET /api/tree`** returned identical folder counts before and after a rebuild.

## Criterion 7 — why N/A rather than tested

The only externally reachable way to start the server is `corpus server start`, whose full flag set is
`--json --workspace --timeout --verbose --no-color -h --version`, and the server binary's own usage
line (emitted on an unknown option) is `usage: corpus-server [--workspace <dir>]`. Neither exposes a
no-projection mode, and no documented environment variable selects one. Determining whether the routes
are conditionally mounted would require reading `apps/server` source, which this evaluation does not
do. Marked **N/A**; if a no-projection mode is meant to be user-reachable, that is a separate gap to
raise with the orchestrator, not a SERVER-017 failure.

## Failures

None.

## Summary

**6 of 6 testable criteria passed; 1 marked N/A as unreachable from outside.** SERVER-017 does what it
promises and survives considerably more abuse than the acceptance criteria demand. The reopen seam is
the part that could plausibly have been faked, and it is not: the inode moves on every rebuild, the
running process answers the *new* file on the very next request, and every consumer that captured the
handle at mount time — document reads, FTS, the tree, the lock service and its `423` write guard, the
git writer, the queue reader and its long-poll — all reached the reopened connection without a
restart. Drift induced directly in the derived cache was reported faithfully by `doctor` (including
`path: null` on `count_mismatch`) and healed by one `rebuild`. Rebuild is invisible to git, leaves
nothing behind, emits its single coarse invalidate frame and nothing more, and stays correct under six
concurrent invocations. The E2E Verification Log is specific, real, and independently corroborated.
