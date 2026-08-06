# [CLI-030] `corpus upgrade`: exit 7 must stop promising "nothing was changed", and an interrupt must not leave the server down

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CLI-025
- Blocks: —

## Spec References

- SPEC.md §2.3 — "The CLI" (uniform failure surface; "conventional exit codes documented in `docs/cli.md`")
- SPEC.md §2.4 — "Upgrading"

## Summary

Two findings from the PR review of CLI-025.

**1. Exit 7 documents a promise the code breaks.** `apps/cli/src/errors.ts` describes exit
7 as _"Refused — a precondition was not met, and nothing was changed"_, and `corpus
upgrade`'s own description repeats _"Every refusal leaves the installation exactly as it
found it and exits 7"_. Both surface in `--help` and in the generated `docs/cli.md`, which
SPEC §2.3 makes the authority for exit codes. The promise is false for
`upgrade_install_failed`: `npmInstall` throws a `RefusedError` **after** the server has
been stopped and after npm may have partially rewritten the global package.
`index.test.ts` already proves the server is stopped and restarted on that path — so state
changed. An agent that trusts exit 7 will not re-verify its server or its tool version,
which is exactly the wrong conclusion after a half-finished install.

**2. The restart is protected against exceptions but not signals.** The `try`/`finally` in
`commands/upgrade/index.ts` brings the server back when a step throws. It does not run on
`SIGINT`/`SIGTERM`. `npm install` runs under a 15-minute timeout, so a Ctrl-C inside that
window skips the `finally` and leaves the server stopped.

## Decisions

### Finding 1 — a distinct exit code **and** a machine-readable `changed` fact

Both halves of the reviewer's option list, because they answer two different readers and
neither one covers the other:

- **Exit 8, `partialFailure`** — "Failed partway: the command had already begun changing
  things, so its effect is unknown; verify before retrying." The exit-code table is the
  documented authority (SPEC §2.3 defers to `docs/cli.md`), and it is the _first_ thing any
  caller branches on, `--json` or not. Keeping one code and fixing only the JSON would
  leave the table false for every caller that reads a shell exit status. Narrowing 7 to
  mean strictly "nothing was changed" also makes 7 worth trusting, which is the whole
  reason it exists.
- **`changed` in the `--json` error envelope** — because the exit code does not reach every
  reader. `.corpus/upgrade.log` ends in a `report:` line carrying `{"error":{…}}` and **no
  exit code at all**, and for an upgrade spawned detached by the server (§2.4) that file is
  the only witness there is. So the fact must live in the payload too.

`changed` is deliberately **tri-state** (`false` / `true` / absent) rather than a plain
boolean, so that fixing one lie does not introduce another. `false` is asserted only where
the code path proves it (`RefusedError`); `true` where a change had begun
(`PartialFailureError`); **absent** everywhere else, because a `ServerResponseError` from a
failed `POST` genuinely cannot say whether the server wrote anything. The agent-facing rule
is one comparison: `changed === false` ⇒ nothing happened, retry freely; anything else ⇒
re-verify before retrying.

Rejected: rewording the exit-7 text alone (the reviewer ruled it out, correctly — the
wording is not the defect). Rejected: exit 8 without the payload field (the journal, the
one artifact a detached run leaves, has no exit code).

Three call sites become exit 8, and they are exactly the three places where something had
already moved:

| code                     | why it changed state                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `upgrade_install_failed` | the server was stopped and npm was handed the package                         |
| `upgrade_interrupted`    | same window, ended by a signal                                                |
| `upgrade_template_failed`| the tool **was** installed; only the workspace half failed                    |

Everything else in the upgrade keeps exit 7 and now truthfully carries `changed: false`:
unreachable, unverifiable, unknown install method, unwritable prefix, checksum
unreadable/mismatched, download failed, insecure transport, bad asset URL. Every one of
them is decided before the server is touched or a byte is installed.

### Finding 2 — a signal handler, plus a plain statement of what it cannot cover

