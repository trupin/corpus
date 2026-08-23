# [SERVER-141] List a folder's own documents

## Domain
server

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: CONTRACT-081
- Blocks: UI-161

## Spec References
- SPEC.md Section 9.2 — "The route catalogue" (`GET /api/docs`)
- SPEC.md Section 10 — "UI — the board" (rider 1, the explorer)

## Summary

Implement `folderScope=self` on the collection query: the documents whose own
path is directly in the named folder, and nothing inherited from a descendant or
from a parent. `folderScope=tree` keeps today's SQL byte for byte.

## Acceptance Criteria

- [x] `folderScope=self` matches a document whose path is `<folder>/<name>.md`
      and no document whose path has a further `/` after the prefix.
- [x] `folderScope=self` matches no thread by inheritance — the thread's own
      path decides, like every other document's.
- [x] The page statement and the COUNT statement share the condition, so
      `page.total` counts the set the page draws from.
- [x] `folderScope=tree` produces the same SQL and the same rows as today. A
      test pins that, not a reading of the diff.
- [x] A folder whose name contains `%`, `_` or `\` still matches exactly — the
      existing `likePrefix` escaping is not bypassed by the new condition.

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/filters.ts` — the `folder` condition gains a `self` form
- `apps/server/src/docs/filters.test.ts` — the conditions, both scopes
- `apps/server/src/docs/query.test.ts` — page and COUNT agree at both scopes

### Key Implementation Details

Today's condition, at `filters.ts:241`:

```sql
(d.path LIKE @folder ESCAPE '\' OR EXISTS (
   SELECT 1 FROM documents p WHERE p.id = t.parent_id AND p.path LIKE @folder ESCAPE '\'))
```

`self` drops the `EXISTS` half and adds "no further separator":

```sql
(d.path LIKE @folder ESCAPE '\'
 AND instr(substr(d.path, @folderLen + 1), '/') = 0)
```

`@folderLen` is the **unescaped** prefix's length — `folderPathPrefix(folder)`
before `likePrefix` wraps it and before the escaping doubles any character. Bind
it as its own parameter rather than computing it in SQL: `length()` over the
escaped literal is a different number, and the bug that produces is a folder
whose name contains an escapable character silently listing its children.

Use the binder for both, so the two parameters stay in step with the rest of the
clause and nothing is interpolated.

### Edge Cases
- The root. `folderPathPrefix("")` — whatever it yields today — must give
  `self` the top-level documents. Pin it with a test rather than reasoning about
  it, because the prefix is `""` and `instr(substr(path, 1), '/')` then counts
  the separators in the whole path.
- A document filed at the folder path itself rather than under it (there is no
  such thing today, but the condition should not depend on that).
- `folder` with a trailing slash — `folderPathPrefix` already normalises it.

## Testing Strategy

Unit tests over a real SQLite projection built by the existing test helpers:
a folder with two of its own documents, a sub-folder with one, and a thread
whose parent is in the folder but which is filed elsewhere. Assert the three
scopes' row sets and both `page.total`s.

**Falsify the fix**: delete the `instr(...) = 0` conjunct and watch the
sub-folder's document reappear in the `self` set. A test that passes with the
conjunct removed is testing nothing.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. `corpus init` a scratch workspace and start the server
2. Create `todos/a.md` and `todos/unfiled/b.md`
3. `curl '…/api/docs?folder=todos&limit=100'`
4. Expected: `a` only
5. Actual: `a` and `b` — the prefix match reaches the sub-folder

### Verification Steps
1. Restart the server after the change
2. `curl '…/api/docs?folder=todos&folderScope=self&limit=100'` → `a` only,
   `page.total` 1
3. `curl '…/api/docs?folder=todos&limit=100'` → `a` and `b`, unchanged
4. `curl '…/api/docs?folder=todos&folderScope=self'` on a folder holding a
   thread's parent → the thread is absent

## E2E Verification Log

**Model: Opus 5 (1M context).** Real workspace `scratchpad/ws096`, real server on
**127.0.0.1:8791** — never 8765 or 5173.

### Reproduction (2026-08-23)

`todos/a.md`, `todos/unfiled/b.md`, and a thread on `a` filed in `data/threads/`.

