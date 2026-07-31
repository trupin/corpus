# [SERVER-047] Context pack assembly

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-024, SERVER-041, SERVER-045
- Blocks: CLI-021

## Spec References
- SPEC.md §7 context packs (SHARED-006 Edit 4), §9.2 context bullet (Edit 9)

## Summary
Build `GET /api/threads/:id/context`: resolve the thread's anchor to its chunk
(SERVER-042 addressing), return the anchored passage with its enclosing section;
gather related excerpts ranked against the anchor text + thread text — links-graph
neighbors (SERVER-041) fused with semantic nearest chunks (SERVER-045); degrade to
links-only exactly like search degrades to lexical, same honesty. Enforce the
contract's bounds at assembly (rank, then cut). Whole-document threads: parent title
+ opening section; standalone: related-only pack ranked against the thread text.
Orphaned anchor (§6): the pack says so and carries the preserved quote.

## Acceptance Criteria
- [ ] All four thread shapes produce correct packs (anchored, whole-doc, standalone, orphaned-anchor)
- [ ] Bounds enforced: oversized corpus still yields a pack within contract caps, best-ranked first
- [ ] Semantic-degrade path mirrors search's flag semantics
- [ ] Pack for a thread whose anchor sits mid-section returns the WHOLE enclosing section, not a snippet fragment

## Technical Design
### Files to Create/Modify
- `apps/server/src/threads/context.ts` (new + tests), route wiring; reuses related + vector modules — no new ranking logic beyond fusion weights

## Testing Strategy
apps/server scoped: fixture workspace covering the four shapes + bound-overflow case.

## E2E Verification Plan
Real server: comment on a section of a seeded doc, `curl` the pack — passage, section, related excerpts all verifiable against files on disk.

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
