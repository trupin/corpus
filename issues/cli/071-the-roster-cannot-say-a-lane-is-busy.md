# [CLI-071] The roster cannot say a lane is busy

## Domain

cli

## Status

done

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

- [x] A row says when its lane is holding work, in a cell of its own
- [x] It reads naturally beside a **not-live** row, because `{live: false,
      working: true}` is the pair the field exists for — a row that only made
      sense next to `live` would miss the case
- [x] Absent when the lane holds nothing, on the CLI-070 principle: a column of
      states nobody reads is a column nobody reads
- [x] It does not replace or absorb the waiting count — *is anybody there*, *is
      anybody waiting* and *is anything being done* are three facts, and the
      launch decision needs all three
- [x] `docs/cli.md` regenerates cleanly

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

Implemented by the orchestrator on opus, 2026-08-26.

### The row now reads in the order a reader decides in

```
th_9f1a2b "Rate check" · analyst (doc_a7) · lapsed, last parked 41m ago · working · 3 waiting
```

*Is anybody there* · *is anything being done* · *is anything waiting*. The
`working` cell goes **before** the count for that reason, and a test asserts the
order rather than trusting the source to keep it.

### It looks like a contradiction, and that is the case it exists for

`lapsed · working` reads oddly until you know that a resident works its
conversation inline and holds no park while it does. That row is a **busy agent**,
and the same row without `working` is a **launch**. Both are tested, and a third
test asserts the two cells stay separate rather than collapsing into one verdict
— because a reader who took `working` for presence would leave a genuinely dead
lane unlaunched forever, since a listener that died mid-event holds its event
until `reap-stale` requeues it.

### Falsification

Printing the cell unconditionally:

```
× says nothing for a lane holding nothing
× prints one row per lane, the orchestrator's first
× prints a mixed roster legibly
× gives the orchestrator's row no resident cell at all
```

Four, because the row is pinned in several shapes — which is the pin working.

### Checks

```
vitest run apps/cli              2132 tests passed   exit 0
eslint apps/cli/src                 0 errors         exit 0
docs/cli.md                         regenerates clean
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[CLI-071]` prefix
