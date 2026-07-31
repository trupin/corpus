# [CLI-019] `corpus search` + `corpus doc related`: token-frugal retrieval verbs

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-022, SERVER-040, SERVER-041
- Blocks: AGENT-008, CLI-020

## Spec References
- SPEC.md §7 Retrieval discipline (SHARED-006 Edit 4), §9.2 (Edits 7, 8)

## Summary
The agent's retrieval surface. `corpus search "<query>"` with the same filter flags as
`corpus doc list` (shared flag definitions — they must not drift) plus `--limit`;
`corpus doc related <id> [--limit] [--include-archived]`. Output is the **token-frugal
contract**: one line per hit — id, heading path (or relation label for related), the
snippet/excerpt — nothing else; a `--json` escape hatch mirrors the wire shape. Both
are thin typed-client calls; no local logic beyond formatting. Exit codes and error
rendering follow the existing verb conventions.

## Acceptance Criteria
- [ ] One line per hit, fields tab-separated in the existing list-output style; no bodies, no wrapping, stable field order (agents parse this)
- [ ] Filter flags shared with `doc list` (single definition site); `--json` mirrors the wire response
- [ ] Empty result and unknown id render per existing conventions (empty table / 404 error path)
- [ ] Search verb prints the semantic-state note line ONLY when the server flags degraded ranking (silent in Phase A)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/search.ts` (new), `apps/cli/src/commands/doc/related.ts` (new), shared filter-flag module with `doc/list.ts`, command registration

## Testing Strategy
apps/cli scoped: output formatting against a stubbed client (frugal line shape, --json passthrough, degraded-note gating), flag-parity test with doc list.

## E2E Verification Plan
Real server + seeded workspace via the bin (`apps/cli/src/bin/corpus.ts`): search a phrase, follow a related id, confirm one-line-per-hit output and that a full doc read remains a separate `corpus doc get`.

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
