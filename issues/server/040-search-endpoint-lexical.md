# [SERVER-040] GET /api/search: lexical ranked retrieval with heading-path hits

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: CLI-019, SERVER-042 (chunk addressing supersedes on-read derivation)

## Spec References
- SPEC.md §9.2 search bullet (SHARED-006 Edit 7), §7 Retrieval discipline (Edit 4)

## Summary
Implement `GET /api/search` over the existing FTS5 `search` table: relevance-ranked
(bm25), composing the same filter predicates as the docs list (shared code, not
copied), archived default identical. Per hit: doc id, title, **heading path of the
best-matching passage**, one-line snippet. The projection stores no heading structure
in Phase A: derive on read for the top-k only — locate the FTS match offset in the
body (or turn), walk the markdown headings above it (threads: the turn's H2 is the
path). Cap `limit` sanely. Response envelope includes the semantic-state field as
`current`/absent per the frozen contract.

## Acceptance Criteria
- [x] Ranked results for title/body/turn matches; filters compose exactly like `/api/docs` (shared predicate builder — a filter added later cannot diverge)
- [x] Hit in a nested section reports the full heading path; hit in a turn reports the turn heading; body text never returned
- [x] Archived excluded by default; `includeArchived` lifts, explicit status filter untouched (same rule as the overlay)
- [x] Derivation cost bounded: only top-k bodies are read

## Technical Design
### Files to Create/Modify
- `apps/server/src/search/` (new: route handler, heading-path derivation, snippet), wiring in the app; extract the shared filter builder from the docs-list module

### Decisions recorded (sprint-019 TEST-681, TEST-671, Done Criteria)

