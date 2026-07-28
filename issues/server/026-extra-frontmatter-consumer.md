# [SERVER-026] Consume CONTRACT-011: extra frontmatter, pinned/order, parentTitle

## Domain

server

## Status

todo

## Priority

P0

## Model

opus — projection/query plumbing on established patterns (originTitle precedent).

## Dependencies

- Depends on: CONTRACT-011, SERVER-011, SERVER-015
- Blocks: UI-003

## Spec References

- SPEC.md §11 (views), §12 (plugin frontmatter)
- `issues/contract/011-extra-frontmatter-surface.md`

## Summary

Server half of the CONTRACT-011 coupled commit: project the extra-frontmatter object into doc rows (byte-preserving via the existing YAML machinery), honor it on create/update through the standard mutation pipeline (validation per the contract's collision rules), support the `pinned` filter and `order` sort in the collection query, and populate `parentTitle` (one query with the parent resolution, read at response time — the `originTitle` pattern).

## Acceptance Criteria

- [ ] apps/server compiles against the regenerated contract; extra frontmatter round-trips disk → row → create/update E2E (seed views' `pinned`/`order`/`query`/`column` visible via `GET /api/docs?pinned=true&sort=order`).
- [ ] parentTitle populated for parented threads; null otherwise.
- [ ] Colocated tests + E2E evidence; full gate green as the coupled unit.

## E2E Verification Log

_Filled in by the implementing agent ("implemented on: opus")._

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
- [ ] Committed with CONTRACT-011
