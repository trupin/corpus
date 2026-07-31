# [UI-026] ⌘K overlay adopts GET /api/search

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-045
- Blocks: —

## Spec References
- SPEC.md §11 search overlay (SHARED-006 Edit 11)

## Summary
The overlay's ranked result list switches from `GET /api/docs?q=` to `GET
/api/search`: same filter chips, same archived semantics, results now
relevance-ranked with heading path + snippet per hit; a quiet one-line note when the
response flags `catching-up`/`lexical-only`. **"Save as view" is unchanged** — it
pins the query as a filtered list served by `GET /api/docs` (the signed
ranked-search-vs-lists rule); the overlay must keep producing the same view document
it does today. Grouped-by-type presentation stays.

## Acceptance Criteria
- [ ] Overlay results come from `/api/search`, ranked, with heading-path subtitles; chips and archived behavior unchanged
- [ ] Staleness note shown exactly when flagged; absent on `current`
- [ ] "Save as view" produces an identical view doc to today (regression e2e)
- [ ] Result click-through navigation unchanged

## Technical Design
### Files to Create/Modify
- `apps/ui/src/search/` overlay data hook + result row (+ tests); save-as-view path untouched

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); overlay e2e spec updated to the new payload shape via the hermetic stubs.

## E2E Verification Plan
Real app: ranked results with section subtitles; save-as-view column identical to a pre-change one; note line under a catching-up index.

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
