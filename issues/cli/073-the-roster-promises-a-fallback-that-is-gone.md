# [CLI-073] The roster tells an operator to wait for a fallback that was deleted

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-160 (found while reproducing it), SERVER-152 (the removal)

## Spec References

- SPEC.md §7 — the rider signed 2026-08-25 removing the lapse fallback

## Summary

Found while reproducing SERVER-160. `corpus agents` prints, under every roster:

> a lane with no listener is not a failure: past the grace window (16m) its
> pending work becomes visible to the orchestrator's own `corpus queue
> claim-all`, so it is done more slowly and without the conversation's warmth —
> never silently not done.

**Every clause after the colon is false.** The rider signed 2026-08-25 removed
that fallback: `visibleTo` is exact equality, and a lapsed lane's work is
claimable by nobody. The `--help` text carried the same promise in longer form.

This is the worst kind of stale prose — it is *reassuring*. An operator watching
a conversation go unanswered reads it and waits sixteen minutes for something
that is never coming, which is exactly what happened while SERVER-160 was being
diagnosed.

## Acceptance Criteria

- [x] Neither the roster note nor the `--help` text claims a lapsed lane's work
      becomes claimable by the orchestrator
- [x] Both say what is now true: the work **waits for a listener**, and the
      pending count is a launch instruction
- [x] The tests that pin these strings are updated with them

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/agents.ts` — `FALLBACK_NOTE` and the `--help` prose

## Testing Strategy

The existing string assertions.

## E2E Verification Plan

`corpus agents` against a real workspace with an undesignated lane.

## E2E Verification Log

**Implemented on: opus.** Before:

```
a lane with no listener is not a failure: past the grace window (16m) its pending
work becomes visible to the orchestrator's own `corpus queue claim-all` …
```

After:

```
a lane with no listener is not a failure, but its work waits: nobody else can
claim it. The orchestrator's job is to launch a listener for it — that is what
the pending count on each row is for.
```

## Completion Checklist (domain agent)

- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
