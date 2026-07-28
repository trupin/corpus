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

## Rider (orchestrator, 2026-07-28)

`DocRow.parentTitle`'s description in `packages/contract/src/schemas/query.ts` ends
"render such a thread as standalone rather than showing a raw id" — adjudicated wrong during the
UI-004 parentTitle fix: an orphaned thread had a parent, and kit renders an empty context cell,
not the word "standalone". Correct the description to match (one line) while touching this file.

## Riders (orchestrator, 2026-07-28 — sprint-010 adjudications)

1. **`Job.type`** — add the event type to `JobSchema` (the projection already stores
   `events.type`); the console's job rows are `<event type> · <title>` per the prototype and §11.
   SERVER-027 populates it in the coupled commit.
2. **`DocsQuerySchema.includeArchived`** — stringbool (the `pinned` precedent). When true, the
   default `status <> 'archived'` exclusion is lifted (union — archived rows appear alongside
   open ones); absent/false keeps today's behavior; `status=archived` alone still means "archived
   only". SERVER-027 implements the query change. SPEC §11 clarification goes to the phase-end
   spec pass.
