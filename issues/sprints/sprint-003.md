# Sprint 003 — Phase 2 Second Batch: Projection, Queue, Workspace

**Issues**: SERVER-004, SERVER-008, CLI-002
**Domains**: server, cli
**Date**: 2026-07-26
**Plan phase**: Phase 2 — Server Backbone + CLI
**Branch**: `phase-2-server-cli` (agents work in pre-created worktrees cut from it)

---

## What makes this sprint different

Sprint 002 crossed the "a real server process exists" threshold. This one crosses the
**"a real workspace exists"** threshold: after CLI-002 lands, `corpus init` produces a
workspace on disk from nothing, `corpus server start` runs a real daemon against it,
SERVER-004 projects that workspace's real files into a real SQLite database, and
SERVER-008 parks a real long-poll against the real queue directories inside it.

That means **no issue in this batch may verify against a hand-assembled fixture
workspace when an `init`-produced one is available**. The centerpiece integration test
(TEST-79) is the whole point of batching these three together:

```
corpus init  →  corpus server start  →  real projection over the seed workspace
             →  corpus health  →  queue idle parks  →  event lands  →  idle wakes
             →  claim-all  →  complete  →  events table and directories agree
```

Everything else in this contract exists to make that line true and provable.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue      | The real application in this sprint                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SERVER-004 | Real `.md` files on real disk in a real `git init` workspace, projected into a **real `.corpus/cache.db`** inspected with the **`sqlite3` CLI** — never an in-memory database, never a dumped JS object. Rebuild/doctor timings measured with `time`. The read-your-write and lifecycle claims additionally run against the **real server process** (`npx tsx apps/server/src/main.ts`) on port `8775`. |
| SERVER-008 | A **real server process** on port `8785` against a real workspace, driven by real `curl` (including two shells for the park/wake test) and real `ls`/`cat` of `.corpus/queue/<status>/`. `app.request()` is the unit-test path only — a long poll that was never held open by a real socket is not evidence.       |
| CLI-002    | The **real built binary** on `PATH` (`npm run build -w apps/cli && npm link -w apps/cli` → `corpus`), never `tsx src/…`, in a real shell, with `echo $?` read for **every** exit code. The daemon it starts is the real SERVER-003 server; the workspace it creates is a real directory it made itself.            |
| Integration | All three of the above composed, on port `8805`, with **zero stubs in the chain**.                                                                                                                                                                                                                            |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports`
map into `dist/`. Each worktree is a separate checkout: run `npm install` (if
`node_modules` is absent) and `npm run build` **inside your own worktree** before any
verification step. A probe that imports another worktree's `dist/`, or a stale one, is not
evidence.

### Port allocation

Three agents run concurrently and each may need several ports. Ranges are assigned; take
the next free number **inside your range** and record it in your E2E log.

| Consumer                                   | Range         | Primary                          |
| ------------------------------------------ | ------------- | -------------------------------- |
| SERVER-004                                 | `8770`–`8779` | `8775`                           |
| SERVER-008                                 | `8780`–`8789` | `8785`                           |
| CLI-002                                    | `8790`–`8799` | `8795` (2nd workspace: `8796`)   |
| Sprint-003 integration (TEST-79…TEST-86)   | `8800`–`8809` | `8805`                           |
| Automated tests, every workspace           | —             | `0` (ephemeral). Never hardcode. |

**Reserved — do not bind:**

- **`8765`** — the documented workspace default and the port the **UI e2e suite** claims.
  It must stay free for the whole sprint. CLI-002 in particular must **never** let
  `corpus init`'s default port probe start at 8765 during E2E: pass `--port` explicitly
  (Open Conflict 12).
- `8865`, `8965` — sprint-002's assignments; leave them alone so that sprint's evidence
  stays re-runnable.
- **`5173`** — held by an unrelated developer process on this machine. Do not assume it is
  free and do not "fix" the Vite config's 5173 default. Playwright/Vite use
  `CORPUS_UI_PORT=5273`.

### Scratch directories — one prefix per issue

Parallel agents sharing `/tmp/corpus-*` destroyed each other's evidence last sprint. Every
temp workspace is created with **your own prefix**:

| Issue       | Prefix                                                 |
| ----------- | ------------------------------------------------------ |
| SERVER-004  | `mktemp -d /tmp/corpus-s004-XXXXXX`                    |
| SERVER-008  | `mktemp -d /tmp/corpus-s008-XXXXXX`                    |
| CLI-002     | `mktemp -d /tmp/corpus-cli002-XXXXXX`                  |
| Integration | `mktemp -d /tmp/corpus-sprint003-int-XXXXXX`           |

Automated tests use `fs.mkdtemp` with the same prefix. **Never** `rm -rf /tmp/corpus-*` —
delete only paths you created and captured in a variable.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill node`, `killall node` **kill sibling agents'
servers** and are forbidden for the duration of this sprint. Stop what you started, by pid:

```sh
# started directly
npx tsx apps/server/src/main.ts & SRV=$!   ; kill -TERM "$SRV"
# started via the CLI
corpus server stop                          # or: kill -TERM "$(jq -r .pid .corpus/server.pid)"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN` — not by
killing whatever looks like a server.

### Runtime gotchas that will otherwise be misread as bugs

- **Node is v25.2.1 locally; CI pins Node 22.** Global `EventSource` is behind a flag on
  this build. No issue in this batch needs SSE — if you reach for it, you have drifted into
  SERVER-007.
- **jsdom's `localStorage` quirk** affects `apps/ui` only. No issue in this batch touches
  `apps/ui` or `packages/kit`.
- **`diff-match-patch`'s `Diff_Timeout` is 1 s**, and the anchor engine's fuzzy rung
  (`findFuzzyRange` → bitap) is the expensive one. This matters directly to SERVER-004:
  a projection that runs the **full** resolution ladder on every unresolved anchor pays
  fuzzy cost per orphan and can miss the 2 s / 2000-document rebuild target. See Open
  Conflict 1.
- **`better-sqlite3` is a native module.** Its first install in a fresh worktree may
  rebuild against the local Node ABI; budget for it and do not report the delay as a
  projection performance result.
- **`.gitkeep` files live inside `.corpus/queue/<status>/`** in every `init`-produced
  workspace. Anything that counts or lists queue events must count `evt_*.json` only. See
  Open Conflict 15 — this is the single most likely cross-issue false failure in this batch.

### Deferred verification is recorded, not skipped

Any test below that cannot be executed — because a dependency has not landed at the moment
of verification — is marked `DEFERRED → <issue>` in the E2E Verification Log with the
reason and the substitute evidence supplied. Silent omission is a fail. Two deferrals are
expected and pre-authorized (TEST-40's real producer, and the `npm pack` half of CLI-002's
install path); see Open Conflicts 5 and 11.

---

## Acceptance Tests

### SERVER-004: SQLite projection — schema, projectors, FTS, rebuild/doctor

#### Schema and handle

TEST-1: The schema is §9.1's tables, verbatim
Given: A workspace with no `.corpus/cache.db`.
When: The projection is opened, and `sqlite3 <ws>/.corpus/cache.db ".tables"` plus
`PRAGMA table_info(<t>)` are run for every table.
Then: Exactly `documents`, `threads`, `anchors`, `turns`, `events`, `seen`, `jobs`,
`locks`, `links`, `search`, `meta` and the bookkeeping `file_hashes` exist, and each of the
first ten carries §9.1's column names in §9.1's spelling. A renamed or extra column on any
§9.1 table fails this test.

TEST-2: The handle is opened with the pragmas the design pins
Given: An open projection.
When: `PRAGMA journal_mode`, `PRAGMA foreign_keys`, `PRAGMA busy_timeout` are queried on
that connection.
Then: `wal`, `1`, `5000`.

TEST-3: A schema-version change wipes rather than migrates
Given: A populated `cache.db` written at `SCHEMA_VERSION = N`.
When: `meta.schema_version` is set to `N-1` out of band and the projection is reopened.
Then: The database is rebuilt from files, not migrated: `meta.schema_version` reads `N`
again and every row is reconstructed. No migration code path exists.

TEST-4: The database handle closes with the server
Given: A real server process (port 8775) with the projection open.
When: The process is stopped with `kill -TERM`.
Then: It exits `0`, and `lsof -p <pid>` shows no open `cache.db` afterwards (the process is
gone); `.corpus/cache.db-wal` is checkpointed away or absent, and reopening the database
requires no recovery pass.

