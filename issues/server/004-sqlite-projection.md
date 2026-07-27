# [SERVER-004] SQLite projection: schema, projectors, FTS, rebuild/doctor

## Domain

server

## Status

done

## Priority

P0

## Model

opus — the schema is fully pinned by §9.1; the work is disciplined mapping, not design.

## Dependencies

- Depends on: SERVER-001, SERVER-003
- Blocks: SERVER-005, SERVER-007, SERVER-011

## Spec References

- SPEC.md §9.1 — "Projection (SQLite)" (the derived tables, document roots, read-your-write consistency)
- SPEC.md §7 — "Skills and agent definitions are documents" (`.claude/skills/**/SKILL.md`, `.claude/skills-archived/`, `.claude/agents/*.md` as additional roots)
- SPEC.md §15 — M1 check (projection rebuild idempotence, `db doctor` drift detection)
- CLAUDE.md — Architecture Decision 2 (files remain the source of truth; SQLite is derived and rebuildable)

## Summary

Build the derived SQLite projection in `apps/server/src/projection/`: the schema from §9.1 backed by `better-sqlite3` at `<workspace>/.corpus/cache.db`, per-file incremental projectors, a full rebuild that reconstructs the database from files alone, and a `doctor` drift check cheap enough to run in pre-commit. Document roots are `<workspace>/data/` plus the Claude Code roots from §7 (`.claude/skills/**/SKILL.md` → `type: skill`, `.claude/skills-archived/**/SKILL.md` → archived skills, still indexed, `.claude/agents/*.md` → `type: agent-def`). Parsing goes exclusively through SERVER-001's core library; anchor `resolved_offset` comes from SERVER-002's resolver. Projection functions are synchronous so write paths can re-project before responding, which is what gives §9.1's read-your-write consistency.

## Acceptance Criteria

