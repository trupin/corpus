# [UI-161] The explorer draws a document under every expanded ancestor

## Domain
ui

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: CONTRACT-081, SERVER-141
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board" (rider 1, the explorer: "shows the
  workspace as a tree: `GET /api/tree`'s folders, and under each folder its
  documents")

## Summary

**Reported by the user, 2026-08-23, with a screenshot**: a folder in the
explorer showing five identical rows for one document, under a folder whose own
count reads `1`. The user's words: _"Any time I collapse and reopen a directory,
the content duplicates in the file explorer."_

The cause is not the collapse. The explorer asks
`GET /api/docs?folder=<path>` per expanded folder, and that filter is a **path
prefix** — a parent's listing contains every descendant's documents. So a
document filed in `todos/unfiled` is drawn once as a child of `todos` and again
as a child of `todos/unfiled` whenever both are open. Both rows carry the key
`d:<id>`, and React reports the duplicate key as unsupported:

> Encountered two children with the same key, `d:doc_alpha`. Keys should be
> unique so that components maintain their identity across updates. Non-unique
> keys may cause children to be duplicated and/or omitted — the behavior is
> unsupported and could change in a future version.

Collapsing and reopening is what forces the re-render that makes React act on
it. Two rows is what a controlled reproduction shows; the user's five is the same
defect in a deeper tree over a longer session.

Fixing the listing is CONTRACT-081 and SERVER-141. This issue is the explorer's
half: ask for the folder's own documents, and never draw one document twice.

## Acceptance Criteria

- [x] Each folder lists only the documents filed **directly** in it. A document
      in a sub-folder is drawn under the sub-folder and nowhere else.
- [x] `useFolderDocs` passes `folderScope: "self"`.
- [x] The bound line (`N of M — the listing reached its bound`) counts the
      folder's own documents, so `limit=100` bounds the folder rather than its
      whole subtree.
- [x] No two rows in the tree ever share a key. A test asserts it directly over
      `buildTreeRows`, so the guarantee does not depend on the server's filter
      being right.
- [x] Collapsing and reopening a folder, at any depth, any number of times,
      leaves the row count unchanged.
- [x] No React duplicate-key warning is emitted by the explorer. The test suite
      fails on one rather than printing it.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/explorer/useFolderDocs.ts` — pass `folderScope: "self"`
- `apps/ui/src/explorer/treeRows.ts` — `pushDocs` keeps only rows whose own
  folder is this node's, as a belt-and-braces invariant
- `apps/ui/src/explorer/treeRows.test.ts` — the invariant, and the key uniqueness
- `apps/ui/src/explorer/Explorer.test.tsx` — the collapse/reopen regression, with
  a fixture that reproduces the server's **prefix** semantics

### Key Implementation Details

The client-side filter in `pushDocs` is deliberate belt and braces, not
redundancy to be argued away. `folder=` is prefix-scoped for a reason — a board's
folder column shows the folder's work and the conversations about it — and the
explorer is the one caller that wants the other set. A tree that draws whatever
a listing hands it is one server change away from this bug again, and the check
is one comparison per row.

Derive the row's own folder from `row.path` rather than trusting a field: the
listing is `data/docs/<folder>/<name>.md`, and `folderOf` in `@corpus/kit`
already does this for the reader.

**The fixture in `Explorer.test.tsx` is the load-bearing part of this issue.**
The existing one answers `folder=X` from an exact-match map, which is why the
suite has been green through this defect. It must answer a prefix, the way the
server does:

```ts
const items = Object.entries(docs)
  .filter(([key]) => key === wanted || key.startsWith(`${wanted}/`))
  .flatMap(([, value]) => value);
