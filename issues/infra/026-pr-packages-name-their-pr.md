# [INFRA-026] A PR's package cannot be told from any other PR's

## Domain

infra

## Status

done

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

- [x] The artifact uploaded by `package.yml` on a pull request carries the PR
      number in its name, e.g. `corpus-<version>-pr<N>-<sha_short>`
- [x] The exact naming scheme is fixed here and **documented where CLI-034 can
      depend on it** — CLI-034 parses these names to find the newest build for a
      PR, so an undocumented scheme is a break waiting to happen
- [x] The sticky packaging comment states the artifact name it produced
- [x] Runs **not** on a pull request (a push to `main`, a tag) keep a name that
      cannot be mistaken for a PR build — they have no PR number to carry, and
      must not silently reuse the PR-shaped name
- [x] The tarball inside the artifact is unchanged — this issue names the
      artifact, it does not alter what is packed or the version inside it
- [x] `pack:check` and the rest of the packaging gate still pass

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

## Decisions

**`corpus-<version>-pr<N>-<sha_short>`**, documented in `docs/RELEASING.md`
under a heading that says outright that the name is a contract and names the
command that parses it. The version inside the tarball is untouched, as the
issue required: making PR builds carry a prerelease version touches INFRA-008's
singularity invariant and was not what was asked for.

**Duplicate names: `overwrite: true`.** `upload-artifact@v4` fails rather than
replacing on a duplicate, and a duplicate happens on a re-run of the same head
sha. Failing there would leave the PR carrying the *older* build under the name
and a red job that explains nothing. A force-push changes the sha and gets its
own name, so only same-sha re-runs replace — the one case where replacing is
right. "The newest build for PR N" stays answerable by creation time, with at
most one artifact per (PR, sha).

**A run with no PR number fails rather than falling back.** The workflow
triggers on `pull_request` and nothing else, so an empty number means the
trigger changed — and the wrong answer to that is a build labelled like a PR
build that is not one. The guard's message says what to do instead.

**Fork PRs, recorded for CLI-034.** The workflow *does* run on a fork's pull
request and *does* upload an artifact; what it cannot do is comment, because a
`pull_request` event from a fork gives the run a read-only token whatever the
`permissions:` block asks for. So a fork's build is reachable, and CLI-034
cannot refuse it by absence. It must refuse it by origin — the workflow run's
`head_repository` is what says where the code came from, and the artifact name
does not. Written into `docs/RELEASING.md` rather than left in this issue,
because that is where CLI-034 was told to look.

## E2E Verification Log

Run by the orchestrator on **opus** (Claude Opus 5), 2026-08-26.

A workflow change cannot be unit-tested, and this repository's own issue says so:
the acceptance evidence is the run. It ran on this phase's pull request, #65.

**Two pushes, two artifacts, both named for the PR:**

```
corpus-0.24.0-pr65-7eb8396   created 2026-08-26T23:00:36Z, expired=false
corpus-0.24.0-pr65-ca99d5c   created after the follow-up push
```

**The sticky comment names the artifact it produced**, and points at the command
that installs it:

```
| Artifact | `corpus-0.24.0-pr65-ca99d5c` |
| Tarball  | `corpus-0.24.0.tgz`          |
| Version  | `0.24.0`                     |
| Download | corpus-0.24.0-pr65-ca99d5c → …/artifacts/9627134510 |

Install it with `npm install -g <path-to-tgz>`, or with `corpus upgrade --unstable 65`.
```

**The tarball inside is unchanged**: still `corpus-0.24.0.tgz`, still the version
this branch carries. Only the label moved, which is what this issue promised.
`pack:check` ran ahead of the upload on both runs and passed — the job's ordering
makes that a precondition rather than a coincidence.

**And CLI-034 consumes it, live.** `corpus upgrade --unstable --check` read the
list, matched the scheme, skipped the coverage artifacts sharing the namespace,
and chose the newer of the two:

```
corpus 0.24.0 → PR #65 — corpus 0.24.0, commit ca99d5c, built 10 minutes ago
  artifact: corpus-0.24.0-pr65-ca99d5c
```

**Runs that are not pull requests** were not observed, because there are none:
`package.yml` triggers on `pull_request` alone and the pack step now fails rather
than inventing a name when the PR number is empty. That guard is the answer to
the criterion rather than a name a non-PR run would carry.
