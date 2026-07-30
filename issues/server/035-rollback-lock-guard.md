# [SERVER-035] Skill rollback must honor edit locks (+ lane TOCTOU, truncation wording)

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-018
- Blocks: —

## Spec References
- SPEC.md §9.2 — "document write paths refuse edits to a document locked by the other party"; rollback routes
- SPEC.md §7 — skill rollback "lands as a normal auto-commit … like any mutation"

## Summary
PR #11 review (finding 1, MAJOR): `rollbackSkill`
(`apps/server/src/skills/rollback.ts`) is the only document write path that never
consults the edit-lock guard — every other mutation calls
`workspace.assertWritable(docId, actor)` (`docs/update.ts:221`, `docs/move.ts:35`,
`docs/archive.ts:103`, `docs/delete.ts:170`); rollback goes straight to
`mutex.run(...runMutation(...))`. Failure: user is editing `comment/SKILL.md` in the
board (session holds the lock — `corpus doc edit` would be 423-refused); agent runs
`corpus skill rollback comment` → server overwrites and commits over the in-progress
edit with no refusal. Rollback tests contain zero lock coverage. Also folds two
same-file MINORs from the review:

- **Finding 14 (TOCTOU)**: candidate read/selection (`rollback.ts:170-187`) runs
  outside the document lane; a save landing between the read and `mutex.run` is
  silently overwritten by a rollback chosen against stale bytes — violates the
  pipeline's inside-the-lane convention (SERVER-022 finding 7).
- **Finding 15 (refusal overclaim)**: the "history holds nothing that differs and
  validates" message (`rollback.ts:193-196`) asserts completeness the code didn't
  establish when the 50-revision walk (`git/show.ts:24-29`) truncates.

## Acceptance Criteria
- [ ] `rollbackSkill` calls the same edit-lock guard as the other write paths before mutating; when the other party holds the lock the route answers `423` (contract declares it per CONTRACT-018)
- [ ] Current-content read, candidate selection, validation, and the write all run inside the document lane — no window where a concurrent save is chosen-against-then-overwritten
- [ ] When `findLastKnownGood`'s revision walk truncates, the refusal message no longer claims exhaustiveness (scope the claim to the walked window, or walk to the root — pick one and say why in the log)
- [ ] Lock regression test: rollback against a doc whose lock the other party holds → 423, file and git untouched
- [ ] Lane regression test: a save entering the lane first is not overwritten by a rollback that read pre-save bytes (deterministic interleaving)

## Technical Design

### Files to Create/Modify
- `apps/server/src/skills/rollback.ts` — guard + restructure so selection happens inside `mutex.run`
- `apps/server/src/skills/*.test.ts` — lock + lane coverage
- `apps/server/src/git/show.ts` — only if the truncation fix lands there

### Key Implementation Details
Mind lock ordering when moving `withGitLock` inside the document lane: keep the
acquisition order every other path uses (document lane outermost unless the codebase's
convention says otherwise — check `runMutation` callers). `assertWritable` placement
should mirror `docs/update.ts`.

### Edge Cases
- `to === null` (last-known-good walk) and explicit `--to` both guarded.
- Lock held by the *same* party must still be writable (parity with other paths).

## Testing Strategy
apps/server scoped tests only (VITEST_MAX_THREADS=4): lock refusal, same-party pass-through, deterministic lane interleaving, truncation message case.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start the real server against a scratch workspace (explicit --workspace, ports 9180+)
2. Acquire the session-side edit lock on a skill doc (as the board does), then `corpus skill rollback <name>` as the agent
3. Expected: 423 refusal. Actual (pre-fix): rollback overwrites and commits.

### Verification Steps
1. Restart after the fix; repeat — expect 423, file unchanged, no new commit
2. Release the lock; rollback succeeds as before

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
