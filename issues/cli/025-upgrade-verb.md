# [CLI-025] `corpus upgrade` / `corpus upgrade --check`

## Domain
cli

## Status
done

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
- [x] `--check` reports latest vs installed without side effects
- [x] Full run verifies checksum before install; mismatch/missing → refusal
      with the reason, nothing installed
- [x] Reinstall uses the detected npm-global path; undetectable → refusal with
      instructions
- [x] Server restarted only when it was running; not started when it wasn't
- [x] Already-latest: says so, exits 0, touches nothing
- [x] Network failures are reported honestly; no partial installs

### The workspace half (SHARED-007 amendment, signed 2026-08-03)
The user asked what happens to skills and agent files on upgrade, and the answer
was "nothing, and that is a gap". `corpus workspace upgrade` already does the
three-way sync correctly; it was never wired to this command.
- [x] After a successful tool install, the upgrade performs the workspace
      template sync — the same code path as `corpus workspace upgrade`, called,
      not reimplemented
- [x] A file the workspace edited is **never** overwritten. This is inherited
      from `template/plan.ts`'s `decide`, so the test that matters is that this
      command routes through it rather than doing its own copying
- [x] The report says what was updated and what was left alone, in one place
- [x] **Conflicts (`keep-modified`) are presented as unresolved work, not as
      notices** — listed distinctly from what merely happened, each naming
      `corpus workspace diff <path>` (CLI-027). The audience is the agent (user,
      2026-08-03: _"assume this will be run by an agent… make it clear it needs
      to be resolved"_), so an agent must be able to tell what it still owes
      without parsing prose
- [x] Never auto-merges a conflicted skill — a plausible-looking merge of prose
      that instructs the agent is worse than a clear refusal
- [x] Ordering is deliberate and stated: install → template sync → conditional
      restart, so the restarted server is running the same generation as the
      files on disk
- [x] A template sync failure does not silently follow a successful install —
      say plainly that the tool moved and the workspace did not, and what to run
- [x] Everything written lands in one attributed commit (inherited), so
      `corpus skill rollback` still undoes a bad upgrade
- [x] `--check` remains side-effect free: it reports that template changes are
      pending, and writes nothing

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/upgrade/` (colocated per feature); reuse the server
  lifecycle module for stop/start; GitHub API via fetch, no new deps unless
  unavoidable

### As built
- `apps/cli/src/commands/upgrade/release.ts` — the Releases API lookup, version
  ordering, and asset selection. Assets are found by **shape** (`*.tgz` plus the
  sibling `*.tgz.sha256`) rather than by name, because the published package name
  is still provisional. The check's shape is the contract's `UpgradeCheck`,
  imported rather than re-declared, so CONTRACT-027 and this verb cannot drift.
- `apps/cli/src/commands/upgrade/install.ts` — install-method detection from the
  running copy's own path, HTTPS-only download, checksum verification **before
  the bytes reach the disk**, and `npm install --global --prefix <prefix>`. Every
  failure here is a `RefusedError`.
- `apps/cli/src/commands/upgrade/journal.ts` — `.corpus/upgrade.log`: truncated
  per run, appended as it goes, ending in one `report: {…}` line. This is
  CONTRACT-027's `UpgradeStarted.logPath`, and the only channel a detached run
  has, since it restarts the server that spawned it.
- `apps/cli/src/commands/upgrade/index.ts` — the orchestration and the registry
  entry (a **standalone** command: the tool is installed once per machine, so it
  must run outside a workspace, and it resolves one itself when there is one).
- `apps/cli/src/output.ts` — `createNestedOutput`, so `runStop`/`runStart`/the
  template sync can run as steps without each emitting its own JSON value.
- `apps/cli/src/commands/workspace/upgrade.ts` — split into
  `applyWorkspaceUpgrade` (returns the report) and `runWorkspaceUpgrade`
  (emits + renders), which is what makes "the same code path, called, not
  reimplemented" literally true. Added `upToDate` to the report, and the
  `unresolved — corpus workspace diff <path>` line under every conflict, so both
  verbs point at CLI-027.
- `apps/cli/src/errors.ts` — exit code **7, "Refused — a precondition was not
  met, and nothing was changed"**, and `RefusedError`. `internal_error` would
  claim an unexpected exception and `check_failed` would claim the work
  succeeded; a refusal is neither, and a caller must be able to tell it from a
  crash.

### Decisions worth knowing
1. **Ordering**: probe what is running → check → refuse early → download+verify →
   **stop** (if it was running) → install → template sync → **restart** (in a
   `finally`). The stop sits before the install because npm rewrites
   `node_modules` under a live process, including the packages the server loads
   lazily. The restart is in a `finally` so a failed sync or a failed install
   still brings the board back.
2. **Already latest touches nothing** (acceptance criterion), so the pending
   template changes are *reported* from a dry-run plan and not applied; the
   message names `corpus workspace upgrade`.
3. **Conflicts do not fail the run.** The upgrade succeeded; exit 0, with
   `conflicts` as its own top-level array under `--json` and a separated block in
   the human report. A non-zero exit would read as "the upgrade failed".
4. **A template-sync failure emits the report and then rethrows**, so a
   partly-finished upgrade still hands its caller the machine-readable half and
   still exits non-zero.
5. **The installed version is read back** from the new package's own manifest
   after the install rather than taken from the release tag; a disagreement is
   reported, not hidden (proved in the E2E log below).
6. `CORPUS_RELEASES_API` / `CORPUS_RELEASES_REPO` point the lookup at a fork, a
   mirror, or a fixture. That seam is what makes the E2E below possible without
   touching GitHub.

## Testing Strategy
Unit-test the version compare, checksum verify, install-path detection, and
restart predicate with injected effects; a real-download test only against a
recorded fixture (no live GitHub in unit runs).

## E2E Verification Plan
Real run against the v0.1.0 release assets (check + download + verify path;
install step against a scratch prefix, NOT the user's global).

## E2E Verification Log
Model: **opus** (claude-opus-5[1m]).

Real everything except GitHub: a real `npm pack` tarball of this repo, a real
`npm install -g` into a **scratch prefix** (`/tmp/cli025-e2e/prefix` — the user's
own installation was never touched), a real workspace on **port 9310** (the
user's live server on 8765 was never contacted, stopped or bound), and a
loopback fixture on 9410 serving the two documents INFRA-016 publishes.

Setup:
```
npm run package:build && (cd dist-package && npm pack)          # corpus-0.3.0.tgz
# bump the staged manifest to 0.4.0, append a line to two template skills, pack again
npm install -g --prefix /tmp/cli025-e2e/prefix ./corpus-0.3.0.tgz
./prefix/bin/corpus --version                                   # 0.3.0
./prefix/bin/corpus init ws --port 9310
# the agent evolves one skill, and commits it
printf '\n<!-- the agent evolved this skill -->\n' >> ws/.claude/skills/comment/SKILL.md
git -C ws commit -qm "agent evolved the comment skill"
(cd ws && ../prefix/bin/corpus server start)                    # corpus 0.3.0 listening on :9310 (pid 19775)
```

**1. `corpus upgrade --check` — reports, writes nothing.**
```
$ CORPUS_RELEASES_API=http://127.0.0.1:9410 ../prefix/bin/corpus upgrade --check
corpus 0.3.0 → 0.4.0 available
  release notes: https://github.test/releases/v0.4.0
nothing was downloaded, installed or written (--check).
EXIT=0
```
`--check --json` carried `check:{installed:0.3.0, latest:0.4.0, upgradeAvailable:true,
verifiable:true, reachable:true, detail:null}`, `tool.method:"npm-global"`,
`tool.prefix:"/private/tmp/cli025-e2e/prefix"`, `template.dryRun:true`,
`reportPath:null`. `.corpus/upgrade.log` did **not** exist afterwards.

**2. `corpus upgrade` — the whole thing.**
```
$ CORPUS_RELEASES_API=http://127.0.0.1:9410 ../prefix/bin/corpus upgrade --from user
corpus 0.3.0 → 0.4.0
  verified corpus-0.4.0.tgz (1.0 MiB, sha256 14e0b26f5c35…)
  stopped (pid 19775)
  installed 0.4.0 with `npm install --global --prefix /private/tmp/cli025-e2e/prefix /var/…/corpus-upgrade-eN5B9r/corpus-0.4.0.tgz`
  workspace template:
  upgrade (tool 0.3.0 → 0.4.0):
    update  .claude/skills/orchestrate/SKILL.md
    keep    .claude/skills/comment/SKILL.md — modified here — 1 line only here, 1 line only in the new copy
            unresolved — corpus workspace diff .claude/skills/comment/SKILL.md
  wrote 1 file in commit fe52f6c8dac69f6c9dd71085b47d882b71b3a6f0.
  corpus 0.4.0 listening on http://127.0.0.1:9310 (pid 19866)
    logs: corpus server logs -f

1 conflict to resolve — the tool changed this file and this workspace had edited it too, so nothing was overwritten and nothing was merged:
  .claude/skills/comment/SKILL.md — modified here — 1 line only here, 1 line only in the new copy
    corpus workspace diff .claude/skills/comment/SKILL.md
report written to .corpus/upgrade.log
EXIT=0

$ ../prefix/bin/corpus --version            # 0.4.0  ← the tool really was replaced
$ ../prefix/bin/corpus server status        # running — pid 19866 on :9310, corpus 0.4.0
```
Verified on disk afterwards: the edited skill still ends
`<!-- the agent evolved this skill -->` (never overwritten); the untouched skill
now ends `<!-- shipped by tool 0.4.0 -->` (updated); `git log -1` is
`user <user@corpus.local> | workspace: upgrade template files 0.3.0 → 0.4.0 by user`
— **one** attributed commit, so `corpus skill rollback` still undoes it.

**3. The report survives the restart.** `.corpus/upgrade.log` holds the whole
human account plus a final `report: {…}` line whose JSON carries
`tool.installed:true`, `template.written:[".claude/skills/orchestrate/SKILL.md"]`,
`server:{wasRunning:true,stopped:true,restarted:true}` and
`conflicts:[{path:".claude/skills/comment/SKILL.md", …, "resolve":"corpus workspace diff .claude/skills/comment/SKILL.md"}]`.

**4. The command the conflict names actually runs.**
```
$ ../prefix/bin/corpus workspace diff .claude/skills/comment/SKILL.md
.claude/skills/comment/SKILL.md
  conflict — edited here and changed by the tool. …
  --- workspace/…   +++ tool/…
  -<!-- the agent evolved this skill -->
  +<!-- shipped by tool 0.4.0 -->
EXIT=0
```

**5. Already latest — touches nothing.** Re-run at 0.4.0 against the same
fixture: `corpus 0.4.0 is already the latest release; nothing was installed`,
the pending template change printed as a `--dry-run` plan, the conflict block
repeated, exit 0; `corpus --version` still 0.4.0 and the server still up on the
same pid.

**6. Refusals (exit 7, nothing changed).**
- *No published checksum* (fixture serving no `.sha256`):
  `corpus: release 0.5.0 cannot be verified, so it will not be installed` … `EXIT=7`,
  `corpus --version` unchanged. `--json` gave
  `{"error":{"code":"upgrade_unverifiable",…}}`, and `.corpus/upgrade.log`
  recorded `failed: …` plus `report: {"error":…}` — a detached refusal is not
  silent.
- *Undetectable install method* (the dev checkout):
  `corpus: this copy of corpus cannot upgrade itself: it is not installed under a node_modules directory (a source checkout, or an unpacked build)`
  with the runnable instruction `npm install -g http://127.0.0.1:9410/corpus-0.9.0.tgz`; `EXIT=7`.
- *Checksum mismatch* and *unwritable prefix* are unit-tested against real bytes
  and a real `access(W_OK)`; a mismatch leaves no file in `tmpdir()` at all.

**7. Server not running → not started.** With the server stopped,
`corpus upgrade --json` reported `server:{wasRunning:false, stopped:false,
restarted:false, detail:"it was not running when the upgrade began, so it was
left stopped"}`, and `corpus server status` still said not running afterwards.

**8. Release tag vs package version.** A fixture publishing the 0.4.0 tarball
under tag `v0.9.0` produced
`installed 0.4.0 …` and
`note: the release was published as 0.9.0 but its package declares 0.4.0; the installed version is the one reported here.`

Cleanup: scratch server and fixture stopped, 9310/9410 free, `dist-package/`
regenerated at 0.3.0. **Port 8765 was never touched** (confirmed still held by
the user's own server).

### Not verifiable here
- The **real** GitHub Releases API was never contacted (deliberately: §2.4
  forbids background checks, and a suite that reached it would be one). The
  request shape — path, `user-agent`, `x-github-api-version`, 404-means-no-releases,
  403-with-`x-ratelimit-remaining: 0` — is unit-tested against a scripted `fetch`,
  but no real 200 from `api.github.com` was observed.
- No real published release exists yet, so nothing here proves the *actual*
  `corpus-<version>.tgz.sha256` asset INFRA-016 will attach; the format
  (`shasum -a 256`, bare filename) is read exactly as `release.yml` writes it.
- The upgrade was never run **spawned detached by the server** (SERVER-050 is
  not built). The half that makes that work — the report landing in
  `.corpus/upgrade.log` rather than on a dying stdout — is verified.
- Windows: `detectInstallMethod` accepts `<prefix>/node_modules/<pkg>` on win32
  only, and that branch is unit-tested but never run on Windows.

### Known gap, pre-existing
`corpus upgrade | head -6` was observed to kill the process mid-run (after the
template sync, before the restart), leaving the server stopped: **CLI-024**
(SIGPIPE guard) has not landed, and nothing in this verb is exempt from it. The
journal did preserve everything up to the kill, which is the property it was
designed for. Not worked around here — CLI-024 is the fix, and it covers every
verb.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [x] Committed with `[ISSUE-ID]` prefix
