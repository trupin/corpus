# [CONTRACT-081] A folder listing that stops at the folder

## Domain
contract

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: SERVER-141, UI-161

## Spec References
- SPEC.md Section 9.2 — "The route catalogue" (`GET /api/docs`)
- SPEC.md Section 10 — "UI — the board" (rider 1, the explorer: "under each folder its documents")

## Summary

`GET /api/docs?folder=X` matches **every descendant**: the filter is
`d.path LIKE 'X/%'`, plus the threads whose parent is under `X`
(`apps/server/src/docs/filters.ts`). That is right for a board column, which is
what the parameter was built for — a folder column shows the folder's work and
the conversations about it. It is wrong for the explorer, which draws one row
per folder and asks each folder for its own documents, and it is what makes a
document appear under every expanded ancestor at once (UI-161).

There is no way to ask the collection route for the documents filed **directly**
in a folder. This issue adds one.

## Acceptance Criteria

- [x] `GET /api/docs` accepts `folderScope`, one of `tree` or `self`, meaningful
      only alongside `folder`.
- [x] `folderScope` defaults to `tree`, so every existing caller keeps the
      behaviour it has today and no client has to change to stay correct.
- [x] `folderScope=self` is documented as: documents whose own path is directly
      in the folder, and no thread inherited from a parent elsewhere.
- [x] `folderScope` without `folder` is a 400 with a message naming the missing
      parameter, not a silent no-op.
- [x] `page.total` is defined to count the same set the page draws from, so a
      `self` listing's bound line is about the folder's own documents.
- [x] The generated `openapi.json` is regenerated and committed; the typed
      client exposes the field.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/docs.ts` (or wherever `DocsQuery` lives) — the
  `folderScope` enum, its default, and its description
- `packages/contract/src/routes/docs.ts` — the query parameter on the route
  definition
- `packages/contract/openapi.json` — regenerated

### Key Implementation Details

The name is `folderScope`, not `recursive` or `exact`. Two reasons. A boolean
would have to pick which way round `true` means, and the pair `tree` / `self`
says which set is being asked for without the reader having to remember. And the
default has to be `tree`: the parameter is being added under an existing route
that many callers already use, and a default of `self` would silently narrow
every board column in the product.

`folderScope` is a **filter**, so it belongs beside `folder` in the query schema
and in `canonicalFilter` — two callers asking for the same folder at different
scopes must not share a cache entry.

### Edge Cases
- `folderScope=self` with `folder` naming a folder that does not exist: an empty
  page, exactly as `tree` already answers.
- `folderScope=self` and a thread whose parent is filed in the folder: excluded.
  The thread is a document, and its own path decides where it is filed.
- The root: `folder=""` (or the root spelling `folderPathPrefix` already accepts)
  with `self` means the documents at the top of `data/docs/`, not the corpus.

## Testing Strategy

Schema unit tests: the default, the enum, the 400 when `folderScope` arrives
without `folder`. A drift check that `openapi.json` regenerates clean.

## E2E Verification Plan

The contract has no runtime of its own; verification is that `npm run build`
regenerates `openapi.json` with no diff and the typed client compiles against it
in both `apps/cli` and `packages/kit`.

### Verification Steps
1. `npm run build`
2. `git diff --exit-code packages/contract/openapi.json` after a regeneration
3. `npm run typecheck`

## E2E Verification Log

### Post-Implementation Verification

Model: **opus** (claude-opus-5, 1M context).

**What landed**

- `packages/contract/src/schemas/query.ts` — `FOLDER_SCOPES` (`tree`, `self`),
  `FolderScopeSchema`, `DEFAULT_FOLDER_SCOPE`, the `folderScope` parameter on
  `DocsQuerySchema` (published after `isParent`, so the two docs-only parameters
  sit together and the shared filter shape stays one spread), and a third
  `.refine()` refusing a scope that arrives without a `folder`.
- `packages/contract/src/routes/docs.ts` / `routes/search.ts` — the collection
  query's description states the modifier and its `400`; ranked retrieval states
  that `folderScope` is held back for `isParent`'s reason and no other, so
  `folder` there always means the tree.
- `packages/contract/src/schemas/pagination.ts` — `PageMeta.total` now says it
  ignores **only** pagination, so the bound line is always about the set the list
  is showing.
- `packages/contract/openapi.json` + `src/client/schema.generated.ts` —
  regenerated.

**`.optional()` rather than `.default()`, and why.** A zod default is applied
before the refinements run, so a defaulted `folderScope` is indistinguishable
from a sent one and the "a scope with nothing to scope is a `400`" rule could
only ever be enforced for `self`. The parameter is therefore optional in the
schema and carries `default: "tree"` in the **published** document, which is
where a client reads it. Verified on the generated artifacts:

```
$ python3 -c "…json.load(open('packages/contract/openapi.json'))…"
['limit', 'offset', 'q', 'type', 'status', 'stage', 'includeArchived', 'tag',
 'folder', 'parent', 'references', 'agent', 'author', 'since', 'due', 'stale',
 'unread', 'isParent', 'folderScope', 'needs', 'sort']
