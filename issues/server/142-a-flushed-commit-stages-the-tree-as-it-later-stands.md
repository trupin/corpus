# [SERVER-142] An out-of-band commit stages the tree as it later stands, not as it was observed

## Domain
server

## Status
todo

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 4 — git auto-commit, and the audit trail carried by the commit
  author
- SPEC.md Section 7 — the agent's writes and what attributes them

## Summary

**Escalated by SERVER-140's implementer against the machinery its own test
protects, rather than against someone else's code.** Not fixed there on purpose:
the cheap patch is wrong in exactly the case that matters.

`collectDocument` records an out-of-band commit for **every** event it processes,
duplicates included, and `flush()` hands that commit to a promise chain. The
commit's `git add` therefore stages the working tree **as it stands when the
commit runs**, not as it stood when the flush observed it.

So if the server writes the same path while such a commit is waiting on the git
lock, the person's commit carries the **server's** bytes under the `user`
author. That is the mirror image of the rule SERVER-140's test exists to protect,
and §4's whole audit trail is the commit author.

`selfWrites.record` cannot prevent it. The observation predates the record.

## Why it is filed rather than fixed

The obvious cheap patch — skip the commit when the registry says the bytes are
the server's — is wrong when the **first** flush's commit is the stale one,
because skipping then loses the person's commit entirely. A lost commit is worse
than a misattributed one: one is a wrong label on a recorded change, the other is
an unrecorded change.

Closing this needs one of two designs, and choosing between them is a decision
about the watcher/committer boundary:

1. **Stage a snapshot of the observed bytes.** The commit records what the flush
   saw, whatever the tree says by the time the lock is free. Correct by
   construction, and it means the committer stops using the working tree as its
   own input.
2. **Share a lock between the watcher's commit chain and `applyOperations`.** The
   server cannot write a path while a person's commit over that path is
   outstanding. Simpler to state, and it puts a server write behind a lock held
   by a filesystem event, which is a latency question nobody has measured.

## Why it is not in v0.20.0

v0.20.0 is four sentences already — the tree, the reader's values, the reader's
width, and what the agent pays for the CLI. This is a fifth, it needs a design
decision rather than an implementation, and no user has reported it. Debt that
merely exists is not a reason to widen a release.

It is **P1 rather than P2** because the thing it corrupts is the audit trail, and
an audit trail is only worth what its worst entry is worth.

## Acceptance Criteria

- [ ] A person's commit records the bytes the flush observed, whatever the tree
      holds when the commit runs.
- [ ] A server write racing a person's outstanding commit changes neither the
      person's commit's contents nor its author.
- [ ] No path through the fix can drop a person's commit. A reproduction covering
      the first-flush case exists and is asserted.
- [ ] The chosen design is written down with the one rejected, and why it lost.

## Technical Design

### Files to Create/Modify
- `apps/server/src/watcher/` — `collectDocument`, `flush`, and the committer
- `apps/server/src/git/commit.ts` — if design 1 is chosen, the staging path
- the tests beside each

### Key Implementation Details

Read SERVER-140's issue file first. Its "The finding" section carries the
reasoning that produced this issue, and its test is the one that must keep
passing.

`selfWrites.record` is not the mechanism here and cannot be made into one. Do not
reach for it.

### Edge Cases
- The first flush's commit being the stale one — the case that rules out the
  cheap patch.
- Several out-of-band commits queued over the same path.
- A commit whose observed bytes no longer exist on disk at all.

## Testing Strategy

A test that writes a path from the server while a person's commit over the same
path is outstanding, and asserts both the contents and the author of the
resulting commit. It must be able to fail: remove the fix and watch the server's
bytes land under `user`.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server on a scratch workspace
2. Edit a document out of band and hold the git lock
3. Have the server write the same path before the lock frees
4. Expected: the person's commit carries the person's bytes
5. Actual: it carries the server's, under the `user` author

### Verification Steps
1. Repeat with the fix, and inspect the commit with `git show`
2. Repeat the first-flush case and confirm no commit is lost

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
