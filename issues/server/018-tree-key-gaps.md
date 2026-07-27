# [SERVER-018] `["tree"]` invalidate-key gaps: thread deletion and archive/unarchive

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — two narrow, well-located fixes surfaced by the sprint-006 evaluator; no design ambiguity.

## Dependencies

- Depends on: SERVER-006, SERVER-009
- Blocks: — (UI-008 and UI-011 consume the corrected behavior but are not hard-blocked)

## Spec References

- SPEC.md §9 — SSE invalidation keys
- `issues/evals/CLI-004-eval.md` — the two "minor, not failures" notes at the end of the sprint-006 verdict

## Summary

`["tree"]` invalidate-key gaps on mutation paths that change what `GET /api/tree` returns:

1. **Thread deletion emits no `["tree"]` SSE key, though thread creation does** (sprint-006 evaluator). A deletion changes the tree exactly as much as a creation; a board subscribed on `["tree"]` shows a stale entry until an unrelated invalidation arrives.
2. **`doc archive`/unarchive emit no `["tree"]` key either** (sprint-007 planner, by inspection of every `TREE_KEY` emitter in `docs/archive.ts`) — yet archived documents are excluded from every folder count, so the board's folder badges silently desynchronize. Sprint-007 contract TEST-132b covers this.

The governing invariant (sprint-007 contract): **a mutation's invalidate frame carries `["tree"]` exactly when the response of `GET /api/tree` actually changed.**

> **Scope adjudication (orchestrator, 2026-07-27):** the originally filed second half — populating `originTitle` in the jobs listing — is **struck**: `JobSchema` has no such field anywhere in the contract, so it is a contract change, not a population fix. It is now a CONTRACT-007 rider (jobs-listing origin title), consumed by UI-011.

## Acceptance Criteria

- [ ] Deleting a thread (both direct deletion and last-turn cascade) broadcasts the same key set shape as creation, including `["tree"]`.
- [ ] `doc archive` and unarchive broadcast `["tree"]` (their folder counts change).
- [ ] Reproduction logged first for both paths (these are bugs); regression tests for both; SSE key vocabulary unchanged (no new key names).
- [ ] Audit of the remaining tree-changing mutations against the invariant (create/move/delete already emit; state which paths were checked).

## Technical Design

Expected footprint: the invalidation frame construction in the thread-delete/cascade path and `docs/archive.ts`. No contract changes.

## Testing Strategy

Colocated Vitest: one SSE-frame assertion on thread delete/cascade; one jobs-listing assertion with a thread-origin job. E2E: curl -N on /events during a delete; jobs listing after a thread-origin job.

## E2E Verification Plan

### Verification Steps

1. Real workspace: create anchored thread, delete it; capture SSE frames; `["tree"]` present on both creation and deletion.
2. Enqueue a thread-origin job; `GET /api/jobs` shows the thread title in `originTitle`.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

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
- [ ] Committed with `[SERVER-018]` prefix
