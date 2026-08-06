# [INFRA-016] Release workflow publishes a .sha256 checksum asset beside the tarball

## Domain
infra

## Status
done

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
- [x] Release for a v* tag carries both the tarball and its .sha256 asset
- [x] Checksum computed from the exact uploaded artifact in the same job
- [x] `shasum -a 256 -c` passes against a downloaded pair (verified locally
      against a real `npm pack`; no release cut, per the no-publish decision)

## Technical Design
### Files to Create/Modify
- `.github/workflows/release.yml`

## Testing Strategy
Workflow lint + a dispatch/act-style verification; document evidence.

## E2E Verification Plan
Download both assets from a release; `shasum -a 256 -c` passes.

## E2E Verification Log
Ran on **opus** (orchestrator, directly — the session's subagent limit was reached).

Verified against a **real** `npm run package:build` + `npm pack`, not a mock,
because the thing being checked is a shell contract between two steps:

- Packed `corpus-0.3.0.tgz`, wrote `corpus-0.3.0.tgz.sha256`, and verified it in
  place: `corpus-0.3.0.tgz: OK`, exit 0.
- **Verified as a downloader would**, which is the part that could silently be
  wrong: copied *only the two files* into an empty directory and ran
  `shasum -a 256 -c` there. Passes — because the checksum is generated from
  inside `dist-package`, so the recorded name is the bare tarball name. Had it
  recorded a path, this is the check that would have failed, and it would have
  failed on a user's first upgrade rather than here.
- **Negative case**: appended one byte to the tarball and re-verified —
  `FAILED`, `WARNING: 1 computed checksum did NOT match`, exit 1. A checksum
  that cannot fail is decoration.
- Workflow parsed with `yaml`: the checksum step runs *after* `npm pack`, in the
  same `dist-package` working directory, contains **no second `npm pack`**, and
  the release step's env carries `CHECKSUM_PATH` alongside `TARBALL_PATH` with
  both attached in one `gh release create`.
- Ref-derived values keep the env-indirection discipline (PR #16 finding 1): the
  tarball name reaches the shell as `$TARBALL`, never as a `${{ }}` splice.
- `npx prettier --check` clean.

**Not verified by cutting a release**, deliberately: releases are a user
decision, and nothing here needed one to be proven.

## Completion Checklist (domain agent)
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
