# [CONTRACT-022] Routes: GET /api/search + GET /api/docs/{id}/related

## Domain
contract

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-006 (amendment applied to SPEC.md)
- Blocks: SERVER-040, SERVER-041, CLI-019, CONTRACT-023, CONTRACT-024, UI-025

## Spec References
- SPEC.md §9.2 (SHARED-006 draft Edits 7, 8 — apply-time text), §7 Retrieval discipline (Edit 4)

## Summary
Retrieval Phase A's two read-only routes, with **frozen response shapes** (Phase B
upgrades ranking in place; the shapes never change — the signed drafting decision).

- `GET /api/search`: `q` required; the full `GET /api/docs` filter set with identical
  semantics (incl. archived default); `limit`. Hit = document id, title, heading path
  of the best-matching passage (turn heading for thread hits), one-line snippet —
  never a body. Include from day one the **optional** semantic-staleness flag field on
  the response envelope (absent/`current` in Phase A) so Phase B is additive-only.
- `GET /api/docs/{id}/related`: `limit`, `includeArchived`. Row = id, title, one-line
  excerpt, relation literal (`linked | similar | both`) — `similar`/`both` unused
  until Phase B but in the enum now (shape freeze).

Both read-only, no acting party, bearer-guarded like everything else.

## Acceptance Criteria
- [x] Both routes in `ENDPOINT_INVENTORY` and §9.2 spelling matches exactly (inventory test green — the
      inventory equality is a test; the §9.2 *spelling* agreement is manual, see C6 note in the log)
- [x] Zod schemas: search hit and related row shapes as above; filters reuse the existing docs-list query schema (shared, not copied)
- [x] Generated openapi.json + typed client updated, drift check green
- [x] Response envelope carries the optional semantic-state field, documented as Phase B's seam

## Recorded Decisions (frozen shapes — Phase B reads these)

1. **Semantic-state field name: `semanticIndex`** (TEST-666). Optional, on **both** envelopes
   (`SearchResults` and `RelatedDocs`), enum `current | indexing | stale | disabled`, absent-or-
   `current` in Phase A with nothing behind it. The published rule is **"treat any value other than
   `current` as degraded"** rather than an exhaustive match, so a Phase B value a client has never
   heard of still reads correctly — that is what keeps the field additive rather than a widening.
   CLI-019's TEST-705 and CLI-020 key off this name. _Rejected:_ `semanticState` (state of what?
   collides with queue/thread "state" vocabulary); a boolean `degraded` (loses the *why*, and Phase B
   wants to distinguish "building" from "not configured").
   _Why it also rides on the related envelope:_ §9.2's related bullet says semantically similar
   documents join **that** ranked list in Phase B too, so the same degradation applies there; adding
   it later would be the shape change the freeze exists to prevent.
2. **Both `limit` caps: default 10, maximum 50** (`RETRIEVAL_DEFAULT_LIMIT` / `RETRIEVAL_MAX_LIMIT`,
   one definition used by both routes — TEST-671, TEST-696). _Rejected:_ inheriting
   `DEFAULT_PAGE_LIMIT = 50` / `MAX_PAGE_LIMIT = 200`. 200 one-line hits is a page of prose the agent
   never asked for on a surface whose only justification is token frugality; ten is what a first look
   at a ranked list is for, fifty is the ceiling for a rare sweep. A caller wanting breadth wants
   `GET /api/docs`, which pages properly. Asserted in `retrieval.test.ts` (`< DEFAULT_PAGE_LIMIT`,
   `< MAX_PAGE_LIMIT`) so a later "harmonisation" fails a test.
3. **`headingPath` is one string, and the separator is contract-level** —
   `HEADING_PATH_SEPARATOR = " › "` (U+203A, spaced), exported from `@corpus/contract`. §9.2 calls it
   "the heading path … its address inside the document", and the sprint expects SERVER-040 to choose a
   separator "once and use it everywhere"; pinning it here means server, CLI and any later UI render
   one address format instead of three. It is documented as a **display join**: print it, never split
   on it (a heading may contain the character). _Rejected:_ `string[]` — unambiguous, but it moves the
   separator decision into every consumer and buys structure no Phase A surface uses.
