# [CONTRACT-081] A folder listing that stops at the folder

## Domain
contract

## Status
todo

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

- [ ] `GET /api/docs` accepts `folderScope`, one of `tree` or `self`, meaningful
      only alongside `folder`.
- [ ] `folderScope` defaults to `tree`, so every existing caller keeps the
      behaviour it has today and no client has to change to stay correct.
- [ ] `folderScope=self` is documented as: documents whose own path is directly
      in the folder, and no thread inherited from a parent elsewhere.
- [ ] `folderScope` without `folder` is a 400 with a message naming the missing
      parameter, not a silent no-op.
- [ ] `page.total` is defined to count the same set the page draws from, so a
      `self` listing's bound line is about the folder's own documents.
- [ ] The generated `openapi.json` is regenerated and committed; the typed
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
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
