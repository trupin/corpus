# [SERVER-040] GET /api/search: lexical ranked retrieval with heading-path hits

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022
- Blocks: CLI-019, SERVER-042 (chunk addressing supersedes on-read derivation)

## Spec References
- SPEC.md §9.2 search bullet (SHARED-006 Edit 7), §7 Retrieval discipline (Edit 4)

## Summary
Implement `GET /api/search` over the existing FTS5 `search` table: relevance-ranked
(bm25), composing the same filter predicates as the docs list (shared code, not
copied), archived default identical. Per hit: doc id, title, **heading path of the
best-matching passage**, one-line snippet. The projection stores no heading structure
in Phase A: derive on read for the top-k only — locate the FTS match offset in the
body (or turn), walk the markdown headings above it (threads: the turn's H2 is the
path). Cap `limit` sanely. Response envelope includes the semantic-state field as
`current`/absent per the frozen contract.

## Acceptance Criteria
- [ ] Ranked results for title/body/turn matches; filters compose exactly like `/api/docs` (shared predicate builder — a filter added later cannot diverge)
- [ ] Hit in a nested section reports the full heading path; hit in a turn reports the turn heading; body text never returned
- [ ] Archived excluded by default; `includeArchived` lifts, explicit status filter untouched (same rule as the overlay)
- [ ] Derivation cost bounded: only top-k bodies are read

## Technical Design
### Files to Create/Modify
- `apps/server/src/search/` (new: route handler, heading-path derivation, snippet), wiring in the app; extract the shared filter builder from the docs-list module

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4): ranking fixture corpus, heading-path cases (top-level, nested, turn, no-heading doc → path = title), filter parity table vs `/api/docs`.

## E2E Verification Plan
Real server, seeded workspace: `curl /api/search?q=…` returns ranked frugal hits; verify a nested-section hit's path against the file on disk.

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
