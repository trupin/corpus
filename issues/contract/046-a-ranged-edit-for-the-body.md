# [CONTRACT-046] The only body edit is a whole-body replacement

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-037 (rider must be signed first)
- Blocks: SERVER-079, CLI-035

## Spec References

- SPEC.md §9.2 — as amended by SHARED-037 (rider pending sign-off); today it
  documents `PUT /api/docs/:id` whole-body replacement only
- SPEC.md §6 — anchors reconciled on every write
- SPEC.md §4 — autosave squashing, author attribution

## Summary

The agent's only way to change one line of a document is to send the whole
document: `corpus doc edit` pipes a full body into `PUT`. The user asked
(2026-08-08) why insertion isn't possible and what Claude does natively — the
answer is **anchored exact-string replacement** (an `old` excerpt unique in the
file, a `new` replacement, refusal on zero or multiple matches), which costs
tokens proportional to the change rather than the document.

This issue adds that operation to the contract. It matters twice over: token
efficiency for every agent edit, and — with SHARED-035's styled text — an edit
that never carries the rest of the body **cannot wipe the style markers it never
saw**.

## Acceptance Criteria

- [x] A patch request shape: `old` (non-empty string), `new` (string, may be
      empty — deletion of the quoted text), `all` (boolean, default false).
      `PatchDocRequest` in `schemas/doc-patch.ts`; strict, and carrying **no
      `key`** (SPEC.md §7's exemption — sending one is a `400` naming it)
- [x] Semantics documented in the route definition, mirroring the native Edit
      tool contract: `old` must match the body **exactly and uniquely**;
      zero matches is a refusal naming the count (0), multiple matches is a
      refusal naming the count, unless `all` — which replaces every occurrence
- [x] The refusal shape carries the match count and is distinguishable from
      validation refusals — the caller's recovery differs (re-quote with more
      context vs. fix the content). `PatchConflictError`: `409`, `code:
      "conflict"`, `reason: no-match | multiple-matches`, `matches: n`
- [x] The response is the same shape as the existing document write response —
      a patch is an ordinary write once applied (anchors reconciled per §6,
      same commit semantics per §4). **Deliberate addition of one field**:
      `replaced`, the occurrence count — see "Design decisions" below
- [x] The operation is a **body** operation only; frontmatter keeps its existing
      field-patch semantics on `PUT` (`Doc.body` excludes the frontmatter block,
      so an `old` quoting frontmatter is a plain zero-match — no special case)
- [x] `openapi.json` regenerates with no diff; typed client exposes the route;
      schema round-trip tests cover `old`/`new`/`all` and both refusal shapes

## Design decisions (the two the orchestrator asked for judgement on)

### 1. The response carries the whole write response, plus `replaced`

`PatchDocResponse` = `{doc, anchors, warnings, replaced}` — the first three
being `docWriteResponseShape`, the *same schema instances* `UpdateDocResponse`
is built from, so the two cannot drift.

Symmetry won, for a reason stronger than symmetry: **`key.ts` fixes exactly one
publication site for a key — `Doc`.** A lean reply would need a bare `key`
field beside the response, which is precisely the "sibling `key` that could
disagree with the first" that `StaleKeyError`'s docblock already rejected. The
token argument does not survive contact either: the rider's cost complaint is
about the *request* ("priced a one-line edit at the length of the document"),
and a caller that has just changed a document it did **not** send has *more*
need of the resulting body than one that sent it — the saved body is its proof
the edit landed where it thought.

`replaced` is the one field added, because it is the one fact on the response
that the caller cannot derive from its own request. With `all: true` the caller
deliberately did not enumerate the sites, so the count is the operation's blast
radius; and a success that hid the count while **both refusals name it** would
be the odd one out.

### 2. The refusal is a third `409`, narrowing `conflict` with `reason` + `matches`

Not `400`: the body is well formed, `old` is a valid non-empty string, and the
identical request would succeed against a different version of the document.
The repo's own rule (`error.ts`) is that `400` means "fix the body and retry"
and that retrying unchanged **cannot** help here — a `400` sends the caller in
circles. Not `422`: nothing in this contract uses it, and a fourth status family
for one route buys a distinction `code`/`reason` already carries.

`409` now carries three shapes and no `code` means two things: `stale_key` keeps
its own code (it carries a whole document), while `ReattachConflictError` and
`PatchConflictError` both narrow `conflict` with a **non-overlapping** `reason`
vocabulary — pinned by a new assertion in `openapi.test.ts`. `ERROR_CODES` stays
at seven, so no consumer that switches on `code` grows a branch. The count rides
as a typed `matches` field rather than in prose, because a number a client must
parse out of a sentence is a number a client will parse wrong.

## Technical Design

### Files to Create/Modify

As built:

- `packages/contract/src/schemas/doc-patch.ts` **(new)** — request, refusal and
  response schemas, and the reasoning behind each. Its own module rather than
  more of `doc.ts`, following `reattach.ts`'s precedent
- `packages/contract/src/schemas/doc.ts` — `docWriteResponseShape` extracted, so
  `UpdateDocResponse` and `PatchDocResponse` are built from the same instances
  (byte-neutral in the published document; verified)
- `packages/contract/src/routes/doc-patch.ts` **(new)** — `POST
  /api/docs/{id}/patch`. A `PATCH` verb on the resource would collide with the
  existing frontmatter-patch semantics of `PUT` — `PUT` *is* already a field
  patch — so a named sub-resource is honest about being an operation
- `packages/contract/src/routes/doc-patch.test.ts` **(new)** — 51 tests
- `routes/index.ts` (registered after `updateDoc`), `routes/inventory.ts`
  (pinned endpoint + the derivation record), `schemas/index.ts`,
  `schemas/key.ts` (the "no key here" paragraph now describes a route that
  exists), `src/openapi.test.ts` (five pinned invariants extended)
