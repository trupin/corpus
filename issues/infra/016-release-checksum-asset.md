# [INFRA-016] Release workflow publishes a .sha256 checksum asset beside the tarball

## Domain
infra

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007
- Blocks: CLI-025

## Spec References
- SHARED-007 rider ("verifies its published checksum")

## Summary
`corpus upgrade` (CLI-025) must verify what it downloads. The release workflow
(`.github/workflows/release.yml`) currently attaches only the tarball; add a
`corpus-<version>.tgz.sha256` asset generated from the packed tarball in the
same job (no re-pack), uploaded alongside it. Follow the existing env-indirection
pattern for anything derived from ref names (PR #16 injection lesson).

## Acceptance Criteria
- [ ] Release for a v* tag carries both the tarball and its .sha256 asset
- [ ] Checksum computed from the exact uploaded artifact in the same job
- [ ] `shasum -a 256 -c` passes against a downloaded pair (verified on a real
      or workflow_dispatch run if a real release is not warranted)

## Technical Design
### Files to Create/Modify
- `.github/workflows/release.yml`

## Testing Strategy
Workflow lint + a dispatch/act-style verification; document evidence.

## E2E Verification Plan
Download both assets from a release; `shasum -a 256 -c` passes.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
