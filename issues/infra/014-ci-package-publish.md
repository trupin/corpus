# [INFRA-014] CI packaging: tarball on every PR, release on every main merge

## Domain
infra

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: — (INFRA-013 lands in the same batch; keep the workflow edits conflict-free)
- Blocks: —

## Spec References
- None product-behavioral — dev-harness/CI (user request 2026-07-31). Standing decision unchanged: NO npm publish, ever — distribution is repo-hosted artifacts.

## Summary
User directive: CI packages the CLI and publishes the artifact — on PRs, "attached"
to the PR; on main, as a new repository release.

Design:
- **Build step** (both triggers): `npm run build && npm run package:build && npm run
  pack:check`, then `npm pack` from `dist-package/` → the installable `corpus-<v>.tgz`.
  The tarball IS the artifact (it's what `npm install <file>` consumes). If the user
  wants a literal .zip alongside, it's one extra step — flag in the report, default
  to tgz-only.
- **PR trigger**: upload the tarball as a workflow artifact; maintain ONE sticky PR
  comment (create-or-update, not append) linking the artifact download + recording
  version, head sha, and size. Note artifact downloads require a logged-in GitHub
  user — acceptable, this is the repo's own workflow.
- **Main trigger**: create a release per merge, auto-tagged `v<version>-main.<run_number>`
  (collision-free while the manifest version is static), marked **prerelease**, with
  the tarball as a release asset and the squash-commit subject as the release body.
  The existing user-decided `v*` tag flow (version:check reads GITHUB_REF) remains
  the path for real releases and is NOT touched.
- Permissions: workflow needs `contents: write` (releases) and `pull-requests: write`
  (sticky comment) — scope them per-job, not workflow-wide.
- Keep the packaging job parallel to validate, but gate release creation on validate
  success (a broken main merge must not publish an artifact).

## Acceptance Criteria
- [ ] PR push: tarball artifact uploaded; sticky comment on the PR links it with version/sha/size; second push updates the same comment
- [ ] Main merge: prerelease `v<version>-main.<run>` created with the tarball attached, only after validate succeeds
- [ ] `pack:check` failure fails the job before any publish/comment
- [ ] Real `v*` tag release flow demonstrably unchanged
- [ ] Installable proof in the log: download the PR artifact, `npm install -g <tgz>` into a scratch prefix, `corpus --version` works

## Technical Design
### Files to Create/Modify
- `.github/workflows/` (new packaging workflow or jobs in the existing one), minor `scripts/` support if needed

## Testing Strategy
Workflow-level: exercised on the implementing PR itself (its own sticky comment + artifact is the live test); the main-trigger path verified on the merge.

## E2E Verification Plan
The implementing PR shows its own comment+artifact; post-merge, the first prerelease appears with an installable tarball.

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
