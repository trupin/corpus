# [UI-026] ⌘K overlay adopts GET /api/search

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-045
- Blocks: —

## Spec References
- SPEC.md §11 search overlay (SHARED-006 Edit 11)

## Summary
The overlay's ranked result list switches from `GET /api/docs?q=` to `GET
/api/search`: same filter chips, same archived semantics, results now
relevance-ranked with heading path + snippet per hit; a quiet one-line note when the
response flags `catching-up`/`lexical-only`. **"Save as view" is unchanged** — it
pins the query as a filtered list served by `GET /api/docs` (the signed
ranked-search-vs-lists rule); the overlay must keep producing the same view document
it does today. Grouped-by-type presentation stays.

## Acceptance Criteria
- [x] Overlay results come from `/api/search`, ranked, with heading-path subtitles; chips and archived behavior unchanged
- [x] Staleness note shown exactly when flagged; absent on `current`
- [x] "Save as view" produces an identical view doc to today (regression e2e)
- [x] Result click-through navigation unchanged

## Technical Design
### Files to Create/Modify
- `apps/ui/src/search/` overlay data hook + result row (+ tests); save-as-view path untouched

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); overlay e2e spec updated to the new payload shape via the hermetic stubs.

## E2E Verification Plan
Real app: ranked results with section subtitles; save-as-view column identical to a pre-change one; note line under a catching-up index.

## E2E Verification Log

**implemented on: opus** (2026-08-01, ui-dev). Ports: server `8810`, Vite `5287` with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8810`. `8765` never bound; `5173` never taken (it is held by
an unrelated `ssh` tunnel, pid 16094, which was neither started nor stopped here). Warm per-user
model cache, no download. Scratch: `~/.claude/jobs/4dd0ddef/tmp/s022-ui/ui-026-{real,drive}/`.

### The fork (C11) — TEST-1022, TEST-1023, TEST-1024

`toApiParams`, `toViewFrontmatter` and `fromViewFrontmatter` were **not touched**. C11, quoted:

> `apps/ui/src/search/searchQuery.ts:111-118` — `toViewFrontmatter` **calls** `toApiParams` … So
> **repointing `toApiParams` at `/api/search` silently corrupts every saved view** … UI-026 must add
> a *second* serializer and leave `toApiParams` / `toViewFrontmatter` / `fromViewFrontmatter` on the
> `GET /api/docs` grammar untouched.

The second serializer is `apps/ui/src/search/searchApi.ts` → `toSearchParams()`. Its return type is
the kit's `SearchParams`, built from the contract's `/api/search` parameter type, so `sort`,
`offset` and `pinned` are absent **by construction** — reaching for one is a type error.