TEST-5: A build without FTS5 fails loudly at open
Given: A `better-sqlite3` build whose `fts5` module is unavailable.
When: The projection is opened.
Then: Open throws immediately with a message naming `fts5`. The projection never opens in a
degraded, search-less mode.

#### Document roots and typing (§7)

TEST-6: All five roots are indexed with the right type
Given: A workspace containing a nested `data/docs/finance/mortgage.md` (`type: note`), a
`data/threads/th_x9y8.md`, a `.claude/skills/orchestrate/SKILL.md`, a
`.claude/skills-archived/legacy/SKILL.md`, and a `.claude/agents/researcher.md`.
When: `sqlite3 … "select type, status, path from documents order by path"` is run after a
rebuild.
Then: Types are `note`, `thread`, `skill`, `skill`, `agent-def` respectively; the archived
skill's `status` is `archived`; every `path` is workspace-relative and POSIX-separated
(`data/docs/finance/mortgage.md`, not an absolute or backslashed path).

TEST-7: Claude Code frontmatter coexists with Corpus frontmatter
Given: A `SKILL.md` whose single YAML block carries both `name`/`description` (Claude Code)
and `id`/`type`/`title`/`tags`/`status` (Corpus).
When: The file is projected.
Then: It is indexed with no validation failure and no warning, and its `title` is Corpus's
`title`.

TEST-8: A skill with no Corpus `id` gets a stable synthetic id and is never rewritten
Given: A hand-written `.claude/skills/notes/SKILL.md` carrying only `name` and
`description`.
When: It is projected, then the workspace is rebuilt from scratch twice.
Then: It is indexed with the same id all three times, `title` falls back to `name`, and
**the file's bytes and mtime are unchanged** — the projection never writes to the corpus.

TEST-9: A symlinked plugin skill is indexed exactly once
Given: `.claude/skills/todos` is a symlink to a directory elsewhere containing `SKILL.md`.
When: A rebuild runs.
Then: `select count(*) from documents where type='skill'` counts it once, and its `path` is
the workspace-relative path under `.claude/skills/`.

TEST-10: Everything outside a root is ignored
Given: The workspace additionally contains `data/docs/notes.txt`, `data/docs/.hidden.md`,
`node_modules/pkg/README.md`, and `README.md` at the workspace root.
When: A rebuild runs.
Then: None of them appears in `documents`.

#### Per-document projection

TEST-11: A document row carries the §9.1 shape
Given: A note with `tags: [finance, urgent]`, a `due`, and a 600-character body.
When: Its row is selected.
Then: `tags_json` parses as `["finance","urgent"]`, `body_excerpt` is the first 280
characters of the **body** (no frontmatter, no leading fence whitespace) and is not longer
than 280, and `created`/`updated`/`due`/`reviewed`/`evergreen` match the frontmatter.

TEST-12: A thread projects its thread row and its turns in document order
Given: A thread document with three turns (`user`, `agent`, `user`) with distinct
timestamps.
When: `threads` and `turns` are selected.
Then: The `threads` row has `turn_count = 3`, `last_author = 'user'`, `last_ts` equal to the
third turn's timestamp, and `parent_id`/`anchor_id`/`agent`/`status` from the frontmatter;
the three `turns` rows carry `idx` `0,1,2` in document order with matching `author`, `ts`,
`body_md`.

