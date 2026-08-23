# [CLI-066] A body piped over a socket is dropped silently, and a template lands instead

## Domain
cli

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: — (CLI-007 is the decision this hardens, not reverses)
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- `apps/cli/src/input.ts` — `stdinCarriesABody()` and its CLI-007 rationale
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Hit for real during the SHARED-070 audit (2026-08-23, v0.19.0). The audit's
capture harness ran `corpus doc create … <<heredoc` through Node's `spawnSync`
with `input:` — which hands the child a **socketpair** on fd 0.
`stdinCarriesABody()` accepts only regular files and FIFOs (the CLI-007 fix for
agent harnesses that hold a never-closing socket on fd 0), so the CLI read
nothing: **five documents were created with the note template's empty scaffold
as their bodies, exit 0, no warning anywhere.** The loss surfaced only later as
an inexplicable `orphaned_anchor` on a thread whose quoted text "was" in the
body the caller sent. 340 bytes of body were verifiably written to the pipe and
verifiably absent from the document.

CLI-007's decision is right — a socket must never be *blocked on*. What is
wrong is the silence: the CLI cannot tell "no body offered" from "a body
offered on a transport I refuse", and it picks the interpretation that writes
the wrong document at exit 0. `spawnSync`-shaped callers are not exotic — any
tool that wraps the CLI programmatically gets a socketpair from libuv.

## Acceptance Criteria
- [ ] When fd 0 is a **socket** and the verb is one whose body may come from
      stdin (`doc create`, `doc edit`, `thread create/reply`, `skill create`,
      `doc patch --stdin`, `job log`), the CLI emits a one-line warning on
      stderr: stdin was a socket, so no body was read from it — pass `-m` or
      `--file` if one was intended. Exit code unchanged (the CLI-007 hazard —
      blocking — must not return; a poll/zero-timeout read is acceptable only
      if provably non-blocking on macOS and Linux, otherwise warn on the fstat
      alone).
- [ ] The warning is one line and appears only when no `-m`/`--file` was given —
      a caller who passed the body explicitly is not nagged.
- [ ] `--json` mode carries the same fact as a `warnings` entry if the verb has
      a warnings channel, stderr otherwise.
- [ ] The full `--help` of the body-taking verbs names the three body sources
      and states that a socket is not one (doc create's already gestures at
      this; make it explicit).
- [ ] The Claude Code Bash-tool path (heredoc → regular file) still reads
      bodies and prints no warning — regression-tested.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/input.ts` — `resolveBody` learns to distinguish "no fd/TTY"
  from "socket", returning the warning case
- body-taking command modules — surface the warning

### Key Implementation Details
`stdinCarriesABody` already fstats fd 0; add a third outcome (`socket`) instead
of collapsing it into `false`. The warning text is read by agents: follow the
CLI's usual refusal shape — what happened, then the repair, one line each.

### Edge Cases
- `0<&-` (no fd 0): stays silent — nothing was offered.
- A socket fd 0 on a verb that takes no body: no warning.
- `doc patch --stdin` explicitly requests stdin: on a socket that is an
  **error**, not a warning — the caller named stdin as the source and it cannot
  be read.

## Testing Strategy
Unit tests in `input.ts`'s suite with a socketpair fd (Node `net` or
`child_process` harness); command-level test that the warning reaches stderr
and the created document used the template body.

## E2E Verification Plan
A Node one-liner using `spawnSync` with `input:` against a real workspace
server; before: silent template body; after: same document plus the stderr
warning. A shell heredoc run alongside stays warning-free.

### Reproduction Steps (bugs only)
1. Scratch workspace, server up
2. `node -e 'const r=require("child_process").spawnSync("node",["<bin>","doc","create","--type","note","--title","probe"],{input:"# Body\n",encoding:"utf8"}); console.log(r.stdout,r.stderr,r.status)'`
3. Expected: body lands, or a warning that it cannot
4. Actual (2026-08-23): `created doc_…`, exit 0, template body, no warning

### Verification Steps
1. Rebuild, repeat step 2 — expect the one-line stderr warning, template body
2. Run the same create via a shell heredoc — body lands, no warning

## E2E Verification Log
_Filled in by the implementing agent._

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
- [ ] Committed with `[ISSUE-ID]` prefix
