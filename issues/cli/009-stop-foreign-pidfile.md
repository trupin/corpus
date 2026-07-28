# [CLI-009] `server stop` must not delete a live foreign pidfile

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus — one guarded branch plus tests.

## Dependencies

- Depends on: CLI-002
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), finding 16

## Summary

`commands/server/stop.ts:62-78` — the `foreign` state deletes a pidfile whose recorded pid is
alive (possibly this workspace's own server on a previously configured port), forfeiting the
CLI's only handle on that daemon. A live pid's pidfile should be left in place with a
diagnostic; only a dead pid's stale file is cleanup.

## Acceptance Criteria

- [ ] Live-foreign pid → pidfile kept, actionable message; dead pid → stale file removed.
- [ ] Tests cover both branches.

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