```

With that fixture and no fix, the nested case draws two rows for one document
and React warns. That is the reproduction, and it is what the regression test
must be able to fail on.

### Edge Cases
- A thread filed in one folder whose parent is in another: drawn where it is
  filed. `folderScope=self` already excludes the inherited match; the client
  check agrees.
- The root's documents, drawn under the root folder row and not repeated.
- A folder listing that is still pending while its parent's has arrived: the
  parent must not show the child's documents in the meantime.

## Testing Strategy

`treeRows.test.ts`: a `docsByFolder` map deliberately seeded with a descendant's
document in the parent's answer, asserting the parent draws it not at all and
that every key in the returned rows is distinct.

`Explorer.test.tsx`: with the prefix fixture, open a parent and a child, collapse
and reopen the parent four times, and assert exactly one row for the document
each time. Fail the test on a React key warning by spying on `console.error`.

**Falsification.** Remove the `folderScope` argument and watch the Explorer test
go red; then remove the `pushDocs` filter and watch it go red again. Both halves
must be independently able to fail, or one of them is decoration.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a workspace with `todos/a.md` and `todos/unfiled/b.md`
2. Open the explorer (`⌘B`), expand `todos`, expand `todos/unfiled`
3. Collapse `todos`, reopen it. Repeat.
4. Expected: one row for `b`, under `unfiled`
5. Actual: `b` appears under `todos` and under `unfiled`, and the count climbs
   with each collapse and reopen

### Verification Steps
1. Rebuild `@corpus/kit` and restart the app — kit changes are invisible to the
   browser until `npm run build -w packages/kit`
2. Repeat the reproduction ten times at three depths
3. Expected: one row per document, no console warning, the bound line counting
   the folder's own documents

## E2E Verification Log

### Reproduction (bugs only)
Reproduced 2026-08-23 by the orchestrator, in jsdom over the real `<Shell />`,
with the fixture corrected to the server's prefix semantics:

```
round 1: 2 alpha rows
round 2: 2 alpha rows
round 3: 2 alpha rows
round 4: 2 alpha rows
AssertionError: expected 2 to be 1
```

with React's duplicate-key warning on every render. The same test against an
exact-match fixture reports `1` every round — which is why the shipped suite
never caught it.

### Post-Implementation Verification

**Model: opus (claude-opus-5[1m]).**

**The wire, first.** A real server (`corpus server start`, port 8790, a scratch
workspace holding `todos/a.md` and `todos/unfiled/b.md`) answers exactly as
CONTRACT-081 and SERVER-141 promise:

```
GET /api/docs?folder=todos&includeArchived=true
  → doc_alpha001 @ data/docs/todos/a.md, doc_beta0001 @ data/docs/todos/unfiled/b.md
    page {'total': 2, 'limit': 50, 'offset': 0}
GET /api/docs?folder=todos&folderScope=self&includeArchived=true
  → doc_alpha001 @ data/docs/todos/a.md
    page {'total': 1, 'limit': 50, 'offset': 0}
```

`page.total` is `1` under `self` and `2` without it, so the bound line counts
the folder's own documents rather than its subtree's.

**Reproduction in a real browser, with both halves removed.** Chromium against
the built UI the server serves, expanding `todos` and `todos/unfiled` then
collapsing and reopening `todos` ten times:

```
round 1: alpha rows 1, beta rows 1
round 2: alpha rows 1, beta rows 3
round 3: alpha rows 1, beta rows 4
…
round 10: alpha rows 1, beta rows 11
after ten: alpha 1, beta 12
```

The user's report, exactly: the count climbs with each collapse and reopen.

**The same ten rounds against the fix:**

```
round 1..10: alpha rows 1, beta rows 1
after ten: alpha 1, beta 1
```

`beta` is drawn under `unfiled` and nowhere else, and no console warning is
emitted. Three depths were exercised in the same run (`todos`,
`todos/unfiled`, and the move of `alpha` into `todos/unfiled` for UI-158, which
left one row under `unfiled` and none under `todos`).

**Falsification, both halves, independently.**

- `folderScope: "self"` removed → `Explorer.test.tsx` red:
  `expected '?folder=todos&includeArchived=true&li…' to contain 'folderScope=self'`.
- `pushDocs`'s filter removed → four tests red across two files:
  `treeRows.test.ts` on the shape, on key uniqueness (`expected 4 to be 5`) and
  on the bound line, and `Explorer.test.tsx`'s "draws one row even when the
  server ignores folderScope" (`expected 2 to be 1`, plus React's duplicate-key
  warning: `expected [ Array(1) ] to deeply equal []`).

**The fixture is the load-bearing part, and it now lies the way the server
does.** `Explorer.test.tsx` answers `folder=X` as a **prefix** and honours
`folderScope=self`; a third option, `ignoreFolderScope`, answers the whole
subtree whatever the modifier said, which is what tests the client-side filter
alone. With the prefix fixture and no fix, the nested case drew two rows and
React warned — the reproduction the orchestrator logged above.

**Every test in `Explorer.test.tsx` now fails on a React duplicate-key
warning**: `console.error` is spied on in `beforeEach` (passing through), and
`afterEach` asserts no line containing "same key" was logged.

**One thing fixed on the way past**: `ExplorerTree.tsx` spread `key` into its
`<button>`s, which React warned about on every render of the tree. The key is
now passed directly.

**Checks.** `vitest run apps/ui` — 178 files, 3689 tests pass. `vitest run
packages/kit` — 63 files, 954 tests pass. `npm run typecheck` exit 0.
`eslint apps/ui packages/kit` exit 0. `prettier --check` clean.

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
