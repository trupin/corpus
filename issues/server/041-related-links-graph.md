# [SERVER-041] GET /api/docs/:id/related: links-graph expansion

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: CLI-019, SERVER-047, UI-025

## Spec References
- SPEC.md §9.2 related bullet (SHARED-006 Edit 8), §7 Retrieval discipline (Edit 4)

## Summary
Phase A `related`: rank documents connected to `:id` through the `links` table —
outgoing refs, backlinks, and (rank boost) mutual links. Row: id, title, one-line
excerpt (opening body line), relation `linked` (the `similar`/`both` literals exist in
the contract but are Phase B's). Archived excluded by default; 404 on unknown id;
ranking deterministic (mutual > backlink ≈ outgoing, tie-break by recency).

## Acceptance Criteria
- [x] Outgoing, incoming, and mutual refs all surface; mutual ranks first; deterministic order
- [x] Excerpts are single lines, never bodies; archived default + `includeArchived` behave like every list
- [x] Unknown id → 404 through the contract error shape

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/related.ts` (new) + route wiring; reads `links` + `documents` only — no new tables

### Decisions recorded (sprint-019 TEST-691, TEST-692, TEST-696, Done Criteria)

**Thread neighbours are included** (TEST-691's required decision). `insertLinks`
scans the body *plus every turn body*, so a `[[ref]]` typed in a reply is a
`links` row keyed on the thread's own document id, and related sets therefore
contain threads. That is the intended answer, not a leak:

- Edit 8 says "the documents most related to this one", and a thread **is** a
  document (§6) — same frontmatter, same id space, readable by the same
  `corpus doc show`.
- The conversation that referred to a document is very often the most useful
  thing near it; hiding it would make the agent's expansion strictly worse than
  the §11 backlinks panel, which already shows threads through `references=`.
- Excluding them would need a type predicate §9.2 does not authorize, and would
  have to answer what happens to a thread that references a document from its
  *preamble* rather than a turn — a distinction `links` cannot express.

Verified live: `th_ref00001` (whose only reference is inside a turn) appears in
`doc_anchor01`'s related set.

**Ranking**: `outgoing + incoming`, so a mutual pair (2) ranks above a
one-directional one (1) and outgoing ≈ backlink — §9.2 gives no reason to prefer
a direction, and inventing one would be a scoring model rather than a graph.
Ties break by recency then `id ASC`, the convention every shipped ordering
follows, with `d.updated IS NULL` first in the ORDER BY so an undated document
sorts last rather than first (SQLite puts NULLs at the top of a DESC).

**Dangling refs**: the join to `documents` is an INNER join, so a reference to a
document that does not exist is simply not a row. `links` stores those on purpose
(SPEC.md §5 — referencing a not-yet-created document is legitimate); handing the
agent an id it cannot then read would be worse than omitting it.

**Self-reference** is excluded inside the CTE: a document may legitimately
contain `[[<its own id>]]`, and "most related to this one" never means itself.

**Excerpt** (TEST-692): the stored `documents.body_excerpt` — 280 characters from
the first non-blank one, spanning lines — folded to a single bounded line by the
shared `toOneLine` helper (`core/one-line.ts`, `ONE_LINE_MAX_CHARS = 160`), the
same rule a search hit's snippet obeys. No disk read; never the multi-line slice
verbatim, which is what a *list row* wants and what shipping-it-as-one would be.

**`limit` cap** (TEST-696): `RETRIEVAL_DEFAULT_LIMIT = 10` /
`RETRIEVAL_MAX_LIMIT = 50` from the contract, same decision and same rejected
alternative as SERVER-040's (`MAX_PAGE_LIMIT = 200` is a page of prose in a
surface justified by frugality).

**`semanticIndex` is omitted**, for the same reason as on search: absent means
the server makes no claim, and Phase A has no semantic index to claim anything
about. `relation` is `linked` on every row; `similar`/`both` parse but are never
emitted.

**Reads only**: `links` + `documents`, no schema change (`PROJECTION_TABLES`
untouched), no write, no lock, no mutex. Mounted in `mountDocsRoutes` beside the
other pure projection reads — not in `write-routes.ts`.

## Testing Strategy
apps/server scoped: fixture graph (chain, mutual pair, orphan, archived neighbor), ranking and default-exclusion cases.

## E2E Verification Plan
Real server: seed three linked docs, verify ranked rows + relation labels via curl; archived neighbor appears only with the flag.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context). Date 2026-07-31. Not a bug, so no
pre-fix reproduction is required.

**Setup.** Workspace `…/tmp/s019-server/041-w9ARtA`, created from a cwd outside
this repository with `corpus init --port 8806` (port explicit; `8765` never
touched). Built CLI `apps/cli/dist/bin/corpus.js`. Server pid 75163, stopped at
the end.

Seeded graph (files written by hand, projected by the real projector — the
`links` rows below are read straight out of `.corpus/cache.db`):

```
doc_anchor01 -> doc_anchor01     (self-reference)
doc_anchor01 -> doc_archiv1      (archived neighbour)
doc_anchor01 -> doc_gone001      (dangling — no such document)
doc_anchor01 -> doc_mutual1      (mutual, with the row below)
doc_anchor01 -> doc_out0001      (outgoing)
doc_in000001 -> doc_anchor01     (incoming)
doc_mutual1  -> doc_anchor01     (mutual)
th_ref00001  -> doc_anchor01     (written inside a thread TURN)
```

plus `doc_orphan1`, connected to nothing.

**1. `GET /api/docs/doc_anchor01/related` (default).**

```json
{"related":[
 {"id":"doc_mutual1","title":"Rate ladder",
  "excerpt":"Points back at [[doc_anchor01]].","relation":"linked"},
 {"id":"doc_out0001","title":"Escrow schedule",
  "excerpt":"First line of the escrow schedule. Second line, which a one-line excerpt has to fold in.",
  "relation":"linked"},
 {"id":"doc_in000001","title":"Closing checklist",
  "excerpt":"Points at [[doc_anchor01]] for the reserve rules.","relation":"linked"},
 {"id":"th_ref00001","title":"Reserve conversation",
  "excerpt":"## user · 2026-07-21T09:00:00Z Check [[doc_anchor01]] before the closing call — the reserve rules changed.",
  "relation":"linked"}]}
```

Reading that against the graph:

- **outgoing** (`doc_out0001`), **incoming** (`doc_in000001`) and **mutual**
  (`doc_mutual1`) all surface; the orphan does not.
- **mutual ranks first** — and `doc_mutual1` is `updated: 2026-07-10`, the
  *oldest* of the three, so it can only be first because reciprocity outranks
  recency. The rest fall in recency order (07-24, 07-23, 07-21).
- the **dangling** `doc_gone001` is absent though its `links` row exists.
- the **self-reference** is absent though its `links` row exists.
- the **archived** neighbour is absent by default.
- the **thread whose reference was typed in a turn** is present — the decision
  above.
- every `excerpt` is one line (the second row's source body is two lines plus a
  leading blank; it comes back folded), every `relation` is `linked`.

**2. Archived flag.** `?includeArchived=true` →
`doc_mutual1, doc_out0001, doc_in000001, doc_archiv1, th_ref00001` — the union,
with the archived row placed by the same ranking.

**3. Determinism.** Two identical requests, byte-identical responses.

**4. Following a row (the expansion loop).**
`GET /api/docs/doc_mutual1/related` → `doc_anchor01` — the graph walks both ways.

**5. A document nothing links to.** `GET /api/docs/doc_orphan1/related` →
`{"related":[]}` — an empty set, never an error.

**6. Status codes.**

```
GET /api/docs/doc_missing1/related  -> 404 {"code":"not_found","message":"no document with id doc_missing1"}
GET /api/docs/doc_anchor01/related?limit=51 -> 400
GET /api/docs/doc_anchor01/related?limit=2  -> 200, 2 rows
GET /api/docs/doc_anchor01/related  (no Authorization) -> 401
```

The 404 body is byte-identical to `GET /api/docs/{id}`'s, via the same
`notFound()`.

**7. Routing (CONTRACT-022 TEST-670, verified over HTTP as it required).**
`GET /api/docs/doc_anchor01` still reaches the **document read**
(`200`, keys `frontmatter,body,path,anchors`) while
`GET /api/docs/doc_anchor01/related` reaches the **related handler** — neither
swallows the other.

**8. Size.** The whole four-row response is **615 bytes**; no `body`, no
`bodyExcerpt`, no frontmatter — the four contract fields per row.

**9. Cleanup.** `corpus server stop` (pid 75163);
`lsof -nP -iTCP:8806 -sTCP:LISTEN` → no listener (8804 free too);
`ls -d /Users/theophanerupin/code/corpus/.corpus` → *No such file or directory*.
No `git` command was run in this repository; scratch confined to
`…/tmp/s019-server/041-w9ARtA`, nothing glob-deleted.

**Tests.** `VITEST_MAX_THREADS=4 vitest run apps/server/src/docs/related.test.ts`
→ 17 passing (fixture graph incl. dangling, self, archived, orphan and
turn-written refs; ordering; excerpt folding; the 404; and six over-HTTP route
cases).

**Deferred / struck**: none. TEST-687 … TEST-698 were all executed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
