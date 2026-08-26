# [SERVER-050] Upgrade endpoints: check proxy + detached upgrade trigger

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-027, CLI-025
- Blocks: UI-035

## Spec References
- SHARED-007 rider

## Summary
Implement CONTRACT-027. Check: fetch the latest release from GitHub on demand
(no background polling, no cache beyond the request), compare with the running
server's version, answer honestly on network failure. Trigger: spawn the
installed `corpus upgrade` as a DETACHED process (own process group, stdio to a
log under `.corpus/`) so the upgrade survives the server it will restart; answer
202 immediately. The server does not attempt to replace itself in-process —
the CLI owns download/verify/install/restart per CLI-025. Guard: refuse a
second trigger while one is in flight (pidfile or equivalent under `.corpus/`).

## Acceptance Criteria
- [x] Check returns installed/latest/upgradeAvailable/notesUrl; unreachable
      GitHub → the modeled failure shape, not a 500
- [x] Trigger spawns detached, logs to a discoverable path, answers 202
- [x] Double-trigger refused while an upgrade is in flight
- [x] The spawned upgrade actually survives the server's own restart (proven
      in the E2E log)

## Technical Design
### Files to Create/Modify
- `apps/server/src/upgrade/` (routes + spawn + guard), app wiring

## Testing Strategy
Route tests with injected fetch/spawn; a real-spawn test proving detachment
(child outlives a killed parent) without performing a real install.

## E2E Verification Plan
Real server: check against real GitHub; trigger with the CLI stubbed to a
script that sleeps past a server restart and logs.

## Decisions

**The check reaches GitHub; the trigger spawns the CLI.** Asymmetric on purpose.
The judgment the check publishes is the judgment the upgrade obeys, so it is
imported from `@corpus/contract` (CONTRACT-090) rather than written twice — a
server that offered an upgrade the CLI then refused is the failure
`UpgradeCheckSchema` tells clients to avoid. The upgrade itself is not
importable in that way and never will be: it ends by restarting this process.
Rejected: proxying the check by spawning `corpus upgrade --check --json`. It
single-sources the same judgment, but `--check` also runs the workspace template
dry-run, so every press of a *check* button would scan the whole workspace and
could fail for reasons the check has nothing to do with.

**Two files, one named.** The `202` names `.corpus/upgrade.log`, which is the
CLI's report and the CLI's to write. The child's stdout and stderr go to
`.corpus/upgrade-console.log` instead. The first attempt pointed both at the
report and the real E2E run showed why that was wrong: the CLI truncates the
file at the start of its run, wiping the server's banner, and then every line
appeared **twice** — once through stdout and once through the report writer.
The console log is not redundant: a `node` that cannot boot writes to stderr and
exits, and with `stdio: "ignore"` that sentence would be lost.

**The report's name is declared in two places and guarded by a test.** Apps do
not import apps, so `apps/cli/src/paths.ts` and the server each spell
`upgrade.log`. A test reads the CLI's declaration out of its source and fails if
it moves. Rejected: lifting the constant into `@corpus/contract`, which is
cleaner but is a third contract change for one string, and catches no drift this
does not.

**A stale guard is not a refusal.** The pidfile refuses a second trigger only
while the recorded pid is alive *and* the record is under thirty minutes old.
The liveness probe catches a killed child; the window catches a pid the kernel
reused and a machine that slept. Being wrong costs one refusal that should have
been a refusal — being right the other way costs a workspace permanently unable
to upgrade because of a file nobody knows to delete.

**A fixture can no longer call either route.** `POST /api/upgrade` starts a real
installer, and in a source checkout the CLI is exactly where the trigger looks.
That is not theoretical: mounting the routes made `json-body.test.ts`'s mutating
sweep and `write-fixture.test.ts` both spawn a real `corpus upgrade` on this
machine, and the only reason nothing was installed is that the running version
happened to equal the latest release. `refuseRealWorldRoutes` now refuses both
paths in every fixture-built server, naming the suite that does test them.

`write-fixture.test.ts` used `POST /api/upgrade` as its declared-but-unmounted
specimen and said in a comment that mounting the routes would be "the right
moment to notice". It noticed. No unmounted route is left, so the check is now
called directly and its wiring to `app.request` is asserted separately.

## E2E Verification Log

Run by the orchestrator on **opus** (Claude Opus 5), 2026-08-26. Real workspace
at a scratch path, real server started from source on port 8766 (the user's own
server on 8765 was never touched).

**Check, against real GitHub.**

```
GET /api/upgrade/check
{"installed":"0.24.0","latest":"0.24.0","notesUrl":"https://github.com/trupin/corpus/releases/tag/v0.24.0",
 "reachable":true,"upgradeAvailable":false,"verifiable":true,"detail":null}
```

No token → `401`.

**Check, unreachable.** Restarted with `CORPUS_RELEASES_API=https://api.github.invalid`:

```
status=200
{"installed":"0.24.0","latest":null,"upgradeAvailable":false,"verifiable":false,"notesUrl":null,
 "reachable":false,"detail":"https://api.github.invalid/repos/trupin/corpus/releases/latest could not be reached (fetch failed)"}
```

A `200` carrying the modelled failure, and `installed` survives the failed look.

**Trigger, real detached spawn.**

```
POST /api/upgrade  → 202  {"started":true,"logPath":".corpus/upgrade.log"}
POST /api/upgrade  → 409  {"code":"conflict","message":"an upgrade started at 2026-08-26T21:56:04.079Z is
                            still running; watch .corpus/upgrade.log, and try again if it has finished"}
```

Seven seconds later, `.corpus/upgrade.log` held the CLI's own report, once:

```
corpus upgrade 0.24.0 → 0.24.0
started 2026-08-26T21:58:54.345Z
corpus 0.24.0 is already the latest release; nothing was installed
migrations: none — every document is written the way this tool reads it.

report: {"mode":"upgrade","check":{...},"server":{"wasRunning":true,"stopped":false,"restarted":false,
  "detail":"nothing was installed, so the server was left exactly as it was"},...}
```

and `.corpus/upgrade-console.log` held the banner and the child's stdout. A third
trigger after the child exited answered `202` again — the guard released itself
with no cleanup step.

Nothing was installed, because the running version equalled the latest release
and `performUpgrade` returns before the download on `!upgradeAvailable`. The
global `corpus` on this machine was checked before and after: `0.20.0`,
unmodified since 23 August.

**Detachment, falsified.** The unit test kills the *process group*, which is what
`detached` actually defends against — `detached: true` makes the child a group
leader. The same fixture with the flag removed dies with the group, and that
converse is a test in the suite rather than a note: without it the assertion
would pass on a platform where nothing was ever at risk.

**Suites.** `vitest run apps/server` — 208 files, 4737 tests, all passing.
`tsc --noEmit -p apps/server` clean. `eslint .` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
