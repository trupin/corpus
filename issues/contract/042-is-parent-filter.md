# [CONTRACT-042] No filter can express "top-level only", so views cannot exclude children

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-024 (the §9.2 rider — **must be signed before this lands**)
- Blocks: SERVER-073, CLI-032, UI-088

## Spec References

- SPEC.md **§9.2** — the collection query endpoint's enumerated filter list
- SPEC.md **§11** — columns and saved views are filtered lists

## Summary

**Requested by the user, 2026-08-07**: "a filter query attribute called
`isParent`, so I can show parents only in views."

Today `GET /api/docs` takes `parent=<id>` — threads whose parent is *that
document*. There is no way to ask for documents that are **not a child of
anything**, so a view cannot exclude child threads, and a board column showing
threads shows sub-threads mixed in with the conversations they hang off.

This is the query-side companion to UI-087 (child threads rendering twice in a
reader). That one is a rendering defect; this is a missing capability.

## The semantics, decided

**User decision, 2026-08-07**, chosen against the alternative:

`isParent=true` selects documents whose `parent` is **null or absent** —
top-level documents. A standalone document with no children **still matches**:
it parents nothing, but it is not a child of anything, and a view of "parents
only" that hid every uncommented note would be nearly empty.

The rejected reading was "has at least one child". It matches the name more
literally and is the wrong behaviour.

**The name is misleading and that was accepted knowingly** — these are roots
rather than parents. `isRoot`, or `hasParent=false`, would say what it does.
Keeping the user's word is deliberate; nothing is published, so renaming stays
cheap. Do not rename it unilaterally.

## Acceptance Criteria

- [x] `isParent` is a boolean query parameter on `GET /api/docs` — `z.stringbool()`
      with `type: "boolean"`, the same convention `pinned` / `unread` /
      `includeArchived` already use; published as `isParent?: boolean` on the
      generated client
- [x] `isParent=true` matches documents with **no parent**; `isParent=false`
      matches documents that **are** a child of something — *declared* here (the
      published description is the contract); enforcement in SQL is SERVER-073
- [x] **Absent means no filtering**, exactly as every other optional filter
      behaves — not a default of `true`. A view that never set it must not
      change what it shows
- [x] Its description says plainly that it selects *roots*, not *documents that
      have children*, so the next reader is not misled by the name. State the
      rejected reading, or someone will "fix" it
- [x] The interaction with `parent=<id>` is **decided and stated**, not left to
      fall out: `parent=X` with `isParent=true` is a contradiction. Choose
      refusal or empty-set deliberately and say which in the description —
      **refused with `400`**; see Decision 1 below
- [x] Whether this **no-ops for non-thread types** is answered explicitly. The
      existing `parent` filter is documented as thread-only; this one probably
      should **not** be, because a non-thread document with no parent is a
      genuine top-level document and the whole point is a mixed view. Verify
      what `parent` actually holds for non-thread rows before deciding — do not
      assume it is null — **not thread-only**; see Decision 2 below
- [x] `openapi.json` and the typed client regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/query.ts` (the filter, beside `parent` at
  ~L150), plus regenerated artifacts.

### Notes

- **§9.2 enumerates the filter list literally** — `?q=&type=&status=&…&parent=&…`
  — so this needs a line there. That is SHARED-024, drafted and **awaiting user
  sign-off**. Do not apply a SPEC edit; do not land this before it is signed.
- Booleans on query strings are a place drift creeps in. Match however the
  existing `pinned` / `unread` / `stale` booleans are parsed rather than
  inventing a second convention.

## Testing Strategy

Contract tests over `true`, `false`, absent (no filtering), the contradiction
with `parent=<id>`, and shape rejection; the OpenAPI drift check as usual.

## Decisions

### Decision 1 — `parent=<id>` with `isParent=true` is **refused with `400`**, not answered with an empty set

The two are refused together because **the intersection is not empty**. `parent`
no-ops for non-thread types — its SQL predicate is
`(t.id IS NULL OR t.parent_id = ?)` (`apps/server/src/docs/filters.ts:246`), so
every non-thread row passes it unconditionally. Composed with an
`isParent=true` predicate, `parent=X&isParent=true` would return **every root
non-thread document in the workspace**: not an empty set a caller could read as
"nothing matched", but a plausible-looking list that has nothing to do with what
was asked. An empty-set answer would also be a lie about what the server did.

`400` is also the honest code by this repo's own rule (recorded on CONTRACT-038):
`400` means "fix the request and retry", and here dropping either parameter fixes
it — the caller is not sent in circles. The precedent is one rung up in the same
schema: `sort=relevance` without `q` is a `400` rather than a silent fallback.

`parent=<id>&isParent=false` is **redundant, not contradictory**, and is
accepted. It is enforced by a second `.refine()` on `DocsQuerySchema`, so it is
declared in the contract rather than left to the server to invent.

### Decision 2 — `isParent` is **not thread-only**; it is meaningful for every type

Verified before deciding, not assumed:

- The projection has **no `parent` column on `documents` at all**
  (`apps/server/src/projection/schema.ts:232`). `parent_id` lives only on
  `threads` (`:254`).
- The docs query reaches it through `LEFT JOIN threads t ON t.id = d.id`
  (`apps/server/src/docs/filters.ts:124`), and the row's `parent` is wrapped in
  `threadOnly()` — `CASE WHEN t.id IS NULL THEN NULL ELSE … END`
  (`apps/server/src/docs/query.ts:209`).
- So a non-thread row's `parent` is `null` because it **has no parent**, not
  because the value is unknown. Confirmed by running the existing assertion:

  ```
  $ vitest run apps/server/src/docs/query.test.ts \
      -t "reports null for every thread field on a document row"
  ✓ apps/server/src/docs/query.test.ts > row fields >
    reports null for every thread field on a document row
  Tests 1 passed | 84 skipped (85)
  ```

  Note that the fixture that passes is `doc_parent` — a note **with** child
  threads hanging off it. Its `parent` is `null`, so it matches `isParent=true`.
  That is exactly the semantics the user chose, verified against real projected
  data rather than argued from the name.

Therefore `isParent=true` genuinely matches a non-thread document and
`isParent=false` genuinely excludes it. That is an **answer, not a no-op**, and
a mixed top-level list of notes and standalone threads is the whole point. This
is stated in the published description so the next reader does not copy
`parent`'s thread-only rule across by analogy.

### Decision 3 (consequential, flagged for the orchestrator) — declared on `GET /api/docs` only, not on `/api/search`

`isParent` is a genuine structural filter and belongs in the shared
`docFilterShape` **on the merits** — ranked retrieval restricted to roots is a
sensible ask. It is held back for one reason only: SPEC §9.2's signed
`/api/search` parameter string does not carry it, while the signed
`GET /api/docs` string (the SHARED-024 rider) does. Publishing a parameter on
ranked retrieval is a SPEC rider, not a contract decision, so it was not taken
unilaterally.

The consequence is recorded rather than hidden: the docblock on
`docFilterShape` names this as the one exclusion that is bookkeeping rather than
principle, the `/api/search` route description says in published prose that
`isParent` is not among its filters and why, and `openapi.test.ts` pins both.
Moving it into the shared shape later is a one-line change and breaks no
consumer. **If the orchestrator wants it on ranked retrieval, that is a
one-token rider to §9.2's `/api/search` enumeration.**

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), matching the issue's `opus`
recommendation. Verified 2026-08-07. Note that the git hooks no longer build,
typecheck or test (INFRA-025), so every gate below was run by hand.

### 1. Published contract — `openapi.json`

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
exit=0

$ grep -n '"isParent"' packages/contract/openapi.json
3952: "name": "isParent"
```