TEST-13: Links come from document bodies **and** turn bodies, but never from code fences
Given: A note whose body contains `[[th_x9y8]]`, a thread one of whose turn bodies contains
`[[doc_a1b2c3]]`, and a note containing `[[doc_never]]` inside a fenced code block.
When: `select from_id, to_id from links order by from_id` is run.
Then: Rows exist for the note→thread and the thread→doc pairs (the turn-level ref attributed
to the **thread's** id), and no row exists for `doc_never`.

TEST-14: Removal and re-identification leave no stale rows
Given: A projected document at `data/docs/a.md` with id `doc_aaa`, a thread, anchors and
links.
When: (a) The document is removed and `removeDocument` runs; then (b) a fresh file is
written at the same path with a different id `doc_bbb` and projected.
Then: After (a), no row referencing `doc_aaa` or `data/docs/a.md` survives in `documents`,
`threads`, `turns`, `anchors`, `links`, `search`, `file_hashes`. After (b), exactly one
`documents` row exists for that path, and it is `doc_bbb`.

TEST-15: Unparseable frontmatter is skipped, reported, and non-fatal
Given: `data/docs/broken.md` whose YAML frontmatter does not parse, alongside four valid
documents.
When: A rebuild runs.
Then: It completes; the four valid documents are indexed; `broken.md` appears in the
report's `skipped` with a reason; nothing partial was inserted for it; and the process did
not exit.

TEST-16: Two files claiming the same id resolve deterministically
Given: `data/docs/a.md` and `data/docs/b.md` both with `id: doc_dup`.
When: A rebuild runs, twice.
Then: The row present is the one from the first path in sorted path order, both times, and
the other is reported as `duplicate_id` drift by `doctor`.

#### Anchors — the orphan look-alike guarantee

> The rule chosen under Open Conflict 1 must be written into SERVER-004's issue file
> **before implementation**. TEST-17…TEST-21 hold regardless of which option is chosen;
> TEST-22 is the test that distinguishes them and must be written to the recorded choice.

TEST-17: A live anchor's `resolved_offset` slices to its quoted text
Given: A document whose frontmatter anchor `anc_k4f7` quotes a phrase present verbatim in
the body.
When: `select resolved_offset from anchors where anchor_id='anc_k4f7'` is run and the
returned integer is used to slice the real file's body.
Then: The offset is an integer and the slice of length `len(exact)` starting there equals
the selector's `exact`.

TEST-18: A selector with no counterpart in the body projects NULL
Given: A document whose anchor quotes text that appears nowhere in the body and has no
similar neighbour.
When: The anchor row is selected.
Then: `resolved_offset` is `NULL`.

TEST-19: The orphaned bread bullet never lands on the milk bullet
Given: A document whose body is a grocery list —

```
Groceries:

- bread from the corner bakery
- milk from the corner bakery
```

— with an anchor on the *bread* bullet, which is then **deleted through the real
reconciliation path** (the anchor keeps its last selector, per §6 step 5).
When: The document is projected and `select resolved_offset from anchors` is run.
Then: `resolved_offset` is `NULL`. Specifically it is **not** the character offset of
`milk from the corner bakery`. A non-NULL offset here fails SERVER-004 outright — this is
the SERVER-002 round-3 evaluator observation the AC exists for.

TEST-20: Fuzzy similarity never produces an offset at projection time
Given: A document with an anchor whose `exact` is `assume a 30-year fixed at 6.1%`, edited
**out of band** (no reconciliation) so the body now reads `assume a 30-year fixed at 6.4%`
— above the engine's fuzzy threshold, below exact.
When: The document is projected.
Then: `resolved_offset` is `NULL`. Projection resolves on the exactness tier only; keeping
selectors attached across edits is the reconciler's job on the write path, not the
projector's job at render time.

TEST-21: Rebuild and incremental projection agree, byte for byte
Given: A workspace with a mix of live, orphaned, and look-alike-orphaned anchors, projected
incrementally file by file.
When: `rebuild()` reconstructs the database **from files alone** into a second path and
`select doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset from anchors order by
doc_id, anchor_id` is dumped from both.
Then: The two dumps are identical. Any anchor state that survives only inside SQLite —
never re-derivable from the files — fails this test, and with it SERVER-004's own invariant
that nothing durable lives only in the projection.

TEST-22: The recorded orphan rule is honoured on verbatim restore
Given: The TEST-19 workspace, with the deleted `- bread from the corner bakery` bullet
restored verbatim (same surrounding lines) by a direct file write, then re-projected.
When: The anchor row is selected, from the incremental path and from a full rebuild.
Then: The result matches the rule recorded in the issue file, identically on both paths —
under **exact-only re-resolution**, an integer offset pointing at the restored bullet;
under **unconditional NULL for orphans**, `NULL`, with the issue file naming where that
orphan state is persisted in the *files* (not in SQLite) and TEST-21 still passing.

#### Full-text search

TEST-23: FTS finds documents by title, by body, and by turn
Given: Fixtures where the word `mortgage` appears only in one document's title, only in a
second document's body, and only inside one turn of a thread.
When: `sqlite3 … "select ref, kind, snippet(search,4,'[',']','…',8) from search where search
match 'mortgage'"` is run.
Then: Three rows come back — `kind='doc'` for the first two (with `ref` = the document id)
and `kind='turn'` for the third (with `ref` = `<threadId>#<ts>` and `doc_id` = the thread
id) — and every `snippet()` value is non-empty.

TEST-24: The tokenizer is the one the schema declares
Given: A document whose body contains `café`.
When: `search match 'cafe'` is queried.
Then: The document is returned (`remove_diacritics 2` is in effect).

#### Rebuild

TEST-25: Rebuild is idempotent (§15 M1)
Given: A populated workspace.
When: `rebuild(config, { into: A })` and `rebuild(config, { into: B })` run back to back,
and both databases are dumped with deterministically ordered `select *` queries over every
table.
Then: The dumps are identical apart from `meta.rebuilt_at`.

TEST-26: Rebuild replaces `cache.db` atomically and cleans up after itself
Given: A workspace with an existing `cache.db`.
When: `rebuild(config)` (no `into`) completes; then a rebuild is interrupted mid-way
(`kill -TERM` the running rebuild process).
Then: After the first, `cache.db` holds the new content and no `*.rebuild-*` file remains.
After the interruption, `cache.db` is still the **previous, valid** database — never
half-written — and the leftover temp file is removed by the next rebuild.

TEST-27: Rebuild reports what it did
Given: A workspace with 6 documents (one unparseable), 2 threads with 5 turns total, 3
anchors, 4 links and 2 queue events.
When: `rebuild` returns.
Then: Its report carries `{documents, threads, turns, anchors, links, events, durationMs,
skipped}` with counts matching the database, and `skipped` naming the unparseable file with
a reason.

TEST-28: An empty workspace rebuilds to a valid, empty database
Given: A workspace created by `corpus init` with `data/docs` emptied.
When: `rebuild` then `doctor` run.
Then: Rebuild succeeds with zero-count report, the schema is complete (TEST-1 passes against
it), and `doctor` reports `ok`.

#### Doctor

TEST-29: A clean workspace reports `ok`
Given: A workspace rebuilt from its current files.
When: `doctor(config)` runs.
Then: It returns `{ok: true, drift: []}` and it did **not** modify `cache.db` (size and
mtime unchanged; it opens read-only).

TEST-30: Each drift kind is detected independently
Given: The clean workspace from TEST-29.
When: In turn — (a) a document's content is changed with `printf >>`; (b) a new `.md` file
is added without projecting; (c) a projected file is `rm`ed; (d) a document with an
unparseable frontmatter is added; (e) a second file claiming an existing id is added — and
`doctor` is run after each.
Then: Each run reports `ok: false` with, respectively, `content_mismatch` naming the path,
`missing_row`, `orphan_row`, `unparseable`, `duplicate_id`; and re-projecting the affected
file (or removing it) returns `doctor` to `ok`.

TEST-31: The queue count check compares events, not files
Given: An `init`-produced workspace whose `.corpus/queue/<status>/` directories each hold a
`.gitkeep`, plus 3 real `evt_*.json` files spread across statuses.
When: `doctor` runs.
Then: It reports `ok`. A `count_mismatch` here — caused by counting `.gitkeep` as an event —
is a defect, not drift (Open Conflict 15).

TEST-32: The hash pass is skipped when size and mtime are unchanged
Given: A clean, projected workspace.
When: `doctor` runs twice with no file touched, with file reads/hashes counted.
Then: The second run hashes zero files; a file whose mtime is bumped without a content
change is hashed and then reported clean.

TEST-33: Doctor and rebuild run against a workspace whose server is not running, and while
it is
Given: (a) A workspace with no server process; (b) the same workspace with a real server
running on 8775.
When: `doctor` runs in both.
Then: Both complete and agree; the (b) run neither blocks nor is blocked (WAL read
concurrency) and leaves the running server healthy afterwards.

TEST-34: Performance stays inside the stated targets
Given: A generated workspace of 1000 documents (doctor) and 2000 documents (rebuild), each
with anchors, threads and refs.
When: `time` measures a warm `doctor` and a cold `rebuild`.
Then: Doctor < 200 ms, rebuild < 2 s, single-document incremental projection < 5 ms —
measured on this machine, with the raw numbers pasted into the E2E log. CI assertions carry
generous margins.

TEST-35: A multi-megabyte document does not blow up the projector
Given: A 5 MB document body.
When: It is projected.
Then: It succeeds, `body_excerpt` is 280 characters, its FTS row is queryable, and process
RSS stays bounded.

TEST-36: Read-your-write is synchronous
Given: An open projection.
When: A single script writes a new markdown file, calls `projectDocument`, and immediately
`SELECT`s it — in the same tick, with no polling, no `await` on a timer.
Then: The row is there. No projection function is `async`.

TEST-37: A file that vanishes between enumeration and read is a removal, not a crash
Given: A rebuild enumerating a workspace.
When: A file is deleted after enumeration and before its read (`ENOENT`).
Then: The rebuild completes, that path is absent from the database, and no error is thrown.

---

### SERVER-008: Queue over HTTP — event store + long-poll

> Response shapes below are the **contract's** (`packages/contract/src/schemas/queue.ts`),
> which supersede the prose in SERVER-008's Key Implementation Details wherever they differ.
> See Open Conflicts 2, 3, 4 and 7.

#### Store and layout

TEST-38: The five status directories exist and events are §7-shaped
Given: A fresh workspace whose `.corpus/queue/` is empty (or absent).
When: The server boots and an event is enqueued.
Then: `pending/ in-progress/ processed/ failed/ abandoned/` all exist, and the event file at
`.corpus/queue/pending/<id>.json` parses with `id` (matching `^evt_[a-z0-9]{12}$`), `type`,
`created` (ISO 8601), `source`, `payload`.

TEST-39: Writes are atomic
Given: A reader repeatedly `cat`ing `.corpus/queue/pending/` while a burst of 200 events is
enqueued.
When: Every observed file is parsed as JSON.
Then: No truncated or partial file is ever observed (temp file + rename inside the same
directory).

#### Long-poll idle

TEST-40: Idle returns immediately when pending work exists, and does not claim it
Given: A running server with 2 events in `pending/`.
When: `time curl -sS -D- "127.0.0.1:8785/api/queue/idle?timeout=60" -H "Authorization: Bearer
$TOKEN"`.
Then: It returns in well under a second with `200` and body `{"events":[…]}` containing both
events; and `ls .corpus/queue/pending/` still shows both files — **idle reports
availability, it never claims**.

TEST-41: Idle parks and returns `204` with no body when the window expires
Given: A running server with an empty queue.
When: `time curl -sS -o /dev/null -w '%{http_code}' "…/api/queue/idle?timeout=10" …`.
Then: It blocks for ~10 s (measured, ±1 s) and then returns `204` with an empty body. `204`
is a normal outcome, not an error.

TEST-42: A parked idle wakes within a few hundred milliseconds of an event landing
Given: A parked `curl` on `…/api/queue/idle?timeout=60` in one shell, empty queue.
When: An event is made pending in another shell (see Open Conflict 5 for the pinned
producer).
Then: The parked call returns `200` with that event inside 1 s — measured with `time`, in
two real shells against a real socket. This is the single most important behaviour in
SERVER-008.

TEST-43: A timeout the contract does not allow is a validation error, not a silent clamp
Given: A running server.
When: `…/api/queue/idle?timeout=600` and `…/api/queue/idle?timeout=abc` are requested.
Then: Both return `400` with an `ApiError` body of `code: "bad_request"`, a message, and a
non-empty `issues` array naming `query.timeout` (per the ValidationError-requires-issues
rule). `timeout` omitted parks for the 480 s default.

TEST-44: A dropped client leaves nothing behind
Given: A parked idle request.
When: The `curl` is killed (`kill -INT`), then an event is enqueued, then a fresh idle call
is made.
Then: The fresh call returns immediately with the event; the server log shows no unhandled
rejection and no leaked-timer warning; and the server is still healthy on `/api/health`.

#### HALT

TEST-45: While halted, idle parks and claim-all is empty
Given: `POST /api/queue/halt` has been called and `.corpus/HALT` exists, **with events
sitting in `pending/`**.
When: `…/api/queue/idle?timeout=10` and `POST /api/queue/claim-all` are called.
Then: Idle blocks the full ~10 s and returns `204` (it never returns the pending events);
claim-all returns `{"events":[]}` and `ls .corpus/queue/pending/` is unchanged — the
filesystem was not touched.

TEST-46: Halt and resume are idempotent and reported
Given: A running server.
When: `halt` is called twice (the second with a `reason`), then `resume` twice.
Then: Each call returns `200` with a `QueueStatus`; `.corpus/HALT` holds `{reason?, at}` and
is rewritten, not duplicated; after the first `resume` the sentinel is gone and the second
`resume` still returns `200`; `GET /api/queue/status` reports `halted` truthfully at each
step.

#### Claim, transitions, reap

TEST-47: Claim-all moves everything pending in one batch
Given: 3 pending events.
When: `POST /api/queue/claim-all`.
Then: `200` with all three in `events`; `.corpus/queue/pending/` holds no `evt_*.json`;
`in-progress/` holds all three, with payloads byte-identical to what was enqueued.

TEST-48: Concurrent claims never double-hand an event
Given: 50 pending events.
When: 5 `claim-all` calls run in parallel (`&` … `wait`) against the real server.
Then: The union of returned ids is exactly the 50 enqueued, **no id appears twice**, and
`pending/` ends empty. Events enqueued during the claim simply remain pending and come back
on the next claim.

TEST-49: Complete, fail and abandon land the event in the right directory
Given: Three claimed events.
When: `POST /api/queue/<id>/complete`, `POST /api/queue/<id>/fail` with
`{"reason":"boom"}`, and `DELETE /api/queue/<id>`.
Then: Each returns `200` with the event; the files are in `processed/`, `failed/` and
`abandoned/` respectively; the failed event's JSON on disk records the reason; **no file is
deleted** — abandon is a move, not a delete.

TEST-50: Transitions are idempotent, and unknown ids 404
Given: An event already in `processed/`.
When: `complete` is called on it again; then `complete` is called on `evt_doesnotexist`.
Then: The first returns `200` unchanged; the second returns `404` with an `ApiError` of
`code: "not_found"`.

TEST-51: Hostile ids are rejected before any filesystem access
Given: A running server.
When: `POST /api/queue/..%2F..%2Fetc%2Fpasswd/complete`, `…/foo/complete`, and
`DELETE /api/queue/evt_../complete` are called.
Then: Each returns `400` with `issues`; no file outside `.corpus/queue/` is read, created or
stat'ed (verified with `ls -la` of the workspace before and after).

TEST-52: Reap-stale returns stuck work to pending and gives up past the cap
Given: One `in-progress` event backdated well past the staleness threshold, and one already
at the attempt cap.
When: `POST /api/queue/reap-stale`.
Then: `200` with `{"reaped":["<first id>"]}`; the first event is back in `pending/` with an
incremented attempt counter on disk; the second is in `failed/` with an error naming the
attempt cap and is **not** listed in `reaped`.

TEST-53: Status counts match the directories
Given: Events spread across all five statuses.
When: `GET /api/queue/status` is compared with `ls .corpus/queue/<status>/*.json | wc -l`
per directory.
Then: `pending`, `inProgress`, `processed`, `failed`, `abandoned` match exactly, and
`.gitkeep` files are not counted.

TEST-54: A malformed event file poisons nothing
Given: A hand-written truncated `pending/evt_bad000000000.json`.
When: `claim-all` runs, then the server is restarted.
Then: The bad file lands in `failed/` with an error, the other events are claimed normally,
the boot rebuild completes, and neither operation crashed.

#### Projection mirror and auth

TEST-55: Every transition is mirrored before the response returns
Given: A running server with the projection open.
When: An event is enqueued, claimed, and completed, with `sqlite3 … "select id,status from
events"` read immediately after each HTTP response.
Then: The `events` row's status is already `pending`, `in-progress`, `processed`
respectively — no polling, no sleep. The mirror is written synchronously before responding.

TEST-56: A restart never loses or duplicates events
Given: Events spread across the five directories, some moved by hand while the server was
stopped.
When: The server is restarted and `GET /api/queue/status` plus `select status, count(*) from
events group by status` are compared with the directories.
Then: All three agree exactly. The `events` table is rebuilt from the directories at boot.

TEST-57: The queue surface is behind the bearer guard
Given: A running server.
When: `status`, `idle`, `claim-all`, `halt`, `complete` are called with no token and with a
wrong token.
Then: Every one returns `401` with `WWW-Authenticate: Bearer` and an `ApiError` body of
`code: "unauthorized"`. No queue file is touched.

---

### CLI-002: `corpus init` + server lifecycle verbs

#### `corpus init` — the workspace

TEST-58: `init` creates the §4 tree
Given: An empty directory.
When: `corpus init --port 8795` runs, and `find . -type d | sort` is captured.
Then: `data/docs/`, `data/docs/inbox/`, `data/docs/templates/`, `data/docs/views/`,
`data/threads/`, `.corpus/queue/{pending,in-progress,processed,failed,abandoned}/`,
`.corpus/locks/`, `.corpus/jobs/`, `.corpus/attachments/`, `.claude/skills/`,
`.claude/agents/` and `.claude/skills-archived/` all exist. (The last three matter to
SERVER-004's document roots — see Open Conflict 9.)

TEST-59: The config is the canonical shape, and mode-protected
Given: A freshly initialized workspace.
When: `cat .corpus/config.json` and `stat -f '%Lp' .corpus/config.json` (macOS) are run, and
the file is parsed by **both** `@corpus/server`'s `WorkspaceConfigSchema` and the CLI's.
Then: It is `{"version":1,"port":8795,"token":"…","dataDir":"data"}`, the mode is `600`, the
token is base64url with ≥32 bytes of entropy (43 characters), and both schemas accept it
without complaint.

TEST-60: The template lands verbatim, renamed and filtered
Given: A freshly initialized workspace and the tool's bundled `assets/workspace/`.
When: Every template file is compared with its installed counterpart (`diff`), and
`find . -name .gitkeep` is run.
Then: `README.md`, `data/docs/templates/note.md`, the three `data/docs/views/*.md` and both
`SKILL.md` files are **byte-identical** to the template; `claude/` installed as `.claude/`
and `gitignore` as `.gitignore`; no `.gitkeep` from the template was copied; and no
skill file was templated or substituted.

TEST-61: The queue skeleton is the only `.corpus` content git tracks
Given: A freshly initialized workspace.
When: `git ls-files | grep '^\.corpus'`, `git check-ignore -v .corpus/config.json
.corpus/cache.db .corpus/server.pid .corpus/server.log .corpus/jobs/x.jsonl`, and
`git status --porcelain` are run.
Then: `git ls-files` lists exactly the five `.corpus/queue/<status>/.gitkeep` files;
`check-ignore` reports every listed runtime path as ignored; `git status --porcelain` is
empty. The `.gitignore` in the workspace is the **template's**, unmodified (Open
Conflict 8).

TEST-62: The queue skeleton survives a clone
Given: A freshly initialized workspace.
When: `git clone <ws> <clone>` runs and `find <clone>/.corpus -type d` is captured.
Then: All five `.corpus/queue/<status>/` directories exist in the clone. (This is the whole
reason the `.gitkeep` files exist.)

TEST-63: The initial commit is one commit, authored as `user`
Given: A freshly initialized workspace.
When: `git log --format='%H %an <%ae> %s'` and `git rev-parse --abbrev-ref HEAD` are run.
Then: Exactly one commit, authored **and** committed by the `user` identity regardless of
the operator's global git config, on branch `main`.

TEST-64: `init` refuses to clobber, and changes nothing when it refuses
Given: An initialized workspace.
When: `corpus init` is run again in it; `echo $?`; `git log --oneline | wc -l`;
`md5 .corpus/config.json` before and after.
Then: Exit code is non-zero, the message contains "already a Corpus workspace", the commit
count is still 1, and the config is unchanged. There is no `--force`.

TEST-65: A failure part-way through leaves nothing behind
Given: An empty target directory and an injected failure after the tree is created (for
example, an unwritable `.claude/` or a `git` that fails at commit time).
When: `corpus init` runs.
Then: It exits non-zero reporting the underlying error, and the previously empty target is
empty again — a later `corpus init` succeeds in it without a manual `rm -rf`.

TEST-66: An existing repository is reused, not re-initialized
Given: A directory with a `.git/` and two existing commits, but no `.corpus/`.
When: `corpus init --port 8797` runs.
Then: It succeeds, says it reused the existing repository, `git log` shows three commits
(the workspace commit on top), and the original branch name is preserved.

TEST-67: Path and environment errors are actionable
Given: (a) A nonexistent target path; (b) a target that is a regular file; (c) a `PATH` with
no `git`.
When: `corpus init <target>` runs in each.
Then: (a) creates the directory tree and succeeds; (b) exits `2` with a usage error; (c)
exits non-zero **before creating anything**, naming `git` and how to install it (verified:
the target is still empty).

TEST-68: `--port` is honoured, and an occupied port fails loudly
Given: A listener already bound on 8798.
When: `corpus init --port 8798` runs in an empty directory, then `corpus init --port 8799`
runs in another.
Then: The first fails loudly naming the port (leaving nothing behind, per TEST-65); the
second writes `"port": 8799`. `--port` is a registry-visible flag documented in
`docs/cli.md`.

TEST-69: Two workspaces are fully independent
Given: Two empty directories.
When: `corpus init --port 8795` and `corpus init --port 8796` run in them.
Then: Their tokens differ, their ports differ, and neither workspace references the other.
No user-level registry file is created anywhere outside the two directories.

TEST-70: `init` records the template manifest
Given: A freshly initialized workspace.
When: The manifest `corpus workspace upgrade` will later compare against is read.
Then: It exists at the path pinned in Open Conflict 10, listing every installed
template-provenance file with a content hash and the tool version — or, if the orchestrator
defers it, SERVER/CLI issue files record the deferral and CLI-005 is updated to say a
pre-manifest workspace is the norm.

#### `corpus server` — lifecycle

TEST-71: `start` daemonizes and returns immediately
Given: An initialized workspace on port 8795 with no server running.
When: `time corpus server start` runs, then the **shell that started it exits** and a fresh
shell runs `curl -H "Authorization: Bearer $(jq -r .token .corpus/config.json)"
http://127.0.0.1:8795/api/health`.
Then: The command returns in a couple of seconds printing the board URL; `.corpus/server.pid`
holds `{pid, port, startedAt, version}`; `ps -p <pid>` shows the process alive **after the
starting shell is gone**; and health returns `200` with the `Health` payload.

TEST-72: `start` is idempotent
Given: A running server.
When: `corpus server start` runs again; `echo $?`.
Then: Exit `0`, output names the port and the pid ("already running on :8795 (pid N)"), and
the pid is unchanged.

TEST-73: A server that cannot bind fails visibly, not silently
Given: The workspace's port is stolen by another listener between init and start.
When: `corpus server start` runs.
Then: It exits non-zero after the readiness poll, prints the **tail of `.corpus/server.log`
showing `EADDRINUSE`**, leaves no orphan child process (`ps` confirms), and does not leave a
pidfile pointing at a dead pid.

TEST-74: `status` reports the truth and gates scripts by exit code
Given: A running server, then a stopped one.
When: `corpus server status`, `echo $?`, `corpus server status --json | jq .` in both states.
Then: Running → exit `0`, human output and the single JSON object both carrying
running/pid/port/health/uptime/version. Stopped → exit non-zero and a "not running" report.
`--json` emits exactly one JSON value on stdout and nothing else.

TEST-75: `logs` tails and follows
Given: A running server with startup lines in `.corpus/server.log`.
When: `corpus server logs -n 20`; then `corpus server logs -f` in one shell while requests
are made in another; then Ctrl-C.
Then: The first prints the last 20 lines (without reading the whole file); the follow shows
new lines as they land; Ctrl-C exits `0`. Each `start` is delimited in the log by a header
line naming the ISO timestamp, pid and port.

TEST-76: `stop` is graceful, and stopping a stopped server is not an error
Given: A running server.
When: `corpus server stop`; `ps -p <pid>`; `ls .corpus/server.pid`; `corpus server stop`
again; `echo $?`.
Then: The process is gone, the pidfile is removed, and the second `stop` says "not running"
and exits `0`.

TEST-77: Stale and reused pidfiles are detected, never reported as "running"
Given: (a) A server killed with `kill -9`, leaving its pidfile; (b) a hand-written pidfile
naming a live but unrelated pid (e.g. a `sleep 600`).
When: `corpus server status` then `corpus server start` run in (a); `corpus server stop`
runs in (b).
Then: (a) status reports stopped, cleans the pidfile, and the subsequent `start` succeeds
cleanly. (b) The unrelated process is **still alive** afterwards, and the CLI reports "not
running (stale pidfile removed)".

TEST-78: Two workspaces run simultaneously and never cross wires
Given: The two workspaces from TEST-69, both started.
When: `corpus server status` is run from inside each; then `curl -H "Authorization: Bearer
<wsA token>" http://127.0.0.1:8796/api/queue/status` (wsA's token against wsB's port).
Then: Each status reports its own pid and port; the cross-token request returns `401`. With
the server stopped in one workspace, `corpus health` there exits `4` with the "run `corpus
server start`" message while the other workspace keeps working.

---

### Cross-issue integration

TEST-79: **The centerpiece — nothing to something, through the real stack**
Given: An empty directory and the built, linked `corpus` binary.
When: This exact sequence runs, with every command's output and exit code captured:

```sh
WS=$(mktemp -d /tmp/corpus-sprint003-int-XXXXXX); cd "$WS"
corpus init --port 8805                      # 1. workspace from nothing
corpus server start                          # 2. real daemon
corpus health                                # 3. real client → real socket → real server
sqlite3 .corpus/cache.db "select type,count(*) from documents group by type"
                                             # 4. real projection over the seed workspace
curl -sS -o /tmp/idle.$$ -w '%{http_code}' \
  "127.0.0.1:8805/api/queue/idle?timeout=60" -H "Authorization: Bearer $TOKEN" &
IDLE=$!                                      # 5. park
# … make one event pending (Open Conflict 5) …
wait $IDLE                                   # 6. wake
curl -sS -X POST 127.0.0.1:8805/api/queue/claim-all -H "Authorization: Bearer $TOKEN"
curl -sS -X POST 127.0.0.1:8805/api/queue/$ID/complete -H "Authorization: Bearer $TOKEN"
corpus server stop
```

Then: Every step succeeds; step 3 exits `0` and prints the real health payload; step 4 shows
the seed documents typed `view`, `template`, `skill` (never `.gitkeep`, never `.gitignore`);
the parked idle in step 5 returns `200` within 1 s of the event landing; claim-all moves the
event to `in-progress/` and complete moves it to `processed/`; and `corpus server stop`
leaves no process and no pidfile. **No hop in this chain is stubbed.** This test is what
makes the three issues a batch.

TEST-80: The projection of an `init`-produced workspace is exactly the template's documents
Given: A freshly initialized workspace, never edited.
When: `sqlite3 .corpus/cache.db "select id,type,title,path from documents order by path"`.
Then: Rows exist for `data/docs/templates/note.md` (`type: template`), the three
`data/docs/views/*.md` (`type: view`), and both `.claude/skills/*/SKILL.md`
(`type: skill`) — and nothing else. `README.md` at the workspace root, `.gitignore`, and
every `.gitkeep` are absent. The seed documents are `evergreen: true`, so a day-one
workspace's Attention view is not full of its own scaffolding.

TEST-81: `rebuild && doctor` is clean on a real workspace — the standing v1 invariant
Given: The TEST-79 workspace after the queue round-trip, with the server **running**.
When: A rebuild runs, then `doctor`.
Then: `doctor` reports `ok` with no drift — including no `count_mismatch` from the queue
`.gitkeep` files and none from the processed event. Then a document is edited out of band
and `doctor` reports `content_mismatch`; re-projecting restores `ok`.

TEST-82: The queue survives a real daemon restart
Given: The TEST-79 workspace with events spread across `pending/`, `in-progress/` and
`processed/`.
When: `corpus server stop && corpus server start`, then `GET /api/queue/status` and
`select status,count(*) from events group by status` are compared with the directories.
Then: All three agree, with no event lost and none duplicated.

TEST-83: One config file, three readers
Given: The single `.corpus/config.json` that `corpus init` wrote.
When: The server boots from it, the CLI resolves the workspace from it, and the daemon
launched by `corpus server start` reads it.
Then: All three derive the same port and token, and none of them requires a field `corpus
init` does not write or rejects one it does. The daemon's environment handoff carries only
what the server actually reads (Open Conflict 13).

TEST-84: Two workspaces, two daemons, two projections, two queues
Given: Workspaces A (8795) and B (8796), both initialized and started.
When: An event is made pending in A only, and a document is created in B only; then both
projections and both queue statuses are read.
Then: A's queue shows the event and B's is empty; B's projection shows the document and A's
does not; and neither `.corpus/cache.db` references the other workspace's paths.

TEST-85: A halted workspace stops the loop and nothing else
Given: The TEST-79 workspace with pending events.
When: `POST /api/queue/halt`, then a parked idle, a claim-all, a `corpus health`, and a
projection read.
Then: Idle parks its full window and returns `204`, claim-all returns empty, and **health and
the projection keep working normally** — HALT stops the agent picking up work, not the
server.

TEST-86: The repo-wide gates stay green
Given: All three issues landed and merged onto the phase branch.
When: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
`npm test` run from a clean tree, followed by `npm run e2e` with `CORPUS_UI_PORT=5273`.
Then: All pass with no regression against the pre-sprint baseline, combined coverage stays at
or above the 90% gate, `docs/cli.md` regenerates with no diff (CLI-002 adds `init` and the
`server` topic to the registry, so a stale copy must block), `openapi.json` regenerates with
no diff, and the pre-push hook passes end to end.

---

## Out of Scope

Nothing below belongs to this sprint. An agent building one of these has drifted; an
evaluator failing an issue for lacking one is wrong.

**Projection (SERVER-004)**

- The **chokidar watcher** and any re-projection triggered by a file event — SERVER-007.
  SERVER-004 exports single-file projectors *for* the watcher; it does not start one.
- SSE invalidation of any kind — SERVER-007.
- `corpus db rebuild` / `corpus db doctor` **CLI verbs**, their output formatting and their
  exit-code mapping — CLI-004. SERVER-004 exports `rebuild()` and `doctor()` as functions.
- Wiring `doctor` into the workspace's pre-commit hook — INFRA.
- The **collection query endpoint** (`GET /api/docs?…`, `needs=me`, snippet highlighting on
  the wire) — SERVER-011. SERVER-004 builds the tables and the FTS index that endpoint will
  read; it exposes no HTTP route.
- **Writing anything into the corpus.** Stamping a missing `id` into a `SKILL.md`, fixing a
  duplicate id, normalizing frontmatter: all SERVER-005. The projection reads.
- **Anchor reconciliation.** SERVER-004 *consumes* the anchor engine per its orphan AC and
  changes nothing under `src/anchors/`. Re-opening the SERVER-002/012 adjudications (the
  diff is advisory; in-place edit evidence outranks a verbatim duplicate elsewhere;
  deleted-claim verification is exact-only plus insertion-overlap; fuzzy never runs on
  deletion-shaped claims) is out of scope.
- Migrations. A schema change wipes and rebuilds; there is no migration code to write.

**Queue (SERVER-008)**

- **Producing** events from product actions — `comment.created` from `POST /api/threads`
  and `POST /api/capture`, `form.respond` — all SERVER-006. SERVER-008 ships the internal
  `enqueue()` those will call.
- `agent.done` semantics and background subagent wake-back — SERVER-006/AGENT.
- **Job logs**: `.corpus/jobs/*.jsonl`, `GET /api/jobs`, `POST /api/jobs/:id/log`, the
  loopback-only tokenless ingest, retry — SERVER-009. The `jobs` table is SERVER-004's; no
  one populates it this sprint.
- **Locks** of every kind — SERVER-009.
- The `corpus queue idle|claim-all|complete|fail|abandon|reap-stale|halt|resume` **CLI
  verbs** and the ~8 min rearm loop — CLI-004. SERVER-008 ships the endpoints they will call.
- The orchestrate skill's use of any of this — AGENT/M5.
- Changing any queue **contract** shape. The contract is frozen for this sprint; a shape
  that does not fit is an Open Conflict to escalate, not a schema to edit (Open
  Conflicts 2, 3, 4, 7).

**CLI (CLI-002)**

- Every other verb: `doc`/`thread` (CLI-003), `queue`/`lock`/`job`/`db` (CLI-004),
  `workspace upgrade` (CLI-005), plugin verbs (PLUGINS-001). CLI-002 adds `init` and the
  `server` topic and nothing else.
- **Any filesystem write outside `corpus init` and the pidfile/logfile.** Those are the two
  documented exceptions in §2.2 rule 4; everything else goes through the server.
- Log rotation or size management for `.corpus/server.log`.
- `npm pack` / global-install packaging and the `files` manifest that makes the workspace
  template ship — INFRA-008 (Open Conflict 11).
- Spinners, progress bars, colors.

**Everywhere**

- UI work of any kind. No issue in this batch touches `apps/ui` or `packages/kit`.
- Re-opening sprint-002's adjudications: the canonical `config.json` shape with the 8765
  port default and loopback-at-bind `host`; `ApiError`-only error bodies (now including
  `internal_error`); the `/api/openapi.json` contract exemption; the `/events` guard
  accepting `?token=`; `uptimeSeconds`; static-before-parameter route registration order.
- Performance work beyond SERVER-004's stated targets and the ~250 ms round-trip goal, which
  nothing in this batch can yet measure end to end.

---

## Integration Points

**SERVER-004 → SERVER-008 — one `events` writer, not two.**
SERVER-004 owns the schema (including `events`) and the runtime projectors in
`project-runtime.ts`: a whole-directory projector (used by `rebuild` and by SERVER-008's
boot rebuild) and a single-event projector (used by SERVER-008 on every transition).
SERVER-008 **consumes** them and defines no DDL, no second `events` writer, and no second
boot-rebuild path. The seam is a narrow, synchronous interface:

```
projection.projectQueueDir(db, corpusDir)   → rebuilds `events` from the five directories
projection.projectEvent(db, event, status)  → upserts one row
projection.removeEvent(db, id)              → deletes one row
```

Names may differ; the ownership may not. If SERVER-004 has not landed when SERVER-008 needs
the seam, SERVER-008 declares the interface, codes against it, and marks TEST-55/TEST-56 as
`DEFERRED → SERVER-004` with unit-level substitute evidence — it does not fork the schema.

**SERVER-004 ↔ SERVER-008 — shared files inside `apps/server`.**
Both edit `apps/server/src/app.ts` (SERVER-004 registers a disposer for the database handle;
SERVER-008 mounts the queue routes) and both may edit `apps/server/package.json`
(SERVER-004 adds `better-sqlite3` + `@types/better-sqlite3`). They must run in **separate
worktrees**; the orchestrator merges SERVER-004 first, then rebases SERVER-008 onto it, so
the queue's mount lands on top of the projection's disposer registration rather than
alongside a conflicting copy. Neither agent may reformat lines the other owns.

**CLI-002 → SERVER-004 — the workspace `init` produces is the workspace the projection
reads.**
`corpus init` decides which directories exist; SERVER-004's roots decide which of them are
indexed. Three concrete obligations fall out: `.claude/agents/` and `.claude/skills-archived/`
must exist (Open Conflict 9) or two of SERVER-004's five roots are never exercised against a
real workspace; the template's seed documents must project as `view`/`template`/`skill`
(TEST-80); and the workspace `README.md` at the root must **not** be indexed, because it sits
outside every root.

**CLI-002 → SERVER-008 — the queue skeleton and its `.gitkeep` files.**
`corpus init` creates the five status directories each holding a `.gitkeep` so the skeleton
survives a clone. SERVER-008's listing, counting and claiming logic, and SERVER-004's
`doctor` count check, must therefore consider `evt_*.json` only. This is the batch's most
likely cross-issue false failure (Open Conflict 15) — TEST-31, TEST-53 and TEST-81 all hold
it.

**CLI-002 ↔ SERVER-003 — the daemon handoff.**
`corpus server start` spawns the installed `@corpus/server` entry point detached, and the
server resolves its own workspace and config. The server reads `CORPUS_WORKSPACE`,
`CORPUS_PORT`, `CORPUS_LOG_LEVEL`, `CORPUS_UI_DIST` — and takes the **token from
`config.json` only**. Passing a `CORPUS_TOKEN` the server ignores is dead weight; passing a
`CORPUS_PORT` that disagrees with the config is a live hazard (the CLI would then poll a
port the config does not name). Pin: pass `CORPUS_WORKSPACE` and nothing else unless the
operator explicitly overrode the port (Open Conflict 13).

**CLI-002 ↔ CLI-001 — the frame is reused, not rebuilt.**
`init` and the `server` topic register into the existing declarative registry and inherit
`--json`, the global flags, the three levels of `--help`, and `docs/cli.md` generation.
Exit codes come from the existing `ExitCode` table (`0` success, `2` usage, `3` no
workspace, `4` server unreachable, `5` server error) — CLI-002 introduces no new code, and
`corpus server status` on a stopped server uses an existing one. All server-reaching calls
go through CLI-001's `createClient()`; `apps/cli/src` must still contain zero `fetch(` calls
outside `client.ts`.

**CLI-002 ↔ the workspace template — one install contract, three copies.**
`docs/workspace-template.md` is the contract; `scripts/workspace-template.ts` holds the
machine-readable rename/filter tables and a test that keeps the two in agreement. CLI-002
becomes the third implementation. It must encode no knowledge of any individual seed file —
copy the tree wholesale, apply the two renames (`claude/` → `.claude/`, `gitignore` →
`.gitignore`), drop `.gitkeep` — and it must carry a test proving its tables match the
committed contract, so adding a template file never requires editing the CLI.

---

## Open Conflicts — orchestrator decision required before implementation

Fifteen disagreements between the three issue files, the contract, the spec and the install
contract, in rough order of blast radius. Each carries a recommendation; the orchestrator
adjudicates **before** the domain agents start, and each adjudication is written back into
the affected issue file(s).

**1. SERVER-004's orphan look-alike decision (the AC that names this decision explicitly).**
The two pinned options are (a) orphaned-at-reconcile-time anchors project `resolved_offset =
NULL` unconditionally, or (b) re-resolve **exact-only** via `resolveAnchorExact`, never fuzzy.

**Recommendation: (b), exact-only.** Three reasons, in order of weight:

- **(a) is not implementable from files alone.** The frontmatter anchors map is
  `{exact, prefix, suffix}` — `apps/server/src/anchors/types.ts` carries no orphan flag, and
  `reconcileAnchors`' `orphaned` list is a per-save *report*, not persisted state. To make
  orphanhood sticky, the projection would have to remember it in SQLite, which contradicts
  SERVER-004's own stated invariant ("nothing durable may ever live only in SQLite") and
  breaks rebuild-from-files-alone (§15 M1, TEST-21). Option (a) is only viable if
  orphanhood is first persisted **in the file** — a frontmatter/contract change owned by
  CONTRACT and SERVER-005, which is out of scope for this batch.
- **The exactness tier is exactly the right strength.** `resolveAnchorExact` implements §6
  rungs 1–2 (`prefix+exact+suffix`, then a *unique* `exact`); the deleted bread bullet
  resolves to nothing under both rungs, so TEST-19 passes. Fuzzy is the rung that finds the
  look-alike sibling, and the reconciler already refuses to trust it on deletion-shaped
  claims (the SERVER-002 round-2/3 adjudication). Running it at projection time would
  reintroduce, at render time, exactly the misattachment the write path was fixed to
  prevent.
- **Fuzzy at projection time is dead weight anyway.** Reconciliation runs on *every* write
  path, and the watcher (SERVER-007) will run it for out-of-band edits before projecting —
  so a live anchor's selector is always fresh by the time the projector sees it, and the
  exact rung suffices. Meanwhile fuzzy is `diff-match-patch` bitap: paying it per unresolved
  anchor across a 2000-document rebuild puts SERVER-004's 2 s target at risk for no benefit.

The cost of (b), stated honestly: an anchor whose text is edited out of band *and* whose
document is projected before the watcher reconciles will read as orphaned until the next
save. That is a temporary, self-healing, honest under-report — and it is the strictly safer
failure direction than silently pointing a thread at the wrong sentence.

**2. The idle endpoint's response shape.** SERVER-008's Key Implementation Details describe
`{pending: n}`, `{pending: 0, timedOut: true}` and `{halted: true, events: 0}`. The contract
declares `200` → `IdleResult = {events: QueueEvent[]}` (min 1) and **`204` with no body** on
expiry, with no `halted` or `timedOut` field anywhere.
**Recommendation: the contract wins** — the same call sprint-002 made twice. `200
{"events":[…]}` when work is available, `204` empty when the window expires (including while
halted). The issue file's prose is corrected before implementation. A server that emits a
shape its own contract does not declare defeats §9.3.

**3. The idle timeout: "clamped" or rejected?** The issue says the server clamps the
client's ask (max ~9 min). `IdleQuerySchema` is `z.coerce.number().int().min(1).max(480)
.default(480)`, and the app's `defaultHook` turns a schema failure into a `400 bad_request`
— so `timeout=600` is a **validation error**, not a clamp, and the contract's own prose
("the server clamps anything longer") already disagrees with its own schema.
**Recommendation: the schema is authoritative — `400` with `issues`** (TEST-43). It is the
behaviour the code already produces, it is what the generated client's types promise, and
silently ignoring a caller's explicit parameter is worse than telling them. The contract's
description sentence and SERVER-008's "~9 min" prose are both corrected; the CLI's rearm
(CLI-004) requests ≤ 480. Changing `MAX_IDLE_TIMEOUT_SECONDS` is a CONTRACT issue, not a
server workaround.

**4. `reap-stale`: an undeclared query parameter and a richer result.** The issue specifies
`POST /api/queue/reap-stale?olderThan=<seconds>` returning "the counts of each outcome". The
contract declares no query parameters (an unknown one is simply ignored, so
`?olderThan=1` would silently do nothing) and returns `ReapStaleResult = {reaped: string[]}`.
**Recommendation: implement the contract.** The staleness threshold (default 900 s) and the
attempt cap (default 3) are **server-side constants**, not request parameters; `reaped` lists
only the ids returned to `pending/`, and events pushed past the cap into `failed/` are not in
it. E2E backdates files past the real threshold (`touch -t` an hour ago) rather than leaning
on a parameter that does not exist — a test that "passes" because the server ignored
`?olderThan=1` is a false pass.

**5. Nothing in this batch can produce an event through a product action.**
SERVER-008's E2E step 3 says to trigger an enqueue by posting an `@agent` comment — but
`POST /api/threads` is SERVER-006, which is not in this batch. Worse, an event file dropped
into `pending/` from another process wakes **nothing**: waiters are resolved by the
in-process `enqueue()`, and SERVER-007's watcher does not exist yet. As written, TEST-42 and
the TEST-79 centerpiece are unexecutable.
**Recommendation: give the waiter registry a poll fallback** — alongside the in-process wake,
re-check `pending/` on a modest interval (~500 ms) while a request is parked. It is a dozen
lines, it makes `idle` honest about what the spec says an event *is* (a file in a directory,
§7), it survives an event moved by hand or by a future direct-write path, it costs a `readdir`
per parked request per half-second, and it makes the centerpiece runnable **today** with
`cp evt.json .corpus/queue/pending/`. The alternative — mark TEST-42 and TEST-79's wake step
`DEFERRED → SERVER-006` with only unit-level evidence — leaves the sprint's headline claim
unproven and is not recommended. Either way the decision is recorded in SERVER-008's issue
file before implementation.

**6. Two owners for the `events` mirror, and two editors for `app.ts`.** SERVER-004's file
list includes `project-runtime.ts` ("events, jobs, locks, seen projectors"); SERVER-008's
includes `queue/project.ts` ("queue → events table mirror + boot rebuild"). SERVER-008 also
does not list SERVER-004 among its dependencies, though it needs the `events` table to exist.
**Recommendation: SERVER-004 owns the schema and the projector primitives; SERVER-008
consumes them** (see Integration Points for the seam). Add SERVER-004 to SERVER-008's
Depends-on line. Merge SERVER-004 first, then rebase SERVER-008. Separate worktrees for both.

**7. The on-disk event carries fields the wire schema does not declare.** SERVER-008
rewrites the event JSON with `status`, `updated`, `attempts` and `error`; `QueueEventSchema`
declares only `id`, `type`, `created`, `source`, `payload`. And the fail *request* field is
`reason`, while the issue's on-disk field is `error`.
**Recommendation: the on-disk file is a superset; the wire response is the contract's
shape.** Transition bookkeeping (`status`, `updated`, `attempts`, `error`) is written to the
file and used by reap and by the boot rebuild; responses carry at least the five declared
fields and no consumer in this sprint may depend on extras. The fail request's `reason` is
stored on disk as `error`, and that mapping is documented in the issue file so the next
reader does not think two fields exist.

**8. Two sources for the workspace `.gitignore`.** CLI-002's AC has `corpus init` writing a
`.gitignore` enumerating runtime paths (`.corpus/cache.db*`, `.corpus/jobs/`, …). But
`assets/workspace/gitignore` already exists, ships in the template, installs as `.gitignore`
via the rename table, and is built around the `.corpus/*` + `!.corpus/queue/` +
`.corpus/queue/*/*.json` structure that the `.gitkeep` skeleton depends on.
**Recommendation: the template wins; `corpus init` never writes a `.gitignore`.**
`docs/workspace-template.md` is the install contract and CLI-002's own edge-case note already
cites it. Two generators for one file is how the negation pattern gets silently broken. Fix
CLI-002's AC to say the `.gitignore` arrives with the template copy, and keep TEST-61 as the
guard.

**9. `init` does not create two directories the spec and the projection require.**
CLI-002's AC lists `data/` and `.corpus/` but not `.claude/agents/` or
`.claude/skills-archived/`. The template ships `claude/agents/.gitkeep` — which is
**filtered** on copy, so the directory would not survive — and ships no `skills-archived` at
all, though SPEC §4 lists it and SERVER-004 indexes it as a document root.
**Recommendation: `corpus init` creates `.claude/agents/` and `.claude/skills-archived/`
explicitly**, exactly as it creates `data/docs/inbox/`. Add them to CLI-002's AC and to
`docs/workspace-template.md`'s "generated by `corpus init`" list, and to
`INIT_GENERATED` in `scripts/workspace-template.ts` in the same commit (the test compares
them). Without this, two of SERVER-004's five roots are never exercised against a real
workspace, and `corpus doc archive` on a skill (§7) would have nowhere to move it.

**10. The template manifest has a contract but no acceptance criterion.** SPEC §2.1 and
`docs/workspace-template.md` both say `corpus init` records a manifest (path + content hash +
tool version) for `corpus workspace upgrade` to three-way compare against. CLI-002's AC does
not mention it, and `INIT_GENERATED` does not list it.
**Recommendation: write it now, in CLI-002.** It costs one file, it is worthless if written
later (CLI-005 cannot retroactively know what the *original* install contained — SPEC §2.1
already describes the degraded "pre-manifest workspace" path as a fallback, not a plan), and
skipping it means every workspace created between now and CLI-005 is permanently a
conservative-upgrade case. Pin the path as `.corpus/template-manifest.json` and the shape as
`{version: 1, tool: "<tool version>", installedAt: "<ISO>", files: [{path, sha256}]}`, add it
to `INIT_GENERATED`, and note it is gitignored under `.corpus/*`. If the orchestrator defers
it, record the deferral in both CLI-002 and CLI-005 and drop TEST-70.

**11. Where does `assets/workspace/` live at install time?** CLI-002 says to resolve the
template "relative to the installed package" via `import.meta.url`, so a global install
works. But the template sits at the **repo root** (`<repo>/assets/workspace/`), while the CLI
is `apps/cli` whose `package.json` declares `"files": ["dist"]` — so `new URL('../assets/
workspace/', packageRoot)` resolves to `apps/assets/workspace` in the monorepo and the
template ships in no tarball at all.
**Recommendation: a two-candidate resolver plus a packaging follow-up.** Mirror the pattern
already used by `resolveUiDistDir` in `apps/server/src/config.ts`: try the packaged layout
(`<cliPackageRoot>/assets/workspace`) first, then the dev layout (`<repoRoot>/assets/
workspace`), and fail with a message naming both when neither exists. Add `assets` to
`apps/cli`'s `files` and a build step that stages the template into `apps/cli/assets/` — or
hand that one step to infra-dev, since CLI-002 blocks INFRA-008 anyway. **The `npm pack` +
global-install half of CLI-002's E2E step 1 is `DEFERRED → INFRA-008`**; `npm run build -w
apps/cli && npm link -w apps/cli` is the pinned E2E path for this sprint, and the deferral is
recorded with the resolver's dev-layout evidence as the substitute.

**12. `corpus init`'s default port probe would take 8765.** The default is 8765, probing
upward — and 8765 is reserved this sprint for the UI e2e suite. CLI-002's `--port` flag
appears only in Key Implementation Details, not in the AC or the registry.
**Recommendation: make `--port <n>` a registry-visible flag with an AC and a `docs/cli.md`
entry**, and require every E2E step in this sprint to pass it explicitly (TEST-58 onward).
The default-probe behaviour is still tested — but by holding 8790 with a listener and
asserting the probe steps to 8791, never by racing the UI suite for 8765.

**13. The daemon's environment handoff includes a variable the server ignores.** CLI-002
spawns the server with `CORPUS_WORKSPACE`, `CORPUS_PORT` and `CORPUS_TOKEN`. The server reads
`CORPUS_WORKSPACE` and `CORPUS_PORT`, and takes the token from `config.json` **only** — there
is no `CORPUS_TOKEN` in `apps/server/src/config.ts`. Worse, `CORPUS_PORT` *overrides* the
config, so a stale value would have the daemon listening on a port the CLI's pidfile and the
config disagree about.
**Recommendation: pass `CORPUS_WORKSPACE` only** (plus `CORPUS_LOG_LEVEL` when the operator
asked for it). Drop `CORPUS_TOKEN` — passing a secret through an environment the server never
reads is pure exposure. Pass `CORPUS_PORT` only when the operator explicitly overrode the
port for this run, and then write that same port into the pidfile. TEST-83 holds this.

**14. `corpus server status` needs an exit code for "stopped".** The AC says non-zero so
scripts can gate on it, but CLI-001's `ExitCode` table has no "stopped" member, and the
nearest candidates mean something else (`4` = server unreachable, `6` = a check-style command
reported a failure while its own work succeeded).
**Recommendation: reuse `6` (`checkFailed`).** `status` did its job perfectly — it
successfully determined the server is stopped — which is precisely what `6` means; `4` would
wrongly claim the CLI could not reach a server it never expected to find. Record the choice
in CLI-002's AC and in `docs/cli.md`'s exit-code table. Adding a new exit code is the
alternative, but a new code is a permanent addition to a documented surface for one verb's
one state.

**15. `.gitkeep` inside the queue directories will be counted as an event.** Every
`init`-produced workspace has `.corpus/queue/<status>/.gitkeep`. SERVER-008 lists and counts
those directories; SERVER-004's `doctor` compares `.corpus/queue/**` file counts against
`events` rows. A naive `readdir` makes every real workspace report a permanent
`count_mismatch` and inflates every status count by one.
**Recommendation: `evt_*.json` is the only thing that counts as an event, everywhere** — the
queue store's listing, claim-all's snapshot, the status counts, the boot rebuild, and
doctor's count pass. This needs no decision so much as a written-down rule both agents
inherit; TEST-31, TEST-53 and TEST-81 hold it. It is listed here because it is the one
cross-issue defect in this batch that both agents will otherwise ship independently and
neither will see alone.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above PASSes in the evaluator's verdict** — TEST-1 … TEST-86, with
  any test that could not be executed explicitly marked `DEFERRED → <issue>` in the relevant
  E2E Verification Log, with its reason and its substitute evidence. Two deferrals are
  pre-authorized (Open Conflicts 5 and 11); a third needs the orchestrator's sign-off.
- **The fifteen Open Conflicts are adjudicated** by the orchestrator before implementation
  starts, and each adjudication is written back into the affected issue file(s) so the next
  agent inherits the decision rather than re-deriving it. **Conflict 1 (the orphan
  look-alike rule) is blocking for SERVER-004** — its AC says so explicitly, and TEST-22
  cannot be written until it is answered.
- **Each issue's E2E Verification Log carries concrete evidence from the environment pinned
  above** — exact commands, actual output, the ports and scratch prefixes used, and the model
  the implementing agent ran on ("implemented on: opus | fable").
- **SERVER-004's performance numbers are real measurements**, pasted from `time`, not
  estimates.
- `/test` passes with no regressions and combined coverage stays at or above the 90% gate.
- `/lint` passes (eslint, prettier, tsc across all workspaces).
- `npm run build` succeeds from a clean tree, `docs/cli.md` and `openapi.json` both
  regenerate with no diff, and the pre-push hook passes end to end.
- **The composition is proven, not assumed**: TEST-79 shows an empty directory becoming a
  running Corpus — `corpus init` → `corpus server start` → a real projection over the seed
  workspace → `corpus health` → a real long-poll parking and waking → claim → complete —
  with no stub anywhere in the chain.
