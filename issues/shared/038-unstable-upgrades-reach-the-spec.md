# [SHARED-038] `--unstable` reaches §2.4 before it reaches the code

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

done — **SIGNED 2026-08-12 and applied**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CLI-034

## Spec References

- SPEC.md §2.4 line 84 — "Upgrading": the stable path's guarantees — GitHub
  Releases lookup, HTTPS download, **published-checksum verification**,
  reinstall through the detected install method
- CLAUDE.md — every PR gets a tarball artifact from
  `.github/workflows/package.yml`

## Summary

PR #36's review caught this chain shipping spec-silent behavior: CLI-034 adds
`corpus upgrade --unstable`, which §2.4 does not describe — and which
**cannot deliver the checksum verification §2.4 advertises**, because CI
artifacts carry no published checksum. A command that quietly skips a step the
spec promises is exactly what a rider exists to prevent; the deviation must be
spec text the user signed, not an implementation detail. The user's decisions
are already recorded in CLI-034 (2026-08-08): bare `--unstable` takes the
newest build across open PRs and names the PR before installing; `--unstable
<PR#>` targets one; PR packages carry the PR number (INFRA-026).

## Drafted rider text

To be appended to §2.4's Upgrading paragraph:

> **Unstable builds, on demand and named as such.** `corpus upgrade --unstable`
> installs the newest **pull-request build** — the tarball CI attaches to every
> PR — instead of a release: bare, it takes the newest build across open PRs
> and **names the PR it chose before installing**, because the newest build is
> not always the caller's own; with a PR number it takes that PR's newest build
> and reports plainly when none is available rather than falling back to
> another PR's. The unstable path **states its deviations instead of hiding
> them**: PR artifacts require an authenticated GitHub token (the command
> refuses with instructions when none is usable, and never silently falls back
> to a release), they expire on CI's retention schedule (an expired build is an
> ordinary answer naming the window), and they carry **no published checksum**
> — so the checksum verification of the stable path does not run, and every
> unstable install says so and says how to return (`corpus upgrade` reinstalls
> the newest stable). Which build is installed is recorded, so "which build am
> I running" stays answerable after the fact. Everything else is the stable
> path unchanged: same reinstall through the detected install method, same
> refusal when it cannot be detected, same conditional server restart. The
> stable path itself is untouched — `corpus upgrade` without the flag still
> installs only published releases, checksum verified.

## Acceptance Criteria

- [ ] Read aloud to the user on its own
- [ ] User signs off, or amends
- [ ] Applied to §2.4 with the `_(Rider signed YYYY-MM-DD.)_` marker
- [ ] Contradiction sweep recorded: §2.4's "never phones home" (the artifact
      lookup is on-demand, confirm the wording cannot be read otherwise), the
      UI's "Upgrade & restart" flow (release-only — confirm it stays that way
      or say so), `POST /api/upgrade` (§9.2 line 403 — unaffected, release path
      only)
- [ ] CLI-034 unblocks only on the signed text

## Technical Design

None — spec text. Implementation is CLI-034 (with INFRA-026 ahead of it).

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Read aloud verbatim, separately from the other held riders
- [ ] Signed by user
- [ ] Applied to SPEC.md §2.4 with signature marker
- [ ] Contradiction sweep recorded here
- [ ] Committed with `[SHARED-038]` prefix
