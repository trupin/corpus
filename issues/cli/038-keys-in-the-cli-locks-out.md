# [CLI-038] `corpus doc read` hands you a key; the write verbs demand one

## Domain

cli

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098

## Spec References

- SPEC.md **§7** "A key, not a lock", and its orchestrator-skill invariant
- SPEC.md **§15** M3 — the CLI verb families, with `lock` struck

## Summary

The agent-facing half. This is where SHARED-041 either works or repeats the
lock's failure — the whole rider rests on a write being **impossible** without a
key, not merely discouraged.

## Acceptance Criteria

- [ ] `corpus doc read` (and every verb that prints a document) prints the key,
      and prints it somewhere an agent will actually carry — not buried
- [ ] The same output says when a person has an edit session open. §7 makes this
      information the agent acts on politely; the wording should invite that
      without implying a refusal
- [ ] `corpus doc edit` takes `--key` and **refuses without it** when it is
      replacing a body. The refusal must say what to do — re-read, then retry —
      because an agent that cannot recover from the message will guess
- [ ] A `409` renders as the two useful facts: what the document now says, and
      the fresh key. Not a stack trace, and not a raw payload dump
- [ ] Delta verbs are unchanged and take no key: `--add-tag`, `--folder`,
      archive, unarchive, status, `reviewed`, move. Nor does `corpus doc patch`
- [ ] The `lock` verb family is **deleted**: `corpus lock acquire|release|break|
      list|reap`, `apps/cli/src/commands/lock/`, and its registry entries
- [ ] `docs/cli.md` regenerates and the drift check passes
- [ ] Exit codes: a stale key is its own code, distinguishable from a usage error
      and from a server failure. An agent branches on exit codes

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/read.ts`, `edit.ts`
- **Delete** `apps/cli/src/commands/lock/`
- The command registry, and `docs/cli.md`

### Notes

- `apps/cli/src/commands/doc/edit.ts` carries comments about the `423` lock
  conflict and about not retrying it. Those are now about `409` and the advice
  inverts: a `409` is exactly the case where retrying (after re-reading) is
  right. Rewrite them rather than leaving them describing a mechanism that is
  gone.

## Testing Strategy

Unit against the stub server: the key round-trips, a missing key refuses before
any request is sent, a `409` renders both facts, and the exit code is distinct.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`.

Drive the agent's actual loop: read, edit with the key, read again, edit with the
stale key, see the refusal, retry with the fresh one.

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