```
GET /api/docs?folder=todos&limit=100
  → ["data/threads/th_cucxjkav.md","data/docs/todos/unfiled/b.md","data/docs/todos/a.md"]  total=3

GET /api/docs?folder=todos&folderScope=self&limit=100
  → ["data/threads/th_cucxjkav.md","data/docs/todos/unfiled/b.md","data/docs/todos/a.md"]  total=3
                                                                          ↑ identical

GET /api/docs?folderScope=self&limit=100
  → 400 query.folderScope: "`folderScope` narrows what `folder` matches and needs a
        `folder` to narrow. Pass `folder`, or drop `folderScope`."
```

The parameter was accepted and read by nothing: `self` answered the subtree plus
the inherited thread. (The `400` already worked — it is the contract's own
refinement, not the server's.)

### Post-implementation verification (server restarted, pid 25656)

```
folder=todos&limit=100                          → [threads/th_cucxjkav, todos/unfiled/b, todos/a]  total=3
folder=todos&folderScope=tree&limit=100         → [threads/th_cucxjkav, todos/unfiled/b, todos/a]  total=3
folder=todos&folderScope=self&limit=100         → [todos/a]                                        total=1
folder=todos&folderScope=self&limit=1           → [todos/a]                                        total=1
folder=todos/unfiled&folderScope=self&limit=100 → [todos/unfiled/b]                                total=1
folder=nowhere&folderScope=self&limit=100       → []                                               total=0
```

- `tree` is unchanged, and equals the no-parameter default.
- `self` drops the sub-folder's document **and** the inherited thread.
- `page.total` is 1 at `limit=1` as well as at `limit=100`, so the COUNT carries
  the same condition the page does.

**The root**, with `data/docs/atroot.md` dropped in out of band:

```
folder=/&folderScope=self&limit=100          → ["data/docs/atroot.md"]  total=1
folder=data/docs&folderScope=self&limit=100  → ["data/docs/atroot.md"]  total=1
folder=/&folderScope=tree&limit=200          → 15 documents, atroot included  total=15
```

**A folder name holding `%` and `_`** — `data/docs/50%_off/`, with a sub-folder:

```
folder=50%25_off&folderScope=self&limit=100 → ["data/docs/50%_off/own.md"]                         total=1
folder=50%25_off&folderScope=tree&limit=100 → ["data/docs/50%_off/sub/deep.md","…/50%_off/own.md"] total=2
```

### Tests

`./node_modules/.bin/vitest run apps/server/src/docs/query.test.ts` → **138
passed**, 7 of them the new `folderScope` block.

**Falsification, twice, restoring `filters.ts` byte-for-byte each time:**

1. **The `instr(...) = 0` conjunct deleted** (replaced with a tautology so the
   binding stays live) → **5 failed | 2 passed**. `doc_deep` and `doc_deeper`
   reappear in the `self` set, `page.total` reads 4 instead of 2, and the root's
   `self` returns the whole corpus. The two survivors are correct: *inherits
   nothing* survives because the same edit keeps the `EXISTS` half dropped, and
   *a folder naming nothing* is empty either way.
2. **`@folderLen` bound over the escaped literal** (`likePrefix(path).length`
   instead of `path.length`) → **1 failed | 6 passed**, and the one that fails is
   *escapes a folder name holding `%`, `_` and a backslash*: `data/docs/50%_off\deals`
   escapes to four extra characters, `substr` then starts past the separator,
   `instr` finds none, and the sub-folder's document is listed as the folder's
   own. That test is the only thing standing between this fix and that bug.

**A test that could not fail with the fix absent**: *answers an empty page at
either scope for a folder naming nothing* passes either way — it pins the
contract's "a `folder` naming nothing answers an empty page at either scope",
which is a statement about what must **not** change.

### Fixture gotcha, recorded

`corpus-fixture.ts` silently drops a document whose id the contract's
`DocumentIdSchema` refuses, and `doc_own_a` is refused — an id carries no second
underscore. The rows simply never appear, with no error, which reads exactly
like a broken WHERE clause. Ids in these fixtures are `doc_owna`, not
`doc_own_a`.

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
