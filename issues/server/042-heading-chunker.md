# [SERVER-042] Deterministic heading-path chunker with content-addressed identity

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-040
- Blocks: SERVER-043, SERVER-044

## Spec References
- SPEC.md §9.1 semantic-index block, chunking bullet (SHARED-006 Edit 6)

## Summary
The Phase B foundation: split document and turn bodies into chunks along markdown
heading structure — a chunk is a section addressed by its heading path, split further
past a bounded size budget (~500 tokens; approximate by chars, constant documented).
Chunk id = hash(doc id, heading path, content) — same content, same chunks, always.
New `chunks` table in the projection (schema bump, migration per the established
SCHEMA_VERSION pattern), populated at projection time; embeddings columns stay empty
until SERVER-044. Observable contract: re-projecting after a small edit changes only
the edited sections' chunk rows; a file move/rename changes none (id is identity).
Fence-aware parsing (headings inside code fences are not headings — reuse/extend the
todos plugin's fence-aware line-parser approach, but server-side). Search's on-read
heading derivation (SERVER-040) switches to chunk-table lookup here.

## Acceptance Criteria
- [ ] Deterministic: same body → identical chunk ids across runs; property test included
- [ ] Small edit to one section: only that section's chunk rows change (test asserts row-level diff)
- [ ] Move/rename: zero chunk changes; heading inside a code fence: not a boundary
- [ ] Oversized section splits at the budget with stable sub-addressing; turns chunk per turn heading
- [ ] `db rebuild` reconstructs chunks identically; SCHEMA_VERSION bumped with migration + downgrade refusal per existing pattern
- [ ] `/api/search` heading paths now come from chunks (on-read derivation removed).
PR #15 review note to close here: the on-read derivation addresses the FIRST
occurrence of a repeated passage (`locatePassage` indexOf) — a doc with identical
boilerplate under two headings always reports the earlier section. Chunk addressing
must key on the actual matched chunk, making this class impossible; add the
repeated-passage fixture as a test.

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/chunker.ts` (new + tests), `apps/server/src/projection/db.ts` (schema), projection write/rebuild paths, `apps/server/src/search/` lookup swap

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4): chunker property/table tests, projection-diff tests, migration test.

## E2E Verification Plan
Real server: save a one-line edit in a large seeded doc; inspect `chunks` rows before/after (sqlite3) — only the touched section differs; `db rebuild && db doctor` clean.

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
