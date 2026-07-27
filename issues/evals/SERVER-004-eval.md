# Evaluation: SERVER-004

**Date**: 2026-07-27
**Sprint**: sprint-003 (TEST-1 … TEST-37, plus cross-issue TEST-80/81)
**Verdict**: PASS

Evaluator environment: ports `8840`–`8858` (8765 left free throughout, verified before and
after), scratch prefixes `/tmp/eval-s3-*`, all servers started and stopped by the real CLI or
by pid. Node v25.2.1, system `sqlite3` 3.43.2. The real built binary
(`apps/cli/dist/bin/corpus.js`) on PATH; every database below is a real file on disk read
from a **separate process** with the `sqlite3` CLI.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | 14 numbered sections plus a Gates table and an explicit "verified by unit test rather than by hand E2E" disclosure.                                                 |
| Commands are specific and concrete      | PASS   | Exact `sqlite3` invocations, exact `PRAGMA`/`select` text, exact report JSON, exit codes, `time` numbers.                                                           |
| Real E2E (not mocked)                   | PASS   | Real `.md` files, real `.corpus/cache.db`, real `sqlite3` CLI from another process, real server process on 8775 with `kill -TERM`. No in-memory database anywhere. |
| Scenarios cover acceptance criteria     | PASS   | Every AC has a corresponding section; the four unit-test-substituted cases are named rather than omitted.                                                           |
| Application restarted after changes     | PASS   | §9 shows a fresh server boot, live `sqlite3` read of the WAL database, then `kill -TERM` and a post-shutdown integrity check.                                       |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (worktree `.claude/worktrees/server-004`, branch `wt-server-004`)".                                                                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                                     |

**Log vs. observation.** I re-derived the log's headline numbers independently and they hold.
Rebuild of a generated 2206-document workspace: log claims 448 ms, I measured **490 ms**
(target < 2 s). Warm `doctor` over 2206 files: log claims 58 ms, I measured **54 ms**. Single
incremental projection into a 2206-document database, 20 samples: log claims
min 0.241 / median 0.427 / max 0.530 ms, I measured **min 0.505 / median 0.540 / max 0.656 ms**
— same order of magnitude, comfortably inside the 5 ms target. No claim in the log was
contradicted by observation.

## Criteria Results

