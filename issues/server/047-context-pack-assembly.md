# [SERVER-047] Context pack assembly

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-024, SERVER-041, SERVER-045
- Blocks: CLI-021

## Spec References
- SPEC.md §7 context packs (SHARED-006 Edit 4), §9.2 context bullet (Edit 9)

## Summary
Build `GET /api/threads/:id/context`: resolve the thread's anchor to its enclosing
section, return the anchored passage with that whole section; gather related
excerpts ranked against the anchor text + thread text — links-graph neighbors
(SERVER-041) fused with semantic nearest chunks (SERVER-045); degrade to
links-only exactly like search degrades to lexical, same honesty. Enforce the
contract's bounds at assembly (rank, then cut). Whole-document threads: parent title
+ opening section; standalone: related-only pack ranked against the thread text.
Orphaned anchor (§6): the pack says so and carries the preserved quote.

> **Corrected 2026-08-01/02 (sprint-022 C1, C2, C3, OC1, OC2, OC9).** Four
> premises in the text above were wrong and are withdrawn:
>
> - **"resolve the thread's anchor to its chunk (SERVER-042 addressing)"** — the
>   parent side must come from `core/headings.ts`'s `headingSections`, **never**
>   from the chunk tables (C2). A section larger than `CHUNK_CHAR_BUDGET = 2000`
>   is *split* into several chunks, so a chunk is a fragment of a section by
>   construction and "the whole enclosing section" is unsatisfiable from them.
>   The anchor's offset is `anchors.resolved_offset`, populated `resolveAnchorExact`-only.
> - **"four thread shapes"** — there are **five** (C1/OC9). A thread whose parent
>   `DELETE /api/docs/{id}` removed is a `200` with the `parent-deleted` shape,
>   never a `404` about a thread that plainly exists.
> - **"no new ranking logic beyond fusion weights"** — no *fusion weights*
>   either. `fuseRankings`, `overFetchLimit` and `notArchivedSql` are reused
>   verbatim; the semantic half is the existing `SemanticRetrieval.forQuery`
>   (C3), and `loadSemanticOnlyHits` is **extracted** from `search/search.ts`
>   rather than re-expressed (OC2).
> - **AC 4** is restated per OC1: the whole enclosing section **up to the
>   contract's cap**, never a snippet window, truncated *around the anchor* and
>   flagged when the cap cuts it.

## Acceptance Criteria
- [x] All **five** thread shapes produce correct packs (anchored, whole-doc, standalone, orphaned-anchor, parent-deleted)
- [x] Bounds enforced: oversized corpus still yields a pack within contract caps, best-ranked first
- [x] Semantic-degrade path mirrors search's flag semantics
- [x] Pack for a thread whose anchor sits mid-section returns the WHOLE enclosing section (up to the cap, flagged), not a snippet fragment

## Technical Design
### Files to Create/Modify
- `apps/server/src/threads/context.ts` (new + tests), route wiring; reuses the fusion,
  archived-filter and semantic-retrieval primitives — no new ranking logic and no new constants
- `apps/server/src/semantic/passages.ts` (new): `loadSemanticOnlyHits`, extracted from
  `search/search.ts` per OC2 so there is one chunk→row mapping, not two

## Testing Strategy
apps/server scoped: fixture workspace covering the five shapes + bound-overflow case.

