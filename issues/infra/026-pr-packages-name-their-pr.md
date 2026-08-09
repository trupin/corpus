# [INFRA-026] A PR's package cannot be told from any other PR's

## Domain

infra

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-034

## Spec References

- SPEC.md §2.4 — upgrading; CLAUDE.md — "Every PR gets the same tarball as a
  workflow artifact (`.github/workflows/package.yml`), linked from a single
  sticky comment"

## Summary

`.github/workflows/package.yml` names each PR's tarball artifact
`corpus-<version>-<sha_short>`. Every open PR is normally on the same version, so
the only thing distinguishing two PRs' packages is a seven-character SHA that
says nothing about where it came from. Once `corpus upgrade --unstable`
(CLI-034) can install one of these, "which build am I running?" has to be
answerable from the name alone.

The user's requirement (2026-08-08): **PR packages carry the PR number as a
suffix so they cannot be confused.**

## Acceptance Criteria

- [ ] The artifact uploaded by `package.yml` on a pull request carries the PR
      number in its name, e.g. `corpus-<version>-pr<N>-<sha_short>`
- [ ] The exact naming scheme is fixed here and **documented where CLI-034 can
      depend on it** — CLI-034 parses these names to find the newest build for a
      PR, so an undocumented scheme is a break waiting to happen
- [ ] The sticky packaging comment states the artifact name it produced
- [ ] Runs **not** on a pull request (a push to `main`, a tag) keep a name that
      cannot be mistaken for a PR build — they have no PR number to carry, and
      must not silently reuse the PR-shaped name
- [ ] The tarball inside the artifact is unchanged — this issue names the
      artifact, it does not alter what is packed or the version inside it
- [ ] `pack:check` and the rest of the packaging gate still pass

## Technical Design

### Files to Create/Modify

- `.github/workflows/package.yml` — the `name:` on the `actions/upload-artifact`
  step (currently line ~98) and the sticky comment step (~113)
- `docs/RELEASING.md` — document the PR artifact naming scheme, since CLI-034
  becomes a consumer of it

### Key Implementation Details

`github.event.pull_request.number` is available on `pull_request` events and
empty otherwise — the branch between PR and non-PR names hangs off that, not off
a ref-name heuristic.

**The version inside the package is deliberately not changed.** Making PR builds
carry a prerelease version string is a bigger decision (it touches
`version:check`'s singularity invariant, INFRA-008/INFRA-022) and is not what was
asked for. If CLI-034 finds it genuinely needs the installed build to *report*
its PR, raise it rather than reaching into the version.

### Edge Cases

- Two runs on the same PR (a force-push, a re-run) produce the same name —
  `upload-artifact@v4` fails rather than overwriting on a duplicate name. Confirm
  the current behaviour and decide: distinct names per run, or an explicit
  overwrite. CLI-034 wants "the newest artifact for PR N", which is answerable
  either way but not by accident.
- A PR from a fork — check whether the workflow runs at all, and if it does,
  whether its artifact should be installable by `--unstable` at all. A fork's
  build is untrusted code; say so here rather than leaving CLI-034 to discover it.
- Retention is 14 days; nothing changes, but CLI-034 must be told.

## Testing Strategy

CI is the test surface. Verify on a real PR: the artifact name carries the PR
number, the sticky comment names it, and the tarball still passes `pack:check`.
A workflow change cannot be meaningfully unit-tested; the acceptance evidence is
a link to the run.

## E2E Verification Plan

### Verification Steps

1. Push this change as a PR
2. Confirm the Package workflow's artifact is named with the PR number
3. Download it and confirm the tarball is byte-identical in structure to what the
   previous naming produced (same contents, different label)
4. Confirm the sticky comment names the artifact
5. Confirm a `main` push produces a non-PR-shaped name

## E2E Verification Log

_[Agent fills: model run on, links to the workflow runs, observed artifact names.]_

## Completion Checklist (domain agent)

- [ ] `/lint` passes
- [ ] E2E verification log filled in with links to real runs
- [ ] Naming scheme documented for CLI-034
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-026]` prefix
