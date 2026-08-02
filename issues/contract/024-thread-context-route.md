# [CONTRACT-024] Route: GET /api/threads/{id}/context (bounded pack)

## Domain
contract

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: SERVER-047, CLI-021

## Spec References
- SPEC.md §9.2 context bullet (SHARED-006 Edit 9), §7 context packs (Edit 4)

## Summary
The context-pack schema: anchored passage + enclosing section from the parent
(whole-document thread → parent title + opening content; standalone → no parent
block), plus ranked related excerpts (id, heading path, short excerpt, relation).
Total size bounded by contract — the schema carries the bound (max excerpt count and
per-excerpt length) so "a briefing, never a dump" is a **published ceiling and a
test oracle** rather than a server courtesy. Read-only, no acting party.

> **Corrected 2026-08-01 (sprint-022 C5 / Open Conflict 4).** This summary
> originally read "enforceable at the type level". That is not achievable and the
> phrase is withdrawn: `z.infer` of `z.string().max(n)` is `string` and of
> `z.array(T).max(n)` is `T[]`, and nothing in the shipped stack validates a
> response — `app.openapi` handlers return `c.json(...)` unvalidated and
> `openapi-fetch` does no runtime parsing. What the contract owes is named
> exported constants, `.max()` so `maxItems`/`maxLength` reach `openapi.json`,
> and a `safeParse` that rejects overflow. Enforcement is SERVER-047's
> rank-then-cut plus its self-parse test (TEST-970).

> **Corrected 2026-08-01 (sprint-022 C1/C6/OC1/OC3/OC9).** Three further gaps in
> the text above: there are **five** thread shapes, not three (orphaned anchor and
> deleted parent were missed); the envelope carries **`semanticIndex`**, which
> this file never mentioned though SERVER-047 and CLI-021 both assume it; and the
> parent block carries an explicit **truncation flag** (OC1 — the bound wins over
> "the whole enclosing section", but visibly).

## Acceptance Criteria
- [x] Route in `ENDPOINT_INVENTORY`; §9.2 spelling exact; inventory test green
- [x] Pack schema distinguishes all **five** parent cases on one discriminated field; bounds encoded in the schema (length/count caps) as named exported constants
- [x] Envelope carries the shared `semanticIndex` field (OC3), reusing the exported `semanticIndexField`
- [x] Parent block carries the truncation flag and its cap (OC1)
- [x] openapi.json + client regenerated, regeneration idempotent

## Technical Design
### Files to Create/Modify
- `packages/contract/src/schemas/context.ts` (new — the pack schemas and caps),
  `routes/threads.ts` (context route), `inventory.ts`, `schemas/retrieval.ts`
  (export `semanticIndexField`), barrels, regenerated artifacts

## Testing Strategy
packages/contract scoped: schema round-trips incl. bound violations rejected, inventory equality.

## E2E Verification Plan
Build + drift check green; client exposes the typed method.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context), 2026-08-01. No server started
(sprint-022 assigns CONTRACT-024 no port), no port bound, no git command run, no
dependency added. Nothing outside `packages/contract` was modified except this
issue file.

### Files touched

New: `packages/contract/src/schemas/context.ts`,
`packages/contract/src/schemas/context.test.ts`,
`packages/contract/src/routes/thread-context.test.ts`.

Edited: `routes/threads.ts` (the route definition), `routes/inventory.ts` (one
entry + provenance note), `routes/index.ts` (registry + ordering note),
`schemas/index.ts` (barrel), `schemas/retrieval.ts` (**`export` on
`semanticIndexField` plus prose — nothing else**), and four existing test files
extended (`openapi.test.ts`, `routes/index.test.ts`, `client/index.test.ts`,
`schemas/retrieval.compat.test.ts`). Regenerated: `openapi.json`,
`src/client/schema.generated.ts`.

### TEST-942 — §9.2 inventory walk (manual; nothing here parses SPEC.md)

`SPEC.md:344`, quoted verbatim:

> - `GET /api/threads/:id/context` _(Retrieval Phase C)_ — the thread's **context
>   pack** (§7 Retrieval discipline): the anchored passage with its enclosing
>   section from the parent (a whole-document thread gets the parent's title and
>   opening content; a standalone thread, no parent content), plus the top
>   most-related excerpts across the corpus — each an id + heading path + short
>   excerpt — bounded in total size. Read-only; no acting party.

`SPEC.md:285`, §7's context-packs paragraph, quoted verbatim:

> **Context packs** _(Retrieval Phase C)_. `corpus thread context <id>` (via
> `GET /api/threads/:id/context`, §9.2) returns a thread's **briefing**: the
> anchored passage with its enclosing section from the parent document (a
> whole-document thread gets the parent's title and opening content; a standalone
> thread has no parent content), plus the most-related excerpts from across the
> corpus — each an id + heading path + short excerpt, ranked by relatedness to the
> thread's anchor and text (links, and with Phase B, semantic similarity). The
> pack is **bounded**: reading it costs roughly the same however large the corpus
> grows — a briefing, never a dump. From Phase C the comment skill starts from the
> pack (above).