`searchQuery.ts` and `searchQuery.test.ts` are byte-unchanged (for the orchestrator's `git diff`):

```
$ /sbin/md5 apps/ui/src/search/searchQuery.ts apps/ui/src/search/searchQuery.test.ts apps/ui/src/board/useSaveAsView.ts
MD5 (apps/ui/src/search/searchQuery.ts)      = 5cc25c174b79d41399f4dcd127642933
MD5 (apps/ui/src/search/searchQuery.test.ts) = 67240129027caa959d17e927fb8aed54
MD5 (apps/ui/src/board/useSaveAsView.ts)     = f76bea99811e5f39918dc9eca48232a4
```

`searchQuery.test.ts` passes with **no assertion edited**, round-trip identity included. Belt and
braces, `searchApi.test.ts` re-asserts the property from the *source*: `searchQuery.ts` contains
`GET /api/docs`, contains `q: text, sort: RELEVANCE_SORT`, and contains no `/api/search` — so a
later change that merged the paths back together fails a test rather than a review.

**TEST-1024 — the saved view, written by the real server.** `⌘K` → "mortgage" → `save as view`, on
port 8810; the document that landed on disk:

```yaml
id: doc_xgpieaqd
type: view
title: mortgage
pinned: true
order: 13
query:
  q: mortgage
  sort: relevance
```

`sort: relevance` — the **list** grammar, exactly as before. Reloading the board, the new column
fetches `GET /api/docs?q=mortgage&sort=relevance`, and `/api/search` is requested **zero** times on
board load: ranked retrieval is confined to the overlay, lists stayed on `GET /api/docs`
(`SPEC.md:409`, signed).

`DEFERRED → no git` for the literal "pre-change build vs post-change build" half of TEST-1024/1035:
this agent runs no git commands, so it cannot check out the pre-change tree to write the baseline
document. Substitute evidence, which is stronger than a diff of two artifacts: the three functions
that *produce* the document are byte-identical (md5 above), the property is asserted from source in
a unit test, and the real server's output is pasted above. The orchestrator's `git diff` over
`apps/ui/src/search/searchQuery.ts` closes it.

### Real app — TEST-1025, TEST-1031, TEST-1035

Real workspace, three seeded notes plus the template's own documents, `corpus db rebuild` clean.
Real Chromium against Vite 5287 → server 8810. `⌘K`, typed `mortgage`:

```
{"id":"doc_cnxhpke2","glyph":"doc","title":"Mortgage options","snippet":"## Rate assumptions The base case assumes a 30-year fixed mortgage at…","marks":["mortgage"],"headingPath":"Insurance"}
{"id":"doc_wyhijbjn","glyph":"doc","title":"Payoff maths","snippet":"## Amortisation Extra principal payments shorten the mortgage term considerably.","marks":["mortgage"],"headingPath":"Amortisation"}
{"id":"doc_skillcomment","glyph":"doc","title":"Comment","snippet":"…\"Mortgage rates?\" becomes \"Mortgage rate assumptions…","marks":["Mortgage","Mortgage"],"headingPath":"Worked examples"}
{"id":"doc_skill61c2325d","glyph":"doc","title":"todos","snippet":"## Adding items …","marks":[],"headingPath":"Todos › Adding items"}
groups: [ 'Documents · 8' ]
requests: GET /api/search?q=mortgage        ← the only one; no sort, no offset, no pinned
uncaught: []
```

Ranked in the server's order, every row carrying its passage's `headingPath` as the `.sr-path`
subtitle (`Todos › Adding items` shows the `HEADING_PATH_SEPARATOR` rendering intact) and a one-line
snippet. No client-side re-sort exists: `/usr/bin/grep -rn "sort" apps/ui/src/search/results.ts`
returns nothing, and `groupResults` only partitions.

**Click-through (TEST-1031).** `↵` on `Mortgage options` closed the overlay and opened the reader in
its home column. A hit carries no folder/type/status, so the overlay reads the document to resolve
placement — through the reader's own `["docs", id]` cache entry, so it is the reader's request moved
earlier rather than an extra one. Observed wire, one read, not two:

```
GET /api/docs/doc_cnxhpke2 | GET /api/docs/doc_cnxhpke2/related
overlay open: 0 · reader visible: 1 · uncaught: []
```

### The degraded note — TEST-1029, TEST-1036

`corpus index rebuild` on the same workspace, then the same query, two surfaces side by side:

```
$ corpus index status
identity    none recorded yet
indexed     0
pending     64
rebuilding  yes
state       indexing

overlay:  Ranked on text alone — the semantic index is still being built.
```

One word, two surfaces. Once the index caught up (`state current`, `pending 0`) the line was
**absent**, and it is absent on a response with no `semanticIndex` field at all. Four unit
assertions cover `current` / absent / each degraded state, plus a fifth for a state this build has
never heard of — which still reads as degraded, per the contract's "consumers test `!== "current"`,
never a switch". Screenshot: `~/.claude/jobs/4dd0ddef/tmp/s022-ui/ui-026-drive/overlay-degraded.png`.

The issue's words `catching-up`/`lexical-only` do not exist and appear nowhere in the diff
(sprint-021 C3). The CLI's wording is not reused — a unit test pins that the overlay's line is not
`#`-prefixed, names no `SPEC.md`, and contains neither the word "lexical" nor the raw state value.

### Chips — TEST-1027, TEST-1028

All twelve chips still render, in order, and still compose; asserted verbatim in
`SearchOverlay.test.tsx`. `includeArchived` is still expressed by omission: no `status` by default,
`includeArchived=true` from the warn chip, asserted on the **request** in unit, jsdom and Playwright.
Sprint-010 Open Conflict 3, honoured: "the default is expressed by omission … the chip emits
`includeArchived=true` rather than by naming a status, because `status=archived` would narrow to
archived-only".

**One chip lost its options, and it is the `tag:` chip.** `tagOptions` read `row.tags` off the
document rows `GET /api/docs` returned; a `SearchHit` is an id, a title, a heading path and a
snippet, and that frugality is the endpoint's reason to exist. Three alternatives were rejected: a
tag-collection route does not exist in the §9.2 grammar (inventing one is a contract change); a
second `GET /api/docs` per query reintroduces exactly the request the overlay's data path exists to
prevent; guessing a vocabulary is a lie. The chip stays in the row, still displays and still clears a
tag set from a restored query, but can no longer offer one. **Escalated to the orchestrator** as a
contract question. The `references:`/`parent:` pickers are unaffected — a hit carries id and title,
which is all they ever used.

### Two further consequences, both stated rather than hidden

- **Chips with no text search nothing now.** `q` is required by `SearchQuerySchema` and an empty one
  is a `400`, and the shared prep's `useCorpusSearch` is disabled on a blank `q` by design ("an open
  overlay with nothing typed is not a ranking of everything"). So a chip-only overlay issues **no**
  request and says `Type to search — documents, threads and turns, ranked.` rather than claiming
  nothing matched. `save as view` still works from chips alone — a view is a list, not a ranking —
  and that path is tested.
- **The `.type-glyph` says the kind, not the type.** A hit carries no `type`, so the glyph reads
  `doc`/`thread` off the id prefix — the contract's own discriminant (`DocumentIdSchema`'s
  `^(doc|th)_[A-Za-z0-9]+$`, SPEC.md §5), named once as `resultKind()` and tested, and shared with
  the grouping so the two can never disagree (TEST-1026). Highlighting survived the payload change:
  `/api/search` sends plain text, so the query's words are marked client-side into `<mark>` elements
  React creates — no HTML string, no sanitizer, the same safety property the structured runs bought
  (sprint-010 Open Conflict 4), keeping §11's "snippet-highlighted results" true.

