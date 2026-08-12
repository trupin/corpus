# [CLI-041] `corpus doc diff` dies with `EPIPE` when piped into `head`

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-024 (added the SIGPIPE guard that does not cover this verb)

## Spec References

- Not spec behaviour. This is about the CLI being usable in a shell.

## Summary

Found incidentally by AGENT-023 while walking the revert loop against a real
server: `corpus doc diff <id> | head` dies with an unhandled `EPIPE`.

CLI-024 added a SIGPIPE guard for exactly this. It does not cover `doc diff`.

It matters more than a cosmetic crash because of where the verb now sits: after
SHARED-042 the revert loop **begins** with `corpus doc diff`, and reading a large
diff through `head` or `less` is the obvious first thing anyone does with it — an
agent piping it into `head` gets a stack trace instead of the first lines.

## Acceptance Criteria

- [ ] Reproduce: `corpus doc diff <id> | head -5` against a document with a diff
      longer than the pipe buffer
- [ ] The verb exits cleanly on a closed pipe, like the verbs CLI-024 fixed
- [ ] **Find out why CLI-024's guard missed it** rather than adding a second
      guard beside it. If the guard is per-verb, every verb added since is
      suspect and the sweep is the issue; if it is global and `doc diff` writes
      through a different path, that path is the bug
- [ ] Whatever the cause, the fix covers the verbs that share it — name them

## Technical Design

### Files to Create/Modify

- Wherever CLI-024 put the guard, and `apps/cli/src/commands/doc/diff.ts`

## Testing Strategy

A test that closes the pipe early. If the existing guard has one, extend it to
cover the verb rather than writing a second.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
