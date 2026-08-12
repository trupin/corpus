# [CLI-039] A hung `git gc` leaves children the timeout does not kill

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-037 (added the bound), SERVER-089 (measured the corruption)

## Spec References

- SPEC.md **§4** — "Corpus maintains the repository; git does not maintain it in
  the background", and "Maintenance never prevents a server from starting"

## Summary

Found by PR #42's review, disclosed in a code comment, and filed so the gap is
not discoverable only by reading that comment.

`runGit` bounds every git child at 120 s (CLI-037), which turns a hung `git gc`
into the failure §4 already promises to handle. But Node's `execFile` timeout
calls `child.kill()` on the **direct pid**, not the process group — and `git gc`
forks `git repack` and `git pack-objects` as its own children. So on expiry the
`gc` process dies while a repack may still be running, and `corpus server start`
then spawns the server beside it: **the concurrent-writer condition CLI-037
exists to remove**, reached through the pathological door rather than the
ordinary one.

Reaching it needs `gc` to hang past 120 s, so this is a genuine pathology-only
window, and the bound is still strictly better than hanging forever. But the
whole point of CLI-037 was that a second unsupervised writer must not exist.

## Acceptance Criteria

- [ ] Reproduce: make a `gc` outlive the bound and show a `repack` child
      surviving the kill
- [ ] The whole process group is signalled, or the start refuses to spawn while a
      repack is still alive — whichever is chosen, say why, since they have
      different failure modes
- [ ] `corpus server start` still never blocks on maintenance (§4). A fix that
      makes the start wait for a wedged repack trades one failure for a worse one
- [ ] `apps/cli/src/commands/init/git.ts`'s disclosure comment is updated to
      describe what is true afterwards
- [ ] `git-timeout.test.ts` covers the new behaviour, and keeps pinning that the
      bound itself exists

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/init/git.ts`

### Notes

- `detached: true` plus `process.kill(-pid)` is the usual shape for signalling a
  group, but it changes how the child is reaped and how its output is collected.
  Check both rather than assuming.

## Testing Strategy

A fake `git` on `PATH` that forks a long-lived child, so the group behaviour is
observable without waiting 120 s for a real repack.

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