4. **No score/rank field on a hit** (TEST-665 allows one only with written justification; none is
   claimed). A bm25 number is meaningless outside the corpus it was computed against, the order
   already carries it, and Phase B recomputes relevance from a different combination.
5. **`q` is not in the shared filter shape.** It is the query, not a structured filter, and its
   optionality is the one thing the two endpoints genuinely disagree about (optional on the collection
   query, required on ranked retrieval). Each declares its own with its own description; the fourteen
   *structured* filters are shared. §9.2's promise is about "the structured filters", so this is the
   literal reading, not a loophole.
6. **`RelatedQuerySchema.includeArchived` is declared locally, not spread from `docFilterShape`.** The
   shared description is written around `status` (the no-op-alongside-explicit-`status` sentence), and
   `/api/docs/{id}/related` takes no `status` — reusing it would publish a sentence about a parameter
   that is not on the route. The *rule* is the same and says so. Reasoning is in a code comment at the
   declaration.

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/search.ts` (new), `docs.ts` (related route), `inventory.ts`, barrel, regenerated `openapi.json`
- Reuse/extract the docs-list query param schema so search and docs cannot drift

## Testing Strategy
packages/contract scoped: inventory equality, schema round-trips (hit/row parse, enum), openapi snapshot.

## E2E Verification Plan
`npm run build` then the generated client typechecks against both routes; openapi drift check green.

## E2E Verification Log

**Implemented on: opus** (2026-07-31, sprint-019, phase-7-retrieval-a, main tree). No port, no server,
no `corpus init` — this issue's verification is the build, the generator and the drift check.
Scratch: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s019-contract/022-gbPo4S` (artifact snapshots
+ diffs; only paths created here were removed). `/Users/theophanerupin/code/corpus/.corpus` absent:
`ls -d …/.corpus` → `No such file or directory`. No git command was run by this agent (the drift check
runs `git diff --stat HEAD` internally; that is the script's own read-only call).

### Build, tests, lint

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 (contract → kit → apps; rerun scoped `-w packages/contract` after formatting) |
| `npm run typecheck` (**all** workspaces) | exit 0 — server, cli, ui, kit, plugins all compile against the refactored query schema |
| `VITEST_MAX_THREADS=4 vitest run packages/contract` | **41 files, 1461 tests, exit 0.** New this issue: 53 in `schemas/retrieval.test.ts`, 43 in `openapi.test.ts`'s "the retrieval surface (CONTRACT-022)" describe, 4 in `client/index.test.ts`'s "the typed retrieval calls", 4 in `routes/index.test.ts` (counts from `vitest -t`) |
| `VITEST_MAX_THREADS=4 vitest run apps/server/src/docs/{query,routes,fts}.test.ts` | **147 tests, exit 0, suites unmodified** (TEST-664: no server file was touched — `find -newermt` over the tree lists only `packages/contract/**` + this issue file as mine) |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 (three new/edited files were run through `prettier --write`, then artifacts regenerated: hashes unchanged) |

`npm test -w packages/contract` does not exist (no `test` script in that workspace) — the workspace run
is `vitest run packages/contract`, recorded above.

### Generation, idempotence, drift

```
npm run generate -w packages/contract      → exit 0
shasum -a 256 … (run 1)  ==  shasum -a 256 … (run 2)   → identical
dfd69fd1e4cc4323e566f80e77a4d7931c1b50df10877dda528ac049f6f41c56  packages/contract/openapi.json
e44ec79199df4f8f732f2ff831f96175aad235ebc5e643775d0b71d2a12f5513  packages/contract/src/client/schema.generated.ts
```

`node --import tsx scripts/check-generated-artifacts.ts` → **exit 1, "API contract is stale"**, with
`openapi.json +462 / schema.generated.ts +211, 673 insertions(+)`. That is the check **firing
correctly**, not a failure: it regenerates and then `git diff --stat HEAD`, so it reports every
uncommitted regeneration as drift — this agent commits nothing. It goes green the moment the
orchestrator commits the two regenerated artifacts with the source. The invariant this agent *can*
prove — that the working tree equals what the generator produces — is the byte-identical second run
above. (`docs/cli.md`: `✓ CLI reference is up to date` in the same run.)

### `/api/docs` is unmoved (OC3's stop-and-escalate bar)

Snapshotted `openapi.json` and `schema.generated.ts` **before** any edit, regenerated after, diffed:

```
diff openapi.before.json openapi.json        → hunks: 28a29,32  993a998,1056  1274a1338,1391
                                                      3534a3652,3739  3808a4014,4250  3811a4254,4273
   lines removed/changed (`^<`): 0        lines added: 462
diff schema.before.ts schema.generated.ts    → hunks: 399a400,473  647a722,811  3594a3759,3783  3686a3876,3897
   lines removed/changed (`^<`): 0        lines added: 211
```

**Every hunk is an `a` (append) hunk; zero lines were removed or modified in either artifact.** Plus a
structural check:

```
/api/docs           identical: true      /api/docs/{id}  identical: true
DocRow              identical: true      DocList         identical: true
components added:   RelatedDocs, RelatedDoc, SearchResults, SearchHit     removed: []
paths added:        /api/docs/{id}/related, /api/search                   removed: []
/api/docs param names: limit,offset,q,type,status,includeArchived,tag,folder,parent,references,
                       agent,author,since,due,stale,unread,pinned,needs,sort   (unchanged, in order)
```

So no escalation was needed: params, defaults, refinements, descriptions and **parameter order** are
byte-identical. Preserving the order required one deliberate move — `pinned` sits between `unread` and
`needs` in the published list, so `DocsQuerySchema` spreads the shared shape in two runs
(`...filtersBeforePinned`, `pinned`, `needs`, `sort`) rather than one; the reason is a comment at the
destructure. A new filter added to `docFilterShape` still lands on both endpoints untouched by that
split. `sort=relevance` without `q` still 400s (shipped `query.test.ts`/`routes.test.ts` green,
unmodified), and `pinned`/`sort`/`offset` still work.

### C5 correction — the premise is stale under Zod 4 (recorded, approach unchanged)

C5 states `DocsQuerySchema` is a `ZodEffects` with no `.omit()`. At runtime under `zod@4.4.3` it is
not:

```
node --import tsx -e "import { DocsQuerySchema } … "
ctor: ZodObject   has omit: function   has shape: object
```

Zod 4 keeps refinements inside the schema rather than wrapping it. The **substantive** half of C5 holds
and is what drove the design: `DocsQuerySchema` is a genuine superset (`pinned`, `sort`, `offset`), so
it cannot be reused wholesale for a route whose signed parameter list omits all three, and omitting
from it would drag pagination and the wrong parameter order in. Implemented per **OC3 as adjudicated**:
a base `docFilterShape` (a plain shape object) is the single definition, `DocsQuerySchema` and
`SearchQuerySchema` are both built from it.

### C6 — §9.2 spelling is asserted by a person, because nothing parses SPEC.md

Confirmed: `ENDPOINT_INVENTORY` is a hardcoded array and both tests
(`openapi.test.ts:157`, `routes/inventory.test.ts:54`) compare it to the **generated routes**. Nothing
in the repository reads `SPEC.md` — so the "§9.2 spelling matches exactly" criterion is **not**
satisfiable by a green suite, and the inventory test must not be read as evidence of it. The provenance
is instead recorded in `routes/inventory.ts`'s module comment (SHARED-006 Edits 7 and 8, signed
2026-07-30), the way every prior addition did.