folderScope: {'required': False, 'name': 'folderScope', 'in': 'query'}
            schema: {"type": "string", "enum": ["tree", "self"], "default": "tree"}
/api/search parameters: [… 'unread', 'needs', 'limit']   # no folderScope

$ grep -n "folderScope?" packages/contract/src/client/schema.generated.ts
96:  folderScope?: "tree" | "self";
```

The `default` does **not** promote the member to required — `openapi-typescript`
only does that for schema object properties, not for parameters (the same reason
`sort?:` and `limit?:` are optional today).

**Generation is clean and idempotent**

```
$ npm run build            → EXIT=0
$ npm run build -w packages/contract && npm run generate -w packages/contract
BUILD=0  GEN=0
$ npm run generate -w packages/contract   # second run, diffed against the first
IDEMPOTENT=0               # byte-identical openapi.json
```

**Tests**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
Test Files  68 passed (68)
Tests  2863 passed (2863)
```

New tests: `schemas/query.test.ts` → "the folderScope modifier" (9 cases:
both scopes accepted beside a folder, an unknown scope rejected, the parameter
left absent, a folder-only query byte-identical to before, both scopes refused
without a folder naming `folder`, no data on the refusal, composition with the
rest of the grammar). `openapi.test.ts` → the published enum, the published
`default`, each promise in the description, and the deliberate absence on
`/api/search` with the reason published there. `client/index.test.ts` → the
scope on the wire through the typed client and the mounted route, absence when
not asked for, and the `400` naming `folder`.

**Falsification — both new guards were broken and the tests failed**

1. Refine neutralised (`.refine(() => true, …)`):
   ```
   × the folderScope modifier > refuses folderScope=tree with no folder, naming folder
   × the folderScope modifier > refuses folderScope=self with no folder, naming folder
   × the folderScope modifier > does not answer the unscoped corpus …
   Tests  3 failed | 163 passed (166)
   ```
2. Published `default: DEFAULT_FOLDER_SCOPE` deleted:
   ```
   × … the folderScope modifier > publishes `tree` as the default, so an omitted scope is today's behaviour
   Tests  1 failed | 523 passed (524)
   ```
   Both reverted afterwards; the suite is green as reported above.

**Typecheck and lint**

```
$ npm run typecheck -w packages/contract → 0
$ npm run typecheck -w packages/kit      → 0
$ npm run typecheck -w apps/cli          → 0
$ ./node_modules/.bin/eslint <7 touched files>   → 0
$ ./node_modules/.bin/prettier --check <touched files + openapi.json> → clean
```

**Acceptance criteria**

- `folderScope`, `tree` | `self`, alongside `folder` — yes, published enum above.
- Defaults to `tree`, no caller changes — yes: absent stays absent through the
  schema (test: "keeps a folder-only query exactly as it was"), and the document
  publishes `default: "tree"`.
- `self` documented as one level, no inherited thread — yes, pinned clause by
  clause in `openapi.test.ts`.
- `folderScope` without `folder` is a `400` naming `folder` — yes, for **both**
  values, at the schema and through the mounted route.
- `page.total` counts the set the page draws from — stated on `PageMeta.total`
  generally and on `folderScope` specifically. The server owes the SQL
  (SERVER-141 AC 3).
- `openapi.json` regenerated, client exposes the field — yes.

**`canonicalFilter` needs no edit, and that is checked rather than assumed.**
`packages/kit/src/query/keys.ts` canonicalises by walking the object's own keys
and states the rule outright — "Unknown filters are **preserved**, so the
contract can grow a query parameter without a kit release — the kit does not
allowlist the grammar it knows about". So two callers asking for the same folder
at different scopes already get different cache entries, and `docsListKey` needs
no change. (The kit is not this domain's to edit in any case.)

**Not done here, deliberately.** `folderScope` is published on the collection
query alone, following `isParent`'s precedent: §9.2's signed `/api/search`
parameter string does not carry it, and `openapi.test.ts` pins that string
exactly. Moving it into `docFilterShape` would publish it on both endpoints in
one line, and the server already shares `docs/filters.ts` between them — so this
is a rider away, not a rewrite.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
