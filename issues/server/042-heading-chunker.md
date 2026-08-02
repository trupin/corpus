# [SERVER-042] Deterministic heading-path chunker with content-addressed identity

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-040
- Blocks: SERVER-043, SERVER-044

## Spec References
- SPEC.md §9.1 semantic-index block, chunking bullet (SHARED-006 Edit 6)

## Summary
The Phase B foundation: split document and turn bodies into chunks along markdown
heading structure — a chunk is a section addressed by its heading path, split further
past a bounded size budget (~500 tokens; approximate by chars, constant documented).
Chunk id = hash(doc id, heading path, content) — same content, same chunks, always.
New `chunks` table in the projection (schema bump, migration per the established
SCHEMA_VERSION pattern), populated at projection time; embeddings columns stay empty
until SERVER-044. Observable contract: re-projecting after a small edit changes only
the edited sections' chunk rows; a file move/rename changes none (id is identity).
Fence-aware parsing (headings inside code fences are not headings — reuse/extend the
todos plugin's fence-aware line-parser approach, but server-side). Search's on-read
heading derivation (SERVER-040) switches to chunk-table lookup here.

## Acceptance Criteria
- [x] Deterministic: same body → identical chunk ids across runs; property test included
- [x] Small edit to one section: only that section's chunk **work** changes — measured on
`chunk_embeddings`, per sprint-021 C2, which overrides this criterion's original wording
(the projector rewrites every `chunks` row of a document on every save, by design)
- [x] Move/rename: zero chunk changes; heading inside a code fence: not a boundary
- [x] Oversized section splits at the budget with stable sub-addressing; turns chunk per turn heading
- [x] `db rebuild` reconstructs chunks identically; SCHEMA_VERSION bumped 8 → 9 — **wipe-and-rebuild,
no migration code**, per sprint-021 C1, which overrides this criterion's "migration + downgrade
refusal" wording. The read-only downgrade refusal already exists in `openProjectionReadonly` and is
now covered for the 8 → 9 case.
- [x] `/api/search` heading paths now come from chunks (on-read derivation removed).
PR #15 review note to close here: the on-read derivation addresses the FIRST
occurrence of a repeated passage (`locatePassage` indexOf) — a doc with identical
boilerplate under two headings always reports the earlier section. Chunk addressing
must key on the actual matched chunk, making this class impossible; add the
repeated-passage fixture as a test.

## Technical Design
### Files to Create/Modify
- ~~`apps/server/src/index/chunker.ts`~~ → **`apps/server/src/semantic/`** (Open Conflict 7:
`src/index.ts` is the package barrel), `apps/server/src/projection/schema.ts` (schema),
projection write/rebuild paths, `apps/server/src/search/` lookup swap

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4): chunker property/table tests, projection-diff tests, migration test.

## E2E Verification Plan
Real server: save a one-line edit in a large seeded doc; inspect `chunks` rows before/after (sqlite3) — only the touched section differs; `db rebuild && db doctor` clean.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Date 2026-07-31. Port **8804** only; `8765` never
bound, never killed. Workspace:
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s021-server/042-e2e`, created by `corpus init
--port 8804` from the current build. No dependency was added to any manifest.

### What was built, and which rulings shaped it

- **C1 honored — no migration code was written.** `/usr/bin/grep -rn "migrat" apps/server/src`
  returns only the pre-existing prose in `db.ts`/`schema.ts` saying there is no migration path.
  `SCHEMA_VERSION` goes 8 → 9 and the stamp mismatch wipes and rebuilds, as designed.
- **C2 honored — two tables.** `chunks` (+ `chunk_search`) are projection state, deleted and
  reinserted with the document; `chunk_embeddings` is keyed by content-addressed chunk id and is
  **never touched by the document projector**. "Pending" is derived (`chunks LEFT JOIN
  chunk_embeddings`), not a flag anybody writes.
- **OC3 option A honored** — a second FTS5 table, `chunk_search`, used *only* to address a hit.
  `search` and its bm25 ranking are untouched.
- **OC5 honored** — `rebuild()` ATTACH-copies `chunk_embeddings` from the outgoing `cache.db` into
  the temp database before the rename; `chunk_embeddings` is excluded from `REPOPULATED_TABLES`.
- **OC7 honored** — `apps/server/src/semantic/`, never `src/index/`.

### Suite results (VITEST_MAX_THREADS=4, scoped)

```
apps/server: 133 test files, 2660 tests, all passing (46.5 s)
  apps/server/src/search/search.test.ts   45 tests  ✓
  apps/server/src/search/routes.test.ts    6 tests  ✓
  apps/server/src/search/snippet.test.ts   4 tests  ✓
  apps/server/src/semantic/chunker.test.ts 29 tests ✓
  apps/server/src/semantic/chunks.test.ts  12 tests ✓
  apps/server/src/core/headings.test.ts    16 tests ✓
  apps/server/src/docs/related.test.ts     ✓ (no assertion edited)