| #   | Criterion                                            | Result       | Notes                                                                                                                                                                                          |
| --- | ---------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Schema is §9.1's tables verbatim                     | PASS         | `.tables` → the ten §9.1 tables + `meta` + `file_hashes` (+ FTS5 shadow tables). Every column name matches §9.1's spelling exactly; no renamed or extra column on any §9.1 table.                |
| 2   | Handle pragmas                                       | PASS         | Read off the projection's own `better-sqlite3` handle: `journal_mode=wal`, `foreign_keys=1`, `busy_timeout=5000` (`synchronous=1`).                                                             |
| 3   | Schema-version change wipes rather than migrates     | PASS         | Stamped `schema_version=0` + created `legacy_leftover` out of band; reopen → `schema_version=1`, `legacy_leftover` gone, 19 documents / 4 anchors / 3 turns all reconstructed from files.        |
| 4   | Handle closes with the server                        | PASS         | `corpus server stop` → exit 0, process gone, `cache.db-wal`/`-shm` gone, `pragma integrity_check` → `ok`, 6 documents readable with no recovery pass.                                            |
| 5   | Build without FTS5 fails loudly                      | NOT RUN      | No fts5-less `better-sqlite3` build exists on this machine. The log discloses this explicitly and substitutes a unit test against a throwing stub. Recorded, not silently omitted.               |
| 6   | All five roots indexed with the right type           | PASS         | `agent-def`, `skill` (×3 live), `skill`/`archived`, `note`, `thread`, `view`, `template`. Every `path` workspace-relative and POSIX-separated.                                                  |
| 7   | Claude Code frontmatter coexists with Corpus's       | PASS         | `mixed/SKILL.md` carrying both `name`/`description` and `id`/`type`/`title` indexed cleanly; `title` is Corpus's ("Mixed Corpus Title"), not `name`.                                            |
| 8   | Synthetic id stable; file never rewritten            | PASS         | `.claude/skills/notes/SKILL.md` → `doc_skill402c7950` and `researcher.md` → `doc_agentdef9aac2cc9`, identical across three rebuilds; `title` falls back to `name`; mtime, size and md5 unchanged. |
| 9   | Symlinked plugin skill indexed exactly once          | PASS         | `.claude/skills/todos` → `/tmp/eval-s3-extskill`; one row, path `.claude/skills/todos/SKILL.md`.                                                                                                |
| 10  | Everything outside a root is ignored                 | PASS         | `data/docs/notes.txt`, `data/docs/.hidden.md`, `node_modules/pkg/README.md`, root `README.md` — none present in `documents`.                                                                    |
| 11  | Document row carries the §9.1 shape                  | PASS         | `tags_json` = `["finance","urgent"]`; `body_excerpt` length exactly 280 and begins at the body (no frontmatter); `created`/`updated`/`due`/`reviewed`/`evergreen` all match the frontmatter.     |
| 12  | Thread row + turns in document order                 | PASS         | `turn_count=3`, `last_author=user`, `last_ts=2026-07-03T09:10:00Z`, `parent_id`/`anchor_id`/`agent`/`status` from frontmatter; turns `idx` 0,1,2 with matching author/ts/body.                  |
| 13  | Links from bodies and turn bodies, never from fences | PASS         | `doc_a1b2c3→th_x9y8` (body) and `th_x9y8→doc_a1b2c3` (turn body, attributed to the thread). `[[doc_never]]` inside a fence produced no row.                                                     |
| 14  | Removal and re-identification leave no stale rows    | PASS         | See note below.                                                                                                                                                                                |
| 15  | Unparseable frontmatter skipped, reported, non-fatal | PASS         | Rebuild completed, all valid documents indexed, `broken.md` in `skipped` with a line/column reason, no partial rows, process alive.                                                             |
| 16  | Duplicate ids resolve deterministically              | PASS         | Row kept is `data/docs/aaa-copy.md` (first in sorted path order) on **both** runs; the other reported as `duplicate_id` drift naming both paths.                                                |
| 17  | Live anchor's offset slices to its quoted text       | PASS         | `anc_k4f7` offset 7; `body[7:37]` == `assume a 30-year fixed at 6.1%`.                                                                                                                          |
| 18  | Selector with no counterpart projects NULL           | PASS         | `anc_gone` → NULL.                                                                                                                                                                             |
| 19  | Orphaned bread bullet never lands on the milk bullet | PASS         | `anc_bread` → **NULL**. The milk bullet sits at offset **12** in that body; the anchor is not 12. The SERVER-002 round-3 misattachment does not reappear at projection time.                    |
| 20  | Fuzzy similarity produces no offset at projection    | PASS         | `6.1%` selector against an out-of-band `6.4%` body → NULL. Exactness tier only.                                                                                                                 |
| 21  | Rebuild and incremental agree byte for byte          | PASS         | 21 files projected one at a time into a separate database vs. a full `rebuild`; `select doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset … order by` dumps `diff` clean.          |
| 22  | Recorded orphan rule honoured on verbatim restore    | PASS         | Bread bullet restored verbatim → offset **12** on the incremental path and **12** on a full rebuild; slice matches `exact`. Matches Adjudication 1 (exact-only re-resolution).                  |
| 23  | FTS finds by title, by body, and by turn             | PASS         | `zorblatt` in a title only → `doc_titleonly`/`doc`; in a body only → `doc_bodyonly`/`doc`; `mortgage` in a turn → `th_x9y8#2026-07-03T09:00:00Z`/`turn`/`doc_id=th_x9y8`. All snippets non-empty. |
| 24  | Tokenizer is the one the schema declares             | PASS         | DDL carries `tokenize = 'unicode61 remove_diacritics 2'`; `match 'cafe'` returns the `café` document.                                                                                           |
| 25  | Rebuild is idempotent (§15 M1)                       | PASS         | Two rebuilds into two temp paths; all twelve tables dumped with deterministic ordering (253 lines) → `diff` identical. Only `meta.rebuilt_at` differs.                                          |
| 26  | Atomic replace + cleanup                             | PASS         | Clean rebuild leaves no `*.rebuild-*`. A rebuild `kill -TERM`ed mid-flight (exit 143) left `cache.db` valid (`integrity_check ok`, 2206 documents, unchanged) with the temp files behind; the next rebuild removed them. |
| 27  | Rebuild reports what it did                          | PASS         | `{documents, threads, turns, anchors, links, events, durationMs, skipped}` all present and each count equals the corresponding `select count(*)`; `skipped` names the unparseable file with a reason. |
| 28  | Empty workspace rebuilds to a valid empty database   | PASS         | Zero-count report, full schema present, `doctor` → `{"ok":true,"drift":[]}`.                                                                                                                    |
| 29  | Clean workspace reports `ok`, doctor doesn't write   | PASS         | `{"ok":true,"drift":[]}`; `cache.db` size and mtime byte-identical across two runs.                                                                                                            |
| 30  | Each drift kind detected independently               | PASS         | `content_mismatch` / `missing_row` / `orphan_row` / `unparseable` / `duplicate_id` each produced in isolation with the offending path named, and each returned to `ok` after undoing it.        |
| 31  | Queue count check compares events, not files         | PASS         | Workspace with 5 `.gitkeep` + **56** `evt_*.json` spread across all five statuses → `{"ok":true,"drift":[]}`. No `count_mismatch` from `.gitkeep` (Adjudication 2).                              |
| 32  | Hash pass skipped when size and mtime unchanged      | PASS         | Repeat runs report `hashed: 0`. A bare `touch` (mtime bumped, content identical) → `hashed: 1`, then reported clean.                                                                            |
| 33  | Doctor/rebuild with and without a running server     | PASS         | Verdicts identical (`ok:true, drift:[]`) with 8842 idle and with a real server on it; `/api/health` → 200 after both `doctor` and a live `rebuild`. Neither blocked.                            |
| 34  | Performance inside stated targets                    | PASS         | rebuild 2206 docs = **490 ms** (< 2 s); warm doctor 2206 files = **54 ms** (< 200 ms); incremental min/median/max = **0.505 / 0.540 / 0.656 ms** (< 5 ms).                                       |
| 35  | Multi-megabyte document                              | PASS         | 5 243 108-byte body projected in 67 ms, RSS 186 MB; `body_excerpt` exactly 280; FTS row queryable (`behemoth` → `doc_huge01`).                                                                  |
| 36  | Read-your-write is synchronous                       | PASS         | Write → `projectDocument` → `SELECT` in one tick with no `await` and no timer; row present, and a `queueMicrotask` callback had **not** yet run. Zero `AsyncFunction` exports from the module.   |
| 37  | Vanishing file is a removal, not a crash             | PASS         | 141 files deleted mid-rebuild; rebuild exit **0**, no throw, each recorded in `skipped` as "file disappeared during the rebuild", none present in `documents`. A settled rebuild returns `doctor` to `ok`. |
| 80  | Init-produced workspace projects the template docs   | PASS         | Exactly `template` ×1, `view` ×3, `skill` ×2 and nothing else. `README.md`, `.gitignore` and every `.gitkeep` absent. All six seed rows carry `evergreen = 1`.                                   |
| 81  | `rebuild && doctor` clean on a real workspace        | PASS         | After the TEST-79 queue round-trip, with the server running: rebuild → doctor `{"ok":true,"drift":[]}`; out-of-band edit → `content_mismatch` naming the path; re-project → `ok`. Server healthy throughout. |