**The address is derived from the projection's own copy of the text, not from the
file on disk** (TEST-681's required statement). The `search` table is a plain
fts5 table that *stores* the indexed text (C2), so both sources were available.
The indexed copy wins for three reasons:

1. **It is the text the hit is about.** The snippet, the bm25 rank and the
   heading path then all describe one string. Reading the file would address a
   passage in what the document says *now* while quoting the passage the index
   matched — they disagree during exactly the window that matters, the seconds
   after a save before the watcher catches up.
2. **It is already the right slice.** A thread's `kind='doc'` row indexes only
   its preamble, so the scan cannot walk into a turn and claim its heading. From
   the file, that boundary would have to be reconstructed in a second place.
3. **It costs no filesystem.** No `readFileSync`, no frontmatter parse, no ENOENT
   race against a document deleted since it was projected — one indexed
   `ref IN (…)` lookup for the whole page.

The cost is that the indexed copy is lossy by exactly two characters (U+0002 /
U+0003, stripped by `toIndexableText` because they are `snippet()`'s own markup).
Neither is a line terminator or a `#`, and neither can survive in a heading's
name, so heading *structure* is identical in both copies — the difference is
invisible in an address.

**Bounding.** The ranked statement returns at most `limit` rows; the text lookup
runs only over those, and only over the document hits that matched in their
*body* (a turn's address comes from its `turns` row, a title-only match is
addressed by the title). Measured through the injected `PassageTextLoader` seam:
60 matching documents, `limit=5` → **5 texts read**.

**Turn hits read nothing.** `ref = "<docId>#<ts>"` plus the `turns` row's
`author` rebuilds §6's `## <author> · <ts>` heading. The path is the heading's
*name*, `##` dropped — the same rendering a document section's heading gets.

**A thread-preamble hit** (the third case, which the issue text does not mention)
falls out without a special case: the indexed text for a thread's document row is
its preamble, so the scan is bounded to it, finds no heading in a conventional
preamble, and reports the thread's title.

**Which match addresses a multi-match window.** `snippet()` pads the region it
scored with context, and the padding can carry an occurrence from the section
above. The address is taken from the **medoid** of the marked terms — the match
with the smallest total distance to the others — so the terms' point of
convergence decides, not whichever occurrence came first. Ties break to the
earlier offset. Observed live: `q=escrow reserve` reported
`Mortgage › Escrow` under a first-match rule and `Mortgage › Escrow › Reserve`
(the section where both terms actually meet) under the medoid.

**Heading-path separator**: `HEADING_PATH_SEPARATOR` (`" › "`), imported from
the contract, never re-declared. It is a display join — printed, never split.

**Setext headings are not headings** (ATX only). The product writes ATX
everywhere (the editor serializes `##`; §6 pins turn headings), and a scanner
guessing at underlines would have to rule on table rules and horizontal lines. A
fallback address is worse than none; a wrong one is a lie.

**`limit` cap** (TEST-671): `RETRIEVAL_DEFAULT_LIMIT = 10` /
`RETRIEVAL_MAX_LIMIT = 50`, enforced by the contract's schema and honoured here
unchanged. The rejected alternative was the list convention
(`DEFAULT_PAGE_LIMIT = 50` / `MAX_PAGE_LIMIT = 200`): 200 one-line hits is a page
of prose the agent never asked for, in a surface whose whole justification is
token frugality.

**`semanticIndex` is omitted, not set to `current`** (TEST-685). The contract
reads an absent field as "the server makes no claim", which is the truth in Phase
A — there is no semantic index to be caught up. Emitting `current` would assert
one exists and would be the first line of Phase B machinery written under a Phase
A issue.

**The extraction.** `compileFilters` and the SQL fragments it is written against
moved from `docs/query.ts` into `docs/filters.ts` — the WHERE builder, `FROM_SQL`,
`FTS_HITS_CTE`, `RELEVANCE_ORDER_BY`, `notArchivedSql`, `Binder`, `paramsFor`,
`whereClause`. `query.ts` re-exports `DOCS_ROOT` and `folderPathPrefix` so the
shipped suites' imports resolve unchanged. There is one bm25 ordering string and
one hits materialization in the tree; ranked retrieval differs from the list only
in how it *aggregates* those hits (best passage vs. every snippet).

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4): ranking fixture corpus, heading-path cases (top-level, nested, turn, no-heading doc → path = title), filter parity table vs `/api/docs`.

## E2E Verification Plan
Real server, seeded workspace: `curl /api/search?q=…` returns ranked frugal hits; verify a nested-section hit's path against the file on disk.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context). Date 2026-07-31. Not a bug, so no
pre-fix reproduction is required (SDLC step 1 applies to bugs).

**Setup.** Workspace `…/tmp/s019-server/040-Vuc2Wu`, created from a cwd outside
this repository with `corpus init --port 8804` (port passed explicitly —
Adjudication 1; `8765` never bound, never killed, never proxied into). Built CLI
`apps/cli/dist/bin/corpus.js` (the from-source `node --import tsx` form cannot
resolve `tsx` from outside the repo). Server pids 68837 → 71062 → 72450, each
stopped by `corpus server stop` before the next start.

Seeded on disk: `data/docs/finance/mortgage.md` (nested `# Mortgage` → `## Escrow`
→ `### Reserve`, a `## Fees`, a fenced ```` ```md ```` block containing
`# Fake heading` / `## Also fake`, then `## Rates`), `refi.md`,
`archived-guidance.md` (`status: archived`), and
`data/threads/th_escrow01.md` (preamble + two turns). Plus the eight template
files and two plugin skills `corpus init` installs.

**1. Ranked frugal hits, three kinds of address in one response.**

```
GET /api/search?q=escrow%20reserve
{"hits":[
 {"id":"doc_mortg01","title":"Mortgage handbook",
  "headingPath":"Mortgage › Escrow › Reserve",
  "snippet":"…mortgage. ## Escrow How the escrow account works. ### Reserve The escrow reserve is…"},
 {"id":"th_escrow01","title":"Escrow questions",
  "headingPath":"user · 2026-07-22T09:00:00Z",
  "snippet":"Does the escrow reserve change after a refinance?"},
 {"id":"doc_refi001","title":"Refinance notes",
  "headingPath":"Refinance notes",
  "snippet":"A refinance changes the escrow schedule but keeps the same reserve rules."}]}
```

**2. Heading paths verified against the file on disk.** `/usr/bin/grep -n` over
`data/docs/finance/mortgage.md`:

```
15:Opening paragraph about the loan, with no heading above it.
17:# Mortgage
21:## Escrow
25:### Reserve
27:The escrow reserve is recalculated annually and topped up each January.
29:## Fees
34:# Fake heading          <- inside the ```md fence
35:## Also fake            <- inside the ```md fence
38:## Rates
40:The escrow ladder for adjustable rates is documented here.
```

| query | hit's `headingPath` | the file says |
| --- | --- | --- |
| `recalculated annually` | `Mortgage › Escrow › Reserve` | line 27 sits under 25 under 21 under 17 ✓ |
| `opening paragraph loan` | `Mortgage handbook` (the title) | line 15 has no heading above it ✓ |
| `adjustable ladder` | `Mortgage › Rates` | line 40 sits under 38 under 17; the fenced 34/35 are **not** in the path ✓ |
| `escrow reserve` | `Mortgage › Escrow › Reserve` | medoid of the marked terms is the `### Reserve` region ✓ |

**3. Turn hit verified against the thread file's H2s.** `/usr/bin/grep -n "^## "
data/threads/th_escrow01.md` →

```
20:## user · 2026-07-22T09:00:00Z
24:## agent · 2026-07-22T10:00:00Z
```

`q=recomputed tax insurance` → `{"id":"th_escrow01","headingPath":"agent · 2026-07-22T10:00:00Z",
"snippet":"The escrow reserve is recomputed from the new tax and insurance estimates."}`
— the turn at line 24, addressed by its own heading, U+00B7 included.

**4. Archived rule, all three branches.**

```
q=superseded                        -> doc_skillcomment only (doc_arch001 excluded)
q=superseded&includeArchived=true   -> doc_arch001 + doc_skillcomment  (union)
q=superseded&status=archived        -> doc_arch001 only               (narrows)
```

**5. Filter parity, over HTTP.**
`GET /api/search?q=escrow&type=note&tag=finance&folder=finance` →
`["doc_mortg01","doc_refi001"]`;
`GET /api/docs?q=escrow&type=note&tag=finance&folder=finance&sort=relevance` →
`["doc_mortg01","doc_refi001"]`. The full 18-row parity table (every §9.2 filter,
both endpoints, id sets compared) runs as `it.each` in
`apps/server/src/search/search.test.ts` → "filter parity with GET /api/docs".

**6. Status codes.**

```
GET /api/search                                          -> 400 {"code":"bad_request"}
GET /api/search?q=escrow&limit=51                        -> 400
GET /api/search?q=escrow&limit=50                        -> 200
GET /api/search?q=escrow&sort=relevance&offset=10&pinned=true -> 200 (stripped, not rejected)
GET /api/search?q=escrow  (no Authorization)             -> 401
GET /api/search?q=***                                    -> 200 {"hits":[]}
```

**7. Frugality, measured.** Broad query over the whole workspace (the two
installed skills included):

```
GET /api/search?q=thread            -> 4 hits, 716 bytes
  doc_skillcomment      When this runs
  doc_seedopenthreads   Open threads
  doc_skill61c2325d     Todos › Adding items
  doc_skillorchestrate  Concurrency and ordering
GET /api/docs?q=thread&sort=relevance&limit=10  -> same 4 documents, 5071 bytes
comment/SKILL.md on disk                        -> 25376 bytes
```

Same answer, 7× cheaper than the list rows and 35× cheaper than one of the
documents it points at. No body, no 280-character excerpt, no segment array in
any hit — the four contract fields only.

**8. TEST-724 spot check — `/api/docs` unchanged by the `compileFilters`
extraction.** `GET /api/docs?q=escrow&sort=relevance` still ranks
(`doc_mortg01, th_escrow01, doc_refi001`) and still carries structured snippets
(`[{"field":"body","segments":[{"text":"…mortgage.\n\n## ","match":false},
{"text":"Escrow","match":true},…]`). The shipped suites
`docs/{query,fts,routes,view-query}.test.ts` pass **unmodified**: 159 tests.

**9. One ranking source (TEST-672).** `/usr/bin/grep -rn "bm25\|rank"
apps/server/src` (non-test files) shows exactly one statement that produces a
rank — `FTS_HITS_CTE` in `docs/filters.ts:140`
(`SELECT doc_id, kind, ref, rank … FROM search WHERE search MATCH @q`, with the
`MATERIALIZED` hint and its reason intact) — one ordering string,
`RELEVANCE_ORDER_BY = "m.rank ASC, d.id ASC"` (`filters.ts:153`), used by
`ORDER_BY.relevance` (`query.ts:79`) and by ranked retrieval
(`search/search.ts:64`), and two `MIN(rank)` aggregates over that same `hits`
CTE, one per consumer (`query.ts:172`, `search/search.ts:51`). No second bm25
implementation exists; retrieval differs only in what it does with the hits
(best passage, vs. every snippet as JSON).

**10. Cleanup.** `corpus server stop` (pid 72450);
`lsof -nP -iTCP:8804 -sTCP:LISTEN` → no listener; `8806` also free;
`ls -d /Users/theophanerupin/code/corpus/.corpus` → *No such file or directory*.
No `git` command was run in this repository. Scratch confined to
`…/tmp/s019-server/040-Vuc2Wu`; nothing glob-deleted (the prefix is shared).

**Tests.** `VITEST_MAX_THREADS=4 vitest run apps/server/src/search/` → 70 passing
across `search.test.ts` (42), `heading-path.test.ts` (22), `routes.test.ts` (6);
`core/one-line.test.ts` → 7.

**Deferred / struck**: none. Every criterion in the sprint contract's SERVER-040
block (TEST-672 … TEST-686) was executed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