A handler, because it can be made reliable _for the case that actually happens_ (Ctrl-C, a
`kill`, a CI timeout), and because the alternative — documenting "interrupting can leave
your server down" — asks the operator to do by hand something the process is holding all
the state to do itself.

It is scoped to the stop→restart window and turns the first interrupt into the **ordinary
failure path** rather than doing work inside the handler: it kills the npm child through an
`AbortSignal`, the existing `finally` restarts the server and discards the download, the
journal records it, and the command exits 8 with `code: "upgrade_interrupted"`. No
`process.exit`, no async work racing teardown.

It de-registers itself as it fires, so a **second** Ctrl-C gets Node's default disposition
and kills the process outright — an operator who insists is never trapped by their own
tool.

Stated plainly in the help text, because it is true: `SIGKILL`, a power cut, and a laptop
suspending are not catchable, and neither is the case where npm has already replaced enough
of the package that the restart cannot find a working server entry. One more limit was
found by running it rather than reasoning about it: Node's `signal` option kills the
process corpus spawned, **not that process's own children**, so anything npm had itself
started can briefly outlive it (observed with `pgrep` in step 3 of the log). Making the
child `detached` and signalling its process group would fix that and take over signal
delivery entirely — a larger change with its own footguns — so it is said out loud instead.
The description names the recovery (`corpus server start`, then `corpus upgrade` again once
`corpus --version` says what you have). `corpus upgrade | head` remains covered by CLI-024
(SIGPIPE), which is still open and is not this issue.

## Acceptance Criteria

- [x] `ExitCode.partialFailure = 8` exists, is documented in `EXIT_CODES`, and appears in
      the regenerated `docs/cli.md` exit-code table.
- [x] Exit 7's documented meaning is true of every code path that produces it.
- [x] `PartialFailureError` carries `changed: true`; `RefusedError` carries `changed: false`;
      every other `CliError` carries neither.
- [x] `toProblem` puts `changed` in the `--json` error envelope when it is known, so an
      agent branches on a field rather than on prose; `renderError` says it in one line for
      humans.
- [x] `upgrade_install_failed` and `upgrade_template_failed` exit 8, and their `--json`
      `details.server` reports `wasRunning` / `stopped` / `restarted` so an agent knows the
      state of its board without a second command.
- [x] A `SIGINT`/`SIGTERM` inside the install window kills npm, restarts the server, writes
      the report, and exits 8 with `code: "upgrade_interrupted"`.
