# [CLI-020] `corpus index status` / `corpus index rebuild`

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-023, SERVER-046, CLI-019
- Blocks: —

## Spec References
- SPEC.md §9.1 verbs bullet (SHARED-006 Edit 6)

## Summary
Thin typed-client verbs. `corpus index status`: one compact block — identity,
indexed/pending/failed counts, rebuild-in-progress; `--json` mirror. `corpus index
rebuild`: fires, prints the one-line acknowledgment + a hint to watch status (no
polling loop — the verb returns). Also: `corpus search` (CLI-019) now renders its
degraded-ranking note when the server reports `catching-up`/`lexical-only` — the
gating already shipped in CLI-019; this issue adds the wire-value mapping and tests.

## Acceptance Criteria
- [ ] Status output compact and stable-ordered; `--json` passthrough
- [ ] Rebuild returns immediately with acknowledgment; no watch loop
- [ ] Search note line: exact wording per state, silent on `current`; covered by tests

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/index/status.ts`, `index/rebuild.ts` (new), command registration; `search.ts` note mapping

## Testing Strategy
apps/cli scoped: formatting against stubbed client states.

## E2E Verification Plan
Real server via the bin: status mid-drain shows honest counts; rebuild acknowledges and status reflects it; search prints the catching-up note.

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
