# [PLUGINS-007] Todos column re-sourced off the body aggregate

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: — (closes PLUGINS-003 together with PLUGINS-006)

## Spec References
- SPEC.md §12 as amended by SHARED-005

## Summary
Third leg of the PLUGINS-003 design (parallel with PLUGINS-006): the Todos board
column reads item state from the body via the plugin's own aggregate route, keyed on a
`useDocs` `(id, updated)` fingerprint so core-path edits (now possible — the editor
owns the body) still refetch. Without the fingerprint there is a real SSE invalidation
hole: a checkbox toggled through the core editor broadcasts only core doc keys, which
the plugin's `lists` cache never observes (design section has the full analysis).

## Acceptance Criteria
- [ ] Column counts/preview correct against body-backed lists
- [ ] A toggle made through the core editor updates the column without reload (the fingerprint refetch proven)
- [ ] A toggle made through the plugin route/CLI still updates it (existing invalidation path intact)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos scoped; kit query tests where the fingerprint lives.

## E2E Verification Plan
Real server + browser (CORPUS_SERVER_ORIGIN exported and proven; never 8765); both toggle paths exercised.

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
