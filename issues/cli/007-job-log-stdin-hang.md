# [CLI-007] `corpus job log` hangs forever under an agent harness when the line positional is omitted

## Domain

cli

## Status

done

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

- [x] `corpus job log <eventId>` with no positional and fd 0 a socket (or closed) exits with a usage error immediately instead of hanging; heredoc and pipe forms still work.
- [x] The stdin resolution goes through `stdinCarriesABody()` — one implementation, no second fstat path.
- [x] Regression test using the `testing/stdin.ts` helpers; docs/cli.md regenerated if the help text changes.

## Technical Design

Expected footprint: `apps/cli/src/commands/job/log.ts` (or equivalent) + test. No contract or server changes.

## E2E Verification Plan

### Verification Steps

1. Reproduce pre-fix: run `corpus job log <id>` with no positional from a harness-like caller (fd 0 a socket) → observe the hang (bounded by timeout).
2. Post-fix: same invocation exits immediately with the usage error; heredoc form still appends.

## E2E Verification Log

implemented on: opus

**Setup (real server, real workspace).** Scratch workspace `/tmp/corpus-c007-ws`, port 8950, CLI entry
`node --import <repo>/node_modules/tsx/dist/loader.mjs <repo>/apps/cli/src/bin/corpus.ts` (the absolute
loader path is needed because the workspace cwd has no `tsx` to resolve).

```
$ corpus init /tmp/corpus-c007-ws --port 8950
Initialized Corpus workspace at /tmp/corpus-c007-ws
  port 8950, token in .corpus/config.json (mode 600)
$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:8950 (pid 73910)
$ corpus doc create --title "C007 probe" --type note -m "hello body" --json
{"doc":{"frontmatter":{"id":"doc_4cf24r6o",…}}}
# a comment that requests the agent, so there is a real event to log against
$ curl -s -X POST .../api/threads -d '{"parent":"doc_4cf24r6o","body":"@agent please look at this","requestsAgent":true}'
$ corpus queue claim-all --json --from agent
{"events":[{"id":"evt_jkqpntwvoukk","type":"comment.created",…}]}
```

**The harness that models the real caller** (`/tmp/corpus-c007-socket.mjs`): spawns the CLI with a
connected `net.Socket` on fd 0 that is never written to and never closed — exactly what Claude Code's
Bash tool hands its child — and SIGKILLs it after a bound. Verified it really is a socket:

```
$ node /tmp/corpus-c007-socket.mjs 5000 node -e "…fstatSync(0)…"
fd0 isSocket true isFile false isFIFO false isTTY undefined
[harness] child exited code=0 signal=null after 53ms
```

### Reproduction (bugs only)

Pre-fix, with fd 0 a socket and the line positional omitted — no output, no request, no exit:

```
$ node /tmp/corpus-c007-socket.mjs 20000 … corpus job log evt_jkqpntwvoukk
[harness] TIMEOUT after 20000ms — child still running, SIGKILL 75562
[harness] child exited code=null signal=SIGKILL after 20015ms
```

The verb blocked for the full 20 s bound and only ended because the harness killed it. This is the
orchestrate skill's own call shape, so the agent parks mid-job with nothing on stdout or stderr.

### Post-Implementation Verification

Same invocation, post-fix — usage error in 250 ms instead of a hang:

```
$ node /tmp/corpus-c007-socket.mjs 20000 … corpus job log evt_jkqpntwvoukk
corpus: no line to append.
  Pass the line as an argument, or pipe it in: `echo "step 1" | corpus job log <event-id>`. Stdin is read only when it is a pipe or a heredoc.
[harness] child exited code=2 signal=null after 250ms
```

Every reading form still works, and the socket case with a positional (the agent's normal call) is
untouched:

```
$ corpus job log evt_jkqpntwvoukk --json <<'EOF'
step from a heredoc
EOF
{"eventId":"evt_jkqpntwvoukk","appended":true}   exit=0
$ printf 'step from a pipe\n' | corpus job log evt_jkqpntwvoukk --json
{"eventId":"evt_jkqpntwvoukk","appended":true}   exit=0
$ corpus job log evt_jkqpntwvoukk "step from a positional" --json
{"eventId":"evt_jkqpntwvoukk","appended":true}   exit=0
$ corpus job log evt_jkqpntwvoukk 0<&-            # closed fd 0
corpus: no line to append. …                     exit=2
$ corpus job log evt_jkqpntwvoukk < /dev/null     # character device
corpus: no line to append. …                     exit=2
$ node /tmp/corpus-c007-socket.mjs 20000 … corpus job log evt_jkqpntwvoukk "step under an agent harness" --json
{"eventId":"evt_jkqpntwvoukk","appended":true}
[harness] child exited code=0 signal=null after 220ms

$ cat .corpus/jobs/evt_jkqpntwvoukk.jsonl
{"ts":"2026-07-27T18:29:45Z","source":"cli","line":"step from a heredoc"}
{"ts":"2026-07-27T18:29:46Z","source":"cli","line":"step from a pipe"}
{"ts":"2026-07-27T18:29:47Z","source":"cli","line":"step from a positional"}
```

`corpus job log --help` and the regenerated `docs/cli.md` both carry the narrowed contract ("only when
stdin is a pipe or a heredoc… that case is a usage error, exit 2"). Server stopped by pid at the end
(`stopped (pid 73910)`).

**Checks.** `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck` all clean;
`vitest run apps/cli` → 51 files, 507 tests passed.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-007]` prefix