## E2E Verification Plan
Real server: comment on a section of a seeded doc, `curl` the pack — passage, section, related excerpts all verifiable against files on disk.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context), 2026-08-02. Port **8804** only;
scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s022-server/047-e2e`;
no git command run by this agent; nothing touched outside `apps/server/` and this
issue file. **Warm per-user model cache, no download** (sprint-022 authorises it);
the shared cache was read, never written or pruned.

### Files touched

New: `apps/server/src/threads/context.ts` (the assembly),
`apps/server/src/threads/context.test.ts` (35 tests),
`apps/server/src/semantic/passages.ts` (the OC2 extraction).

Edited: `threads/routes.ts` (the route + `ThreadRoutesOptions`),
`threads/read.ts` (`ThreadReader` — a *widening*, see below),
`threads/index.ts` and `semantic/index.ts` (barrels), `search/search.ts` (the
extraction's donor site), `app.ts` (one line: `{ semantic }` into
`mountThreadRoutes`).

### The extraction (OC2 / TEST-977) — pure motion plus one defaulted parameter

`loadSemanticOnlyHits` and `SemanticOnlyHit` moved from `search/search.ts:300-357`
to `semantic/passages.ts` **body-identical**, name and doc comment included
(TEST-977 names the function in its extracted form, so it was not renamed). The
single delta: a third parameter `maxChars: number = ONE_LINE_MAX_CHARS`, applied
at the one `toOneLine` call. `search.ts`'s call site is unchanged and passes
nothing, so its output is byte-identical; the pack passes
`CONTEXT_MAX_EXCERPT_CHARS` (320), which is why the parameter exists at all — the
alternative (return the raw chunk body and shape it in two callers) is the second
implementation the extraction exists to prevent.

```
$ /usr/bin/grep -rn "function loadSemanticOnlyHits" apps/server/src
apps/server/src/semantic/passages.ts:44:export function loadSemanticOnlyHits(
```

One definition. Phase A/B suites re-run with **no assertion edited**:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/search \
      apps/server/src/docs/related.test.ts apps/server/src/docs/related-semantic.test.ts \
      apps/server/src/threads apps/server/src/app.test.ts
    Test Files  21 passed (21)
         Tests  452 passed (452)
```

Both committed snapshots (`search/phase-a-search.snapshot.json`,
`docs/phase-a-related.snapshot.json`) are inside that run and green.

### `ThreadReader` — the one signature that moved, and why

`loadThread`/`readThread` took a whole `ThreadsWorkspace`; they now take
`ThreadReader` (`workspaceRoot`, `projection`, `now`). This is a **widening** —
every `ThreadsWorkspace` satisfies it, so no caller changed — and it is what lets
a read-only surface be constructed in a test without standing up a git
repository, an invalidation bus and a queue it never touches.

### The five-shape decision, in one place

| Condition | Shape |
| --- | --- |
| `parent = null` | `standalone` |
| `parent ≠ null`, no readable parent | `parent-deleted` (200, `deletedParent` names the id) |
| parent readable, `anchor = null` | `whole-document` |
| parent readable, anchor present, `anchors.resolved_offset` NULL **or** the offset no longer slices the quote out of the file | `orphaned-anchor` |
| otherwise | `anchored` |

"No readable parent" is deliberately two facts with one answer: no `documents`
row (`DELETE /api/docs/{id}`), or a row whose file vanished under it. Both are
"the document this conversation was about is gone", and neither may become a 404
about a thread that exists. An *unparseable* parent is deliberately **not**
caught — that is a 500 either way, and reporting it as deleted would hide a
workspace someone must repair.

The offset cross-check (`body.slice(offset, offset + exact.length) === exact`) is
a slice comparison, never a search: the projection can lag a save by the width of
a watcher tick, and reporting the wrong section as "the passage this conversation
is about" is worse than reporting the anchor as orphaned for that fraction of a
second. It is **not** a fuzzy rung — TEST-958's near-miss fixture (one character
different from a passage that *is* in the body) orphans, as it must.

### TEST-956 / TEST-957 — the whole section, on a real server

Anchored thread `th_zdg2aius` on `doc_54oblxxe` ("Mortgage options"), anchored on
`recalculated annually under fixed terms`, which sits mid-way through the file's
third heading section:

```
$ curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8804/api/threads/th_zdg2aius/context
HTTP 200   2325 bytes
{
  "shape": "anchored",
  "parent": {
    "id": "doc_54oblxxe",
    "title": "Mortgage options",
    "headingPath": "Mortgage › Escrow",
    "quote": "recalculated annually under fixed terms",
    "section": "## Escrow\n\nThe escrow reserve is recalculated annually under fixed terms. See [[doc_srorxgeh]].\n\nA second paragraph inside the escrow section, so the anchor is not the whole of it.\n\n",
    "truncated": false
  },
  …
}
$ awk '/^## Escrow$/{f=1} /^## Fees$/{f=0} f' ws/data/docs/finance/mortgage-options.md > file-section.txt
$ diff file-section.txt pack-section.txt
    (no output)                       → BYTE-IDENTICAL to the file's section 3
```

