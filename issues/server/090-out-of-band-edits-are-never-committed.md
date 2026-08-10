# [SERVER-090] An external editor's change is committed under someone else's name, or not at all

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
- Blocks: —
- Related: SHARED-040 (found it; explicitly **not** justified by it),
  SERVER-091–094 (the rider's implementation — this issue is independent of all
  four and may land before or after any of them), SERVER-007 (specified the
  commit that was never built), SERVER-005, SERVER-094 (boot recovery, the other
  thing that will pick these edits up if this is not fixed)

## Spec References

- SPEC.md **§4** — every mutation auto-commits with the acting party as git
  author; `git log` doubles as the audit trail of who changed what
- SPEC.md **§2** Architecture rule 1 — out-of-band edits are **legitimate**: the
  watcher detects them, reconciles anchors (§6), and re-projects
- SPEC.md **§5** — files on disk are the source of truth

## Summary

Found while verifying a claim in SHARED-040's draft, and deliberately filed apart
from it: this is a defect on its own terms and **must not be fixed as a side
effect of that rider**, or it will be recorded as a consequence of a design
change rather than as the bug it is.

Editing a workspace file in an external editor is a supported act (§2 rule 1).
The watcher reconciles its anchors and rewrites the file with `writeAtomically`
(`apps/server/src/watcher/reconcile-out-of-band.ts:138`) — **bypassing the commit
path entirely**. The watcher has no committer.

SERVER-007 step 5 specified the commit that should follow:
`reconcile: anchors on <docId> after external edit`. **No such subject exists
anywhere in `apps/`.** The log line at `reconcile-out-of-band.ts:142` records
`commit: "deferred"` above a comment saying "the `reconcile:` commit is
SERVER-005's; recorded here rather than faked" — and SERVER-005's write paths
commit their own mutations only. The comment points at a commit neither path
builds.

## What actually happens, and why it is worse than "uncommitted"

The commit path stages with `git add -A -- <paths>`. So an out-of-band edit
reaches git **incidentally**: the *next* server mutation to that document sweeps
the earlier content into its own commit, **under that mutation's actor and its
subject**.

Two consequences, and the first is the serious one:

1. **The audit trail is wrong, not merely coarse.** A change you made in an
   external editor is attributed to whoever touched the document next — often the
   agent. §4 makes `git log` the record of *who changed what*, and this makes it
   say something false. A reader has no way to tell.
2. **Absent a later mutation it stays uncommitted indefinitely**, so
   `corpus doc diff` and `corpus skill rollback` read a history that does not
   contain the change, and §9's "git is the only recovery" does not cover it.

## Acceptance Criteria

- [ ] Reproduce first, per the SDLC: edit a workspace file in an external editor,
      show that no commit follows; then make a server mutation and show the
      earlier content inside that commit under the wrong author
- [ ] An out-of-band edit is committed **for itself**, authored `user` — the
      watcher cannot know it was anyone else, and a person editing their own files
      is the only actor §2 rule 1 describes
- [ ] The commit says what it is, so a reader can tell it from a mutation the
      server performed. SERVER-007's `reconcile: anchors on <docId> after external
      edit` is the specified subject; use it or say why not
- [ ] A change no longer reaches git under a later mutation's authorship. Check
      what `git add -A -- <paths>` sweeps on every write path, not only this one
- [ ] Anchor reconciliation's own rewrite and the user's edit land together —
      they are one change to the file, not two
- [ ] The comment at `reconcile-out-of-band.ts:141-142` is corrected. It asserts a
      commit that does not exist, and it is why this went unnoticed

## Technical Design

### Files to Create/Modify

- `apps/server/src/watcher/reconcile-out-of-band.ts`, and whatever committer it
  needs to reach.

### Notes

- **Interaction with SHARED-040**, which is signed and being implemented in
  parallel: under commit windows an out-of-band edit joins or opens the `user`
  party's window rather than committing alone. Whichever lands second must not
  re-introduce the other's defect — fix the attribution here regardless of window
  shape, because "it will be right once windows exist" is how a wrong author
  survives a refactor.
- Check whether `git add -A -- <paths>` is the right staging for any path, not
  just this one: it is the mechanism that lets one act carry another's bytes.

## Testing Strategy

Write a file directly on disk, wait for the watcher, assert a commit exists with
the `user` author and the reconcile subject. Then a server mutation, and assert
its commit contains only its own change. Plus the no-later-mutation case: the
edit is in git without any subsequent activity.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
