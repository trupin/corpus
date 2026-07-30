# [CLI-009] `server stop` must not delete a live foreign pidfile

## Domain

cli

## Status

done

## Priority

P2

## Model

opus — one guarded branch plus tests.

## Dependencies

- Depends on: CLI-002
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), finding 16

## Summary

`commands/server/stop.ts:62-78` — the `foreign` state deletes a pidfile whose recorded pid is
alive (possibly this workspace's own server on a previously configured port), forfeiting the
CLI's only handle on that daemon. A live pid's pidfile should be left in place with a
diagnostic; only a dead pid's stale file is cleanup.

## Acceptance Criteria

- [x] Live-foreign pid → pidfile kept, actionable message; dead pid → stale file removed.
- [x] Tests cover both branches.

## E2E Verification Log

**Implemented on: opus.** 2026-07-29. Real `@corpus/server` daemons, real pidfiles, from-source CLI
(`node --import tsx apps/cli/src/bin/corpus.ts`). Two scratch workspaces:
`/tmp/corpus-s014-clihard-a` (port 9161) and `/tmp/corpus-s014-clihard-b` (port 9162), both created
with `corpus init`.

### Reproduction (pre-fix)

Both servers started for real; then B's `.corpus/config.json` `port` was re-pointed at 9161 — the
copied-config / changed-`CORPUS_PORT` case — while B's own daemon kept serving on 9162.

```
$ corpus server start        # in A → corpus 0.0.0 listening on http://127.0.0.1:9161 (pid 81698)
$ corpus server start        # in B → corpus 0.0.0 listening on http://127.0.0.1:9162 (pid 81877)
$ # B/.corpus/config.json: port 9162 → 9161
$ corpus server status       # in B
pid 81877 is alive, and :9161 is held by another workspace's server (/private/tmp/corpus-s014-clihard-a)
corpus: the workspace server is not running, and :9161 is held by another workspace's server (...)
status exit=6
$ corpus server stop         # in B
not running (stale pidfile removed) — :9161 is held by another workspace's server (/private/tmp/corpus-s014-clihard-a), and pid 81877 was left alone
stop exit=0
$ ls -l B/.corpus/server.pid
ls: /tmp/corpus-s014-clihard-b/.corpus/server.pid: No such file or directory
$ ps -p 81877 -o pid=,command=
81877 node ... apps/server/src/main.ts       # still running
```

The harm, with the config put back the way it was:

```
$ # B/.corpus/config.json: port 9161 → 9162 (back to normal)
$ corpus server status   → not running          (exit 6)
$ corpus server stop     → not running          (exit 0)
$ curl :9162/api/health  → GET :9162/api/health -> 200
```

A live daemon, serving, that the CLI can no longer see or stop — its only handle was the pidfile
`stop` deleted.

### After the fix

Scenario rebuilt from scratch (orphan reaped, B restarted → pid 84511 on :9162, `port` re-pointed
at 9161):

```
$ corpus server stop          # in B
not stopped — :9161 is held by another workspace's server (/private/tmp/corpus-s014-clihard-a), and pid 84511 was left alone
  Its pidfile was kept: pid 84511 was started on :9162, so it may be this workspace's own server. Point `port` in .corpus/config.json back at 9162 and stop again, or stop pid 84511 directly.
stop exit=0

$ cat B/.corpus/server.pid
{ "pid": 84511, "port": 9162, "startedAt": "2026-07-29T10:23:34.651Z", "version": "0.0.0" }

$ corpus server stop --json   # in B
{"stopped":false,"running":false,"reason":"port held by another workspace","pidfileKept":true,"pid":84511,"pidfilePort":9162,"foreignWorkspace":"/private/tmp/corpus-s014-clihard-a"}
exit=0

$ ps -p 84511 -o pid= → 84511      # A untouched, B untouched
$ curl :9162/api/health → 200
```

The message's own advice works — following it stops the daemon the old behaviour stranded:

```
$ # B/.corpus/config.json: port 9161 → 9162
$ corpus server stop
stopped (pid 84511)
$ ps -p 84511 → gone;  B/.corpus/server.pid → No such file or directory
```

Dead-pid half, same foreign holder (B restarted → pid 85202, `kill -9`, `port` re-pointed at 9161):

```
$ kill -9 85202               # pidfile survives the kill
$ corpus server stop          # in B
not running (stale pidfile removed)
stop exit=0
$ ls B/.corpus/server.pid → No such file or directory
```

Cleanup: `corpus server stop` in A (`stopped (pid 81698)`); `lsof -iTCP:9161,9162 -sTCP:LISTEN`
empty.

### Tests

`VITEST_MAX_THREADS=4 vitest run apps/cli/src/commands/server` → 6 files, 77 tests passed,
including the three new ones:

- `stop.test.ts` — live-foreign pid: pidfile kept, message names the recorded port and the remedy.
- `stop.test.ts` — the `--json` shape (`pidfileKept: true`, `pid`, `pidfilePort`).
- `stop.test.ts` — dead pid with a foreign holder: `not running (stale pidfile removed)`, file gone.
- `lifecycle.test.ts` — the whole scenario against two real daemons: re-point B at A's port, `stop`
  keeps the pidfile and leaves both processes alive, then point back and `stop` really stops it.

`docs/cli.md` regenerated from the registry (`npm run docs:cli -w apps/cli`); `prettier --check`
clean on every touched file.

### Not changed (escalation, not a fix)

The `unowned` state (live pid, **nothing** answering on the configured port) still deletes the
pidfile, and the same argument applies to it: that pid may equally be this workspace's own daemon on
a previously configured port. PR #10 finding 16 named only the `foreign` branch, and `unowned` has a
deliberate comment and a test asserting the deletion, so widening the change was left to the
orchestrator's judgment rather than taken unilaterally.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
