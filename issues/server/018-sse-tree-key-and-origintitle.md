# [SERVER-018] Thread deletion omits the `["tree"]` invalidate key; thread-origin jobs report `originTitle: null`

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

Two small server-side gaps found (and explicitly ruled non-blocking) by the sprint-006 evaluator:

1. **Thread deletion emits no `["tree"]` SSE key, though thread creation does.** A deletion changes the tree exactly as much as a creation; a board subscribed on `["tree"]` shows a stale entry until an unrelated invalidation arrives.
2. **`GET /api/jobs` returns `originTitle: null` for thread-origin jobs.** The projection has the thread's title; the jobs listing should carry it so the console (UI-011) can label the job's origin without a second fetch.

## Acceptance Criteria

- [ ] Deleting a thread (both direct deletion and last-turn cascade) broadcasts the same key set shape as creation, including `["tree"]`.
- [ ] `GET /api/jobs` returns the origin thread's title in `originTitle` for thread-origin jobs; document-origin jobs unchanged.
- [ ] Regression tests for both; SSE key vocabulary unchanged (no new key names).

## Technical Design

Expected footprint: the thread-delete invalidation frame construction and the jobs listing projection query. No contract changes — `originTitle` is already nullable in the schema; this populates it.

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
