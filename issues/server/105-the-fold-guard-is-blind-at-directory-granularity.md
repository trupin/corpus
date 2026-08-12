# [SERVER-105] The fold guard is blind at directory granularity

## Domain

server

## Status

todo

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

- [ ] Reproduce both probes above against real git before changing anything
- [ ] The guard answers correctly for a directory-valued stage path, in both
      directions — a removal beneath a surviving directory, and a whole-directory
      removal whose contents the window changed
- [ ] The autosave path stays free of new git invocations. The current guard is
      zero-cost when nothing is missing, and that property is why it can run on
      every fold — do not trade it away for the directory case
- [ ] Consider instead **refusing to fold any commit that stages a directory
      path**. There is exactly one such caller and it is an act, so the cost may
      be nil and the guard stays simple. Say which you chose and why
- [ ] The disclosed non-bug stays a non-bug: an edit-then-delete inside one
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

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