```

`npx eslint apps/server/src --max-warnings 0` → no issues. `prettier --check` → clean.
`tsc --noEmit` in `apps/server` → clean.

### TEST-837 — byte stability, and the four edits that were necessary

Every `headingPath` **value** asserted anywhere in `apps/server/src/search/` and
`apps/server/src/docs/related.test.ts` is unchanged, and every ranking, hit-order and snippet
assertion passes untouched. Four mechanical edits were unavoidable because they name the mechanism
that TEST-835 required removing, and they are listed here rather than buried:

1. `search.test.ts` — the injectable seam's *type* moved from `PassageTextLoader` to
   `ChunkAddressLoader` in three places (the `search()` helper, the turn-hit `forbidden` loader, the
   frugality `counting` loader). Every assertion those tests make survives verbatim, including
   `expect(readRefs).toHaveLength(5)` and `expect(hits[0]?.headingPath).toMatch(/^Section \d{3}$/)`.
2. `search.test.ts` — `describe("loadPassageTexts")` became `describe("loadChunkAddresses")`: the
   function it tested no longer exists, and its replacement is tested in the same position.
3. `heading-path.test.ts` → **split**. `enclosingHeadings`'s ten tests moved **verbatim** to
   `core/headings.test.ts`; `unmarkSnippet`/`hasMatch`'s moved to `search/snippet.test.ts`.
   `locatePassage`/`primaryMatch` and their tests were **deleted** — they *were* the on-read
   derivation TEST-835 required removing.
4. `projection/db.test.ts` — the "no unexpected tables" filter allowed one hard-coded FTS5 shadow
   prefix (`search_`); it now derives the prefixes from the declared virtual tables, so
   `chunk_search_*` is recognised the same way. The chunk tables' columns were added to
   `SPEC_COLUMNS`.

The one *fixture* addition is TEST-836's, named explicitly below.

`/usr/bin/grep -rn "locatePassage\|enclosingHeadings" apps/server/src/search/` → **no matches**
(the on-read derivation is gone from the hit path; `enclosingHeadings` survives in `core/headings.ts`
as the chunker's own section walk, which is what keeps the two addresses identical by construction).

### E2E — TEST-838, a real edit on a real server

Rebuild-first rule observed: `corpus db rebuild` → `11 documents`, then `corpus db doctor` →
`projection is clean — 11 documents from 11 files (1ms)`.

Seeded `data/docs/big.md` — 20 heading sections — and stub embeddings for all 83 chunks of the
workspace (`identity='stub/model-v1'`, `vec=x'000102'`, `updated_ms=1700000000000`), standing in for
SERVER-044's worker. `chunks` before the edit (excerpt of the 20 rows):

```
ord  chunk_id                          heading_path  start_offset  end_offset
0    506d24f4392a57af65a9a4a1b40b5112  Section 0     1             154
...
5    fff16486063bc7f65957895ca3c697c1  Section 5     766           919
...
19   337ceca9c196f3ec6943c42411600aec  Section 19    2935          3090
```

One line inside section 5 edited through `PUT /api/docs/doc_bige2e01` (→ `updated:
2026-07-31T22:21:43Z`). The diff:

```
=== chunk-id diff (before vs after the one-line edit) ===
6c6
< 5 fff16486063bc7f65957895ca3c697c1 Section 5
---
> 5 2ed4eb8058c806e177bf418320833ed9 Section 5

=== embeddings table diff (83 rows) ===
(no change: all 83 embedding rows byte-identical, same updated_ms)