The parameter is published on `/api/docs` as
`{"schema":{"type":"boolean"},"required":false,"name":"isParent","in":"query"}`,
positioned after `pinned` and before `needs`.

### 2. Generation is idempotent, and nothing was hand-edited

```
$ shasum openapi.json src/client/schema.generated.ts   # before re-run
a9fc7b3d28ae8e41cf6ef1e2b25d2c44d6645ac5  packages/contract/openapi.json
6ea83bcb36dcab16e1510be4dff52fa61237847c  packages/contract/src/client/schema.generated.ts
$ npm run generate -w packages/contract && shasum …    # after re-run
<identical>
diff exit=0
```

### 3. Drift check fires, and fires on exactly this change

```
$ node --import tsx scripts/check-generated-artifacts.ts
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 14 ++++++++++++--
 packages/contract/src/client/schema.generated.ts |  6 ++++--
✓ CLI reference is up to date (docs/cli.md).
exit=1
```

The check diffs the regenerated artifacts **against `HEAD`**
(`scripts/check-generated-artifacts.ts` → `diffAgainstHead`), so this is the
expected pre-commit state: the regeneration itself produced no further change
(§2 above), and the only delta versus `HEAD` is the intended `isParent`
addition. It goes green once the orchestrator commits the two artifacts.

### 4. Typed client against a mounted app (real routes, real validation)

`packages/contract/src/client/index.test.ts` exercises `createCorpusClient` over
`OpenAPIHono.fetch` with the real `contractRoutes.listDocs` definition — no fetch
double. The stub handler echoes the parsed `isParent` back through the row's
`excerpt`, so the assertions are about what actually crossed the wire:

- `{ isParent: true }` → `excerpt: "isParent=true"`
- `{ isParent: false }` → `excerpt: "isParent=false"`
- `{}` → `excerpt: "isParent=absent"` (the client sends no parameter at all)
- `{ parent, isParent: true }` → `response.status === 400`, `data` undefined,
  error body naming `isParent`
- `{ parent, isParent: false }` → `200`, `excerpt: "isParent=false"`

The `400` was confirmed against the mounted app directly before being asserted:

```
STATUS 400
BODY {"success":false,"error":{"name":"ZodError","message":"[{\"code\":\"custom\",
 \"path\":[\"isParent\"],\"message\":\"`parent=<id>` and `isParent=true` contradict:
 `parent` asks for the children of a document and `isParent=true` asks for
 documents with no parent. Drop one.\"}]"}}
```

### 5. Tests

```
$ VITEST_MAX_THREADS=4 vitest run packages/contract
Test Files  53 passed (53)
     Tests  1994 passed (1994)
exit=0
```

23 of them are new and were confirmed to run rather than to be skipped
(`vitest run packages/contract -t "isParent" --reporter=verbose` → 23 passed,
1966 skipped): the boolean vocabulary (`true`/`false`/`1`/`0`, and `maybe` / `` /
`root` rejected), absence not defaulting, the `parent` contradiction with its
message and path, the redundant `isParent=false` pairing, the six published
description clauses, and the deliberate absence from `/api/search`.

### 6. Repo gates

```
$ npm run typecheck      # all 5 workspaces
exit=0
$ npm run lint
exit=0
$ prettier --check packages/contract/
All matched files use Prettier code style!
```

(`npm run format:check` repo-wide also flags
`apps/server/src/threads/anchor-context.ts`, which is another agent's in-flight
file in this shared tree and was deliberately left alone.)

### Not verified here, by design

The **behaviour** of the filter — that `isParent=true` actually returns roots
from SQLite — is SERVER-073 and cannot be verified in this package: nothing here
executes a query. What is verified is that the contract declares it, publishes
it, refuses the contradiction at the route boundary, and hands the consumers a
typed `isParent?: boolean`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
