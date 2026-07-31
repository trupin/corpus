# [CONTRACT-023] Routes: index status/rebuild; search staleness flag; `similar` rows live

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: SERVER-045, SERVER-046, CLI-020

## Spec References
- SPEC.md §9.2 index bullet (SHARED-006 Edit 10), §9.1 verbs bullet (Edit 6)

## Summary
Phase B's contract surface, all additive against CONTRACT-022's frozen shapes:
- `GET /api/index/status` — indexed/pending/failed counts, recorded provider/model
  identity, rebuild-in-progress flag.
- `POST /api/index/rebuild` — returns immediately (202-style), no acting party, no
  body; progress observable via status.
- Search response: the semantic-state field gains its Phase B values (current /
  catching-up / lexical-only) — documented, not shape-changed.
- Related rows: `similar` and `both` relation literals become producible (already in
  the enum since CONTRACT-022).
Inventory additions must match §9.2's applied spelling exactly.

## Acceptance Criteria
- [x] Both routes in `ENDPOINT_INVENTORY`; inventory test green
- [x] Status schema as above; rebuild is fire-and-forget with an honest response type
- [x] No breaking change to any CONTRACT-022 shape (client compiled against A-era types still typechecks — assert in a test)
- [x] openapi.json + client regenerated, drift check green

**Corrections applied from sprint-021** (these override the Summary above, which is
wrong in two places):
- **C3** — the Summary's Phase B values `catching-up` / `lexical-only` **do not
  exist**. `SEMANTIC_INDEX_STATES` is frozen at `["current", "indexing", "stale",
  "disabled"]` and was not touched. The mapping from countable facts to those four
  words is what this issue added, published on `IndexStatus.state`.
- **C4** — Phase A emits **no** `semanticIndex` field and two server tests pin its
  absence. The field stays `.optional()` on both retrieval envelopes so those
  tests' Phase B successors flip deliberately rather than being forced.
- **OC8** — `POST /api/index/rebuild` answers with the post-queue `IndexStatus`
  snapshot under `202`.
- **OC9** — a failed-chunk doctor warning needs **no** contract change; it rides
  the open `DoctorWarningKind` space. No kind literal was added.

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/index-maintenance.ts` (new — avoid clashing with the barrel `index.ts`), `search.ts` (state values), `inventory.ts`, regenerated artifacts

## Testing Strategy
packages/contract scoped: inventory equality, schema round-trips, A-compat type assertion.

## E2E Verification Plan
Build + drift check green; generated client exposes both new methods typed.

## E2E Verification Log

**implemented on: opus** (2026-07-31). No server started (sprint-021 assigns
CONTRACT-023 no port); no git command run; no dependency added.

### Files touched

New: `packages/contract/src/schemas/index-maintenance.ts`,
`packages/contract/src/routes/index-maintenance.ts`, and three test files
(`schemas/index-maintenance.test.ts`, `routes/index-maintenance.test.ts`,
`schemas/retrieval.compat.test.ts`).
Edited: `routes/inventory.ts` (two entries + provenance note), `routes/index.ts`
and `schemas/index.ts` (barrel wiring — mandatory, or the routes are unreachable),
`openapi.ts` (one `index` tag), `schemas/retrieval.ts` (**prose only** — a docblock
paragraph and one sentence appended to `semanticIndexField`'s description pointing
at the new endpoint), regenerated `openapi.json` + `src/client/schema.generated.ts`,
and three existing test files extended (`openapi.test.ts`, `routes/index.test.ts`,
`client/index.test.ts`). Nothing outside `packages/contract` was touched.

### §9.2 / §9.1 inventory walk (manual — nothing here parses SPEC.md)

`SPEC.md:355`, §9.2's index bullet, quoted verbatim:

> - `GET /api/index/status` _(Retrieval Phase B)_ — semantic-index health: indexed
>   vs. pending counts, the recorded provider/model identity, and whether a full
>   rebuild is in progress (§9.1) · `POST /api/index/rebuild` — discards and
>   asynchronously rebuilds the semantic index (§9.1): returns immediately,
>   progress observable via status. Both touch only derived runtime state — no
>   workspace file changes, no git commit, no acting party.

`SPEC.md:330`, §9.1's verbs bullet, quoted verbatim:

> - **Verbs.** `corpus index status` — coverage (indexed vs. pending), the
>   recorded provider/model identity, and whether a full rebuild is in progress.
>   `corpus index rebuild` — discards the semantic index and re-queues everything
>   (the narrow counterpart of `corpus db rebuild`, which reconstructs the whole
>   projection and likewise queues semantic re-indexing). Both are thin
>   typed-client calls (§2.2 rule 4) over the §9.2 index endpoints.

Walked item by item against the declarations:

| §9.2 / §9.1 phrase | Where it lands |
| --- | --- |
| `GET /api/index/status` | `ENDPOINT_INVENTORY` entry, byte-identical spelling |
| `POST /api/index/rebuild` | `ENDPOINT_INVENTORY` entry, byte-identical spelling |
| "indexed vs. pending counts" | `IndexStatus.indexed`, `.pending` (+ `.failed`, per the issue's own criterion) |
| "the recorded provider/model identity" | `IndexStatus.identity`, nullable pre-first-index |
| "whether a full rebuild is in progress" | `IndexStatus.rebuilding` |
| "returns immediately … progress observable via status" | `202` + post-queue snapshot; description says so |
| "no acting party" | neither route declares a `request` at all — no header, no body, no query |
| "no workspace file changes, no git commit" | no `Warning` carrier on either response |
| "thin typed-client calls" | both reachable as `client.api.GET("/api/index/status")` / `POST("/api/index/rebuild")`, exercised against a mounted Hono app |

Order note: the two entries sit between `POST /api/check` and `POST /api/skills`
because that is §9.2's own bullet order.

### Build, generation, idempotence

```
$ npm run build                                   → exit 0
$ npm run generate -w packages/contract           → exit 0
    generated ./openapi.json
    generated ./src/client/schema.generated.ts