- [x] A second interrupt is not handled (Node's default terminates the process).
- [x] `corpus upgrade --help` and `docs/cli.md` state what an interrupt can and cannot
      leave behind, and how to recover.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/errors.ts` — `ExitCode.partialFailure`, `EXIT_CODES` entry, `changed` on
  `CliError`/`CliProblem`, `PartialFailureError`, rendering.
- `apps/cli/src/errors.test.ts` — coverage for the above.
- `apps/cli/src/index.ts` — export `PartialFailureError`.
- `apps/cli/src/signals.ts` — `onInterrupt`, a one-shot interrupt handler that de-registers
  itself before invoking its callback.
- `apps/cli/src/signals.test.ts` — one-shot semantics, per-signal dispatch, idempotent
  disposal.
- `apps/cli/src/commands/upgrade/install.ts` — `npmInstall` throws `PartialFailureError`;
  accepts an `AbortSignal` and passes it to `execFile`; honest hint.
- `apps/cli/src/commands/upgrade/install.test.ts` — exit 8, abort kills the child.
- `apps/cli/src/commands/upgrade/index.ts` — interrupt guard around the stop→install→sync
  window; failures enriched with the server report; template failure becomes
  `upgrade_template_failed`; description text.
- `apps/cli/src/commands/upgrade/index.test.ts` — install failure, interrupt, template
  failure.
- `docs/cli.md` — regenerated.

### Key Implementation Details

`performUpgrade` gains a `catch` beside its existing `finally`, so the restart still runs
first and the enriched error is thrown after it — the enrichment can then state whether the
server came back.

`UpgradeEffects.signals` injects the `SignalTarget`, so no test ever touches the real
process's listener table (the same rule `abortOnInterrupt` already follows).

### Edge Cases

- Interrupt arriving **after** the install returned: the sync is short and completes; the
  run reports success and says the interrupt arrived too late to stop anything. Failing a
  finished upgrade would be the opposite lie.
- Interrupt arriving before the stop: the abort is already set when npm is called, execFile
  rejects immediately, and the normal interrupted path runs.
- The restart itself failing after an interrupt: already handled — `server.detail` says the
  server did not come back and names `corpus server start`.
- A `stop` that fails (nothing installed yet) keeps its own error and exit code; it is not
  laundered into an 8.

## Testing Strategy

Vitest, colocated. Unit coverage for the error surface and the signal helper; the upgrade
tests drive `runUpgrade` against a real workspace, a real git repository and a scripted
release with the two destructive effects injected, asserting exit codes, `changed`,
`details.server`, the lifecycle order, and the journal contents.

## E2E Verification Plan

Against a real `npm install -g` into a **scratch prefix**, a real workspace on a scratch
port, and a loopback release fixture — the CLI-025 setup. Verify: a refusal still exits 7
with `changed:false`; a failing npm exits 8 with `changed:true` and a restarted server; a
real `SIGINT` delivered to a real `corpus upgrade` mid-install leaves the server **up** and
exits 8. Both findings are reproduced first against a build of this tree with the two
behaviours reverted, so the before/after is the fix and not the fixture. Port 8765 and 5173
are never touched.

### Reproduction Steps (bugs only)

1. Install a build of this tree with `PartialFailureError` reverted to exit 7 and the
   interrupt handler removed, into a scratch prefix; init a workspace and start its server.
2. Point `CORPUS_RELEASES_API` at the loopback fixture and run `corpus upgrade --json` with
   a failing `npm` shim first on `PATH`.
3. Expected: an exit code that does not claim "nothing was changed".
4. Actual: exit **7**, whose documented meaning is "nothing was changed", while the server's
   pid has moved and npm has been run against the global prefix.
5. Repeat with a slow `npm` shim and `kill -INT` the corpus process eight seconds in.
6. Expected: the server comes back.
7. Actual: corpus dies, the server stays stopped, and the npm child is orphaned.

## E2E Verification Log

Model: **opus** (`claude-opus-5[1m]`).

Real everything except GitHub: real `npm pack` tarballs of this repo, real `npm install -g`
into **scratch prefixes** (`/tmp/cli030-e2e/prefix`, `.../prefix-old`), real workspaces on
ports **9312–9315**, and a loopback release fixture on **9412** serving the two documents
INFRA-016 publishes. The user's own server on **8765 was never contacted, stopped or
bound** (confirmed still held by pid 29851 at the end), and 5173 was never touched. Nothing
was ever installed over the real `corpus`.

Setup:

```
npm run package:build && (cd dist-package && npm pack --pack-destination /tmp/cli030-e2e)
# bump the staged manifest to 0.4.0, append a marker line to both template skills, pack again
shasum -a 256 corpus-0.4.0.tgz > corpus-0.4.0.tgz.sha256
node fixture.mjs                      # /repos/…/releases/latest + the two assets, on 9412
npm install -g --prefix /tmp/cli030-e2e/prefix ./corpus-0.3.0.tgz
./prefix/bin/corpus init ws --port 9312
printf '\n<!-- the agent evolved this skill -->\n' >> ws/.claude/skills/comment/SKILL.md
git -C ws commit -qm "agent evolved the comment skill"
(cd ws && ../prefix/bin/corpus server start)   # corpus 0.3.0 listening on :9312 (pid 53503)
```

**How the "before" build was obtained.** `prefix-old` is this branch with exactly the two
behaviours under review reverted — `PartialFailureError` back to exit 7 / `changed:false`,
and the interrupt handler and its abort signal removed — then built, packed and installed
like any other release. It is not the literal CLI-025 commit; it is the current tree minus
the fix, which is what isolates the two findings. The source was restored from a copy
afterwards and re-verified (`tsc`, `eslint`, 1255 tests) before the "after" tool was built.

### Reproduction

**Finding 1 — exit 7 after the state had already changed.** A two-line `fakebin/npm` that
prints to stderr and exits 1 stands in for a real npm failure, without a real half-install:

```
$ cd /tmp/cli030-e2e/ws && CORPUS_RELEASES_API=http://127.0.0.1:9412 \
  PATH=/tmp/cli030-e2e/fakebin:$PATH ../prefix-old/bin/corpus upgrade --json
{"error":{"code":"upgrade_install_failed","message":"the install command failed: npm install --global --prefix /private/tmp/cli030-e2e/prefix-old /var/…/corpus-0.4.0.tgz","changed":false,"details":{…,"npm":"fake npm: refusing to install","server":{"wasRunning":true,"stopped":true,"restarted":true,"detail":null}}}}
EXIT=7

$ ../prefix-old/bin/corpus server status --json
{… "running":true,"pid":57127 …}
```

**Exit 7**, whose documented meaning is _"a precondition was not met, and nothing was
changed"_ — while the very same payload records `stopped:true, restarted:true` and the
server's pid has moved from **53503 to 57127**. The server was stopped, npm was run against
the global prefix, and the caller was told nothing happened. Bug confirmed.

**Finding 2 — a Ctrl-C mid-install leaves the board down.** `slownpm/npm` sleeps 60s, so
there is a real window:

```
$ ../prefix-old/bin/corpus upgrade > old-int.log 2>&1 & UP=$!
$ sleep 8; kill -INT $UP; wait $UP
corpus 0.3.0 → 0.4.0
  verified corpus-0.4.0.tgz (1.0 MiB, sha256 18443f36d6f5…)
  stopped (pid 57127)
$ ps -p $UP        → dead
$ ../prefix-old/bin/corpus server status
not running
corpus: the workspace server is not running
rc=6
$ pgrep -f "sleep 60"
57219              ← the npm child was orphaned too
```

The `finally` never ran. The server stayed **down**, corpus said nothing about why, and the
install child was left running. Bug confirmed.

### Post-Implementation Verification

Source restored, rebuilt, repacked, reinstalled into the scratch prefix (`corpus --version`
→ `0.3.0`), server restarted on 9312.

**1. A refusal still exits 7, and now says so in the payload.** Fixture restarted publishing
the tarball but no `.sha256`:

```
$ CORPUS_RELEASES_API=http://127.0.0.1:9412 ../prefix/bin/corpus upgrade --json
{"error":{"code":"upgrade_unverifiable","message":"release 0.4.0 cannot be verified, so it will not be installed","changed":false,"details":{"detail":"release v0.4.0 publishes corpus-0.4.0.tgz but no corpus-0.4.0.tgz.sha256, …"}}}
EXIT=7
$ ../prefix/bin/corpus server status --json   → running true, pid 57398   (never stopped)
$ ../prefix/bin/corpus --version              → 0.3.0
```

The human form carries **no** "failed partway" line, correctly — silence there is the
signal that nothing moved:

```
$ CORPUS_RELEASES_API=http://127.0.0.1:9412 ../prefix/bin/corpus upgrade
corpus: release 0.4.0 cannot be verified, so it will not be installed
  SPEC.md §2.4 verifies a release's published checksum before installing it. …
EXIT=7
```

**2. The same failing npm now exits 8, and hands over the state of the board.**

```
$ CORPUS_RELEASES_API=http://127.0.0.1:9412 PATH=/tmp/cli030-e2e/fakebin:$PATH \
  ../prefix/bin/corpus upgrade --json
{"error":{"code":"upgrade_install_failed",
 "message":"the install command failed: npm install --global --prefix /private/tmp/cli030-e2e/prefix /var/…/corpus-0.4.0.tgz",
 "changed":true,
 "details":{"command":"npm install --global --prefix …","npm":"fake npm: refusing to install",
            "server":{"wasRunning":true,"stopped":true,"restarted":true,"detail":null}}}}
EXIT=8
$ ../prefix/bin/corpus server status --json   → running true, pid 57526, version 0.3.0
```

Every fact the reviewer said an agent needs is now branchable without parsing prose: exit
**8**, `changed:true`, and `details.server.restarted:true`. Human form:

```
corpus: the install command failed: npm install --global --prefix … /corpus-0.4.0.tgz
  This failed partway: something had already been changed — verify before retrying.
  npm reported the failure below. Check `corpus --version` for the version that is actually
  installed — it may be the old one, the new one, or a partly-replaced package — …
EXIT=8
```

`.corpus/upgrade.log`'s last line — the only witness a detached, server-spawned upgrade
leaves, and the one that has no exit code in it — now carries the same fact:

```
report: {"error":{"code":"upgrade_install_failed","changed":true,"details":{…,"server":{"wasRunning":true,"stopped":true,"restarted":true,"detail":null}}}}
```

**3. A real SIGINT mid-install puts the server back and exits 8.**

```
$ ../prefix/bin/corpus upgrade > new-int.log 2>&1 & UP=$!    # pid 58200
$ sleep 8; kill -INT $UP; wait $UP
corpus 0.3.0 → 0.4.0
  verified corpus-0.4.0.tgz (1.0 MiB, sha256 18443f36d6f5…)
  stopped (pid 58037)
  SIGINT received — stopping the install and putting the server back
  corpus 0.3.0 listening on http://127.0.0.1:9312 (pid 58243)
corpus: the upgrade was interrupted by SIGINT while it was installing
  This failed partway: something had already been changed — verify before retrying.
  The npm child was killed and the workspace's server was started again if it had been stopped.
  Check `corpus --version` and `corpus server status` before running `corpus upgrade` again.
  { "signal": "SIGINT", "server": { "wasRunning": true, "stopped": true, "restarted": true, "detail": null } }
EXIT=8
$ ../prefix/bin/corpus server status
running — pid 58243 on :9312, corpus 0.3.0, up 0s
```

Same sequence, same window, opposite outcome from the reproduction: the board is **up**.

_Observed limitation, and it is why the help text was reworded._ `pgrep -f "sleep 60"`
still found pid **58203** afterwards — Node's `signal` option kills the process it spawned
(`sh`), not that process's own children. Real npm handles its own termination, and a
terminal Ctrl-C reaches the whole foreground group anyway, so this only shows up when the
signal is delivered to corpus alone. Not worked around (making the child `detached` and
signalling its process group would take over signal delivery entirely, which is a larger
change with its own footguns); stated instead, in the help text and in a comment beside the
handler.

**4. A second interrupt is not trapped — and costs what the help says it costs.**

```
$ ../prefix/bin/corpus upgrade > new-int2.log 2>&1 & UP=$!
$ sleep 8; kill -INT $UP; sleep 0.2; kill -INT $UP; wait $UP
corpus 0.3.0 → 0.4.0
  verified corpus-0.4.0.tgz (1.0 MiB, sha256 18443f36d6f5…)
  stopped (pid 58243)
  SIGINT received — stopping the install and putting the server back
EXIT=130
$ ../prefix/bin/corpus server status   → not running (rc=6)
```

The second signal reached no handler, so Node's default killed corpus **during** the
restart — the intended escape hatch, not a regression. It had got far enough to spawn a
listener without recording its pidfile (`lsof` showed pid 58378 on :9312 while `server
status` said "not running"), which is exactly the half-state the help text warns about.
`kill 58378 && corpus server start` recovered it, as documented.

**5. The tool moved and the workspace could not follow → exit 8.** A real install of 0.4.0
into a workspace whose git repository had been removed, so the sync fails after the install
succeeds:

```
$ ../prefix/bin/corpus upgrade --json      # in ws4, .git deleted
EXIT=8
{"error":{"code":"upgrade_template_failed","changed":true,
 "message":"the tool was upgraded to 0.4.0 but this workspace's template files were not: checking whether the workspace tracks its template manifest failed: fatal: not a git repository …",
 "details":{"workspace":"/private/tmp/cli030-e2e/ws4","toolVersion":"0.4.0",
            "server":{"wasRunning":false,"stopped":false,"restarted":false,"detail":"it was not running when the upgrade began, so it was left stopped"}}}}
$ ../prefix/bin/corpus --version   → 0.4.0     ← the tool really did move
```

Before the fix this exited **1** ("internal error — an unexpected exception"), which said
nothing about the installed version having changed under the caller. The full
`UpgradeResult` is still emitted on stdout on this path, so the agent gets the report _and_
an honest exit code.

**6. The happy path is unchanged.** Prefix reset to 0.3.0, server running, one
workspace-edited skill:

```
$ CORPUS_RELEASES_API=http://127.0.0.1:9412 ../prefix/bin/corpus upgrade
corpus 0.3.0 → 0.4.0
  verified corpus-0.4.0.tgz (1.0 MiB, sha256 18443f36d6f5…)
  stopped (pid 58641)
  installed 0.4.0 with `npm install --global --prefix /private/tmp/cli030-e2e/prefix …`
  workspace template:
  upgrade (tool 0.3.0 → 0.4.0):
    update  .claude/skills/orchestrate/SKILL.md
    keep    .claude/skills/comment/SKILL.md — modified here — 1 line only here, 1 line only in the new copy
            unresolved — corpus workspace diff .claude/skills/comment/SKILL.md
  wrote 1 file in commit 4c7553dea86d8d172c4fff777025bf59021f9333.
  corpus 0.4.0 listening on http://127.0.0.1:9312 (pid 59926)

1 conflict to resolve — the tool changed this file and this workspace had edited it too, …
  .claude/skills/comment/SKILL.md — modified here — …
    corpus workspace diff .claude/skills/comment/SKILL.md
report written to .corpus/upgrade.log
EXIT=0
$ ../prefix/bin/corpus --version        → 0.4.0
$ ../prefix/bin/corpus server status    → running — pid 59926 on :9312, corpus 0.4.0
```

Identical to CLI-025 step 2: exit 0, one attributed commit, the edited skill never
overwritten, the conflict listed apart.

**7. Help and docs.** `corpus upgrade --help` from the installed binary renders both new
paragraphs (7-vs-8, and the interrupt window with its recovery). `docs/cli.md`'s exit-code
table now carries `8`, and `npm run docs:cli -w apps/cli` is a no-op against the committed
file (`prettier --check docs/cli.md` clean, `docs/generate.test.ts` green).

Checks: `npx tsc --noEmit -p apps/cli` clean, `npx eslint apps/cli/src` clean,
`VITEST_MAX_THREADS=4 npx vitest run apps/cli` → **1255 passed / 0 failed** (84 files).

Cleanup: both scratch servers and the fixture stopped; 9312/9313/9314/9315/9412 confirmed
free; `/tmp/cli030-e2e` removed; `dist-package/` regenerated at 0.3.0; no vitest workers
left. Port 8765 still held by the user's own server, untouched throughout.

### Not verifiable here

- The **real** GitHub Releases API was never contacted — §2.4 forbids background checks, and
  a suite that reached it would be one.
- `SIGKILL`, a power cut and a suspended machine are uncatchable by construction. The help
  text states the consequence and the recovery rather than the code pretending otherwise.
- The case where npm has replaced enough of the package that the restart cannot resolve a
  server entry was not staged; that path (`server.detail` = "the server did not come back",
  naming `corpus server start`) is unit-tested and predates this issue.
- Windows delivers `SIGTERM` differently and was not exercised; `onInterrupt` is
  unit-tested per signal on POSIX only.
- Killing npm's own grandchildren — see the note under step 3. Observed, stated, not fixed.
- `corpus upgrade | head` can still kill the process mid-run: that is **CLI-024** (SIGPIPE
  guard), still `todo`, and untouched by this issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
