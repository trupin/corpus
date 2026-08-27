# [SERVER-158] The projection answers a glob, and reads `extra_json`

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-091
- Blocks: CLI-072, UI-177

## Spec References
- SPEC.md §9.2 — **Pattern matching**
- SPEC.md §5 — **Structured fields**
- SPEC.md §9.1 — the projection's `extra_json` column

## Summary

`documents.extra_json` has existed since the projection was written and no query
has ever read it. `compileFilters` has no pattern matching of any kind — `q=` is
FTS5 and every structured filter is equality or a prefix.

This issue adds four glob-capable filters and the `extra.<key>` predicate to the
one builder both read endpoints share.

## Acceptance Criteria

- [ ] `title`, `body`, `tag` and `folder` accept globs, and a value with no `*`
      and no `?` behaves exactly as it does today
- [ ] `extra.<key>=<value>` matches a document whose frontmatter carries that key
      with that value
- [ ] A value that is a JSON array matches when **any element** matches, the way
      `tag` already ORs
- [ ] A document lacking the key never matches, whatever the value
- [ ] Nothing user-supplied is interpolated into SQL — the JSON path binds
- [ ] `GET /api/docs` and `GET /api/search` both gain `title` and `body`, from
      the one builder, with no second edit
- [ ] The existing filter suite still passes unchanged

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/filters.ts` — `compileFilters`
- `apps/server/src/docs/filters.test.ts` — new cases
- `apps/server/src/docs/matches-query.ts` — the in-process predicate must agree
- `apps/server/src/docs/query.ts` — bind the new parameters

### Key Implementation Details

**Use SQLite's `GLOB`.** It is the operator the spec's vocabulary describes:
`*` for any run, `?` for one. Do not build a `LIKE` translation — `LIKE` would
need `%`/`_` escaped *and* the spec's wildcards translated, two conversions where
`GLOB` needs none.

**Globs are case-insensitive**, spelled `lower(<col>) GLOB lower(@pattern)`.
`GLOB` is case-sensitive by default and `LIKE` is not, so leaving it raw would
make `title=` behave one way and `tag=` (which already lowercases both sides)
another. One rule across the four, written down in the module's docblock.

**One helper, not four call sites.** Add a predicate builder that takes an SQL
expression and a value, and returns either the exact-match fragment or the glob
fragment. `isGlob(value)` is `/[*?]/.test(value)`.

**`extra` binds its path.** `json_extract(d.extra_json, @path)` with `@path`
bound as `'$."<key>"'`. The key is already validated by CONTRACT-091, and the
bind is the guard that does not depend on that validation staying correct.

The array case:

```sql
(<scalar match> OR EXISTS (
   SELECT 1 FROM json_each(d.extra_json, @path) e
   WHERE json_type(json_extract(d.extra_json, @path)) = 'array'
     AND <element match on e.value>))
```

**`matches-query.ts` must agree.** It is the in-process copy of the predicate
that decides which SSE invalidations a live query cares about. A filter the SQL
honours and it does not means a board column that does not refresh. Add both
there in the same commit, and assert the agreement the way its suite already
does.

### Edge Cases
- `title=*` matches every document, since every document has a title
- `extra.owner=*` matches every document carrying `owner`, and none without it
- A glob on `folder` bypasses `folderPathPrefix`'s normalisation: the pattern is
  matched against the workspace-relative path as stored. Document it — `folder`
  without a wildcard keeps every bit of today's normalisation, and a pattern is
  a pattern over the real path
- `folderScope` alongside a glob `folder` — the `self` narrowing measures a
  literal prefix length and cannot measure a pattern. Refuse the combination
  with `400` naming both, rather than answering something plausible
- A `extra_json` that is not an object (should not happen, the writer forbids it)
  yields no match rather than an error

## Testing Strategy

`filters.test.ts` against a real projection:
- glob and exact forms of each of the four fields
- an `extra` scalar, an `extra` array, and a document lacking the key
- a key with a `"` in it never reaches SQL (it is refused upstream, and the bind
  is asserted here)
- `folderScope=self` with a glob `folder` answers `400`

## E2E Verification Plan
Start a real workspace server. Write a document with `assignee: theo` in
frontmatter through the CLI. Then:
1. `curl '…/api/docs?extra.assignee=theo'` returns it
2. `curl '…/api/docs?extra.assignee=t*'` returns it
3. `curl '…/api/docs?extra.assignee=sam'` does not
4. `curl '…/api/docs?title=Mort*'` returns the mortgage note
5. A document with no `assignee` never appears in 1–3

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] E2E log filled with real output
- [ ] Lint and typecheck clean
