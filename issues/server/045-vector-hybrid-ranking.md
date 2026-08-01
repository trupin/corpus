# [SERVER-045] Vector storage + hybrid ranking in /api/search; `similar` related rows

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-044, CONTRACT-023
- Blocks: SERVER-047, UI-026, INFRA-012

## Spec References
- SPEC.md §9.1 semantic-index block (SHARED-006 Edit 6), §9.2 search/related bullets (Edits 7, 8)

## Summary
The retrieval payoff. Store chunk vectors queryably and rank against them: `/api/search`
becomes hybrid — lexical (bm25) and semantic (query embedded via the resolved provider,
KNN over chunks) fused by reciprocal-rank fusion into one ranked list, response shape
unchanged. `related` gains `similar` rows (nearest chunks' parent documents aggregated),
`both` when also linked. Both envelopes start emitting `semanticIndex`.

> **Sprint-021's corrections override this file** in three places, and the text below has
> been brought into line with them:
>
> - **C3 — the state words.** `catching-up` and `lexical-only` **do not exist**. The
>   frozen enum is `current` / `indexing` / `stale` / `disabled` (CONTRACT-022, signed
>   under SHARED-006), and the mapping from countable facts to those values is published
>   in `IndexStatusSchema.state`. Implemented once, in `semantic/state.ts`.
> - **C6 — the over-fetch.** `LIMIT @limit` is applied *inside* the ranking statement, so
>   fusion must over-fetch the lexical half past `limit` or a document ranked 11th
>   lexically can never be promoted. The factor is an exported documented constant.
> - **OC2 (ruled) — the pure-JS cosine scan is THE vector path.** No native extension, no
>   `sqlite-vec`, no new dependency, no startup platform probe. The issue's original
>   "extension unavailable" degrade is vacuous and is restated as "no usable index".

## Acceptance Criteria
- [x] A semantically-related-but-lexically-disjoint fixture doc surfaces in hybrid results and is labeled `similar` in related (the demo that vectors work)
- [x] Ranking degrades to lexical-only with the honest state word when: index empty, identity invalid, or no provider resolves — never an error, never silently stale results
- [x] `indexing`/`stale` reported per the published mapping while work is pending; fusion is deterministic for fixed inputs
- [x] Query embedding failures degrade the single request to lexical (flagged), not 500

## Technical Design
### Files created
- `apps/server/src/semantic/vectors.ts` — brute-force cosine KNN behind one interface:
  blob↔`Float32Array`, `cosineSimilarity`, `nearestDocuments` (identity-filtered,
  scope-filtered, aggregated to documents by **best chunk**), `vectorCensus`,
  `documentCentroid`, `SEMANTIC_MIN_SIMILARITY`.
- `apps/server/src/semantic/state.ts` — the published fact→word mapping as a pure
  function, plus `IndexRebuildFlag` (the bit SERVER-046's rebuild raises).
- `apps/server/src/semantic/retrieval.ts` — `SemanticRetrieval`: cached, single-flight,
  cooled-down provider resolution; `forQuery` (embeds the query) and `forDocument` (uses
  stored vectors, embeds nothing); one usability predicate governing both.
- `apps/server/src/search/fusion.ts` — `RRF_K`, `RETRIEVAL_OVERFETCH_FACTOR`,
  `RETRIEVAL_OVERFETCH_CAP`, `overFetchLimit`, `fuseRankings`.
- `apps/server/src/semantic/vector-fixture.ts` — hand-set vectors for tests.

### Files modified
- `search/search.ts` — `searchCorpus` is async and takes `SearchDeps`; over-fetches when
  the semantic half contributes, fuses, materializes semantic-only hits from
  `chunk_search`. Emits `semanticIndex` always.
- `docs/related.ts` — async; fuses the linked list with the similar list and emits
  `linked` / `similar` / `both` plus `semanticIndex`.
- `docs/filters.ts` — `DOC_FILTER_JOINS` split out of `FROM_SQL` (byte-identical result)
  so the vector scan reaches `documents`/`threads`/`seen` under the same aliases the
  shared filter fragments name.
- `app.ts` — builds the service inside the projection block, exposes `server.semantic`.
- `lifecycle.ts` — binds the embedded engine into it once built.
- `search/routes.ts`, `docs/routes.ts`, `search/index.ts`, `semantic/index.ts`,
  `docs/index.ts` — wiring and barrels.

### Design decisions
1. **Fusion is RRF over ranks, tie-broken by `d.id ASC`.** bm25 and cosine have
   incomparable scales; RRF discards both and keeps position, which needs no per-corpus
   calibration. `k = 60`, the published value. **Fusing a single list re-derives that
   list** (`1/(k+i)` is strictly decreasing) — the mechanism behind byte-stability.
2. **Over-fetch factor 5, capped at 250.** At `RETRIEVAL_MAX_LIMIT = 50` that is 250
   candidate rows; at the default 10 it covers the page five times over. When the semantic
   half contributes nothing the lexical statement is bound to the caller's own `limit`, so
   the disabled path issues the *same SQL with the same value* as Phase A.
3. **Aggregation to documents is max, never sum** — a long document must not out-rank a
   precise one by having more passages. Mirrors the lexical half's `MIN(rank)`.
4. **`related`'s source vector is the document's centroid**, not a max over its own
   chunks: the alternative multiplies the scan by the source document's chunk count.
   Measured consequence: `related` answers in 1.3 ms against search's 3.4 ms.
5. **One usability predicate for both endpoints.** `forDocument` could technically work
   with no provider resolved (stored vectors only); it does not, because one
   `semanticIndex` word covers both envelopes and TEST-884 requires both to report
   `disabled` together.
6. **A relevance gate exists, and its value is measured** — see the E2E log. Without one,
   `related` publishes `similar` about a document at cosine 0.02, which is a false claim
   rather than merely a bad ordering.

## Testing Strategy
apps/server scoped, deterministic hand-set vectors — a ranking test must not also be a
test of a model's opinion. New: `search/fusion.test.ts` (9), `search/hybrid.test.ts` (17),
`semantic/vectors.test.ts` (24), `semantic/state.test.ts` (9),
`semantic/retrieval.test.ts` (15), `docs/related-semantic.test.ts` (12). Extended:
`search/search.test.ts` (+17: byte-stability matrix and the flipped Phase A pin),
`docs/related.test.ts` (+6: same), `search/routes.test.ts` (+2: the state word on the
wire, including the rebuild flag).

## E2E Verification Plan
Real server, real embedded provider: seed paraphrase pairs sharing no keywords; hybrid
search finds them, `related` labels them `similar`; corrupt the identity → lexical-only.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Port **8804**, workspace
`…/s021-server/045-e2e/ws` created by the real `corpus init`, server started from
`apps/server/src/main.ts`, every command below through the real bin
(`apps/cli/src/bin/corpus.ts`). Real embedded engine, warm model cache
(`CORPUS_MODEL_CACHE_DIR` → SERVER-048's cache):

```
{"msg":"listening on http://127.0.0.1:8804", ...}
{"msg":"semantic index: local/all-MiniLM-L6-v2@384 (embedded)"}
{"msg":"semantic index: embedding with local/all-MiniLM-L6-v2@384 (embedded)"}
```

Seeded four documents through `corpus doc create`; the worker drained on its own:

```
chunks      { c: 64 }
embeddings  { identity: 'local/all-MiniLM-L6-v2@384', state: 'ready', c: 64 }
pending     { p: 0 }
```

### The paraphrase pair — both directions (TEST-879, TEST-895, TEST-932)

`doc_tg6yehkg` "Quarterly revenue growth slowed …" and `doc_gd7ud226` "Sales fell off over
the last three months …" share **no content word**.

Forward — a query matching only the first lexically returns the second:

```
$ corpus search "revenue growth" --json
{"hits":[
 {"id":"doc_tg6yehkg","title":"Quarterly revenue growth slowed","headingPath":"Quarterly revenue growth slowed","snippet":"Quarterly revenue growth slowed against the prior period, and the board asked…"},
 {"id":"doc_gd7ud226","title":"Sales fell off","headingPath":"Sales fell off","snippet":"Sales fell off over the last three months across every region, and directors requested a written account."},
 …],"semanticIndex":"current"}
```

Reverse — the mirror query returns the revenue document:

```
$ corpus search "sales fell off" --json
{"hits":[
 {"id":"doc_gd7ud226","title":"Sales fell off",…},
 {"id":"doc_tg6yehkg","title":"Quarterly revenue growth slowed",…}],"semanticIndex":"current"}
```

The lexical half alone cannot do either: with the provider turned off (below), the same
two queries return exactly one hit each.

`related` labels it — TEST-879's other half:

```
$ corpus doc related doc_tg6yehkg
doc_gd7ud226          similar  Sales fell off over the last three months across every region, …
doc_skillcomment      similar  ## When this runs …
doc_skillorchestrate  similar  ## Purpose and when to run …
```

### `both` (TEST-880)

Added `See [[doc_gd7ud226]]` to the revenue document; both directions relabel:

```
$ corpus doc related doc_tg6yehkg --json
{"related":[{"id":"doc_gd7ud226","title":"Sales fell off",…,"relation":"both"}, …],"semanticIndex":"current"}

$ corpus doc related doc_gd7ud226 --json
{"related":[{"id":"doc_tg6yehkg","title":"Quarterly revenue growth slowed",…,"relation":"both"}, …],"semanticIndex":"current"}
```

### The relevance gate — measured, and the reason it sits where it does

Real `all-MiniLM-L6-v2` vectors read out of this workspace's own `chunk_embeddings`:

```
query "revenue growth"       0.5595 revenue | 0.2643 sales   | 0.0841 bicycle | 0.0114 kitchen
query "sales fell off"       0.7186 sales   | 0.2358 revenue | 0.1484 bicycle | 0.0848 kitchen
query "bicycle brake pads"   0.4219 bicycle | 0.0800 kitchen | 0.0796 revenue | 0.0045 sales

doc→doc  revenue↔sales 0.2614 | kitchen↔bicycle 0.2121 | sales↔bicycle 0.1790
         revenue↔bicycle 0.0819 | revenue↔kitchen 0.0243 | sales↔kitchen 0.0174
```

**The first value tried, 0.25, failed the reverse direction on the real server**:
`sales fell off` → revenue scores **0.2358**, and the pair-to-pair distance is 0.2614 — so
any gate inside the 0.21–0.26 band drops the paraphrase one way while keeping it the
other. That is the finding, and it is why `SEMANTIC_MIN_SIMILARITY` is **0.15**: below the
whole cluster of real relationships, at the top of the "nothing in common" band
(0.011–0.084). It excludes only what the model calls unrelated; deciding which survivor
matters is the ranking's job. Both directions pass at 0.15, and an unrelated query stays
clean:

```
$ corpus search "bicycle brake pads" --json
{"hits":[{"id":"doc_k2w7vu25","title":"Bicycle maintenance",…}],"semanticIndex":"current"}
```

### Degrade paths

**Identity mismatch** (TEST-889) — `UPDATE chunk_embeddings SET identity='other/model@384'`
(65 rows) against the live database:

```
$ corpus search "revenue growth" --json
{"hits":[{"id":"doc_tg6yehkg",…}],"semanticIndex":"disabled"}          # 200, full lexical, one hit
$ corpus doc related doc_tg6yehkg --json
{"related":[{"id":"doc_gd7ud226",…,"relation":"linked"}],"semanticIndex":"disabled"}
```

Not one foreign-identity vector reached the ranking, `similar` disappeared, no error.
Restoring the identity and waiting out `RESOLVE_COOLDOWN_MS` (30 s) recovered `current`
without a restart.

**No provider** (TEST-884) — `"embedding": {"provider": "none"}` in `.corpus/config.json`,
server restarted:

```
{"msg":"semantic index disabled: semantic indexing is turned off by `\"provider\": \"none\"`…"}
{"msg":"semantic index recorded local/all-MiniLM-L6-v2@384; nothing can embed right now, so the existing vectors stay as they are"}

$ corpus search "revenue growth" --json
{"hits":[{"id":"doc_tg6yehkg",…}],"semanticIndex":"disabled"}
$ corpus doc related doc_tg6yehkg --json
{"related":[{"id":"doc_gd7ud226",…,"relation":"linked"}],"semanticIndex":"disabled"}
$ corpus db doctor
projection is clean — 15 documents from 15 files (2ms)     # exit 0
```

**`stale`** (TEST-885) — a 101 KB, 120-section document created and searched immediately:

```
state: stale   hits: 5      # the semantic half still contributed while the backlog drained
state: current hits: 6
state: current hits: 6   (×6)
```

**`indexing`** (TEST-886) — the rebuild flag is SERVER-046's route to raise; the seam it
raises (`server.semantic.rebuild`) is exercised over the wire in `search/routes.test.ts`
("reports `indexing` on the wire while the rebuild flag is raised") and through the
service in `semantic/retrieval.test.ts`. **DEFERRED → SERVER-046** for a CLI-driven
reproduction: `POST /api/index/rebuild` does not exist yet. Recorded, not skipped.

**Query-embed failure** (TEST-888) — covered by `hybrid.test.ts` ("degrades this request
to lexical when the query embedding fails": 200, full lexical hits, `disabled`) and
`retrieval.test.ts` (provider dropped, then re-resolved after the cooldown). **DEFERRED →
provider sabotage**: not reproducible against a healthy in-process engine without breaking
it; the identity-mismatch leg above exercises the same degrade end to end on a real
server.

### Determinism (TEST-881)

`corpus search "revenue growth" --json` run repeatedly in one process and across two
server restarts returned byte-identical `hits` arrays. In tests: the same query twice in
one process, and again over a freshly built workspace with a fresh service, compared as
serialized JSON.

### Phase A byte-stability (TEST-883)

`phase-a-search.snapshot.json` and `phase-a-related.snapshot.json` were captured by
running the **shipped Phase A** `searchCorpus` / `relatedDocs` over the existing fixture
corpora *before* this issue touched them — 16 search cases and 5 related cases. Both
suites now re-run every case and compare **serialized JSON** with `semanticIndex`
stripped, then assert the stripped value is exactly `disabled`. So the test cannot pass by
the field being absent, and cannot pass by the server claiming an index it does not have.
Live confirmation above: the provider-off workspace answers the pure lexical results.

The two Phase A pins were flipped **deliberately** (C4), not deleted:

- `search.test.ts` — was `expect("semanticIndex" in results).toBe(false)`; now
  `expect("semanticIndex" in results).toBe(true)` plus `expect(...).toBe("disabled")`,
  under a renamed test and a comment naming C4.
- `related.test.ts` — was `expect(body.semanticIndex).toBeUndefined()`; now
  `expect(body.semanticIndex).toBe("disabled")`, same treatment.

### The scan is the implementation, and its cost (TEST-891)

Brute-force cosine in pure JS: no native extension, no `sqlite-vec`, no new dependency.
Measured on this machine through the real `nearestDocuments` against a real WAL
projection, 10 runs averaged after warmup:

```
 1,000 chunks × 384 dims:   2.09 ms/query   (insert 21 ms)
10,000 chunks × 384 dims:  26.70 ms/query   (insert 214 ms)
50,000 chunks × 384 dims: 134.87 ms/query   (insert 1086 ms)
```

Where the 10k number goes:

```
joined, object rows, decode+cosine        27.65 ms   ← what ships
flat table (no filter joins)              23.74 ms
joined, rows only (no decode, no cosine)  18.87 ms   ← SQLite row delivery dominates
joined, raw array rows                    24.81 ms   ← rejected: mutates a memoized statement for 11%
in-memory only                             6.56 ms   ← C7 measured 3.27 ms; this cosine also
                                                       computes the stored vector's norm
```

Against C7's table this is ~2× its projected ~14 ms end-to-end at 10k, and the gap is
accounted for: the filter joins (§9.2 requires them on both halves) and an honest cosine
that does not assume the stored vector is unit-length. On the live workspace the whole
request is:

```
GET /api/search?q=revenue%20growth   3.4–4.4 ms   (includes the real MiniLM query embedding)
GET /api/docs/{id}/related           1.1–1.5 ms   (no embedding: stored vectors only)
```

Revisit if a real corpus is measured past ~50k chunks; a native index earns its keep past
~10⁵, which this product does not reach.

### Machine hygiene

`8804` and `8805` free at session end (`lsof -nP -iTCP:<port> -sTCP:LISTEN` → no rows);
`8765` never bound; all scratch under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s021-server/045-*`; three temporary
`zz-*.tmp.ts` measurement scripts deleted; no `.corpus` in the repo; no `npm install`, no
manifest change, no `npm run e2e`.

### Gates

`npm run lint` clean · `npm run format:check` clean · `npm run typecheck -w apps/server`
clean · `vitest run apps/server`: **3008 passed, 2 skipped, 157 files**.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
