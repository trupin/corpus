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
- **Releases are DELIBERATE, not per-merge** _(user amendment, 2026-07-31)_: no
  workflow runs on main pushes. A release happens only when the orchestrator judges
  a change significant (user-visible feature phases, notable milestones) or the user
  asks explicitly. Mechanism: the existing `v*` tag flow — the orchestrator bumps
  the version (`npm version <x.y.z> --workspaces --include-workspace-root`), tags,
  pushes the tag; this issue builds the tag-triggered workflow that packages
  (build → package:build → pack:check → npm pack) and creates the GitHub release
  with the tarball attached and generated notes since the previous tag.
  `version:check`'s GITHUB_REF guard already protects against tag/manifest mismatch.
- **CLAUDE.md**: add the release-decision rule to the Git Workflow section (one
  bullet: releases are orchestrator-judged or user-requested, via version bump +
  `v*` tag; never automatic).
- Permissions: workflow needs `contents: write` (releases) and `pull-requests: write`
  (sticky comment) — scope them per-job, not workflow-wide.
- Keep the packaging job parallel to validate, but gate release creation on validate
  success (a broken main merge must not publish an artifact).

## Acceptance Criteria
- [ ] PR push: tarball artifact uploaded; sticky comment on the PR links it with version/sha/size; second push updates the same comment
- [ ] Main merges create NO release and run NO packaging publish (negative test: the merge of this issue's own PR)
- [ ] Pushing a `v*` tag runs package + pack:check and creates the release with the installable tarball attached; a tag mismatching the manifest version fails before publishing (existing version:check behavior, verified not weakened)
- [ ] CLAUDE.md carries the release-decision rule
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
