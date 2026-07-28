# [CONTRACT-012] `DocRow.unreadThreads` — aggregate unread count for document rows

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — mirrors the parentTitle/originTitle rider pattern.

## Dependencies

- Depends on: CONTRACT-011
- Blocks: SERVER-027

## Spec References

- SPEC.md §11 — document rows' unread indicator
- `issues/ui/004-type-aware-rows.md` — deferral 2 (discovery: no wire data; per-row `?parent=&type=thread&unread=true` is the N+1 sprint-009 TEST-66 forbids)

## Summary

UI-004 shipped the pill behind an `unreadCount` prop seam reading `new` (no number) because `DocRow` carries no aggregate. Add `unreadThreads: number` (required, 0 for threads and childless docs) to `DocRow`, computed server-side in the collection query.

## Acceptance Criteria

- [ ] `DocRow.unreadThreads` required number; description states the semantics (count of this document's threads currently unread for the user).
- [ ] All standing invariants; artifacts regenerated, idempotent; downstream break list measured for SERVER-027.

## E2E Verification Log

_Filled in by the implementing agent ("implemented on: opus")._

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed (coupled with SERVER-027)
