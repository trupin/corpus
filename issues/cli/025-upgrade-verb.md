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

### The workspace half (SHARED-007 amendment, signed 2026-08-03)
The user asked what happens to skills and agent files on upgrade, and the answer
was "nothing, and that is a gap". `corpus workspace upgrade` already does the
three-way sync correctly; it was never wired to this command.
- [ ] After a successful tool install, the upgrade performs the workspace
      template sync — the same code path as `corpus workspace upgrade`, called,
      not reimplemented
- [ ] A file the workspace edited is **never** overwritten. This is inherited
      from `template/plan.ts`'s `decide`, so the test that matters is that this
      command routes through it rather than doing its own copying
- [ ] The report says what was updated and what was left alone, in one place
- [ ] **Conflicts (`keep-modified`) are presented as unresolved work, not as
      notices** — listed distinctly from what merely happened, each naming
      `corpus workspace diff <path>` (CLI-027). The audience is the agent (user,
      2026-08-03: _"assume this will be run by an agent… make it clear it needs
      to be resolved"_), so an agent must be able to tell what it still owes
      without parsing prose
- [ ] Never auto-merges a conflicted skill — a plausible-looking merge of prose
      that instructs the agent is worse than a clear refusal
- [ ] Ordering is deliberate and stated: install → template sync → conditional
      restart, so the restarted server is running the same generation as the
      files on disk
- [ ] A template sync failure does not silently follow a successful install —
      say plainly that the tool moved and the workspace did not, and what to run
- [ ] Everything written lands in one attributed commit (inherited), so
      `corpus skill rollback` still undoes a bad upgrade
- [ ] `--check` remains side-effect free: it reports that template changes are
      pending, and writes nothing

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