The manual walk, both spellings quoted from the applied §9.2 text beside the generated routes:

> `SPEC.md:338` — `` `GET /api/search?q=&type=&status=&includeArchived=&tag=&folder=&parent=&references=&agent=&author=&since=&due=&stale=&unread=&needs=&limit=` `` _(Retrieval Phase A)_ — **ranked retrieval** over documents, threads, and turns. `q` is required; the structured filters are the same set, with the same semantics (including the archived default), as `GET /api/docs`. … each hit carries the document id, title, the heading path of the best-matching passage (for a hit in a thread turn, the turn's heading), and a one-line snippet — **never a body**. … Read-only; no acting party.

> `SPEC.md:341` — `` `GET /api/docs/:id/related?limit=&includeArchived=` `` _(Retrieval Phase A)_ — the documents most related to this one, ranked … Each row carries the document id, title, a one-line excerpt, and its relation (linked / similar / both) — never bodies. Archived documents are excluded unless `includeArchived` lifts the default, like every list. Read-only; no acting party.

Item-by-item, comparing the spec bullet's parameter string against the **generated document**:

```
SPEC  search params: q, type, status, includeArchived, tag, folder, parent, references,
                     agent, author, since, due, stale, unread, needs, limit
ROUTE search params: q, type, status, includeArchived, tag, folder, parent, references,
                     agent, author, since, due, stale, unread, needs, limit
search MATCH (order-sensitive): true

SPEC  related query params: limit, includeArchived      ROUTE: limit, includeArchived   MATCH: true
```

Path spelling: §9.2 writes `:id` (its prose convention), the contract writes `{id}` (OpenAPI's) —
`GET /api/docs/{id}/related` in `ENDPOINT_INVENTORY`, the same transliteration every existing entry
uses (`GET /api/docs/{id}`, `POST /api/locks/{docId}`). Response wording checked by hand against the
schema descriptions: hit = id + title + heading path (turn heading for a turn hit) + one-line snippet,
never a body; row = id + title + one-line excerpt + relation ∈ {linked, similar, both}; both routes
carry "Read-only; no acting party." in their published description (asserted by a test).

### Behaviour observed and written down (TEST-662's open question)

`/api/search` with `sort=relevance&offset=10&pinned=true` is **accepted, and those three are silently
stripped** — not a 400. Queries are tolerant by policy (`schemas/index.ts`: strict bodies, tolerant
reads), so this is the house rule rather than a special case. Because silence is the failure mode the
sprint called out, the route description says it in as many words ("`pinned`, `sort` and `offset` are
not among them and are ignored if sent"), and two tests pin it: a schema-level parse
(`retrieval.test.ts`) and a real request through a mounted Hono app returning `200`
(`routes/index.test.ts`).

### Typed client against a mounted app

`client/index.test.ts` mounts the real `contractRoutes.searchCorpus` / `contractRoutes.relatedDocs`
definitions on an `OpenAPIHono` app and drives them through the **generated** client
(`api.GET("/api/search", { params: { query: { q, limit, type, includeArchived } } })` and
`api.GET("/api/docs/{id}/related", { params: { path: { id }, query: … } })`). Evidence collected there:
the hit object's own keys are exactly `["id","title","headingPath","snippet"]`; the cap defaults to 10
on the wire; an unknown id comes back as the shipped typed `not_found` error. Routing is proved by the
answer, not by reading: `GET /api/docs/doc_a1b2c3/related` reaches the related handler while
`GET /api/docs/doc_a1b2c3` still returns the document (`routes/index.test.ts`) — the in-process half of
TEST-670; the over-HTTP half belongs to SERVER-041.

### Struck / deferred

- **TEST-663's "adding a filter to the base makes it appear on both with no second edit"** — proved
  statically rather than by mutating the shipped schema: `openapi.test.ts` iterates
  `Object.keys(docFilterShape)` and asserts the **published parameter objects are deep-equal** on
  `/api/docs` and `/api/search`, and that search's parameter list *is* `["q", ...keys, "limit"]`. A
  filter added to the base is therefore automatically required on both endpoints with no test edit; a
  filter added to one endpoint alone fails here. Not struck — this is the stronger available form.
- **TEST-670 (over HTTP)** — `DEFERRED → SERVER-041`. No route handler exists yet, and this batch's
  contract issue starts no server. In-process substitute above.
- Nothing else struck.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
