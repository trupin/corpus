# [SERVER-158] The projection answers a glob, and reads `extra_json`

## Domain
server

## Status
done

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

- [x] `title`, `body`, `tag` and `folder` accept globs, and a value with no `*`
      and no `?` behaves exactly as it does today
- [x] `extra.<key>=<value>` matches a document whose frontmatter carries that key
      with that value
- [x] A value that is a JSON array matches when **any element** matches, the way
      `tag` already ORs
- [x] A document lacking the key never matches, whatever the value
- [x] Nothing user-supplied is interpolated into SQL — the JSON path binds
- [x] `GET /api/docs` and `GET /api/search` both gain `title` and `body`, from
      the one builder, with no second edit
- [x] The existing filter suite still passes unchanged

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

**Implemented on: opus.**

### Two defects found in flight, both by running the thing

**1. `json_type(json_extract(…))` raises on any field holding a word.**

The first version tested for an array with the one-argument
`json_type(json_extract(d.extra_json, path))`. That form **re-parses** what it
is handed, and an extracted string like `theo` is not valid JSON, so SQLite
answered `malformed JSON`. Bisected down to the smallest reproduction:

```
1 doc  => [ 'doc_theo' ]
2 docs => ERR malformed JSON
```

One document passed and two failed, because the planner takes a different route
once the OR has more than one row to consider. A one-document fixture would have
shipped it.

The fix collapsed the predicate rather than patching it. `json_each(X, P)` over
a **scalar** yields that scalar as its single row, over an **array** yields each
element, and over a **missing path** yields nothing — so one `EXISTS` covers the
scalar case, the array case and absence, and the OR branch is gone. The only
guard left keeps an *object* out, and it reads the type with the two-argument
`json_type(d.extra_json, path)`, which does not re-parse.

Measured on a real projection afterwards:

```
assignee=theo   [ 'doc_a' ]        owners=theo   [ 'doc_c' ]
estimate=3      [ 'doc_d' ]        nested=theo   []
missing         []                 assignee=*    [ 'doc_a', 'doc_b' ]
```

**2. Three of the four refusals answered `500` with an empty body.**

Against the real server, `folderScope` alongside a glob answered `400` and every
`extra` refusal answered `500` — with **no request in the server log at all**.

```
extra.1bad=x                    => 500  (empty body)
extra.assignee=                 => 500  (empty body)
extra.=x                        => 500  (empty body)
folder=work/*&folderScope=self  => 400  bad_request | `folderScope` narrows a folder prefix…
```

**Zod 4's `ZodError` does not extend `Error`.** Probed directly:

```
thrown: ZodError
instanceof z.ZodError: true
instanceof Error: false
```

Hono routes a non-`Error` throw to neither `app.onError` nor `toHttpError`, so
the branch in `errors.ts` that maps a `ZodError` to a `400` is unreachable from
a handler that throws one. The route now catches its own and raises an
`HttpError`; `errors.ts` carries a note beside that branch so the next handler
does not trust it. Re-measured after the restart:

```
extra.1bad=x                    => 400  `extra.1bad` is not a filter. An extra field's name must be an identifier…
extra.assignee=                 => 400  `extra.assignee` needs a value. There is no way to ask for a document that lacks a field…
extra.=x                        => 400  `extra.` is not a filter…
folder=work/*&folderScope=self  => 400  `folderScope` narrows a folder prefix and cannot narrow a glob pattern…
extra.assignee=theo             => 200  ['doc_broker01']
```

### E2E, against a real server on a real workspace

`corpus init` + `corpus server start` on port 8791, two hand-written `.md` files
under `data/docs/work/tasks/`, one carrying `assignee: theo`, `estimate: 3` and
`owners: [theo, dana]`, the other `assignee: sam`. Every result below is from
`curl` against the running server:

```
extra.assignee=theo          => ['doc_broker01']
extra.assignee=t*            => ['doc_broker01']
extra.assignee=sam           => ['doc_notary01']
extra.owners=dana            => ['doc_broker01']
extra.estimate=3             => ['doc_broker01']
title=Catch-Up*              => ['doc_broker01', 'doc_notary01']
body=*rate assumption*       => ['doc_skillcomment', 'doc_skillconverse', 'doc_skillorchestrate', 'doc_broker01']
folder=work/*                => ['doc_broker01', 'doc_notary01']
extra.assignee=*             => ['doc_broker01', 'doc_notary01']
```

The three skill documents in the `body` result are not noise — they genuinely
contain the phrase, which `filters.ts` already records as the honeypot it is.
They are the evidence that `body` reads the indexed text and not
`documents.body_excerpt`.

### Where the design changed

- `matches-query.ts` needed **nothing**. `matchesQuery` compiles the same
  `compileFilters`, so it agreed the moment the builder did.
- Three other places turn a raw record into a query and each would have dropped
  `extra.<key>` silently: the collection route, `boardScopeQuery` (a board
  scoped by an invented field would stop filtering) and `compileSelectionQuery`
  (a Save would have called a real filter a filter that does not exist). The
  contract gained `splitExtraParams` so all three share the lift.
- The `tag` filter keeps its `IN` form byte for byte when no value carries a
  wildcard, so every tag query shipped before this compiles to the SQL it always
  did.

### Falsification

```
$ # textMatch always uses `=`
      Tests  8 failed | 10 passed (18)
$ # the json_type <> 'object' guard deleted
      Tests  1 failed | 17 passed (18)   × does not walk into a nested object
$ # readExtraFilters rethrows instead of converting
      Tests  3 failed | 27 passed (30)   × the three 400s
```

### Suites

```
$ vitest run apps/server
   Test Files  209 passed (209)
        Tests  4762 passed (4762)
```

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] E2E log filled with real output
- [x] Lint and typecheck clean
