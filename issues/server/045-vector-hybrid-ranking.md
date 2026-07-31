# [SERVER-045] Vector storage + hybrid ranking in /api/search; `similar` related rows

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-044, CONTRACT-023
- Blocks: SERVER-047, UI-026, INFRA-012

## Spec References
- SPEC.md §9.1 semantic-index block (SHARED-006 Edit 6), §9.2 search/related bullets (Edits 7, 8)

## Summary
The retrieval payoff. Store chunk vectors queryably (a sqlite vector extension loaded
into the existing better-sqlite3 handle is the preferred shape — evaluate and record
the choice; a pure-JS brute-force scan over chunk vectors is an acceptable v1 fallback
for a single-user corpus and MUST be the automatic degrade when the native extension
fails to load on a platform). `/api/search` becomes hybrid: lexical (bm25) and
semantic (query embedded via the resolved provider, KNN over chunks) fused by
reciprocal-rank fusion into one ranked list — response shape unchanged, semantic-state
field honest: `current`, `catching-up` (pending > 0), or `lexical-only` (no usable
index/extension). `related` gains `similar` rows (nearest chunks' parent docs
aggregated), `both` when also linked. Platform check at startup, logged once.

## Acceptance Criteria
- [ ] A semantically-related-but-lexically-disjoint fixture doc surfaces in hybrid results and is labeled `similar` in related (the demo that vectors work)
- [ ] Ranking degrades to lexical-only with the honest flag when: index empty, identity invalid, or extension unavailable — never an error, never silently stale results
- [ ] `catching-up` reported while pending > 0; fusion is deterministic for fixed inputs
- [ ] Query embedding failures degrade the single request to lexical (flagged), not 500

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/vectors.ts` (new: storage + KNN + fallback scan), `apps/server/src/search/` fusion, `docs/related.ts` similar rows; extension load probe

## Testing Strategy
apps/server scoped: deterministic stub-embedding fixtures (hand-set vectors), fusion tables, every degrade path; fallback-scan parity test vs extension when available.

## E2E Verification Plan
Real server, real bundled/local provider: seed paraphrase pairs sharing no keywords; hybrid search finds them, `related` labels them `similar`; unload extension → lexical-only flag.

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