- [x] `openProjection(config)` opens/creates `.corpus/cache.db` with WAL, foreign keys on, and the §9.1 schema; the handle registers a disposer with SERVER-003's server.
- [x] Tables exist exactly as §9.1 lists them: `documents`, `threads`, `anchors`, `turns`, `events`, `seen`, `jobs`, `locks`, `links`, FTS5 `search`, `meta` — same names, same columns.
- [x] `projectDocument(db, absPath)` (incremental, single file, synchronous, transactional) and `removeDocument(db, absPath)` keep every derived table consistent for that document.
- [x] Skill and agent-definition roots are indexed per §7 with the right `type`, archived skills still indexed, and Claude Code's `name`/`description` frontmatter coexisting with Corpus's fields without validation failures.
- [x] `links` rows are extracted from `[[refs]]` in document bodies **and** in thread turn bodies.
- [x] `anchors.resolved_offset` is computed with SERVER-002's `resolveAnchor` against the current parent body and is `NULL` when the selector no longer resolves.
- [x] **Orphan look-alike decision** _(evaluator observation, SERVER-002 round 3, 2026-07-26)_: when reconciliation has orphaned an anchor (its frontmatter entry preserved for history), running full-ladder `resolveAnchor` on that preserved selector at projection time can fuzzy-match a similar sibling (the deleted *bread* bullet's selector resolves to the *milk* bullet) — so `resolved_offset` would be non-NULL and the UI would render the orphaned thread on the wrong text. Before implementing, resolve with the orchestrator whether orphaned-at-reconcile-time anchors should (a) project `resolved_offset = NULL` unconditionally (orphan state is sticky until a write re-attaches it), or (b) re-resolve exact-only (`resolveAnchorExact`), never fuzzy. Full-ladder fuzzy at render time contradicts the reconciler's byte-for-byte history guarantee.
- [x] FTS5 `search` covers document titles, document bodies, and turn bodies; a query returns the expected document with a snippet.
- [x] `rebuild(config, { into? })` builds a fresh database from files alone and atomically replaces `cache.db` (or writes to `into` for the pre-push temp-path check); running it twice produces identical content.
- [x] `doctor(config)` detects drift by (a) file counts vs. row counts per root and (b) per-file content-hash comparison, skipping hashing when size and mtime are unchanged; it returns a structured report and completes fast enough for pre-commit (target < 200 ms on a warm workspace of ~1000 documents).
- [x] Unit tests cover per-projector row shapes, rebuild idempotence, drift detection (each drift kind), and FTS behaviour.

## Sprint-003 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-003 Open Conflicts affecting this issue — implement exactly these; full reasoning in `issues/sprints/sprint-003.md`:

1. **Orphan look-alike: option (b), exact-only re-resolution.** `anchors.resolved_offset` is computed with `resolveAnchorExact` (rungs 1–2, never fuzzy) — NULL when exact resolution fails. Decisive argument: option (a) (sticky orphanhood) is unimplementable from files alone — orphanhood is a per-save report, not persisted state, and remembering it in SQLite would break rebuild-from-files. This also keeps projection O(cheap) across rebuilds (no bitap per orphan).
2. **`evt_*.json` is the only thing that counts as an event, everywhere.** Every `init`-produced workspace carries `.corpus/queue/<status>/.gitkeep`; a naive `readdir` count makes `doctor` permanently report `count_mismatch` on every real workspace.
3. **Merge order**: SERVER-004 harvests before SERVER-008 (both touch `app.ts` and the events mirror); SERVER-008's Depends-on gains SERVER-004.

## Technical Design

### Files to Create/Modify

- `apps/server/src/projection/schema.ts` — the DDL (exported as a string constant), `SCHEMA_VERSION`
- `apps/server/src/projection/db.ts` — `openProjection`, pragmas, schema bootstrap/version check, prepared-statement cache
- `apps/server/src/projection/roots.ts` — document root definitions, path→root classification, ignore rules, file enumeration
- `apps/server/src/projection/project-document.ts` — `projectDocument` / `removeDocument` (documents, threads, turns, anchors, links, search)
- `apps/server/src/projection/project-runtime.ts` — `events`, `jobs`, `locks`, `seen` projectors from `.corpus/`
- `apps/server/src/projection/rebuild.ts` — `rebuild`
- `apps/server/src/projection/doctor.ts` — `doctor`, drift kinds, hash bookkeeping
- `apps/server/src/projection/index.ts` — public surface consumed by write paths and route handlers
- `apps/server/src/projection/*.test.ts` — colocated Vitest suites
- `apps/server/package.json` — add `better-sqlite3` and `@types/better-sqlite3`

### Key Implementation Details

**Database handle.** `openProjection({ corpusDir, workspaceRoot })` opens `<corpusDir>/cache.db` and applies `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`. On open it reads `meta.schema_version`; if it is missing or differs from `SCHEMA_VERSION`, the database is **wiped and rebuilt** rather than migrated — the projection is derived and reconstructible, so schema evolution never needs migration code. That rule is a deliberate invariant: nothing durable may ever live only in SQLite.

**Schema (§9.1, verbatim column sets).**

```sql
documents(id TEXT PRIMARY KEY, type TEXT, title TEXT, path TEXT UNIQUE, status TEXT,
          tags_json TEXT, created TEXT, updated TEXT, due TEXT, reviewed TEXT,
          evergreen INTEGER, body_excerpt TEXT)
threads(id TEXT PRIMARY KEY, parent_id TEXT, status TEXT, agent TEXT, anchor_id TEXT,
        title TEXT, created TEXT, updated TEXT, turn_count INTEGER, last_author TEXT, last_ts TEXT)
anchors(doc_id TEXT, anchor_id TEXT, exact_text TEXT, prefix TEXT, suffix TEXT,
        resolved_offset INTEGER, PRIMARY KEY (doc_id, anchor_id))
turns(thread_id TEXT, idx INTEGER, author TEXT, ts TEXT, body_md TEXT, PRIMARY KEY (thread_id, ts))
events(id TEXT PRIMARY KEY, type TEXT, status TEXT, created TEXT, payload_json TEXT)
seen(thread_id TEXT PRIMARY KEY, last_seen_ts TEXT)
jobs(event_id TEXT PRIMARY KEY, status TEXT, started TEXT, updated TEXT, last_line TEXT)
locks(doc_id TEXT PRIMARY KEY, holder TEXT, acquired TEXT, ttl INTEGER)
links(from_id TEXT, to_id TEXT, PRIMARY KEY (from_id, to_id))
meta(key TEXT PRIMARY KEY, value TEXT)
CREATE VIRTUAL TABLE search USING fts5(
  ref UNINDEXED, kind UNINDEXED, doc_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2');
```

Indices: `documents(type)`, `documents(status)`, `documents(updated)`, `threads(parent_id)`, `turns(thread_id, idx)`, `links(to_id)`, `anchors(doc_id)`.

Plus one bookkeeping table this issue introduces for cheap drift detection (derived like everything else, not part of the queryable API surface):

```sql
file_hashes(path TEXT PRIMARY KEY, hash TEXT, size INTEGER, mtime_ms INTEGER)
```

`search` is a standalone (non-external-content) FTS5 table populated by the projectors — one row per document (`kind = 'doc'`, `ref = <doc id>`) and one per turn (`kind = 'turn'`, `ref = <threadId>#<ts>`, `doc_id = <threadId>`). Standalone beats external-content here because the indexed text spans two source tables; the cost is that projectors must delete matching `search` rows before reinserting, which they already do for the other per-document tables.

**Document roots (§7/§9.1).** `roots.ts` exports:

| root                                 | glob                    | type                                     | notes                                                            |
| ------------------------------------ | ----------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `<ws>/data/docs`                      | `**/*.md`               | from frontmatter                          | arbitrary nesting                                                 |
| `<ws>/data/threads`                   | `*.md`                  | `thread`                                  | flat                                                              |
| `<ws>/.claude/skills`                 | `**/SKILL.md`           | `skill`                                   |                                                                   |
| `<ws>/.claude/skills-archived`        | `**/SKILL.md`           | `skill`, status forced to `archived`      | still indexed (§7)                                                |
| `<ws>/.claude/agents`                 | `*.md`                  | `agent-def`                               |                                                                   |

`classifyPath(absPath)` returns the matching root or `null`; anything outside a root is ignored outright. Ignore rules: non-`.md` files, `node_modules`, dotfiles other than the configured `.claude`/`.corpus` roots. Enumeration uses `fs.readdirSync(..., { withFileTypes: true, recursive: true })` (Node ≥ 22) with symlink resolution: plugin skills may be symlinked into `.claude/skills` (§10), so resolve `realpath` and de-duplicate by real path so one file is never indexed twice.

**`projectDocument(db, absPath)`** — synchronous, wrapped in a single `db.transaction`:

1. Read the file, parse with SERVER-001's `parseDocument`. Determine `type` (root override wins for skills/agent-defs; otherwise frontmatter).
2. Delete all existing rows for this document across `documents`, `threads`, `turns`, `anchors`, `links`, `search` (keyed by id **and** by path, since an id may have changed under the same path), then insert fresh rows — delete-then-insert keeps the projector one code path instead of a diffing engine.
3. `documents`: `path` is the workspace-relative POSIX path; `tags_json` is `JSON.stringify(tags)`; `body_excerpt` is the first 280 characters of the body with frontmatter and markdown fences stripped of leading whitespace.
4. When `type === "thread"`: insert the `threads` row (`turn_count`, `last_author`, `last_ts` derived from the parsed turns) and one `turns` row per turn with `idx` in document order.
5. `anchors`: one row per entry in the document's `anchors` frontmatter; `resolved_offset` = `resolveAnchor(body, selector)?.start ?? null` (SERVER-002).
6. `links`: `extractRefs` over the body, and over every turn body for threads; `from_id` is the document id (turn-level refs still attribute to the thread — §9.1's `links` is document-to-document).
7. `search`: one doc row + one row per turn.
8. `file_hashes`: record `sha1(content)`, size, and mtime.

`removeDocument(db, absPath)` deletes by path across the same tables plus `file_hashes`.

**Runtime projectors (`project-runtime.ts`).** `events` from `.corpus/queue/<status>/*.json` (status derived from the containing directory); `jobs` from `.corpus/jobs/<eventId>.jsonl` (status joined from the event, `last_line` = the final line, full logs stay in the file and are tailed, never projected); `locks` from `.corpus/locks/<docId>.json`; `seen` from `.corpus/seen.json`. Each exposes both a whole-directory projector (used by `rebuild`) and a single-file projector (used by the watcher in SERVER-007).

**`rebuild(config, { into })`.** Create a brand-new database at `into ?? <corpusDir>/cache.db.rebuild-<pid>`, apply the schema, enumerate every root, project every file, project runtime state, write `meta.rebuilt_at` and `meta.schema_version`, close. When `into` is omitted, `fs.renameSync` it over `cache.db` (same filesystem, atomic) after closing the previous handle; when `into` is given, leave it in place — that is the mode pre-push uses to prove the projection is reconstructible from files alone (§14). Rebuild reports `{ documents, threads, turns, anchors, links, events, durationMs, skipped: [{path, reason}] }`.

**`doctor(config)`.** Two passes, ordered cheapest-first:

1. **Counts** — enumerate files per root and compare against `SELECT COUNT(*)` per root prefix; compare `.corpus/queue/**` file count against `events`.
2. **Hashes** — for each enumerated file, compare `size`/`mtime_ms` against `file_hashes`; only when they differ, hash the bytes and compare. Any mismatch is drift.

Returns `{ ok: boolean, drift: Drift[] }` with drift kinds `missing_row`, `orphan_row`, `content_mismatch`, `count_mismatch`, `unparseable`, `duplicate_id`. Exit-code mapping and CLI output formatting belong to the CLI issue; `doctor` and `rebuild` are exported as standalone functions taking a config (not a live server), so a pre-commit invocation can run them in-process against a workspace whose server is not running — they open the database read-only for `doctor` and never mutate it.

**Read-your-write.** Everything above is synchronous (`better-sqlite3` is a synchronous binding by design), so SERVER-005's write paths call `projectDocument` inline after writing and before responding, satisfying §9.1's "write endpoints that need read-your-write consistency re-project synchronously before responding". No projector may become `async`.

**Performance targets.** Full rebuild of ~2000 documents under 2 s; `doctor` on a warm workspace under 200 ms; a single-document incremental projection under 5 ms. Prepared statements are cached on the handle; the rebuild wraps all inserts in one transaction.

### Edge Cases

- **Unparseable frontmatter** — do not crash and do not partially insert: skip the file, record it in the rebuild report and as a `doctor` `unparseable` drift entry, and log a warning. A broken file must never take the server down.
- **Skill/agent files with no Corpus `id`** (hand-written `SKILL.md` with only Claude Code's `name`/`description`) — index them with a deterministic synthetic id derived from the workspace-relative path (`skill_<sha1(path).slice(0,8)>`, `agentdef_<…>`) so the id is stable across rebuilds. Stamping a real id into the file is a write and therefore SERVER-005's business, never the projection's. Title falls back to Claude Code's `name`, then to the folder/file name.
- **Duplicate ids across two files** — insert the first by path order, record `duplicate_id` drift for the rest; `doc check` (SERVER-001) is the surface that turns this into a hard failure.
- **File deleted between enumeration and read** (`ENOENT`) — treat as a removal, not an error.
- **Symlinked plugin skills** — resolve real paths and de-duplicate.
- **FTS5 unavailable** in the installed `better-sqlite3` build — fail fast at open with an explicit message naming the missing module rather than degrading silently.
- **Concurrent access**: only the server process opens the database read-write. `doctor` opens read-only, and WAL makes that safe while the server runs. Never assume the CLI has direct database access — it is a thin HTTP client (Decision 2).
- **A rebuild interrupted mid-way** leaves the temp file behind, never a half-written `cache.db` (the rename is the commit point); stale `*.rebuild-*` files are cleaned at the next rebuild.
- **Empty workspace** (no documents at all) — rebuild produces an empty but valid database; `doctor` reports `ok`.
- **Very large document** (multi-MB body) — `body_excerpt` truncation and FTS insertion must not blow memory; stream-free is fine at v1 scale, but assert behaviour with a 5 MB fixture.
- **`.corpus/seen.json` missing or malformed** — project an empty `seen` table with a warning; runtime state is not the corpus.

## Testing Strategy

Vitest, colocated `*.test.ts`, against **real** SQLite files in temp workspaces (`mktemp`-style temp dirs) — never an in-memory stand-in for the projection's own behaviour, since WAL/rename semantics are part of what is under test.

- **Schema**: assert every §9.1 table and column exists (`PRAGMA table_info`), and that opening with a bumped `SCHEMA_VERSION` wipes and rebuilds.
- **Per-projector row shapes**: a fixture document, a fixture thread with three turns, a document with two anchors (one resolvable, one not) — assert exact row contents including `resolved_offset` NULL for the orphan.
- **Links**: refs in a document body and in a turn body both produce rows; refs in code fences do not.
- **FTS**: query by a word appearing only in a body, only in a title, and only in a turn; assert `snippet()` output is non-empty.
- **Rebuild idempotence** (§15 M1): rebuild twice into two temp paths, dump both with `.dump`-equivalent queries ordered deterministically, assert equality.
- **Doctor** (§15 M1): clean workspace → `ok`; then (a) modify a file's content → `content_mismatch`; (b) add a file without projecting → `missing_row`; (c) delete a file without projecting → `orphan_row`; assert each drift kind independently, and assert the hash pass is skipped when size+mtime are unchanged (spy on the hash function or count reads).
- **Roots**: fixtures under all five roots; assert types, that archived skills are indexed with `status: archived`, and that a symlinked skill is indexed once.
- **Performance smoke**: generate 1000 fixture documents, assert rebuild and doctor stay inside the stated targets (generous margins so the test is not flaky in CI).

## E2E Verification Plan

### Reproduction Steps (bugs only)

N/A — this is a feature, not a bug.

### Verification Steps

1. Create a real workspace (`mktemp -d`, `git init`, `.corpus/config.json` as in SERVER-003) and populate it with real content: several documents under `data/docs/` (nested folders), two threads under `data/threads/` with multiple turns and `[[refs]]`, a document with an `anchors:` block containing one resolvable and one non-resolvable selector, plus a real copy of one of this repo's `.claude/skills/*/SKILL.md` and one `.claude/agents/*.md`.
2. Run a real rebuild: `CORPUS_WORKSPACE=<ws> npx tsx -e "import {rebuild} from './apps/server/src/projection/index.js'; console.log(await rebuild(...))"` (or the equivalent script). Expected: a report with the right counts and `.corpus/cache.db` on disk.
3. Inspect the **real** database with the `sqlite3` CLI: `sqlite3 <ws>/.corpus/cache.db "select id,type,path from documents"` — expected: every document present, the skill row typed `skill`, the agent row typed `agent-def`, the archived skill present with `status='archived'`.
4. `sqlite3 … "select doc_id,anchor_id,resolved_offset from anchors"` — expected: the resolvable anchor has an integer offset that, when used to slice the real file's body, yields the quoted text; the non-resolvable one is `NULL`.
5. `sqlite3 … "select * from links"` — expected: rows for refs written in a document body and for refs written inside a turn body.
6. `sqlite3 … "select ref, snippet(search,4,'[',']','…',8) from search where search match 'mortgage'"` (using a word actually present in the fixtures) — expected: hits for the document and for the turn that mentions it.
7. Rebuild a second time into a temp path (`into`), then diff the two databases' logical contents (`sqlite3 … "select * from documents order by id"` on both, `diff` the outputs). Expected: identical — rebuild is idempotent (§15 M1).
8. Drift check: run `doctor` → expected `ok`. Then edit a document with a real editor/`printf >>`, re-run `doctor` → expected `content_mismatch` naming that path. Re-project that single file and re-run → `ok`. Delete a file with `rm`, re-run → `orphan_row`. Time each run (`time`) and record the numbers.
9. Read-your-write sanity: from a single `tsx` script, write a new markdown file, call `projectDocument` synchronously, then immediately `SELECT` it — expected: the row is visible in the same tick, no polling.

## Implementation Notes — deviations from the Technical Design

Three places where the implementation departs from this file's Technical Design, each deliberate and each recorded so the next reader inherits the reasoning rather than re-deriving it.

1. **Synthetic ids are `doc_`-prefixed, not `skill_` / `agentdef_`.** The design pins `skill_<sha1(path).slice(0,8)>` and `agentdef_<…>`, but neither satisfies the contract's `DocumentIdSchema` (`^(doc|th)_[A-Za-z0-9]+$`) — a row carrying one would fail response validation the moment SERVER-011's collection query returned it. The readable kind is kept inside the id instead: `doc_skill61c2325d`, `doc_agentdef9aac2cc9`. Everything the AC actually depends on is unchanged — path-derived, deterministic, identical across rebuilds and the incremental path, and never written back into the file. `documents.type` remains the real discriminator.

2. **`count_mismatch` is the queue mirror's check only.** The design describes a per-root file-count-vs-row-count pass. For document roots that pass is strictly weaker than what `doctor` already does: it compares the enumerated path set against `SELECT id, path FROM documents` (one query, no file reads), which localizes every disagreement as `missing_row` / `orphan_row` / `duplicate_id` / `unparseable` and therefore subsumes counting. Emitting a bare `count_mismatch` alongside those would be pure noise on every real drift. `events` has no per-file bookkeeping table, so it is the one surface where a count is the only available mechanism — and it counts `evt_*.json` exclusively (Sprint-003 Adjudication 2).

3. **The disposer is registered from `lifecycle.ts`, not from `app.ts`.** `createServer` is documented as a pure function of its config — it reads no environment and touches no filesystem — and `app.ts` already declares `registerDisposer` as the seam later subsystems attach *through*. `attachProjection(server)` therefore runs in `runServerProcess`, before the socket binds, and is injectable as `attachProjectionFn` for lifecycle tests driving a stand-in server. Side benefit for the sprint: it removes SERVER-004 from `app.ts` entirely, so SERVER-008's queue mount lands with no conflict there.

Two shapes this issue pins that nothing else had yet defined, flagged for the issues that will write them: `.corpus/seen.json` is a **flat map** of thread id → ISO instant (`{"th_x9y8": "2026-07-04T10:00:00Z"}`), and `jobs.status` is **joined from the `events` mirror** (NULL when no event row exists), never read from the log file.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients, no in-memory databases. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

**implemented on: opus** (worktree `.claude/worktrees/server-004`, branch `wt-server-004`).

**Environment.** Port `8775` (checked free with `lsof -nP -iTCP:8775 -sTCP:LISTEN` before binding; never `pkill`). Scratch workspaces `mktemp -d /tmp/corpus-s004-XXXXXX`. Node v25.2.1, `sqlite3` 3.43.2 (system CLI), better-sqlite3 12.4.1 (SQLite 3.53.2, fts5 present). Every database below is a real file on disk, inspected from a **separate process** with the `sqlite3` CLI — no in-memory database anywhere in this log.

### Reproduction (bugs only)

N/A — this is a feature, not a bug.

### Post-Implementation Verification

**Workspace built by hand** (`corpus init` is being implemented in a parallel worktree, so the tree was assembled from `docs/workspace-template.md`'s documented shape): `git init`, `.corpus/config.json` mode 600 with port 8775, the five `.corpus/queue/<status>/` directories each holding a `.gitkeep`, `.corpus/{locks,jobs}/`, `data/docs/{finance,inbox,views}/`, `data/threads/`, `.claude/{skills,skills-archived,agents}/`. Content: a note with two anchors (one resolvable, one not), a grocery note whose anchor was orphaned through the real reconciliation path, a thread with three turns and `[[refs]]`, the repo's real `assets/workspace/claude/skills/comment/SKILL.md` and the three real seed view documents, an archived skill, a hand-written `.claude/agents/researcher.md` carrying only Claude Code's `name`/`description`, a **symlinked** plugin skill (`.claude/skills/todos -> plugins/todos`), an unparseable `broken.md`, plus decoys (`notes.txt`, `.hidden.md`, `node_modules/pkg/README.md`, root `README.md`), one `evt_*.json`, one lock, one job log, one `seen.json`.

**1. Real rebuild** — `tsx` calling `rebuild()` against the real workspace:

```
{ "documents": 10, "threads": 1, "turns": 3, "anchors": 3, "links": 2,
  "events": 1, "jobs": 1, "locks": 1, "seen": 1, "durationMs": 14,
  "skipped": [{ "path": "data/docs/broken.md",
                "reason": "data/docs/broken.md:4: invalid YAML frontmatter: Flow sequence in block collection …" }],
  "path": "/tmp/corpus-s004-RmpjWk/.corpus/cache.db" }
```

PASS — counts match the fixtures, the unparseable file is named in `skipped`, nothing partial was inserted for it, the process did not exit.

**2. Real database, `sqlite3` CLI.** `sqlite3 …/.corpus/cache.db ".tables"` →
`anchors documents events file_hashes jobs links locks meta search search_config search_content search_data search_docsize search_idx seen threads turns`
(the `search_*` entries are FTS5's own shadow tables; every §9.1 table plus `file_hashes` is present).

`select id,type,status,path from documents order by path`:

```
doc_agentdef9aac2cc9  agent-def  open      .claude/agents/researcher.md
doc_skilllegacy       skill      archived  .claude/skills-archived/legacy/SKILL.md
doc_skillcomment      skill      open      .claude/skills/comment/SKILL.md
doc_skill61c2325d     skill      open      .claude/skills/todos/SKILL.md
doc_a1b2c3            note       open      data/docs/finance/mortgage.md
doc_grocery1          note       open      data/docs/inbox/groceries.md
doc_seedattention     view       open      data/docs/views/attention.md
doc_seedinbox         view       open      data/docs/views/inbox.md
doc_seedopenthreads   view       open      data/docs/views/open-threads.md
th_x9y8               thread     open      data/threads/th_x9y8.md
```

PASS — all five roots typed correctly, the archived skill forced to `status='archived'`, every path workspace-relative and POSIX. `select count(*) from documents where type='skill'` → `3`: the symlinked `todos` skill is indexed **once**, under its link path. `notes.txt`, `.hidden.md`, `node_modules/…`, and the root `README.md` are absent.

**3. Anchors — the orphan look-alike guarantee.** `select doc_id,anchor_id,resolved_offset,exact_text from anchors`:

```
doc_a1b2c3    anc_gone   (null)  a clause that was deleted long ago
doc_a1b2c3    anc_k4f7   8       assume a 30-year fixed at 6.1%
doc_grocery1  anc_bread  (null)  - bread from the corner bakery
```

A script re-read the real files, sliced each body at the stored offset and compared:

```
anc_gone: NULL (orphaned)
anc_k4f7: offset=8 slice="assume a 30-year fixed at 6.1%" matches=true
anc_bread: NULL (orphaned)
milk bullet offset in groceries body = 13
```

PASS — the live anchor's offset slices back to its `exact` byte for byte; the orphaned *bread* bullet is `NULL` and specifically **not** `13`, the offset of the *milk* bullet. Sprint-003 Adjudication 1 (exact-only, `resolveAnchorExact`, fuzzy never) holds at projection time.

**4. Links.** `select * from links`:

```
doc_a1b2c3  th_x9y8      (from the note's body)
th_x9y8     doc_a1b2c3   (from a turn body, attributed to the thread)
```

PASS — `[[doc_fenced]]` inside a code fence produced no row.

**5. FTS5.** `select ref,kind,doc_id,snippet(search,4,'[',']','…',8) from search where search match 'mortgage'`:

```
doc_a1b2c3|doc|doc_a1b2c3|Let us assume a 30-year fixed at…
th_x9y8#2026-07-03T09:00:00Z|turn|th_x9y8|Is the [mortgage] rate in [[doc_a1b2c3]] still…
```

PASS — a title-only hit (`Mortgage options`) and a turn-body hit, both with non-empty snippets, `ref` = `<threadId>#<ts>` for the turn. Diacritic folding: a note containing `café` is returned by `search match 'cafe'` → `doc_cafe01|doc`, so the declared `unicode61 remove_diacritics 2` tokenizer is the one in effect.

**6. Rebuild idempotence (§15 M1).** Two rebuilds into two temp paths, then every table dumped with a deterministic `order by` and `diff`ed:

```
documents: identical   threads: identical   anchors: identical   turns: identical
events: identical      seen: identical      jobs: identical      locks: identical
links: identical       file_hashes: identical   search: identical   meta: identical
idempotence-fail=0
```

PASS. `meta` was compared excluding `rebuilt_at`, which is the one value that is supposed to differ (`schema_version|1`, `rebuilt_at|2026-07-27T01:57:30.399Z`).

**7. The projection never writes to the corpus.** `stat -f '%m %z %N'` and `md5 -q` over every `.md` under `data/` and `.claude/`, before and after two full rebuilds: both diffs empty ("mtimes+sizes: IDENTICAL", "content hashes: IDENTICAL"). The hand-written agent-def and the symlinked skill kept the same synthetic ids across both runs (`doc_agentdef9aac2cc9`, `doc_skill61c2325d`).

**8. Doctor drift detection**, each kind independently, with `time`:

| step | result |
| --- | --- |
| clean workspace | `{"ok": true, "drift": []}`, `stats: {files: 10, documents: 10, hashed: 0, parsed: 0, durationMs: 4}` — **and no `count_mismatch` from the five `.gitkeep` files** (Sprint-003 Adjudication 2) |
| `printf >>` a document | `content_mismatch` naming `data/docs/finance/mortgage.md`, `hashed: 1` |
| re-project that one file | back to `ok` |
| add a `.md` without projecting | `missing_row` naming `data/docs/new.md`, `parsed: 1` |
| `rm` a projected file | `orphan_row`: "data/docs/inbox/cafe.md is projected as doc_cafe01 but no such file exists under any root" |
| add an unparseable file | `unparseable` with the parser's line-and-column message |
| add a second file claiming an existing id | `duplicate_id`: "data/docs/inbox/mortgage-copy.md claims id doc_a1b2c3, already projected from data/docs/finance/mortgage.md" |
| drop an `evt_*.json` into `in-progress/` without projecting | `count_mismatch`: ".corpus/queue holds 2 evt_\*.json file(s) but the projection has 1 event row(s)" |
| undo each | `{"ok": true, "drift": []}` |

The hash pass skipped every file on the clean runs (`hashed: 0`) and hashed exactly the one changed file otherwise. `doctor` left `cache.db` untouched (asserted on size and mtime in `doctor.test.ts`; it opens `readonly: true`).

**9. Real server process, port 8775.**

```
$ CORPUS_WORKSPACE=$WS CORPUS_LOG_LEVEL=debug tsx apps/server/src/main.ts &
{"level":"debug","msg":"projection ready","path":"/tmp/corpus-s004-RmpjWk/.corpus/cache.db","durationMs":18}
{"level":"info","msg":"listening on http://127.0.0.1:8775",…,"workspace":"/tmp/corpus-s004-RmpjWk"}
$ curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8775/api/health   → 200
$ ls -la $WS/.corpus | grep cache
cache.db (4096)  cache.db-shm (32768)  cache.db-wal (395552)
$ sqlite3 $WS/.corpus/cache.db "select count(*) from documents; select count(*) from events;"
10
1
```

The projection is opened and populated **before the socket binds** (a projection that cannot be built is a boot failure), and `sqlite3` reads the running server's WAL database from another process. `doctor` run while the server was up: `{"ok": true, drift: []}` over 10 files in 4 ms, neither blocking nor blocked; `/api/health` still `200` afterwards.

Graceful shutdown:

```
$ kill -TERM <pid>
{"level":"info","msg":"shutting down","signal":"SIGTERM"}
{"level":"info","msg":"shutdown complete","signal":"SIGTERM"}
server exit code = 0
$ ls -la $WS/.corpus | grep cache      → cache.db (147456) only; -wal and -shm gone
$ sqlite3 $WS/.corpus/cache.db "pragma integrity_check; select count(*) from documents;"
ok
10
```

PASS — the disposer closed the handle, the WAL was checkpointed away, and reopening needs no recovery pass.

**10. Read-your-write, in one tick.** A single `tsx` script wrote a new markdown file, called `projectDocument`, then `SELECT`ed — with no `await`, no timer, no polling:

```
projectDocument returned: {"kind":"projected","path":"data/docs/inbox/read-your-write.md","id":"doc_ryw001",…}
SELECT in the same tick: {"id":"doc_ryw001","title":"Read your write","path":"data/docs/inbox/read-your-write.md"}
row visible before any microtask: true
$ sqlite3 .corpus/cache.db "select id,path from documents where id='doc_ryw001'"
doc_ryw001|data/docs/inbox/read-your-write.md
```

PASS. No projection function is `async` (asserted in `index.test.ts`).

**11. A schema-version change wipes rather than migrates.** With the projection closed, `sqlite3` stamped `schema_version=0` and created a `legacy_leftover` table. Reopening (what a boot does):

```
documents after reopen: 11
$ sqlite3 .corpus/cache.db "select * from meta; select count(*) from sqlite_master where name='legacy_leftover'; select count(*) from documents"
schema_version|1
0
11
```

PASS — the database was dropped and rebuilt from files; the foreign table is gone; every row reconstructed. There is no migration code path.

**12. An interrupted rebuild never half-writes `cache.db`.** On a 2201-document workspace, a rebuild was `kill -TERM`ed mid-flight:

```
rebuild exit=143
$ sqlite3 .corpus/cache.db "pragma integrity_check; select count(*) from documents"
ok
2201
$ ls .corpus | grep rebuild-
cache.db.rebuild-38543  cache.db.rebuild-38543-shm  cache.db.rebuild-38543-wal
$ <next rebuild>   → "documents": 2201, "path": ".../cache.db";  no leftovers remain
```

PASS — the rename is the commit point; the previous database stayed valid and the next rebuild cleaned the temp files.

**13. Performance, real measurements on this machine** (`time`, generated workspaces):

| operation | measured | target |
| --- | --- | --- |
| cold `rebuild` of 2200 documents (2000 notes with anchors + 200 threads + 2200 refs) | **448 ms** internal, 0.737 s wall including tsx startup | < 2 s |
| warm `doctor` over 2200 files | **58 ms** internal (`hashed: 0`) | — |
| warm `doctor` over 1000 files | **31 ms** internal, 0.327 s wall including tsx startup | < 200 ms |
| single-document incremental projection into a 2201-document database, 20 samples | **min 0.241 ms, median 0.427 ms, max 0.530 ms** | < 5 ms |

PASS on all four.

**14. Gates.** `npm run build` ✅ · `npm run lint` ✅ (0 errors, 0 warnings) · `npm run format:check` ✅ · `npm run typecheck` ✅ (all four workspaces) · `npm test` **1834 passed / 1834**, of which 126 are this issue's. Coverage: **99.32 % lines, 95.89 % branches, 100 % functions** repo-wide (gate 90 %); `apps/server/src/projection` at 98.05 % lines / 94.01 % branches.

**Verified by unit test rather than by hand E2E** (recorded here so the omission is deliberate, not silent): the 5 MB-body document (`project-document.test.ts` — excerpt stays 280 chars, FTS row queryable), the `ENOENT`-between-enumeration-and-read race, the FTS5-missing open failure (`assertFts5Available` against a stub that throws — no real fts5-less build exists on this machine), and the empty-workspace rebuild.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-004]` prefix