That section fits in one chunk, so a second document proves the distinction the
constant was chosen for. `doc_u3dbw462`, whose `## Long` section is 3854
characters, is split by the chunker into **two** chunks:

```
 chunk 0 | Head              |   18 chars
 chunk 1 | Head › Long       | 1985 chars
 chunk 2 | Head › Long       | 1869 chars

pack section length : 3854   truncated: false
largest chunk       : 1985
section > every chunk: true
section is not 2000  : true          ← the diagnostic failure signature, absent
$ diff long-file-section.txt long-pack-section.txt
    (no output)                       → the multi-chunk section came back whole
```

Unit side, same property against `headingSections`' own answer plus the file's
bytes, and the >4000-character case truncated **around the anchor** (the quote
lands at offset ~1979 of a 4000-character window, `truncated: true`).

### TEST-981 — all five shapes, one running server, five 200s

| Shape | Thread | Status | Distinguishing field |
| --- | --- | --- | --- |
| `anchored` | `th_zdg2aius` | 200 | `parent.section` + `parent.quote` + `parent.headingPath` |
| `whole-document` | `th_depuuyoj` | 200 | `parent.opening` = `"Preamble sentence that opens the mortgage note.\n\n"` |
| `standalone` | `th_t5fetkqj` | 200 | **no `parent` key at all** |
| `orphaned-anchor` | `th_znwafwez` | 200 | `parent.quote` = `"THE ANCHOR PHRASE LIVES HERE."`, no `section`, no `headingPath` |
| `parent-deleted` | `th_m66wveop` | 200 | `deletedParent` = `doc_xbnup3ze` |

The orphan was produced by editing the parent so the quote no longer resolves —
the server said so itself, and the projection agrees:

```
$ corpus doc edit doc_u3dbw462 --file long-edited.md
edited doc_u3dbw462 — 1 orphaned (th_znwafwez) — warning: orphaned_anchor
  (anchor `anc_2f67c22e` no longer resolves in the body; its thread is orphaned)
$ sqlite: SELECT anchor_id, resolved_offset FROM anchors WHERE doc_id='doc_u3dbw462'
  anc_2f67c22e | resolved_offset = null | exact = "THE ANCHOR PHRASE LIVES HERE."
```

The deleted parent by `corpus doc delete`, and the 404/200 split is the whole
point of OC9:

```
deleted doc_xbnup3ze — orphaned 1 thread (th_m66wveop)
GET /api/docs/doc_xbnup3ze          -> HTTP 404      (the parent really is gone)
GET /api/threads/th_m66wveop        -> HTTP 200      (the thread really exists)
GET /api/threads/th_m66wveop/context-> HTTP 200      shape "parent-deleted"
```

### TEST-980 / the Phase 8 payoff — a keyword-disjoint neighbour inside the pack

`doc_kp62gce5` ("Impound account true-up": *"The lender re-runs the impound
analysis every twelve months and adjusts the monthly cushion accordingly."*)
shares **no content word** with the anchored passage:

```
$ /usr/bin/grep -c -i -E "recalculated|annually|fixed|terms|escrow|reserve" \
      ws/data/docs/finance/impound-account-true-up.md
0
```

It is cited by nothing and cites nothing, so the links graph cannot reach it —
and it is in the pack, labelled `similar`, with `semanticIndex: "current"`:

```
excerpts (8):
  doc_ouapdkmh | similar | Boilers                   | ## Boilers The boiler swap is scheduled …
  doc_srorxgeh | linked  | Cabinet delivery schedule | Cabinets arrive on Tuesday and the …
  th_t5fetkqj  | similar | user · 2026-08-02T02:51:58Z | Where did the boiler quote end up? …
  doc_kp62gce5 | similar | Impound account true-up   | The lender re-runs the impound analysis …   ← Phase 8
  …
```

Every excerpt's `headingPath` checked against `chunk_search` with sqlite3 — all
eight either appear as a `heading_path` for that document **or** equal the
document's title (§9.2's floor for a links-only row):

