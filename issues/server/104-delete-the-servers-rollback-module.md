# [SERVER-104] Delete the server's rollback module

## Domain

server

## Status

done — landed 2026-08-12 inside SERVER-090's commit rather than one of its own,
which is why no `[SERVER-104]` commit exists. **This file was written after the
fact** (2026-08-13, INFRA-027): the work shipped, `issues/PLAN.md` carried the
row, and the issue file was never created. Verified against the tree rather than
taken on trust — `apps/server/src/skills/` holds `create`, `paths`, `routes` and
`index`, and no rollback module; the remaining matches for "rollback" in
`apps/server/src` are `docs/write.ts`'s in-memory undo stack, which is a
different mechanism with the same English word.

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-042
- Related: CLI-040 (removed the verb and the route), AGENT-023 (taught the loop)

## Spec References

- SPEC.md **§7** — skill genesis and what the agent may do to a skill
- SHARED-042 — *a revert is a write like any other* (applied 2026-08-12)

## Summary

`corpus skill rollback` destroyed uncommitted edits unrecoverably — PR #43's
review found it, and the fix went further than the bug. The user's answer was to
revert rather than overwrite, and the consequence is that the verb should not
exist at all: **a revert is a write whose content came from history**, so the
agent performs it with the write verbs it already has, and the skill teaches the
loop rather than the CLI carrying a special case.

That left the server's rollback module with no caller. This issue deleted it.

The three halves landed together: `CLI-040` removed the verb and the route,
`AGENT-023` taught the revert loop and the operator's `git restore` path, and
this one removed the implementation behind them. `SERVER-090` was promoted from
P1 tidiness to load-bearing by the same decision — with no verb, the operator's
recovery is a hand `git restore`, and §7 now guarantees the watcher commits that
as the `user` edit it is.

## Acceptance Criteria

- [x] The server's rollback module is deleted, along with its tests
- [x] Nothing in `apps/server` references it — the route was removed by CLI-040's
      contract change, so a leftover module would be dead code the typechecker
      cannot see
- [x] The skills' revert guidance does not point at anything the server still
      exposes

## Technical Design

### Files to Create/Modify

- `apps/server/src/skills/` — remove the rollback module and its test

## Testing Strategy

Deletion, so the test is the absence: the server's suite passes with the module
and its tests gone, and no import of it survives.

## E2E Verification Log

Landed as part of SERVER-090's verification run (2026-08-12); see that issue's
log. Re-verified against the tree 2026-08-13 while filing this file, as recorded
under Status above.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[ISSUE-ID]` prefix — folded into SERVER-090's commit
