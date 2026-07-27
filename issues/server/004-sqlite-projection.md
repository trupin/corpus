# [SERVER-004] SQLite projection: schema, projectors, FTS, rebuild/doctor

## Domain

server

## Status

in_progress

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

- [ ] `openProjection(config)` opens/creates `.corpus/cache.db` with WAL, foreign keys on, and the §9.1 schema; the handle registers a disposer with SERVER-003's server.
- [ ] Tables exist exactly as §9.1 lists them: `documents`, `threads`, `anchors`, `turns`, `events`, `seen`, `jobs`, `locks`, `links`, FTS5 `search`, `meta` — same names, same columns.
- [ ] `projectDocument(db, absPath)` (incremental, single file, synchronous, transactional) and `removeDocument(db, absPath)` keep every derived table consistent for that document.
- [ ] Skill and agent-definition roots are indexed per §7 with the right `type`, archived skills still indexed, and Claude Code's `name`/`description` frontmatter coexisting with Corpus's fields without validation failures.
- [ ] `links` rows are extracted from `[[refs]]` in document bodies **and** in thread turn bodies.
- [ ] `anchors.resolved_offset` is computed with SERVER-002's `resolveAnchor` against the current parent body and is `NULL` when the selector no longer resolves.
- [ ] **Orphan look-alike decision** _(evaluator observation, SERVER-002 round 3, 2026-07-26)_: when reconciliation has orphaned an anchor (its frontmatter entry preserved for history), running full-ladder `resolveAnchor` on that preserved selector at projection time can fuzzy-match a similar sibling (the deleted *bread* bullet's selector resolves to the *milk* bullet) — so `resolved_offset` would be non-NULL and the UI would render the orphaned thread on the wrong text. Before implementing, resolve with the orchestrator whether orphaned-at-reconcile-time anchors should (a) project `resolved_offset = NULL` unconditionally (orphan state is sticky until a write re-attaches it), or (b) re-resolve exact-only (`resolveAnchorExact`), never fuzzy. Full-ladder fuzzy at render time contradicts the reconciler's byte-for-byte history guarantee.
- [ ] FTS5 `search` covers document titles, document bodies, and turn bodies; a query returns the expected document with a snippet.
- [ ] `rebuild(config, { into? })` builds a fresh database from files alone and atomically replaces `cache.db` (or writes to `into` for the pre-push temp-path check); running it twice produces identical content.
- [ ] `doctor(config)` detects drift by (a) file counts vs. row counts per root and (b) per-file content-hash comparison, skipping hashing when size and mtime are unchanged; it returns a structured report and completes fast enough for pre-commit (target < 200 ms on a warm workspace of ~1000 documents).
- [ ] Unit tests cover per-projector row shapes, rebuild idempotence, drift detection (each drift kind), and FTS behaviour.

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

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients, no in-memory databases. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

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

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-004]` prefix