$ shasum -a 256 openapi.json src/client/schema.generated.ts > /tmp/c023-after.sha
    911ba80ecbb3dcde685cf3811982562433b1c5e85944dbab7383d4917f10714e  openapi.json
    b0192de999d21b2297aee31eb65c128c9f59a89c71ba6817969599cb6819116f  src/client/schema.generated.ts
$ npm run generate -w packages/contract           → exit 0        (second run)
$ shasum -a 256 -c /tmp/c023-after.sha
    openapi.json: OK
    src/client/schema.generated.ts: OK            → exit 0
$ npm run build                                   → exit 0        (after regeneration)
```

Generation is idempotent, so the committed artifacts are what a drift check
regenerates. `generation/artifacts.test.ts` (the in-repo drift check, 7 tests)
is green, and `routes/inventory.test.ts` — which reads the **committed**
`openapi.json` from disk — declares the inventory's method+path set exactly
(57 tests green).

Generated client types, confirmed present:

```
$ /usr/bin/grep -n "api/index" src/client/schema.generated.ts
3117:    "/api/index/status": {
3165:    "/api/index/rebuild": {
$ /usr/bin/grep -n -A16 "        IndexStatus: {" src/client/schema.generated.ts
    indexed: number; pending: number; failed: number;
    identity: string | null; rebuilding: boolean;
    state: "current" | "indexing" | "stale" | "disabled";
```

### TEST-867 / TEST-868 — the frozen vocabulary, negative evidence

```
$ /usr/bin/grep -n "SEMANTIC_INDEX_STATES = " packages/contract/src/schemas/retrieval.ts
92:export const SEMANTIC_INDEX_STATES = ["current", "indexing", "stale", "disabled"] as const;
$ /usr/bin/grep -n "^export const RELATIONS" packages/contract/src/schemas/retrieval.ts
212:export const RELATIONS = ["linked", "similar", "both"] as const;
$ /usr/bin/grep -rn --include="*.ts" --include="*.json" -e "catching-up" -e "lexical-only" \
      apps packages plugins scripts | /usr/bin/grep -v "/dist/" | /usr/bin/grep -v "\.test\.ts"
    (no output — exit 1)
```

Both literals are byte-identical to CONTRACT-022's. The two words the issue file
and two other issue files use — `catching-up` and `lexical-only` — appear nowhere
in the shipped source or in either generated artifact; the only occurrences in the
repository are the two test files that assert they are *rejected*. **The Summary
section of this issue is wrong on that point (C3)**, and the mapping in
`IndexStatus.state`'s published description is what replaces it:
`current` (identity recorded, `pending == 0`, no rebuild) · `indexing`
(`rebuilding` true — outranks `stale`) · `stale` (backlog only) · `disabled`
(no provider / no identity / no usable vectors).

`similar` and `both` needed no contract edit at all: they have parsed since
CONTRACT-022. Making them *producible* is SERVER-045's work. The only edit in
`schemas/retrieval.ts` is prose; its executable content is unchanged.

### TEST-874 / TEST-875 — the A-compat approach

`schemas/retrieval.compat.test.ts`, following `db.compat.test.ts`'s precedent:
the CONTRACT-022-era `SearchResults` / `SearchHit` / `RelatedDocs` / `RelatedDoc`
shapes are **hand-transcribed** from `src/client/schema.generated.ts` as it stood
before this issue, deliberately derived from nothing in the package (a snapshot
that tracked the current types would assert nothing). Four directions are asserted:
an A-era payload satisfies both the generated components and the schemas' inferred
types; a Phase B payload (field present, `similar` and `both` rows) is consumed by
A-era reading code; and A-era payloads still `parse`. The assignments use the
**generated** types rather than `z.infer` on purpose — under
`exactOptionalPropertyTypes`, `z.infer` widens an optional to `?: T | undefined`
while `openapi-typescript` never emits `| undefined`, so zod types are assignable
*from* generated ones and not *to* them, for every optional field in this contract
(recorded in CONTRACT-025's compat test).

`semanticIndex` optionality is asserted by object literals missing the key: under
`exactOptionalPropertyTypes` a literal missing a *required* property is a compile
error, so those lines stop typechecking the moment the field is made required.
`SearchResultsSchema.parse({hits: []})` is separately asserted not to add the key —
which is what keeps C4's two server tests (`search.test.ts:446-447`,
`related.test.ts:245`) truthful until SERVER-045 flips them deliberately.

### Decisions worth recording

- **`202`, not `200`** (OC8). The rebuild returns before the work finishes, so the
  status code says accepted-not-completed and the body reports only what is already
  true — the `IndexStatus` snapshot taken immediately after queueing. Not a bare
  `202`: it carries the same component `status` returns, so `corpus index rebuild`
  has counts to print and no second shape was invented.
- **`state` is required on `IndexStatus`, optional on the retrieval envelopes.**
  This response *is* the claim, so there is nothing for its absence to mean; the
  envelopes must be able to say nothing (C4).
- **One `identity` string, not `provider` + `model` fields.** SERVER-043's identity
  is one sticky string (`provider/model@dim`); splitting it here would create a
  second source of truth and invite parsing. Documented as render-verbatim,
  compare-for-equality, with no regex on the wire so SERVER-043 owns the format.
- **`UNATTRIBUTED_POSTS`** — `openapi.test.ts`'s actor-header sweep previously
  exempted `POST /api/check` alone under the name `READ_ONLY_POSTS`. The rebuild is
  not read-only; it mutates *derived runtime state* that never reaches git. The set
  was renamed and both exemptions documented, and a new test asserts each exempt
  operation genuinely declares no header rather than the set becoming a parking
  space. This is the only pre-existing test whose behaviour changed.
- **OC9 needs nothing from the contract.** `DoctorWarningKind` is an open lowercase
  token, so `failed > 0` can become a doctor warning as a pure server change.
  Asserted (`DoctorWarningKindSchema.safeParse("semantic_index_failures")`) and
  commented in `routes/index-maintenance.test.ts`; no literal added to
  `DOCTOR_WARNING_KINDS`.
- **File naming (C16/OC7)** — `routes/index-maintenance.ts` per this issue's own
  Technical Design, and `schemas/index-maintenance.ts` for the same reason, so one
  domain has one name and neither competes with a barrel. A filesystem-level test
  asserts both the module and the barrel exist side by side.

### Checks

```
$ npm run typecheck -w packages/contract                     → exit 0
$ npm run lint                                               → exit 0
    (9 warnings, all in apps/server/src/projection/project-document.ts —
     SERVER-042's work in progress, not this issue's)
$ ./node_modules/.bin/prettier --check packages/contract/src packages/contract/openapi.json
    All matched files use Prettier code style!
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
    Test Files  44 passed (44)
         Tests  1531 passed (1531)
```

New coverage: 47 cases across the three new test files (21 schema round-trip and
published-mapping, 13 route-definition, 13 compat), +19 cases in `openapi.test.ts`
(a `CONTRACT-023` describe block plus the widened header exemption), +4 in
`client/index.test.ts` driving both operations through the typed client against a
mounted `OpenAPIHono` app — including the `202` arriving as `data` rather than as
an error. `routes/index.test.ts`'s stub app, which mounts **every** contract route,
gained handlers for both (it fails otherwise, which is the mounting proof).

### Deferred / not done

- **No `apps/server`, `apps/cli` or `apps/ui` change**, per the brief — SERVER-045,
  SERVER-046 and CLI-020 consume this. `npm run build` (which type-emits every
  workspace) is green against the regenerated client, and the two server sweeps
  driven by `ALL_CONTRACT_ROUTES` (`app.test.ts:125`, `json-body.test.ts`) were read
  and are generic: an unmounted route 404s, which is what both assert.
- **`GET /api/index/status` gets no SSE query key.** The index drains
  continuously; an invalidation key would be a firehose, and polling is what §9.1
  names ("progress observable via status"). Out of scope, and flagged here so its
  absence reads as a decision.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