Walked phrase by phrase against the declarations:

| §9.2 / §7 phrase | Where it lands |
| --- | --- |
| `GET /api/threads/:id/context` | `ENDPOINT_INVENTORY` entry `GET /api/threads/{id}/context` — same spelling under the document's `{id}` convention, placed directly after `GET /api/threads/{id}`, which is §9.2's own bullet order |
| "the anchored passage with its enclosing section from the parent" | `AnchoredContextPack.parent.{quote, section}`; `section` is documented as the *whole* heading section, "not a window around the match, and not one chunk of a section" |
| "a whole-document thread gets the parent's title and opening content" | `WholeDocumentContextPack.parent.{title, opening}` |
| "a standalone thread, no parent content" | `StandaloneContextPack` declares **no `parent` property at all** — asserted in `openapi.test.ts`, not merely omitted |
| "the top most-related excerpts across the corpus" | `excerpts`, `maxItems: 10` on every variant |
| "each an id + heading path + short excerpt" | `ContextExcerpt` = `id`, `headingPath`, `excerpt` (+ `relation`, the sprint's addition) — key order asserted |
| "ranked by relatedness to the thread's anchor and text" | stated in `excerpts`' published description; the ranking itself is SERVER-047's |
| "bounded in total size" / "costs roughly the same however large the corpus grows" | four exported caps, published as `maxItems`/`maxLength`; the sentence is quoted in the route description and pinned by a test |
| "Read-only; no acting party" | `request` has exactly one key (`params`); no `ActorHeaderSchema`, no `requestBody`; the phrase is in the route description verbatim |
| (not in §9.2 — OC9) deleted parent | `DeletedParentContextPack`, a `200` naming the id that no longer resolves |

Nothing in §9.2's bullet asks for a query parameter, and the route declares none
(TEST-955): `parameters` is exactly `["path:id"]`, and the generated client types
it `query?: never`.

### TEST-947 — what the bound is, and what it is not (C5 / Open Conflict 4)

In my own words, and written into `schemas/context.ts`'s docblock so it is legible
where the caps live rather than only here:

`z.infer` **erases `.max()`** — `z.infer<typeof z.string().max(320)>` is `string`,
and `z.infer<typeof z.array(T).max(10)>` is `T[]`. Confirmed in the generated
client: `AnchoredContextPack.excerpts` is
`components["schemas"]["ContextExcerpt"][]`, with the cap present only as a
`@description` comment. Separately, **no shipped path validates a response**:
`app.openapi` handlers hand `c.json(...)` straight out, and `openapi-fetch` does
no runtime parsing. So an over-cap pack would reach a client unchallenged, and the
issue's original phrase "enforceable at the type level" was withdrawn (correction
applied in the Summary above).

What the `.max()` calls genuinely buy, in four places:

1. **A published ceiling.** `maxItems: 10` on `excerpts` in all five variants;
   `maxLength: 320` on `ContextExcerpt.excerpt`; `maxLength: 4000` on
   `AnchoredContextPack.parent.section` and `WholeDocumentContextPack.parent.opening`;
   `maxLength: 1000` on both `quote` fields. Every one asserted against the built
   document in `openapi.test.ts`.
2. **Named exported constants** — `CONTEXT_MAX_EXCERPTS`,
   `CONTEXT_MAX_EXCERPT_CHARS`, `CONTEXT_MAX_SECTION_CHARS`,
   `CONTEXT_MAX_QUOTE_CHARS`. No inline magic number; the tests name the constant
   rather than repeating its value, so a re-tuned cap needs no test edit.
3. **A parser that rejects overflow**, in both directions and at the boundary:
   at-cap parses, cap+1 fails, for the array count and for all four string fields.
4. **A test oracle for SERVER-047**, which owns actual enforcement by
   **rank-then-cut** (rank the candidates, *then* cut) plus TEST-970's self-parse.
   Every variant is a `strictObject`, so the self-parse also catches a pack that
   claims one shape while carrying another's fields — which a lenient object would
   silently strip.

One number is chosen rather than inherited and is worth recording:
`CONTEXT_MAX_SECTION_CHARS = 4000`, deliberately **not** the server's
`CHUNK_CHAR_BUDGET = 2000`. A section larger than the chunk budget is split into
several chunks, so a chunk is a fragment of a section by construction; setting the
cap to the budget would make "the section" and "one chunk" indistinguishable on
the wire, and TEST-957's failure signature ("a parent block that happens to be
exactly 2000 characters") would stop being diagnostic. A test asserts the two
never coincide.