- generated `openapi.json` + `src/client/schema.generated.ts` (regenerated)

### Key Implementation Details

Mirror the native Edit contract precisely rather than inventing near-variants:
uniqueness required by default, `all` as the explicit escape, exact-string
matching (no regex, no normalisation — the agent read the raw body from
`corpus doc show` and quotes it verbatim). Whitespace is significant; say so in
the schema description, because "close enough" matching is how a patch lands in
the wrong place.

### Edge Cases

- `old` equal to `new` — a no-op; decide refusal vs. success-no-change and
  document it (the existing write path's "only a real change" precedent at
  `update.ts:233` suggests no-op success with no commit)
- `old` spanning a frontmatter boundary — refused; the operation is body-only
- Overlapping matches with `all` (e.g. `old: "aa"` in `"aaa"`) — define the
  scan order (left-to-right, non-overlapping) so the server and any client
  simulation agree

## Testing Strategy

Vitest schema round-trips; contract-level tests that the refusal shapes carry
the count; the typed client compiles against both consumers.

## E2E Verification Plan

### Verification Steps

1. `npm run generate -w packages/contract` from a clean tree — no diff
2. Typed-client call against the route mounted on a stub app returns the typed
   response (the M1-style check)

## E2E Verification Log

**Model: opus** (contract-dev, 2026-08-12). Not a bug, so no pre-fix
reproduction — this is a new operation.

**1. Build + generation, from the source of truth.**

```
npm run build                              → exit 0
npm run generate -w packages/contract      → exit 0
  generated ./openapi.json
  generated ./src/client/schema.generated.ts
git diff --stat packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
  packages/contract/openapi.json                   | 186 +++++++++++
  packages/contract/src/client/schema.generated.ts | 140 +++++++++
  2 files changed, 326 insertions(+)
```

**Additions only, zero deletions** — extracting `docWriteResponseShape` out of
`UpdateDocResponseSchema` is byte-neutral in the published document, which is
the check that the shared shape did not quietly reshape the existing write.

**2. Generation is idempotent** (the property the drift check rests on):

```
shasum → regenerate → shasum   → identical
7f2f9a2dc08150808ca70c3eca4b253f042638c0af2a77d44745dcbc15307dea  openapi.json
c13b1d9426124884c62c3d36a7230875e0c59899611195629507aaa05a1f5588  src/client/schema.generated.ts
```

**3. The drift check fires** — hand-edited the published summary to
`"HAND EDITED"` and ran CI's own step:

```
tsx scripts/check-generated-artifacts.ts
  ✗ API contract is stale: packages/contract/openapi.json, .../schema.generated.ts
    Fix: npm run generate -w packages/contract && git add ...
```

Regenerating restored both files to the hashes above, byte for byte. (The check
also reports stale on an uncommitted-but-correct tree, since its second half
diffs against `HEAD` — it goes green once the orchestrator commits the
artifacts.)

**4. The typed client, against the route mounted on a real `OpenAPIHono` app.**
`createCorpusClient({fetch: app.request})` → `client.api.POST("/api/docs/{id}/patch", …)`,
i.e. the generated `paths` types end to end, not the Zod schemas:

```
[200 unique]     replaced= 1 key= 01234567 anchors= {"remapped":[],"orphaned":[]} body-tail= "Rate:  3.90%"
[200 all]        replaced= 2 friday-left= false
[409 zero]       status= 409 {"code":"conflict","message":"text not found","reason":"no-match","matches":0}
[409 multiple]   status= 409 {"code":"conflict","message":"text is not unique","reason":"multiple-matches","matches":2}
[400 key sent]   status= 400 {"code":"bad_request", issues:[{"path":"json","message":"Unrecognized key: \"key\""}]}
[400 empty old]  status= 400 [ 'json.old' ]
[200 no-op]      replaced= 1 body-unchanged= true
```

The two refusals are distinguishable **and** name the count, as the rider
requires; the `key` line is §7's exemption enforced rather than merely
documented (the call needed an `as never` cast to compile at all, which is the
compile-time half of the same statement).

**5. Tests.** `vitest run packages/contract` → **60 files, 2373 tests, 0
failures**, of which 51 are the new `routes/doc-patch.test.ts` (byte-exactness
against trimmed/collapsed/case-folded/CRLF quotes, regex-literal `old` and
replacement-pattern-literal `new`, the frontmatter quote as a zero-match, the
left-to-right non-overlapping scan pinned at `"aa"` in `"aaa"`/`"aaaa"`/`"aaaaa"`,
the no-op, and compile-time probes over the generated `paths`).

**6. Lint / typecheck / format.** `eslint packages/contract/src` → 0 issues;
`prettier --write` on all ten touched files → clean; `npm run typecheck` → **exit
0 in every workspace**, so no consumer breaks at type level.

**7. Known interim break, for the orchestrator — not fixable here.**
`apps/server/src/json-body.test.ts` fails 4 assertions:

```
expected [ 'POST /api/docs/{id}/patch', 404 ] to deeply equal [ 'POST /api/docs/{id}/patch', 400 ]
```

That sweep is driven by `ALL_CONTRACT_ROUTES` on purpose — "a route added later
joins the sweep by existing" — so a declared-but-unmounted route is exactly what
it reports. **SERVER-079 mounting the handler closes it**; nothing in
`packages/contract` can. Checked the other cross-domain pins: `app.test.ts`
(64 tests) and `apps/cli/src/docs` pass unchanged.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] `openapi.json` regenerated, drift check clean
- [x] E2E verification log filled in
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-046]` prefix
