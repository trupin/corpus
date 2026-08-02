# [CONTRACT-026] Tag vocabulary source for the search overlay's tag chip

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: —

## Spec References
- SPEC.md §11 search overlay (filter chips)

## Summary
UI-026 finding (2026-08-02): the overlay's `tag:` chip offered options derived from
`DocRow.tags`, but ranked hits (`SearchHit`) deliberately carry no tags — so on the
hybrid path the chip can display and clear a tag but cannot offer one. Decide the
vocabulary source and spec/implement it: candidates are (a) a lightweight tags
aggregate on an existing surface (e.g. the tree endpoint already aggregates
folders), (b) a dedicated `GET /api/tags` (inventory + §9.2 rider), or (c) tags on
SearchHit (weighs every hit for one chip's benefit — probably wrong). Whichever
wins, the UI consumption is a small UI follow-up rider on this issue.

## Acceptance Criteria
- [ ] Chosen source specced (one-bullet §9.2/§11 rider if a new route — user sign-off per house rules), implemented, and the chip offers options again on the hybrid path
- [ ] No per-hit payload growth unless explicitly chosen

## Technical Design
### Files to Create/Modify
- Per the chosen option; contract + server + one UI touch

## Testing Strategy
Scoped per workspace touched.

## E2E Verification Plan
Real app: overlay tag chip offers the workspace's tags while ranked results render.

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
