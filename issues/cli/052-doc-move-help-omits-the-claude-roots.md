# [CLI-052] `doc move`'s help omits `.claude/` from what cannot be moved

## Domain

cli

## Status

todo

## Priority

P3

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: CONTRACT-065 (the published half of the same gap), SHARED-054

## Spec References

- SPEC.md **§4** — the workspace layout
- SPEC.md **§7** line 399 — the agent-def and skill roots

## Summary

`apps/cli/src/commands/doc/move.ts:49-50` enumerates what cannot be moved as
**threads and skills**, omitting `.claude/agents/`. `assertMovable`
(`apps/server/src/docs/move.ts:45-58`) refuses every path whose root is not
`docs`, so a persona is refused too.

Raised as a NIT by PR #50's fourth review and filed separately on that reviewer's
recommendation:

> They are different work — one is a cross-package pin, the other is one sentence
> of CLI help text.

## Priority is P3, and lower than when it was raised

The same review noted why: `corpus doc check`'s help now states the refusal and
**quotes the exact error string**, so a reader who hits it has something to
search for. The immediate harm — a person following one help text into a `400`
another help text could have predicted — is closed from the other side.

What remains is that `doc move --help` is the natural place to look before
running `doc move`, and it lists two of three cases.

## Acceptance Criteria

- [ ] `doc move`'s help names `.claude/agents/` alongside threads and skills, or
      states the rule as "anything not under `data/docs/`" rather than
      enumerating
- [ ] The wording agrees with `assertMovable`'s two messages, which differ by
      type (threads get their own sentence)
- [ ] `docs/cli.md` **regenerated**, never hand-edited
- [ ] Prefer stating the rule over extending the list — the list is what went
      stale, and a third omission is the same defect a third time

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/move.ts`
- `docs/cli.md` — regenerated

### Key Implementation Details

`assertMovable` emits two different messages: `threads are flat under
data/threads/ and cannot be moved` for a thread, and `<path> is not under
data/docs/ and cannot be moved` for everything else. The help should not imply
one message where two exist.

Read `apps/cli/src/commands/doc/check.ts`'s repair paragraph first and match its
substance rather than inventing a fourth wording of the same rule — this release
spent ten sites reducing one claim to one wording.

## Testing Strategy

Whatever pins CLI help text today. The behavioural check is running `doc move` on
a persona and comparing the refusal with what the help predicted.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus doc move <persona-id> --folder inbox` — capture the real refusal
3. Confirm `doc move --help` predicted it
4. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-052]` prefix
