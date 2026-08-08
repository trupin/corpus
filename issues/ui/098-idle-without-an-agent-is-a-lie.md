# [UI-098] The console says `agent: idle` when no agent exists

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 2 (signed), CONTRACT-045, SERVER-078
- Blocks: —

## Spec References

- SPEC.md §11 line 467 — the console strip's agent pill, as amended by SHARED-033
- SPEC.md §11 — "All agent/system status lives in the console strip"

## Summary

With no agent running anywhere, the console strip reads `agent: idle · queue 3`.
`idle` reads as "the agent is connected and has nothing to do"; the truth is
"nobody is listening and three requests are waiting". This issue adds the
`disconnected` state, fed by the contact SERVER-078 records and CONTRACT-045
puts on the wire.

## Reproduction (confirmed by inspection)

`apps/ui/src/console/consoleModel.ts:133`:

```ts
export function agentState(status: QueueStatus): AgentState {
  if (status.halted) return "halted";
  return status.inProgress > 0 ? "working" : "idle";
}
```

`idle` is the else-branch. Nothing consults whether an agent has ever contacted
the server.

## Acceptance Criteria

- [ ] `agentState` returns `disconnected` when the last agent contact is older
      than the window, or when there has been none at all
- [ ] The window is **derived from `DEFAULT_IDLE_TIMEOUT_SECONDS`** as CONTRACT-045
      exports it — no literal `10 * 60_000` in the UI. A parked agent re-contacts
      the server at least every 480 s, and the threshold must follow that constant
      if it ever changes
- [ ] `idle` now means what it says: an agent is connected and has nothing to do
- [ ] `halted` keeps precedence over everything, as today
- [ ] The pill text reads naturally — `agent: disconnected · queue 3` — and the
      queue depth stays beside it, since it matters most in this state
- [ ] The dot is **not** styled as a failure: per the rider, disconnected is the
      plain truth on a machine with no agent running, not an error. It must be
      visually distinct from both `idle` and the `working` pulse, and must not
      pulse — "nothing else pulses, which is why the pulse means something"
      (`consoleModel.ts:153`)
- [ ] The state **re-evaluates as time passes**, not only when a new status
      arrives: an agent that stops contacting must flip the pill without a
      further poll to prompt it
- [ ] It flips back to `idle` promptly once an agent parks again
- [ ] The index pill's dot vocabulary (which borrows the agent pill's states —
      `consoleModel.ts:143`) is unaffected, or is updated deliberately rather
      than by accident

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/consoleModel.ts` — `agentState`, `agentPillText`, and the
  `AgentState` union
- `apps/ui/src/console/AgentPill.tsx` — the dot class for the new state; its
  docblock lists the three states and their meanings and must be rewritten, not
  appended to
- the console strip's CSS — a dot treatment for `disconnected`

### Key Implementation Details

**The state is time-dependent, which nothing in this component currently is.**
`agentState` is a pure function of a status object today; with a window it also
depends on now. Either the component ticks (the pending indicator's
`TICK_MS = 15_000` is the existing precedent for a coarse clock that costs
nothing) or the query refetches often enough to carry the transition. Pick one
and say why — a pill that only updates when something else happens will sit on
`idle` for an hour after the agent leaves, which is the bug again with extra
steps.

Keep `agentState` pure by passing the clock in, as the reveal and pending code
already do for testability.

### Edge Cases

- **Contact absent entirely** (fresh server) — disconnected, not "unknown"
- **`inProgress > 0` with stale contact** — an agent that claimed work and died.
  SHARED-033's edge-case list flags this for decision; implement what the rider
  settled. Do not invent a rule here
- **Halted and disconnected at once** — `halted` wins, per the existing precedence
- A clock jump (laptop wake) — the window is evaluated against the server's
  timestamp, so the pill corrects itself on the next status rather than asserting
  something from a skewed local clock

## Testing Strategy

Vitest over `agentState` with an injected clock: just inside the window → `idle`;
just outside → `disconnected`; never-contacted → `disconnected`; `inProgress > 0`
→ `working`; `halted` → `halted` regardless. Component tests that the dot class
and pill text follow, and that the state changes on a tick with no new data.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` with **no** agent running
2. Post two `@agent` comments so the queue has depth
3. Expand the console strip
4. Expected: something saying no agent is connected
5. Actual: `agent: idle · queue 2`

### Verification Steps

1. Restart the app with no agent running — confirm the strip reads
   `agent: disconnected` with the queue depth beside it
2. Start `corpus queue idle` — confirm the pill flips to `idle` promptly
3. Let the agent claim an event — confirm `working` and the pulse
4. Kill the agent mid-park; wait past the window **without touching the UI** —
   confirm the pill flips to `disconnected` on its own
5. Restart the agent — confirm it flips back
6. Toggle HALT — confirm `halted` wins in every combination
7. Confirm the index pill is unchanged throughout

## E2E Verification Log

_[Agent fills: model run on, commands, observed output, and the tick-vs-refetch
decision with its reasoning.]_

## Completion Checklist (domain agent)

- [ ] Pre-fix reproduction logged
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-098]` prefix
