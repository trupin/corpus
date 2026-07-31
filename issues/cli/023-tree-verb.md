# [CLI-023] `corpus tree`: expose GET /api/tree to the agent

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/tree`; §7 (agent interacts only through the CLI); §7 Retrieval discipline (structure ≠ enumeration)

## Summary
Found during sprint-019 pre-flight (Open Conflict 2): `GET /api/tree` exists in the
contract and serves the UI, but no CLI verb exposes it — the agent cannot see folder
structure at all (the comment skill's old workaround was a raw `data/docs/` read,
removed by AGENT-008's retrieval-first pass). A structure view is not enumeration:
one bounded call showing folders (and counts), not document bodies. Add `corpus
tree` as a thin typed-client verb; output compact (one folder per line, depth
indent, doc count); `--json` mirror. This is the same §7 reachability species as
CLI-022.

## Acceptance Criteria
- [ ] `corpus tree` renders the folder tree with per-folder counts; no document bodies
- [ ] `--json` mirrors the wire shape; docs/cli.md regenerated; inventory tests updated
- [ ] Skill text may then reference it for filing decisions (follow-up skill touch, not this issue)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/tree.ts` (new + tests); docs regen

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: seeded workspace → tree matches disk; empty workspace → sane empty output.

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
