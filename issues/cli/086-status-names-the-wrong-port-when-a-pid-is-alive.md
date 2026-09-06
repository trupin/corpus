# [CLI-086] `server status` names the wrong port when a live pid is not answering

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger), where
it sat as a post-review observation from cli-dev during CLI-014, 2026-07-29:

> (cli) `corpus server status` renders the `unowned` detail with the _pidfile's_
> port while the probe used the _configured_ one — a re-pointed workspace reads
> "not answering on :9181" when :9182 was probed.

The 2026-09-06 audit of that ledger re-checked the evidence and re-classified the
item: it is not a wording nit. SPEC §2.1 has since been amended to require **both**
ports in this report, so the current output is a **spec violation**, and `stop`
already ships the compliant version of the same sentence.

## Spec References

- SPEC.md:41 — §2.1 Server lifecycle, `corpus server status`

The bullet requires, for a live-but-unowned pid:

> Instead, both `status` and `stop` report the situation — the pid, the port it
> was started on, and the port actually probed — with the remedy that applies
> (re-point the configured port and retry, or check and stop the pid directly)

Three facts are required. `status` currently reports two, and gets one of them
wrong by naming the pidfile's port as the port that was probed.

## Summary

When a pidfile names a **live** pid that does not answer as this workspace's
server, `corpus server status` prints `pid <n> is alive but is not answering on
:<pidfile port>`. The probe used the **configured** port. The two differ exactly
in the case this state exists to report — a workspace whose `port` was re-pointed
after the server started — so the one line that is supposed to explain the
situation names a port nothing was tried on, and the operator is sent to look at
the wrong socket. `corpus server stop` already does this correctly.

## Acceptance Criteria

- [ ] The `unowned` human line names **both** ports and says which is which: the
      port the process was started on (from the pidfile) and the port actually
      probed (the configured one).
- [ ] The `--json` report carries both as distinct fields, and the human line is
      rendered from the same object (the file's stated invariant: "the two can
      never describe different states").
- [ ] The `notRunning` exit-6 message for `unowned` names the probed port, not
      the pidfile's.
- [ ] The remedy sentence matches the one `stop` already prints, so the two verbs
      do not describe the same state in two vocabularies.
- [ ] A unit test pins a re-pointed workspace: pidfile port ≠ configured port,
      live pid, and asserts both numbers appear with the right roles.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/server/status.ts` — the `unowned` arm of `buildReport`
  (line 59-70) and `notRunning` (lines 106-123).
- `apps/cli/src/commands/server/status.test.ts` — the re-pointed-workspace case.
- `apps/cli/src/commands/server/stop.ts` — **read only**, as the reference
  wording. Do not change it.

### Key Implementation Details

`apps/cli/src/commands/server/status.ts:59-70` builds the `unowned` report:

```ts
    case "unowned":
      return {
        ...base,
        running: false,
        healthy: false,
        pid: state.record.pid,
        port: state.record.port,
        startedAt: state.record.startedAt,
        uptimeSeconds: null,
        version: state.record.version,
        detail: `pid ${String(state.record.pid)} is alive but is not answering on :${String(state.record.port)}`,
      };
```

`state.record.port` is the pidfile's. The probe is `probeHealth(client,
workspace.root)`, which uses `workspace.port` — the configured one. The adjacent
`foreign` arm (lines 71-85) already gets this right and carries the comment that
states the rule:

> // The port that was probed, which is the config's — not the pidfile's.
> // They differ exactly when the config was re-pointed after a start, and
> // that is the case this state exists to report.

`stop.ts:66-69` is the compliant sentence to mirror:

```ts
    out.line(
      `not stopped — pid ${String(pid)} is alive but nothing answered on :${String(workspace.port)}, and it was left alone`,
    );
    out.line(`  Its pidfile was kept: ${unownedRemedy(pid, port, workspace.port)}`);
```

Note the two ports are already distinguished in `stop`'s JSON as `pid` /
`pidfilePort` beside the probed `workspace.port`. Keep the field naming
consistent between the two verbs rather than inventing a third spelling.

`notRunning` at status.ts:117-122 has the same defect:

```ts
    state.kind === "unowned"
      ? `the workspace server is not answering on :${String(report.port)}`
```

`report.port` is the pidfile's for `unowned`. Decide the field shape first — if
`ServerStatusReport.port` becomes the probed port for `unowned` (matching
`foreign`), with the pidfile's carried as a separate field, this line becomes
correct for free and the `--json` consumers gain the distinction. That is the
preferred shape, because it makes `port` mean one thing across all five states.

### Edge Cases

- Both ports equal (the ordinary case: nothing was re-pointed). The line must
  still read naturally — do not print `:8765 (probed :8765)`. Either collapse to
  one mention or phrase it so the repetition is harmless.
- `--json` is a documented output shape. Adding a field is additive; **changing
  what `port` means for the `unowned` state is not**, so state the change in the
  verb's description text and regenerate `docs/cli.md`.
- `stale` and `stopped` arms are untouched.

## Testing Strategy

Unit tests over `buildReport` and `notRunning` with a synthetic `ServerState` of
kind `unowned` whose `record.port` differs from the workspace's configured port.
Assert: the human line contains both numbers, the JSON carries both, and the
exit-6 message names the probed one.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` in a scratch workspace, note the port (say 8765).
2. Edit `.corpus/config.json` and set `port` to a free port (say 8766).
3. Run `corpus server status`.
4. Expected (SPEC.md:41): a line naming the pid, `:8765` as the port it was
   started on, and `:8766` as the port actually probed.
5. Actual: `pid <n> is alive but is not answering on :8765` — the probed port
   8766 never appears.
6. Run `corpus server stop` for contrast: it names `:8766` as the port nothing
   answered on, and carries `:8765` in the remedy.

### Verification Steps

1. Rebuild, repeat steps 1-3.
2. Expected: `status` names both ports with the right roles, `status --json`
   carries both, and the exit code is still 6.
3. Restore the config port and confirm the ordinary running report is unchanged.

## E2E Verification Log

_[Agent fills: application restarted, exact commands, observed output. State
which model the implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
- [ ] `docs/cli.md` regenerated if the verb's description changed

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-086]` prefix