```
ok  doc_ouapdkmh | "Boilers"                     | in chunk_search: true  | == title: false
ok  doc_srorxgeh | "Cabinet delivery schedule"   | in chunk_search: true  | == title: true
ok  th_t5fetkqj  | "user · 2026-08-02T02:51:58Z" | in chunk_search: true  | == title: false
ok  doc_kp62gce5 | "Impound account true-up"     | in chunk_search: true  | == title: true
ok  doc_skillorchestrate | "Locks and deferral"  | in chunk_search: true  | == title: false
ok  doc_skillcomment | "Worked examples"         | in chunk_search: true  | == title: false
ok  doc_skill61c2325d | "Todos › Reporting back" | in chunk_search: true  | == title: false
ok  th_depuuyoj  | "user · 2026-08-02T02:51:58Z" | in chunk_search: true  | == title: false
```

### TEST-970 / TEST-972 — a briefing, never a dump

Measured pack sizes on the real server, over a 19-document workspace:

| shape | bytes |
| --- | --- |
| anchored | 2525 |
| whole-document | 2733 |
| standalone | 2756 |
| orphaned-anchor | 1678 |
| parent-deleted | 2803 |
| anchored, 3854-char section | 5659 |

Enforcement is **rank-then-cut**: `fuseRankings(lists, CONTEXT_MAX_EXCERPTS)`
ranks and *then* slices, over both halves fetched to
`overFetchLimit(CONTEXT_MAX_EXCERPTS)`. The unit test builds a corpus of 40
documents at strictly decreasing similarity and asserts the survivors are
`doc_bulk000…` in order rather than whatever the scan read first, with every
excerpt at or under the cap and the whole object fed through
`ContextPackSchema.safeParse` — which **every** pack in the suite is (TEST-970's
self-parse applied to all 35 tests, not one, because `strictObject` is what
catches a pack claiming one shape while carrying another's fields).

**TEST-972, with a stated deviation.** The statement count is measured through a
counting proxy over `ProjectionDb.prepare` — the seam `search.ts`'s
`loadAddresses` is counted through — and is **identical** at 40 and at 600 bulk
documents, with the response size inside a factor of two. **DEFERRED → the
sprint's "past 5,000 documents" was run at 40 vs 600 (15×) instead**: the
property asserted is exact statement-count *equality*, which is scale-free, and
seeding 5,000 real files through the real projector inside a unit test costs
minutes of suite time for no additional evidence. Substitute evidence is the
equality itself plus the measured sizes above. A `loadPassages` seam is exported
on `ContextDeps` for the same counting, asserted called exactly once per request.

### TEST-973 / TEST-974 / TEST-975 — one honest word

- The pack, `/api/search` and `/api/docs/{id}/related` are called **in one test**
  against one workspace and compared: all three report `stale` for a
  partially-embedded index, byte-identical, because all three read the same
  `SemanticOutcome.state`.
- A provider stub that **throws** while embedding yields a `200` with links-only
  excerpts and `disabled`. Never a 500.
- `deps.semantic === undefined` — the fresh-workspace path — is the links graph
  alone with `disabled`, the same answer `related.ts` and `search.ts` give.
- Per-request reading (TEST-976) is proven by a service whose resolution flips
  between two calls (a model finishing its download): the first pack is
  `disabled` with no semantic row, the second carries the neighbour. A handler
  that captured a resolved provider would fail this.

### TEST-964 / TEST-965 / TEST-978 — nothing new was invented

```
$ /usr/bin/grep -rn "forThread\|forText" apps/server/src
    (no output — exit 1)
$ /usr/bin/grep -rn "RRF_K\s*=\|RETRIEVAL_OVERFETCH_FACTOR\s*=\|RETRIEVAL_OVERFETCH_CAP\s*=" apps/server/src
apps/server/src/search/fusion.ts:38:export const RRF_K = 60;
apps/server/src/search/fusion.ts:53:export const RETRIEVAL_OVERFETCH_FACTOR = 5;
apps/server/src/search/fusion.ts:56:export const RETRIEVAL_OVERFETCH_CAP = 250;
$ /usr/bin/grep -n "SCHEMA_VERSION = " apps/server/src/projection/schema.ts
50:export const SCHEMA_VERSION = 9;
$ /usr/bin/grep -c "CREATE TABLE\|CREATE VIRTUAL TABLE" apps/server/src/projection/schema.ts
15                                        (unchanged — the pack is assembled per request)
$ /usr/bin/grep -n "runMutation\|bus.invalidate\|assertWritable\|commit\|mutex" apps/server/src/threads/context.ts
44:// Reads five tables, writes nothing, takes no lock, commits nothing and
    (a comment, and nothing else)
```

The pack calls `SemanticRetrieval.forQuery(text, scope, limit)` — the seam C3
found already existing — with the anchor's quote **plus** the thread's title and
turn bodies, bounded to `CHUNK_CHAR_BUDGET` so a hundred-turn thread does not
send a hundred turns to a provider. TEST-963 asserts the embedded string contains
the anchor text, the title *and* the turn body, that a document matching only the
turns is reachable, and that one matching neither is not.

### TEST-979 — a pure read

```
$ corpus lock acquire doc_54oblxxe --from agent
locked doc_54oblxxe for agent, lease 300s.
GET  /api/threads/th_zdg2aius/context  -> HTTP 200        ← the pack answers
PUT  /api/docs/doc_54oblxxe            -> HTTP 423        ← the control, as user
```

Unit side: a lock held by the other party, then the route — `200`, and the
invalidation bus recorded **zero** frames.

```
$ corpus db doctor
projection is clean — 19 documents from 19 files (3ms)
```

### Checks

```
$ npm run build                                                     → exit 0
$ node_modules/.bin/tsc --noEmit -p apps/server/tsconfig.json       → exit 0 (no output)
$ npm run lint                                                      → exit 0
$ ./node_modules/.bin/prettier --check apps/server/src
    All matched files use Prettier code style!                      → exit 0
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/threads/context.test.ts
    Test Files   1 passed (1)
         Tests  35 passed (35)
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server        (the one workspace run)
    Test Files  163 passed | 1 failed (164)
         Tests  3164 passed | 1 failed (3165)
```

**The one failure is a pre-existing flake, not this change.** It is in
`semantic/engine/` (the real-model worker host, `EmbeddingError` raised from
`worker-host.ts:155`) — a suite this issue does not touch and whose only relation
to the pack is that both can reach the embedded engine. Re-run in isolation and
in a second full sweep, both green:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/semantic/engine
    Test Files  11 passed (11)
         Tests  161 passed (161)
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server | grep "FAIL\|×"
    (no output)
```

**+35 tests** in `threads/context.test.ts`: the five shapes and their negatives
(8), the parent-side bound (4), the related half (10), the degrade word (5), cost
(2), and the route (6).

### Machine hygiene

`8804` bound and released (`lsof` clean before and after); `8805` never touched;
`8765` never bound; `5173` never taken; no `npm run e2e`; no repo-wide suite; no
`git` command; no `.corpus` at the repository root; the shared model cache was
read and never written.

### Deferred / not done

- **TEST-972's 5,000-document workspace** → run at 40 vs 600, reason and
  substitute evidence above.
- **No SPEC.md edit, no contract edit, no CLI/UI change.** CLI-021 consumes this.
- **A whitespace-only or absent anchor entry** yields `orphaned-anchor` with the
  empty quote rather than inventing one — §6 keeps a quote, it cannot manufacture
  one. Tested; worth a reviewer's eye if it reads wrong.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
