# [SHARED-007] Self-upgrade spec rider (signed 2026-08-02)

## Domain
shared (orchestrator-owned)

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: INFRA-016, CLI-025, CONTRACT-027, SERVER-050, UI-035

## Summary
User-approved behavior (AskUserQuestion sign-off, 2026-08-02 — "Approve all"),
to be applied verbatim to SPEC.md (new §2.x "Upgrading") at the upgrade
phase's kickoff, per the established amendment-at-kickoff pattern:

> **Upgrading.** Corpus upgrades itself only on demand — it never checks for,
> downloads, or installs anything in the background, and never phones home.
> `corpus upgrade --check` queries the GitHub Releases API for the latest
> release of the installed distribution, compares versions, and reports.
> `corpus upgrade` performs the check, downloads the release tarball over
> HTTPS, verifies its published checksum, and reinstalls through the same
> npm-global path the tool was installed with; if the install method cannot
> be detected it refuses with instructions rather than guessing. If — and
> only if — the workspace's server was running when the upgrade began, the
> upgrade restarts it against the same workspace once the install succeeds.
> The UI offers the same flow on demand: a check affordance, and when a newer
> release exists, an "Upgrade & restart" action that asks the server to spawn
> the detached CLI upgrade; the UI rides out the restart with its normal SSE
> reconnect and shows the new version on return.

## Acceptance Criteria
- [ ] Rider applied to SPEC.md verbatim at phase kickoff (orchestrator)
- [ ] The five dependent issues implement against this text

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated on the phase branch; fidelity-checked in review
