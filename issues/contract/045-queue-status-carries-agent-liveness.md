# [CONTRACT-045] `QueueStatus` cannot say whether an agent is there

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 2 (rider must be signed first)
- Blocks: SERVER-078, UI-098

## Spec References

- SPEC.md §11 line 469 — the console strip's agent pill, as amended by SHARED-033
- SPEC.md §7 — the queue's long-poll idle endpoint
- SPEC.md §9.2 — the queue status resource

## Summary

`QueueStatus` carries `halted`, `pending` and `inProgress` — everything about the
*work*, nothing about the *worker*. So the UI derives `idle` by elimination
(`consoleModel.ts:135`: not halted, nothing in progress ⇒ idle), which is why a
machine with no agent at all reports `agent: idle`.

SHARED-033 makes `idle` a claim requiring evidence. This issue puts the evidence
on the wire.

## Acceptance Criteria

- [ ] `QueueStatus` carries when the server last observed agent contact — a
      nullable instant, absent when the server has seen none since starting
- [ ] The field is documented as **what the server observed**, not as a heartbeat
      the agent sends: nothing new is asked of the agent, and the existing parked
      long-poll is the signal
- [ ] The window that separates connected from disconnected is **derived from
      `DEFAULT_IDLE_TIMEOUT_SECONDS`** (currently 480 s) and exported alongside
      it, not written as a literal in the UI. A parked agent re-contacts the
      server at least that often, so the threshold must move if the timeout does
- [ ] Whether the contract exports a **derived state** (`working | idle |
      disconnected | halted`) or leaves the UI to compute it from the timestamp
      is decided here and documented — one place must own the rule, and two
      consumers already exist (the pill, and any plugin reading queue status)
- [ ] `openapi.json` regenerates with no diff, and the drift check passes
- [ ] Existing consumers keep compiling — the field is additive
- [ ] Schema round-trip tests cover the absent case as well as the present one

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/queue.ts` — the `QueueStatus` shape, beside
  `DEFAULT_IDLE_TIMEOUT_SECONDS` / `MAX_IDLE_TIMEOUT_SECONDS` (line 332)
- the generated `openapi.json` and typed client (regenerated, not hand-edited)

### Key Implementation Details

Prefer **timestamp on the wire, rule in the contract**: a raw instant plus an
exported helper that answers `disconnected` given a clock. A precomputed enum
would be stale by the age of the response, which for a 10-minute window is
usually harmless and occasionally exactly wrong — and it would make the pill
unable to re-evaluate between polls.

Name the field for what it is. Something like `lastAgentContact` is honest;
`agentAlive` would assert a liveness nobody verified.

### Edge Cases

- **No contact since server start** — absent/null, and the UI must render that as
  disconnected rather than as "unknown, assume fine"
- **A server restart while an agent is parked** — the long-poll drops and the
  agent re-parks within the timeout, so the field refills on its own. Confirm
  nothing needs persisting across restarts, and say so
- Clock source: server-side only, so a client cannot influence it

## Testing Strategy

Vitest: schema round-trips with the field present and absent; the derived-state
helper (if the decision puts it here) across the boundary — just inside the
window, just outside, and never-contacted.

## E2E Verification Plan

### Verification Steps

1. `npm run generate -w packages/contract` from a clean tree — no diff
2. Start the server; `curl` the queue status endpoint with no agent running —
   confirm the field is absent/null and the response validates
3. Run `corpus queue idle` in another terminal; `curl` again — confirm the field
   is populated
4. Confirm the typed client exposes it to both `apps/ui` and `apps/cli` without
   a cast

## E2E Verification Log

_[Agent fills: model run on, commands, observed output, and the
timestamp-vs-derived-state decision with its reasoning.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] `openapi.json` regenerated, drift check clean
- [ ] E2E verification log filled in
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-045]` prefix