### TEST-948 — the staleness word is the shared one

```
$ /usr/bin/grep -n "SEMANTIC_INDEX_STATES = " packages/contract/src/schemas/retrieval.ts
92:export const SEMANTIC_INDEX_STATES = ["current", "indexing", "stale", "disabled"] as const;
$ /usr/bin/grep -rn --include="*.ts" --include="*.json" -e "catching-up" -e "lexical-only" \
      packages/contract/src packages/contract/openapi.json | /usr/bin/grep -v "\.test\.ts"
    (no output — exit 1)
```

Byte-identical to CONTRACT-022's, and neither invented word exists outside the two
tests that assert they are rejected. Per OC3, `semanticIndexField` was made
`export` (the one executable line changed in `retrieval.ts`) and the pack **reuses
the field object**, not a retyped description — `openapi.test.ts` compares
`AnchoredContextPack.semanticIndex.description` to `SearchResults`' with `toBe`,
so a retyped sentence fails. It stays optional on every variant, so a server that
makes no claim says nothing.

### TEST-949 — the excerpt row, and why it is not `RelatedDoc` (C4)

`SPEC.md:285` and `:344` both say "each an id + heading path + short excerpt".
`RelatedDoc` is `{id, title, excerpt, relation}` — **no `headingPath`** — and its
excerpt is deliberately the document's *opening* line rather than the passage that
matched. So the pack's row is a new shape (`ContextExcerpt`), not a widening of a
frozen one; Open Conflict 2's option (C) was rejected and
`retrieval.compat.test.ts` now asserts `headingPath` stayed off `RelatedDoc` from
both directions.

### TEST-950 / TEST-951 — the frozen shapes did not move

`schemas/retrieval.ts`'s only executable change is `const` → `export const` on
`semanticIndexField`; everything else is prose. Asserted rather than reviewed
(no git available to this agent): `retrieval.compat.test.ts` now pins
`SearchHitSchema`'s and `RelatedDocSchema`'s key lists field for field, both limit
constants (`10` / `50`), and both frozen enums, and re-checks that a
CONTRACT-022-era payload still satisfies the generated components *and* the
inferred types. `openapi.json`'s `SearchHit`, `SearchResults`, `RelatedDoc` and
`RelatedDocs` components are unchanged by this issue.

### Build, generation, idempotence (TEST-954)

```
$ npm run build                                   → exit 0
$ npm run generate -w packages/contract           → exit 0
    generated ./openapi.json
    generated ./src/client/schema.generated.ts
$ shasum -a 256 openapi.json src/client/schema.generated.ts > /tmp/c024-after.sha
    abccc53e1a27347e56fe3bccb2f4a3d60acb86f14ab4a0beff532815e90952f8  openapi.json
    11c173d17d1867cfed9ac8037962046c09ed12e8432f38d5c52d01ac85550912  src/client/schema.generated.ts
$ npm run generate -w packages/contract           → exit 0     (second run)
$ shasum -a 256 -c /tmp/c024-after.sha
    openapi.json: OK
    src/client/schema.generated.ts: OK            → exit 0
$ npm run build                                   → exit 0     (after regeneration)
```

Generation is idempotent, so the committed artifacts are exactly what a drift
check regenerates. `generation/artifacts.test.ts` (the in-repo drift check) and
`routes/inventory.test.ts` — which reads the **committed** `openapi.json` from
disk and declares the inventory's method+path set exactly — are both green.

