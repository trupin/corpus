# [CONTRACT-011] Extra-frontmatter surface: view keys, pinned/order, parentTitle rider

## Domain

contract

## Status

todo

## Priority

P0

## Model

fable — the open-vs-closed frontmatter surface is an architectural call with plugin-system consequences (§10/§12); the shape decided here is what every plugin builds against.

## Dependencies

- Depends on: CONTRACT-005
- Blocks: SERVER-026, UI-003

## Spec References

- SPEC.md §11 — columns are pinned `type: view` documents (`pinned`, `order`, `query`, `column` frontmatter)
- SPEC.md §12 — plugin doc types carry their own frontmatter (`todo.items`)
- `issues/sprints/sprint-009.md` — Open Conflict 1 (discovery: no wire path for any view key; ~13 of UI-003's 16 ACs blocked)

## Summary

Sprint-009's planner found §11's view-document model has no HTTP surface: `docRowBaseShape`, `DocFrontmatterSchema`, `CreateDocRequestSchema`, `UpdateDocRequestSchema` are closed sets omitting `pinned`/`order`/`query`/`column`; no `pinned` query param; no `order` in `DOC_SORTS`. Adjudicated design (orchestrator, 2026-07-27): a **namespaced open extra-frontmatter object** carried on doc rows, create and update requests — serving §11's view keys now and §12's plugin keys (`todo.items`) without reopening the contract per doc type. Core keys stay closed and validated; the extra object is the explicit escape hatch, passed through byte-preserving (the server's YAML-splice machinery already does this on disk).

Riders: a `pinned` filter param and `order` sort on `GET /api/docs`; `DocRow.parentTitle` (nullable, required — mirrors `Job.originTitle`; UI-004's "show the parent's title" has no data source today).

## Acceptance Criteria

- [ ] Extra-frontmatter object (name and constraints are this issue's design work: collision rules with core keys, depth/size bounds, no core-key shadowing) on DocRow + create/update requests; round-trips through the generated client.
- [ ] `pinned` query param + `order` sort; view documents' keys reachable end-to-end in the schema.
- [ ] `DocRow.parentTitle` nullable-required rider.
- [ ] All standing invariants; artifacts regenerated, idempotent; known consequence: apps/server compile breaks at the response-shape sites — SERVER-026 consumes in the same coupled commit (TEST-76 waiver precedent).

## Technical Design

To be designed by the implementing agent within the adjudicated shape above; document the collision/validation rules in the schema descriptions (they are the plugin contract).

## E2E Verification Log

_Filled in by the implementing agent ("implemented on: fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed (coupled with SERVER-026)
