# [CLI-025] `corpus upgrade` / `corpus upgrade --check`

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007, INFRA-016
- Blocks: SERVER-050

## Spec References
- SHARED-007 rider (§2.x Upgrading, applied at phase kickoff)

## Summary
On-demand self-upgrade per the signed rider. `--check`: GitHub Releases API
(latest release of trupin/corpus), compare to the installed version, report
from→to + release notes URL; exit 0 either way. Full run: check, download the
tarball + .sha256 over HTTPS, verify the checksum (refuse on mismatch or when
the asset is missing — older releases without checksums are not upgradable
targets), detect the npm-global install path and reinstall through it (refuse
with instructions when the install method cannot be detected — never guess,
never sudo), then restart the workspace server IF AND ONLY IF it was running
when the upgrade began (same workspace, same lifecycle path as `corpus server`
verbs). No background checks, no telemetry, ever.

## Acceptance Criteria
- [ ] `--check` reports latest vs installed without side effects
- [ ] Full run verifies checksum before install; mismatch/missing → refusal
      with the reason, nothing installed
- [ ] Reinstall uses the detected npm-global path; undetectable → refusal with
      instructions
- [ ] Server restarted only when it was running; not started when it wasn't
- [ ] Already-latest: says so, exits 0, touches nothing
- [ ] Network failures are reported honestly; no partial installs

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/upgrade/` (colocated per feature); reuse the server
  lifecycle module for stop/start; GitHub API via fetch, no new deps unless
  unavoidable

## Testing Strategy
Unit-test the version compare, checksum verify, install-path detection, and
restart predicate with injected effects; a real-download test only against a
recorded fixture (no live GitHub in unit runs).

## E2E Verification Plan
Real run against the v0.1.0 release assets (check + download + verify path;
install step against a scratch prefix, NOT the user's global).

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