**DEFERRED → `node --import tsx scripts/check-generated-artifacts.ts`.** Its
second half is `git --no-pager diff --stat HEAD -- <artifacts>`, which is dirty by
construction for uncommitted work, and this agent is barred from running git at
all (house rule). Substitute evidence: the hash-across-regeneration half above,
which the script itself documents as the stricter of the two ("hashing across the
regeneration catches staleness even for an artifact git does not track yet, which
a `git diff` would silently skip"), plus the two in-suite tests named above. The
HEAD-diff half is the orchestrator's post-commit gate.

### The route in the generated artifacts

```
$ /usr/bin/grep -n "api/threads/{id}/context" packages/contract/src/client/schema.generated.ts
1098:    "/api/threads/{id}/context": {
```

The typed method is at `paths["/api/threads/{id}/context"]["get"]`, and the
generated operation reads:

```ts
get: {
    parameters: {
        query?: never;                      // ← TEST-955, at the type level
        header?: never;
        path: { id: string };
        cookie?: never;
    };
    requestBody?: never;                    // ← TEST-952
    responses: {
        200: { content: { "application/json":
              components["schemas"]["AnchoredContextPack"]
            | components["schemas"]["WholeDocumentContextPack"]
            | components["schemas"]["OrphanedAnchorContextPack"]
            | components["schemas"]["StandaloneContextPack"]
            | components["schemas"]["DeletedParentContextPack"] } };
        400: …; 401: …; 404: …;
    };
}
```

Driven for real in `client/index.test.ts` against a mounted `OpenAPIHono` app:
four typed calls, narrowing on `data.shape` (anchored → `parent.section`,
standalone → no `parent` key, parent-deleted → `deletedParent` under a `200`, and
an unknown id surfacing as the shipped typed `not_found`). A compile-time
assertion (`ContextOperation["parameters"] extends { query?: never }`) breaks the
build if a query parameter is ever added.

### Decisions worth recording

- **The union is registered branch-by-branch, not as a component.**
  zod-to-openapi renders a registered `discriminatedUnion` as `oneOf` +
  `discriminator` with no `type: "object"`, which would trip `openapi.test.ts`'s
  "every named component is a plain, non-nullable, undefaulted object" invariant —
  the guard that catches `Named.nullable()` silently rewriting a shared component.
  Inlining the `oneOf` into the response and registering the five *variants* keeps
  that invariant strict at zero cost: every branch is still a referenced component,
  and the generated client is a clean five-way union. A test asserts `ContextPack`
  is **absent** from the component list, so the choice cannot be undone by accident.
- **The discriminant is on the envelope, not on the parent block.** Putting a
  `kind` on `parent` would have made the standalone case "a parent block that says
  there is no parent", which is the probing TEST-943 exists to forbid — and would
  contradict TEST-961's "the parent block is absent, not an empty object". `shape`
  on the envelope satisfies both: one field to read, and two variants that declare
  no `parent` property at all.
- **Response schemas are `strictObject`** — a first for this contract, whose
  strictness policy (`schemas/index.ts`) is written about request *bodies*. It is
  the mechanism behind TEST-943's negative half and behind SERVER-047's self-parse
  test: without it, `{shape: "standalone", parent: {…}}` parses happily with the
  parent stripped. It costs clients nothing, since nothing runtime-validates a
  response.
- **One `truncated` flag per parent block, not one per field.** OC1 asks for a
  truncation claim on the section; the same flag covers a truncated quote, because
  what the agent needs to know is "did I see all of the parent-side text", not
  which field was cut. It is required, not optional — silence is the failure mode
  the flag exists to prevent.
- **Four caps, and the section cap is chosen away from `CHUNK_CHAR_BUDGET`** —
  see TEST-947 above.
- **No `title` on `ContextExcerpt`.** `headingPath` already falls back to the
  document's title for a passage under no heading (the rule `SearchHit` publishes
  and §9.2's floor TEST-966 names), so a title field would carry the same
  information twice in a surface whose reason to exist is frugality. A test
  asserts a row carrying `title` is rejected.

### Checks

```
$ node_modules/.bin/tsc --noEmit          (in packages/contract)     → exit 0
$ npm run lint                                                       → exit 0
$ ./node_modules/.bin/prettier --check packages/contract/src packages/contract/openapi.json
    All matched files use Prettier code style!                       → exit 0
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
    Test Files  47 passed (47)
         Tests  1652 passed (1652)                                   → exit 0
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/app.test.ts
    Test Files   1 passed (1)
         Tests  48 passed (48)                                       → exit 0
```

The server sweep is included because `app.test.ts:126` iterates
`ALL_CONTRACT_ROUTES` and asserts every unmounted declared path `404`s — adding a
route to the contract is exactly the change that can break it. It does not:
`/api/threads/sample/context` `404`s as expected until SERVER-047 mounts it.

**+108 tests** over the pre-issue baseline (1544 → 1652): 60 in
`schemas/context.test.ts` (shapes, round-trips, cross-case rejection, the four
caps at and past the boundary, the truncation flag, the shared degrade word), 13
in `routes/thread-context.test.ts` (the declaration and its absences), +21 in
`openapi.test.ts` (a `CONTRACT-024` describe block over the built document), +5 in
`routes/index.test.ts` (three shapes served off one mounted route, plus the
`/api/threads/{id}` vs `.../context` routing hazard), +5 in `client/index.test.ts`
(typed calls with narrowing), +4 in `schemas/retrieval.compat.test.ts` (the frozen
shapes did not move).

### Deferred / not done

- **No `apps/server`, `apps/cli` or `apps/ui` change.** SERVER-047 and CLI-021
  consume this; `npm run build` type-emits every workspace against the regenerated
  client and is green.
- **`npm run e2e` not run** — CONTRACT-024 starts nothing and owns no port, and
  the sprint makes e2e single-holder.
- **No SPEC.md edit.** Per the orchestrator's adjudication of OC1, the truncation
  flag fits §7's signed "bounded" briefing and needs no spec text now; if a
  reviewer judges otherwise, that is a §7 amendment the orchestrator prepares for
  sign-off, never this agent.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
