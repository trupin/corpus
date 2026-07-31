# [SERVER-043] Embedding provider seam: local-first, sticky identity

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-042
- Blocks: SERVER-044, INFRA-012

## Spec References
- SPEC.md §9.1 local-first + one-index-one-model bullets (SHARED-006 Edit 6); user decision 2026-07-30 (local tool, zero-key)

## Summary
A narrow `EmbeddingProvider` interface (embed batch of strings → vectors + a stable
identity string `provider/model@dim`) with three implementations: local runtime
(Ollama-style HTTP on its default port — probe, never install), bundled local model
(works with zero config and no network; the model artifact itself is INFRA-012's
packaging problem — this issue defines the loading seam and uses a small test double
until the artifact lands), and explicit external provider from `.corpus/config.json`.
Resolution at index-creation time only: config wins; else local runtime if reachable;
else bundled. **Sticky**: the chosen identity is recorded in index metadata and reused
on every subsequent run regardless of environment changes; identity changes only via
config edit or `corpus index rebuild` (which re-picks the current default). Identity
mismatch at startup = the index is invalid → full rebuild queued (SERVER-044/046 wire
the behavior; this issue exposes the check).

## Acceptance Criteria
- [ ] Zero-config resolution order proven by tests (config > local runtime > bundled); probe failure falls through silently
- [ ] Identity recorded on first index write; later runs reuse it even when a "better" runtime appears (stickiness test)
- [ ] Config-declared provider with unreachable endpoint: explicit index error state, never a silent fallback (a configured choice failing loudly ≠ zero-config falling back)
- [ ] No network access in the bundled path; no key material ever logged

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/provider.ts` (new + tests), config schema addition, index metadata read/write in the projection

## Testing Strategy
apps/server scoped: resolution/stickiness/failure tables with stubbed probes; config parse cases.

## E2E Verification Plan
Real server, zero config: `index status`-level metadata (via sqlite3 until SERVER-046) records the bundled identity; add a config provider pointing nowhere → loud error state.

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
