# [CLI-071] The roster cannot say a lane is busy

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-057, SERVER-157
- Blocks: AGENT-055

## Spec References

- SPEC.md §7 — the Orchestrator skill paragraph

## Summary

`corpus agents` prints a lane's liveness and, since CLI-070, its waiting count.
It cannot say the lane is **working** — and after v0.23.0 that is the difference
between *launch a listener here* and *leave that agent alone*.

The orchestrate skill reads its launch decision off this output. Without the
field it launches onto a resident that is simply mid-turn.

## Acceptance Criteria

- [ ] A row says when its lane is holding work, in a cell of its own
- [ ] It reads naturally beside a **not-live** row, because `{live: false,
      working: true}` is the pair the field exists for — a row that only made
      sense next to `live` would miss the case
- [ ] Absent when the lane holds nothing, on the CLI-070 principle: a column of
      states nobody reads is a column nobody reads
- [ ] It does not replace or absorb the waiting count — *is anybody there*, *is
      anybody waiting* and *is anything being done* are three facts, and the
      launch decision needs all three
- [ ] `docs/cli.md` regenerates cleanly

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/agents.ts` — beside `waitingCell`
- `apps/cli/src/commands/agents.test.ts`

## Testing Strategy

A working lane prints it; an idle one does not. Falsify by printing it always
and watching the absence case fail.

## E2E Verification Plan

Against a real workspace: a lane holding a claimed event prints the cell while
its listener is not parked.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-071]` prefix
