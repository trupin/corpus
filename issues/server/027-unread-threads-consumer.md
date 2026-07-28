# [SERVER-027] Populate `DocRow.unreadThreads` in the collection query

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — one aggregate subquery in the collection query, UNREAD_SQL already exists.

## Dependencies

- Depends on: CONTRACT-012, SERVER-011
- Blocks: —

## Spec References

- `issues/contract/012-unread-threads-rider.md`

## Summary

Server half of the CONTRACT-012 coupled commit: an aggregate over the doc's threads using the existing `unreadSql(mark)` fragment (one source of truth — SERVER-021 precedent), no N+1, bounded query cost.

## Acceptance Criteria

- [ ] `unreadThreads` populated in `GET /api/docs`; 0 for threads/childless docs; consistent with per-thread `unread`.
- [ ] Query-plan sanity (no per-row subquery explosion on large corpora — verify with a seeded 500-doc workspace timing).
- [ ] Colocated tests + E2E; full gate green as the coupled unit.

## E2E Verification Log

_Filled in by the implementing agent ("implemented on: opus")._

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with CONTRACT-012

## Riders (orchestrator, 2026-07-28 — sprint-010 adjudications)

Consume both CONTRACT-012 riders in the same coupled commit:

1. **Populate `Job.type`** in job rows from the projection's `events.type`.
2. **Implement `includeArchived=true`**: lift the default `d.status <> 'archived'` exclusion
   (union). Absent/false unchanged; explicit `status=archived` still returns only archived.
