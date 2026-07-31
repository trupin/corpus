# [CONTRACT-022] Routes: GET /api/search + GET /api/docs/{id}/related

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-006 (amendment applied to SPEC.md)
- Blocks: SERVER-040, SERVER-041, CLI-019, CONTRACT-023, CONTRACT-024, UI-025

## Spec References
- SPEC.md §9.2 (SHARED-006 draft Edits 7, 8 — apply-time text), §7 Retrieval discipline (Edit 4)

## Summary
Retrieval Phase A's two read-only routes, with **frozen response shapes** (Phase B
upgrades ranking in place; the shapes never change — the signed drafting decision).

- `GET /api/search`: `q` required; the full `GET /api/docs` filter set with identical
  semantics (incl. archived default); `limit`. Hit = document id, title, heading path
  of the best-matching passage (turn heading for thread hits), one-line snippet —
  never a body. Include from day one the **optional** semantic-staleness flag field on
  the response envelope (absent/`current` in Phase A) so Phase B is additive-only.
- `GET /api/docs/{id}/related`: `limit`, `includeArchived`. Row = id, title, one-line
  excerpt, relation literal (`linked | similar | both`) — `similar`/`both` unused
  until Phase B but in the enum now (shape freeze).

Both read-only, no acting party, bearer-guarded like everything else.

## Acceptance Criteria
- [ ] Both routes in `ENDPOINT_INVENTORY` and §9.2 spelling matches exactly (inventory test green)
- [ ] Zod schemas: search hit and related row shapes as above; filters reuse the existing docs-list query schema (shared, not copied)
- [ ] Generated openapi.json + typed client updated, drift check green
- [ ] Response envelope carries the optional semantic-state field, documented as Phase B's seam

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/search.ts` (new), `docs.ts` (related route), `inventory.ts`, barrel, regenerated `openapi.json`
- Reuse/extract the docs-list query param schema so search and docs cannot drift

## Testing Strategy
packages/contract scoped: inventory equality, schema round-trips (hit/row parse, enum), openapi snapshot.

## E2E Verification Plan
`npm run build` then the generated client typechecks against both routes; openapi drift check green.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