=== pending (chunks with no embedding) ===
chunk_id                          doc_id        heading_path
2ed4eb8058c806e177bf418320833ed9  doc_bige2e01  Section 5
```

**One** of twenty chunk ids moved; nineteen are byte-identical; **exactly one** chunk is pending and
it is section 5's; not one of the 83 embedding rows was written — same vector bytes, same
`updated_ms`. That is the criterion the issue exists for.

### E2E — TEST-826, move and rename re-index nothing

```
corpus doc move doc_bige2e01 --folder finance  → data/docs/finance/big.md
=== chunk-id diff across the move ===        (identical: a move re-indexes nothing)
PUT /api/docs/doc_bige2e01 {"title":"Big E2E document renamed"}
=== chunk-id diff across move + rename ===   (identical)
=== pending after move+rename ===            1     (still only section 5's)
```

### E2E — TEST-836, the PR #15 class closed on a real server

`data/docs/repeat.md` carries byte-identical boilerplate under `## Alpha` and `## Omega`; Alpha's
copy is buried in a long section, Omega's stands alone, so Omega is genuinely the better passage.

```
ord  heading_path  start_offset  end_offset
0    Alpha         1             1466
1    Alpha         1466          2788
2    Omega         2788          2850

GET /api/search?q=thermocline%20reading
{"hits":[{"id":"doc_repe2e01","title":"Survey log","headingPath":"Omega",
          "snippet":"…The thermocline reading is recorded once per shift. More unrelated survey narrative…"}]}
```

The first occurrence of the boilerplate lies inside Alpha's chunk — all `indexOf` could ever have
found — and the address reports `Omega`. **Noted honestly:** the snippet still comes from the
document-granular `search` row and so quotes Alpha's copy (identical text, different trailing
context). That is Open Conflict 3 option A's explicit trade: "`search` and its bm25 ranking are
untouched, so hits, order and snippets stay byte-identical; `headingPath` comes from the
best-matching chunk within the already-chosen document."

### E2E — TEST-830, a thread chunked per turn (out-of-band write, watcher path)

```
ref                               kind  ord  heading_path
th_e2e00001                       doc   0    E2E thread
th_e2e00001#2026-07-31T09:10:00Z  turn  0    user · 2026-07-31T09:10:00Z
th_e2e00001#2026-07-31T09:20:00Z  turn  0    agent · 2026-07-31T09:20:00Z
th_e2e00001#2026-07-31T09:20:00Z  turn  1    agent · 2026-07-31T09:20:00Z › Detail
```

### E2E — TEST-834 / OC5, `db rebuild`

```
=== chunks: full-table diff across db rebuild (83 rows) ===        (identical)
=== chunk_embeddings: full-table diff across db rebuild (83 rows) ===
(identical — carried over by ATTACH-copy, re-attached by content address)
=== pending after rebuild ===   1        (still only section 5's — the rebuild queued nothing new)
corpus db doctor → projection is clean — 11 documents from 11 files (2ms)
```

### E2E — TEST-833, the wipe-and-rebuild path at 8 → 9

Server stopped, `cache.db` stamped back to `8`, server restarted:

```
server.log: projection schema changed; rebuilding from files
meta.schema_version → 9
chunks → 87 ;  chunk_embeddings → 0
corpus db doctor → projection is clean — 12 documents from 12 files (2ms)
```

Two notes an operator will care about, both designed behaviour rather than bugs:

- The **boot** path deletes the database file, so the stamp bump costs one full re-embed. That is
  C1's rule, and it is *different* from `corpus db rebuild`, which carries embeddings over (OC5) —
  a rebuild builds a new file beside the old one and can copy from it; a stamp mismatch cannot,
  because the file it would copy from is the one this build cannot read.
- **`corpus db doctor` could not exercise the read-only refusal here**: the CLI verb goes through
  the running server, and with the server stopped it reports "server not running" before reaching
  the projection. The read-only refusal (`openProjectionReadonly` throwing and naming `corpus db
  rebuild` for a stamp of 8) is covered by `semantic/chunks.test.ts` → "wipes and rebuilds a v8
  database read-write, and refuses it read-only".

### Self-review finding, fixed before hand-off

The first implementation put the carry-over count on `RebuildReport` as `embeddingsCarriedOver`.
`projection/routes.ts`'s `toRebuildResult` spreads that report onto the wire
(`{ skipped, ...counts }`), so the field would have appeared in `POST /api/db/rebuild`'s response —
an undeclared key on a frozen contract shape, from a server issue that is not allowed to change the
contract. It is now logged and never reported, and the two tests that asserted the field assert the
copied rows and the pending count instead, which is the property that actually matters. The E2E
evidence above was gathered by `sqlite3` diffs, not that field, so none of it depended on it.

### Cleanup

`corpus server stop` (pids 30928, 32987, both recorded and stopped by pid). `lsof -nP -iTCP:8804
-sTCP:LISTEN` and `:8805` → empty. No `pkill`/`killall` was used. No git command was run in this
repository.

### Deferred / struck

None. Every criterion in the sprint contract for this issue was executed; the two whose *wording*
the contract itself overrode (C1's migration language, C2's row-diff language) are annotated in the
Acceptance Criteria above with what was verified instead.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
