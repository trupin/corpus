# [SERVER-020] Watcher path breaks the tree-key invariant (structural heuristic vs. signature)

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — the mechanism already exists (`folderTreeSignature()` from SERVER-018); this drops it into the watcher's `flush()`.

## Dependencies

- Depends on: SERVER-018
- Blocks: —

## Spec References

- SPEC.md §9 — SSE invalidation keys
- `issues/server/018-tree-key-gaps.md` — the governing invariant and its escalation note

## Summary

Escalated by SERVER-018's implementer: mutation frames now satisfy the invariant ("a frame carries `["tree"]` exactly when `GET /api/tree`'s response changed") by construction, but the out-of-band **watcher** path (`watcher/watcher.ts`) still picks the key from a `structural` heuristic and breaks the invariant in both directions — reproduced: an on-disk edit setting `status: archived` removed a folder from `GET /api/tree` while the frame carried only doc keys; conversely a skill file appearing under `.claude/skills/` emits `["tree"]` though skills are counted nowhere.

## Acceptance Criteria

- [ ] The watcher's `flush()` decides `["tree"]` by comparing `folderTreeSignature()` across the re-projection, same as `runMutation`.
- [ ] Both reproduced directions become regression tests (disk-edit archive → key present; skill-file appearance → key absent).
- [ ] No new key names; mutation-path behavior untouched.
- [ ] Optional (sprint-007 evaluator note): `POST /api/db/rebuild` is the one remaining route emitting `["tree"]` on a byte-identical tree — deliberately coarse per SERVER-017. Decide whether to fold it into the measured scheme or bless the coarseness with a written rationale.

## Technical Design

Expected footprint: `watcher/watcher.ts` flush + tests. The signature helper is exported from `docs/tree.ts`.

## E2E Verification Plan

### Verification Steps

1. Reproduce both directions pre-fix on a real server with out-of-band file edits; log frames + tree bodies.
2. Post-fix: both directions satisfy the invariant.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

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

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-020]` prefix
