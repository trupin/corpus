# [SERVER-141] List a folder's own documents

## Domain
server

## Status
todo

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

- [ ] `folderScope=self` matches a document whose path is `<folder>/<name>.md`
      and no document whose path has a further `/` after the prefix.
- [ ] `folderScope=self` matches no thread by inheritance — the thread's own
      path decides, like every other document's.
- [ ] The page statement and the COUNT statement share the condition, so
      `page.total` counts the set the page draws from.
- [ ] `folderScope=tree` produces the same SQL and the same rows as today. A
      test pins that, not a reading of the diff.
- [ ] A folder whose name contains `%`, `_` or `\` still matches exactly — the
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

### Reproduction (bugs only)
_[Agent fills]_

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
