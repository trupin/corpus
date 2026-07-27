# [CLI-007] `corpus job log` hangs forever under an agent harness when the line positional is omitted

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — one-call fix with the helper already shipped; the test pattern exists in `input.test.ts`.

## Dependencies

- Depends on: CLI-003, CLI-004
- Blocks: AGENT-002

## Spec References

- `issues/cli/004-queue-lock-job-verbs.md` — the `job log` AC (stdin fallback when the positional is omitted)
- `.claude/agents/cli-dev.md` → Domain Knowledge, 2026-07-27 stdin entry (discovery record)

## Summary

Found during CLI-003's E2E: `!process.stdin.isTTY` is not "a body is piped" — an agent harness (Claude Code's Bash tool included) hands its child a socket on fd 0 that never closes, so `corpus job log <eventId>` with no line positional blocks forever under exactly the caller this verb exists for (the orchestrate skill's loop). CLI-003 shipped `stdinCarriesABody()` (`apps/cli/src/input.ts`), which `fstat`s fd 0 and reads only a regular file (heredoc) or FIFO (pipe); `job log` predates it and still uses the raw fallback.

## Acceptance Criteria

- [ ] `corpus job log <eventId>` with no positional and fd 0 a socket (or closed) exits with a usage error immediately instead of hanging; heredoc and pipe forms still work.
- [ ] The stdin resolution goes through `stdinCarriesABody()` — one implementation, no second fstat path.
- [ ] Regression test using the `testing/stdin.ts` helpers; docs/cli.md regenerated if the help text changes.

## Technical Design

Expected footprint: `apps/cli/src/commands/job/log.ts` (or equivalent) + test. No contract or server changes.

## E2E Verification Plan

### Verification Steps

1. Reproduce pre-fix: run `corpus job log <id>` with no positional from a harness-like caller (fd 0 a socket) → observe the hang (bounded by timeout).
2. Post-fix: same invocation exits immediately with the usage error; heredoc form still appends.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

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

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-007]` prefix
