# [SERVER-093] Nothing reads a history the open window is still holding

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-091
- Blocks: —
- Related: SERVER-092 (the act closers), SERVER-052 (the edit acknowledgment,
  which already flushes and is the precedent for all of this)

## Spec References

- SPEC.md **§4** — "Nothing reads a history the window is still holding"
- SPEC.md **§4** — "Edit acknowledgment": the `doc.edited` event carries a commit
  range, which must be in git before the event exists
- SPEC.md **§7** line 330 — `corpus skill rollback`
- SPEC.md **§9.2** — `GET /api/docs/:id/diff`

## Summary

A window that is still open is a commit the server intends to keep amending. Any
operation that **names, reads or reverts a commit** must close it first, or it
reads a history that is about to change under it: `corpus doc diff` would show a
change that is not the one it was asked about, `corpus skill rollback` would
revert a version other than the one the person just saw, and an acknowledgment's
commit range would dangle the moment the next save amends its endpoint.

The last of those is already solved — `edit/sessions.ts` calls
`endSquashSession(session.lastSha)` before emitting, and its comment is the best
statement of the hazard in the codebase. This issue generalises that one call
into the rule §4 now states, and applies it to the readers that never had it.

## Acceptance Criteria

- [ ] `GET /api/docs/:id/diff` closes the open window **before** it reads. A diff
      requested mid-editing-session shows the change it was asked about, not a
      truncated one. Test by saving and immediately diffing inside the idle
      window — today that read misses the still-foldable content's boundary
- [ ] `corpus skill rollback` closes the window before it resolves the revision
      it is reverting to, and before it writes. It already passes `squash: false`;
      that is not the same thing and does not flush
- [ ] The edit acknowledgment keeps its guarantee. `endSquashSession` may become
      a wrapper over SERVER-091's `closeWindow`, but the published-sha rule must
      not regress and the tracker's timer must not start queueing behind the
      autosave path — see SERVER-091's note on the sync/async split
- [ ] A **read endpoint causing a commit** is accepted and deliberate. Say so at
      the call site in a comment: it is the crux of the rule, and the next
      reviewer will read a `GET` that mutates git as a defect unless it is
      explained
- [ ] Sweep for other readers. Anything in the tree that runs `git log`,
      `git show`, `git diff`, `git rev-parse` against a range or names a sha in a
      response or an event is a candidate. Name in the log every one you found and
      the ruling for each — flush, or why not
- [ ] Reads that do **not** touch git history are untouched, per §4's second
      list. A projection query, a document read, a tree read, a search — none of
      these may acquire the git lock, and a test should prove at least one of
      them does not
- [ ] Where several documents share one window commit, each document's
      acknowledgment names that same commit and each diff stays **path-scoped**,
      so every event still answers about its own document. This is new under
      party-scoped windows and is the acceptance criterion most likely to be
      missed: verify the diff route scopes by path and the acknowledgment's
      `stats` describe the document, not the whole commit
- [ ] `git log` run by hand in a terminal outside Corpus is the one reader that
      cannot be flushed. It lags by at most one open window. Nothing to
      implement; do not try

## Technical Design

### Files to Create/Modify

- `apps/server/src/edit/diff.ts` and/or `edit/routes.ts` — the diff read
- `apps/server/src/skills/rollback.ts`
- `apps/server/src/edit/sessions.ts` — the existing flush, if the primitive
  changes shape under it
- Whatever the sweep turns up

### Key Implementation Details

The primitive is SERVER-091's `closeWindow(reason)`. It runs inside the git lock;
the diff route and rollback already do their git work through `withGitLock`, so
the close belongs in the same critical section as the read — closing outside the
lock leaves a window for an autosave to open a new one between the flush and the
read, which is the whole bug in miniature.

`skills/rollback.ts` is subtle: it both **reads** history (to resolve the target
revision) and **writes** (the restored content, through `runMutation`). The flush
belongs before the read. Its existing `squash: false` stays and keeps meaning what
it means — the restoration commit does not fold into a preceding window.

**Path-scoping under multi-document commits** is the one genuinely new correctness
question here, and it is worth stating why. Before this rider, one window commit
touched one document, so "the diff of this commit" and "the diff of this document"
were the same set of bytes. They no longer are. Every reader that answers *about a
document* must scope its `git diff`/`git show` by path, and any that answered by
commit-wide diff was correct only by accident. Check the diff route and the
acknowledgment's `stats` computation specifically.

### Edge Cases

- **A diff requested when no window is open.** No-op close, no commit, no log
  line. The common case; it must not cost a git invocation.
- **A diff requested by the party that does not own the open window.** Close it
  anyway. The read is not a write, so no party-change flush semantics apply —
  the window simply ends because its content is about to be named.
- **A close whose subject rewrite is refused** (HEAD moved, published,
  mid-operation). The read proceeds against the history as it stands; the window
  is still closed. A refused rewrite must never fail the read.
- **Rollback of a document whose change is in the still-open window.** Flush,
  then resolve — otherwise the candidate list is computed against a commit that
  is about to be amended, and the sha the user picks moves under them.

## Testing Strategy

1. Save, then diff, inside the idle window → the diff names the save. Assert the
   commit count as well: the flush closes the window, it does not add a commit
   beyond the one the save already made.
2. Save two documents into one window, then diff each → each diff shows only its
   own document's change, and both name the same commit.
3. Rollback mid-session → the reverted content is the version that was on screen.
4. A projection read and a search under an open window → no git invocation
   (assert against the fake git's call log), window still open afterwards.
5. The acknowledgment's existing tests must still pass unchanged. If one needs
   changing, that is a signal the published-sha guarantee moved — stop and say so.

## E2E Verification Plan

Real server, free port (**never 8765 or 5173**).

### Verification Steps

1. `corpus doc edit` a document, then immediately `corpus doc diff` it inside the
   idle window. The diff shows the edit. `git log` shows the window's commit
   closed by the read.
2. Edit two documents inside one window, `corpus doc diff` each. Each shows its
   own change only.
3. `corpus skill rollback` a skill mid-editing-session; confirm the restored
   content matches the revision listed, and that the editing work committed
   before the rollback commit rather than being swept into it.

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
