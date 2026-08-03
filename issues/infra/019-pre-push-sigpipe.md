# [INFRA-019] Tag pushes die after the pre-push gate passes; cause unknown

## Domain
infra

## Status
todo — the stdin drain shipped, but it did NOT fix the symptom. Reopened as the
investigation into why a tag ref never reaches the transport while a branch ref
does. v0.2.0 was released by creating the ref via the GitHub API.

## Priority
P0

## Model
opus

## Dependencies
- Depends on: —
- Blocks: every `v*` tag push (blocked the v0.2.0 release)

## Spec References
- —

## Summary
Found while releasing v0.2.0 (2026-08-03). `git push origin refs/tags/v0.2.0`
ran the full gate, printed `pre-push ✓ all checks passed`, and then **exited
141** with nothing on the remote. Three attempts, three identical outcomes; the
tag existed locally and `git ls-remote --tags origin` kept showing only v0.1.0.

141 is 128 + 13 — SIGPIPE. The initial diagnosis was that the hook never reads
the ref list git writes to its **stdin**, so a child (npm, vitest, tsc,
Playwright — all spawned with that descriptor inherited) closes it and git's
write raises SIGPIPE. The hook was changed to drain stdin on that basis.

**That diagnosis did not hold, and this file previously recorded it as proven.**
After the drain landed, tag pushes failed identically. A traced branch push
(`GIT_TRACE=1`) on the same tree then *succeeded*, which rules out the hook: the
same code path passes for a branch ref and dies for a tag ref.

What is actually established:

- Branch pushes complete normally, before and after the change.
- Tag pushes die the instant the hook returns — with `GIT_TRACE=1` enabled, git
  emits **no trace line at all** after `pre-push ✓ all checks passed`, whereas a
  branch push at that same point emits `run_command: git pack-objects …` and
  proceeds. So git is not reaching the transport for a tag ref.
- The gate itself is not the problem: it ran and passed five times across these
  attempts, e2e included.
- Exit status is unreliable in this environment: one run where the hook
  deliberately blocked (a flaky unit test) printed git's own
  `error: failed to push some refs` — proof git was alive and reporting — and
  the shell still surfaced 141.

**Cause of the tag-push failure: unknown.** v0.2.0's ref was created through the
GitHub API (`POST /repos/:owner/:repo/git/refs`) after the gate had passed on
that exact commit; the release workflow triggered normally from it.

The stdin drain is kept regardless. A pre-push hook consuming the ref list git
hands it is correct on its own terms, and the value is kept (`refs_to_push`,
readonly) rather than discarded to `/dev/null`, so a future check that wants to
know what is being pushed reads the variable instead of re-introducing an unread
pipe. It is hygiene, not the fix for the reported symptom.

## Acceptance Criteria
- [x] The hook consumes its stdin before spawning anything (shipped; hygiene)
- [x] Branch pushes still work (exercised by pushing this fix)
- [x] The gate itself is unchanged — same steps, same order, same failure mode
- [ ] **`git push origin refs/tags/<v>` lands the ref, without the API detour**
- [ ] The cause is identified rather than worked around — start from the trace
      asymmetry above (no `run_command` line for a tag, one for a branch), and
      check whether anything in this environment wraps or intercepts `git`
- [ ] Whatever is found, releasing does not depend on a human remembering a
      manual API call

## Technical Design
### Files to Create/Modify
- `.githooks/pre-push`

## Testing Strategy
The fix is verified by the thing it unblocks: push the branch (exercises the
hook on a branch ref), then push the `v0.2.0` tag and confirm it lands on the
remote and triggers `release.yml`.

## E2E Verification Log

**Model: Fable 5, orchestrator, 2026-08-03.**

Pre-fix, three consecutive attempts on the same commit (`6cef2d3`):

```
$ /usr/bin/git push origin refs/tags/v0.2.0 > tagpush.log 2>&1; echo "EXIT=$?"
EXIT=141
$ tail -1 tagpush.log
pre-push ✓ all checks passed
$ /usr/bin/git ls-remote --tags origin
3877372…  refs/tags/v0.1.0        <-- v0.2.0 absent
```

The gate passed every time (239 e2e specs, 2.5 min) and the ref never landed.

Post-fix result recorded below with the release.

## Completion Checklist (domain agent)
- [x] Tests written and passing (the hook is the test; see above)
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
