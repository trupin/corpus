# [SERVER-105] The fold guard is blind at directory granularity

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-090 (added the guard), SHARED-040 (commit windows)

## Spec References

- SPEC.md **§4** — "a document created and deleted inside one window would
  otherwise leave nothing in git to recover from"

## Summary

Found by PR #43's fourth review pass, by running the real committer rather than
reading it. **Latent — no production caller reaches it today** — and filed
because it becomes real the moment one does.

`amendWouldOrphanContent` (`apps/server/src/git/commit.ts`) refuses a fold that
stages the removal of a path `HEAD`'s parent does not carry. It is blind at
directory granularity in two distinct ways, both confirmed against real git:

1. **A removal from inside a surviving directory path.** If a staged path is a
   directory that still exists on disk, `stageablePaths` never puts it in
   `missing`, so `removed` is `[]` and the guard returns `false` on its first
   line — whatever was deleted underneath. Probe: directory staged, `extra.md`
   created inside the window then deleted → `amended`, and
   `git log --all -- extra.md` is empty.
2. **A whole-directory removal.** `cat-file -e HEAD^:<dir>` succeeds on a *tree*,
   so "does `HEAD^` carry this path" answers yes for a directory whose *contents*
   the window changed. Probe: directory in `HEAD^`, new file added under it
   inside the window, whole directory removed → `amended`, zero reachable objects
   for that file.

Both are the exact failure SERVER-090's guard exists to close.

## Why it is not reachable today

The only directory-valued stage paths in production are `move.from`/`move.to`
from `apps/server/src/docs/archive.ts` — the skill folder archive/unarchive.
That is a whole-directory **move**: `mergeDirectory` relocates every file and
both halves are staged in one commit, so the content is present at the
destination.

It turns into a real hole the moment any caller stages a directory for something
other than a whole-directory move.

## Acceptance Criteria

- [x] Reproduce both probes above against real git before changing anything
- [x] The guard answers correctly for a directory-valued stage path, in both
      directions — a removal beneath a surviving directory, and a whole-directory
      removal whose contents the window changed
- [x] The autosave path stays free of new git invocations. The current guard is
      zero-cost when nothing is missing, and that property is why it can run on
      every fold — do not trade it away for the directory case
- [x] Consider instead **refusing to fold any commit that stages a directory
      path**. There is exactly one such caller and it is an act, so the cost may
      be nil and the guard stays simple. Say which you chose and why
- [x] The disclosed non-bug stays a non-bug: an edit-then-delete inside one
      window still folds, and the intermediate revision is collapsed. That is what
      folding is for, and the document survives at its pre-window state

## Technical Design

### Files to Create/Modify

- `apps/server/src/git/commit.ts`

### Notes

- The guard's line is "the window introduced this path" versus "the window
  changed a path that already existed". The directory case breaks it because a
  tree can satisfy "already existed" while its contents did not.

## Testing Strategy

The two probes as tests, driving the real `AutoCommitter` against a real
repository — the review's probes are the specification.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), run by the orchestrator
directly rather than delegated. Branch `phase-33-signed-riders`. No server
started, no port bound (8765 and 5173 untouched).

### 1. Both probes reproduced first, against real git

Written as tests before `commit.ts` was touched, driving the real
`AutoCommitter` against a real repository (`makeRepo`), and run:

```
$ npx vitest run apps/server/src/git/commit.test.ts -t "SERVER-105"
PASS (0) FAIL (2)
 1. keeps a file created and deleted under a surviving directory reachable
    AssertionError: expected 'amended' to be 'committed'
 2. keeps a file reachable when the whole directory holding it is removed
    AssertionError: expected 'amended' to be 'committed'
```

Both folded where they must not — the review's finding, confirmed rather than
taken on trust.

### 2. The choice: refuse to fold any save that stages a directory

Took the option the issue flagged for consideration, for the reason it gave.
Answering the question *properly* means comparing trees, which is a git
invocation on the fold path, and the fold path is every autosave — that trades
away exactly the zero-cost property AC #3 protects. Refusing outright costs
nothing measurable instead: the only production caller that stages a directory
is the skill-folder archive/unarchive (`docs/archive.ts`'s `move.from`/`move.to`),
and that is an **act** — §4's acts commit alone and never fold — so the condition
fires on saves that were not going to fold anyway. It becomes a real cost only if
a future caller stages a directory for an ordinary save, and the cost then is one
extra commit, which is the trade every other condition on that line already makes.

Directory-ness is read off the `statSync` that already decided whether the path
exists (replacing `existsSync` — the same syscall, one more field consulted), and
a *removed* directory off the `ls-files` output that branch already fetches: a
tracked entry beneath a missing path is what makes that path a directory. No new
git invocation anywhere.

### 3. Green after the fix

```
$ npx vitest run apps/server/src/git/commit.test.ts   → PASS (51) FAIL (0)
$ npx vitest run apps/server/src/git                  → PASS (80) FAIL (0)
$ npx vitest run apps/server/src/docs                 → 547 passed (27 files)
$ npx eslint <both files>                             → No issues found
$ npx prettier --check <both files>                   → all use Prettier style
$ npm run build && npm run typecheck -w apps/server   → exit 0
```

The `docs` suite matters specifically: it exercises the skill-folder
archive/unarchive, the one production caller that stages a directory path.

### 4. The two properties that had to survive, asserted

- **Zero-cost on the autosave path** — an ordinary same-party fold of one file
  reaches `ls-files` zero times (`r.calls.some(call => call[0] === "ls-files")`
  is `false`), so the guard still runs on every fold for free.
- **The disclosed non-bug stays a non-bug** — an edit-then-delete of a document
  that existed *before* the window still folds (`kind: "amended"`), and the
  document is still readable at its pre-window state from the prior commit.

## Completion Checklist (domain agent)

- [x] Tests written and passing (4 new: two probes, the zero-cost property, the non-bug)
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
