# [CLI-018] Agent-writable view keys: make §11's "pin me a view" promise reachable

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-016
- Blocks: —

## Spec References
- SPEC.md §11 — "@agent pin me a view of unresolved finance threads just works"

## Summary
Wave-3 audit SPEC 37: `pinned`/`order`/`query`/`column` are core-reserved keys, so
CLI-016's `--extra` refuses them and no other flag writes them — the CLI-only agent
cannot create or pin a view, leaving §11's promise unreachable. Design space: dedicated
flags on `doc create`/`doc edit` (`--pinned`, `--order`, `--query k=v…`), or a
`corpus view create|pin` verb pair. Also decide audit SPEC 38 here: whether `--extra`
gains a documented object escape hatch (the publish plugin stores `publish: {…}`) or
its description drops "total" — one adjudication covering both scalar-shape questions.

## Acceptance Criteria
- [ ] The agent can create a pinned, ordered view with a query through documented CLI verbs alone; it appears as a board column over SSE
- [ ] SPEC 38 adjudicated (object escape hatch or honest description), implemented accordingly
- [ ] docs/cli.md regenerated

## Technical Design
### Files to Create/Modify
- apps/cli doc/create + edit or a new view topic (+ tests), docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: agent creates+pins a view via CLI; board shows the column live.

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