### Tests and gates

- `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui/src/search` → **138 passed** (8 files).
- `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui/src` → **1622 passed** (107 files), no
  regression anywhere else in the workspace.
- `CORPUS_UI_PORT=5287 npm run e2e -- apps/ui/e2e/search.spec.ts` → **16 passed**. The eleven shipped
  overlay tests pass **with every assertion intact** (TEST-1034 — no edit to the save-as-view chip
  assertion, the footer legend, the archived wash, or the board-shortcuts case); the only edit to the
  file is its docblock plus a new `the ranked result list` describe of five stubbed tests
  (TEST-1033's stub branch was inherited from the shared prep and not modified).
- `node_modules/.bin/tsc --noEmit` in `apps/ui` → exit 0. `eslint apps/ui/src/search apps/ui/e2e/search.spec.ts` → clean,
  no suppressions added. `prettier --check` clean.
- `corpus db rebuild && corpus db doctor` → `projection is clean — 13 documents from 13 files`, exit 0.

### Scope and concurrency (OC6)

Files changed, all inside my lane: `apps/ui/src/search/{searchApi.ts,searchApi.test.ts,useSearch.ts,
useSearch.test.tsx,results.ts,results.test.ts,Snippet.tsx,Snippet.test.tsx,SearchResults.tsx,
SearchResults.test.tsx,filters.ts,filters.test.ts,FilterChips.tsx,SearchOverlay.tsx,
SearchOverlay.test.tsx,searchTransport.ts,search.css}` and `apps/ui/e2e/search.spec.ts`. **No file
under `apps/ui/src/reader/` and no `reader.spec.ts`/`related.spec.ts` was opened for writing.** The
frozen prep files are unchanged — md5 `apps/ui/e2e/stubCorpus.ts` = `14b53931a9e0e290ad7a2578711b3e05`,
`apps/ui/src/testing/boardFixture.ts` = `a3349611eee26ab64ad161882e475823`, and `packages/kit/**` was
not touched at all (TEST-1032/1043: this issue consumed the granted kit exception, it did not spend
any of it). The new test transport lives at `apps/ui/src/search/searchTransport.ts` — deliberately
beside the overlay rather than as a branch in the shared `boardFixture.ts`, precisely so the two UI
agents cannot collide on one handler. `npm run e2e` was held once, alone: 5287 and 8810 confirmed
free before and after (`lsof -nP -iTCP:<port> -sTCP:LISTEN`), no `.corpus` at the repo root, no
`corpus init` inside the checkout, the shared model cache read and never written.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