## Notes on individual criteria

### TEST-14 — one surviving `links` row, and why it is correct

After `removeDocument` on `data/docs/finance/mortgage.md` (`doc_a1b2c3`), every row for that
document is gone from `documents`, `anchors`, `search` and `file_hashes`, and re-writing a
fresh file at the same path with `id: doc_bbb` leaves exactly one `documents` row for the
path, with `doc_a1b2c3` gone everywhere.

One row survives that a literal reading of the criterion ("no row referencing `doc_aaa` …
survives in … `links`") would flag: `links(th_x9y8 → doc_a1b2c3)`. It is **not** the removed
document's row — it is owned by `th_x9y8`, whose body still contains `[[doc_a1b2c3]]` (I
confirmed the ref is still in the file). I verified that a full `rebuild` **from files alone**
recreates exactly that row, so deleting it would break TEST-21's rebuild/incremental
agreement, and SPEC §5 states outright that "an unresolved ref renders visibly broken and is a
`doc check` warning, not a failure". Removing it would be the defect. Recorded as PASS with
the criterion's wording noted as over-broad on that one clause.

### TEST-5 — not executed

Constructing a `better-sqlite3` build without the `fts5` module is not possible on this
machine. The implementing agent disclosed this in the log and substituted a unit test driving
`assertFts5Available` against a stub that throws. I could neither confirm nor refute the
runtime behaviour; the disclosure is honest and the sprint's rule is that a non-executable
test is *recorded*, not silently omitted, which it was.

### TEST-68's default-port-probe leg (Open Conflict 12) — not executable as written

The conflict recommends testing the probe "by holding 8790 with a listener and asserting the
probe steps to 8791". The probe's start is fixed at 8765 and is not configurable, so holding
8790 exercises nothing unless 8765–8789 are all occupied — and binding 8765 is forbidden this
sprint. TEST-68's own "Then" clause makes no claim about the probe; all three of its actual
assertions pass (see the CLI-002 verdict). Flagging the conflict text as self-inconsistent
rather than the implementation as defective.

## Failures

None.

## Summary

**36 of 37 sprint criteria verified PASS; 1 (TEST-5) not executable on this machine with the
substitution disclosed in the log.** The two cross-issue criteria that fall to this issue
(TEST-80, TEST-81) also pass.

The orphan look-alike guarantee — the reason this issue's AC called out a blocking
adjudication — holds exactly as adjudicated: the deleted bread bullet projects `NULL` and not
the milk bullet's offset 12, an out-of-band fuzzy edit projects `NULL`, and restoring the
bullet verbatim re-resolves to offset 12 identically on the incremental and rebuild paths.
Rebuild-from-files-alone is intact (TEST-21, TEST-25), which is what makes option (b)
self-consistent.

Performance, drift detection, atomicity and read-your-write all verified against real files,
a real server process and the real `sqlite3` CLI. No discrepancy between the E2E log's claims
and my observations.
