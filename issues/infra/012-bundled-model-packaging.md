# [INFRA-012] Package the bundled embedding model + native vector extension

## Domain
infra

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-043, SERVER-045
- Blocks: —

## Spec References
- SPEC.md §9.1 local-first bullet (SHARED-006 Edit 6); §2.2 packaging decisions; user decision: local tool, zero-key, no npm publish (distribution = clone+build+pack)

## Summary
Make the zero-config promise true in the packed artifact. Two deliverables:
1. **Bundled model**: the small embedding model SERVER-043 loads must be present in
   `dist-package/` (staged like `assets/workspace/`), resolvable from the installed
   layout, and covered by `pack-audit.ts` in both directions (present when required;
   no dev-only model caches leaking). Record the size cost in the issue log — if the
   artifact pushes the pack over a sane size, say so loudly rather than shipping it
   silently (a download-on-first-index fallback is a user decision, not yours).
2. **Native vector extension**: whatever SERVER-045 chose must load from the packed
   layout on macOS/Linux; the pure-JS fallback path must be provably reachable in a
   pack where the native artifact is absent (the degrade SERVER-045 built). Wire a CI
   job step exercising `pack:check` with the new rules.

## Acceptance Criteria
- [ ] `npm run package:build && npm run pack:check` green with the new artifacts audited both directions
- [ ] Installed-layout smoke: from a packed install, zero-config `index status` reports the bundled identity and indexing proceeds offline
- [ ] Extension-absent pack still serves lexical + fallback-scan semantic (or honest lexical-only), per SERVER-045's degrade
- [ ] Pack size delta recorded; regression guard if a threshold is agreed

## Technical Design
### Files to Create/Modify
- `scripts/package-build.ts` (staging), `scripts/pack-audit.ts` (rules), CI workflow step

## Testing Strategy
Script-level tests where they exist; the pack audit IS the test. No full builds while other heavy tasks run (coordinate with the orchestrator).

## E2E Verification Plan
Pack → install into a scratch prefix → `corpus init` + index a doc fully offline (network disabled for the process).

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
