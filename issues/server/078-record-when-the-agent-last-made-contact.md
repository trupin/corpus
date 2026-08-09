# [SERVER-078] The server does not record that an agent is there

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 2 (rider must be signed first), CONTRACT-045
- Blocks: UI-098

## Spec References

- SPEC.md §7 — the queue, and the long-poll idle endpoint
- SPEC.md §11 line 469 — the agent pill, as amended by SHARED-033
- SPEC.md §9.2 — queue status

## Summary

The server already sees every proof of life an agent gives: `corpus queue idle`
parks against it at least every `DEFAULT_IDLE_TIMEOUT_SECONDS` (480 s), and
`claim-all` and the other verbs arrive as the loop runs. It records none of it,
so `QueueStatus` cannot answer "is anyone out there" and the UI guesses.

This issue records the contact and serves it in the status CONTRACT-045 defines.

## Acceptance Criteria

- [ ] The server records the time of the most recent agent contact, in memory
- [ ] **The parked long-poll counts as contact when it arrives**, not only when
      it returns — an agent parked for eight minutes is present for all eight,
      and a rule that only counted returns would flap every cycle
- [ ] The other agent-driven queue verbs (`claim-all`, `status`, the transition
      verbs) also count as contact — the agent working a job is not less present
      than one parked
- [ ] Contact is attributed to **the agent**: a request from the UI or a person's
      CLI invocation must not mark the agent present. Use the acting party the
      queue routes already carry; if some agent path carries none, that is a
      finding to report, not to paper over
- [ ] `GET` of the queue status serves the field per CONTRACT-045
- [ ] The value survives concurrent parked waiters without races
- [ ] Nothing is persisted across restarts, and a fresh server reports no contact
      until an agent arrives — an agent that is still parked will re-park within
      the timeout and refill it on its own
- [ ] No new endpoint, no new polling, and nothing new asked of the agent

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/service.ts` — `idle()` (line 273) and the claim path;
  the service already holds the waiters and is the natural owner
- `apps/server/src/queue/waiters.ts` — the parking lot, if contact is best
  recorded where a waiter registers rather than at the route
- `apps/server/src/queue/routes.ts` — the status response

### Key Implementation Details

Record on **arrival**, at the point the request is accepted, rather than on
completion. `waiters.ts` is where a request becomes a parked waiter, which is the
moment that proves an agent is alive; the return, up to eight minutes later,
proves only that it was alive when it started.

The service's docblock (line 263) notes the agent's loop is `idle → claim-all`,
so both halves of that loop should count. Treat this as "any agent-attributed
queue request refreshes contact" rather than enumerating verbs, so a verb added
later does not silently stop counting.

Keep it in memory. This is liveness, not history: a value that survived a restart
would assert an agent was present based on evidence from a previous process.

### Edge Cases

- **Two agents** — contact is contact; the field says an agent is present, not
  how many. Do not attempt a session count here
- **A parked waiter aborted by client disconnect** — the contact already
  happened; do not roll it back
- **An agent that claimed work and stopped contacting** — the pill will still say
  `working` because `inProgress > 0`. SHARED-033's edge-case list flags this as a
  decision; implement whatever that rider settled, and if it settled nothing,
  report it rather than inventing a rule
- Clock: server monotonic/wall time only, never a client-supplied stamp

## Testing Strategy

Vitest against the real service: a parked `idle` request sets contact at
registration; a `claim-all` sets it; a UI-attributed request does not; concurrent
waiters leave one coherent value; a fresh service reports none. Assert the status
response carries what CONTRACT-045 specifies.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` with no agent running
2. `curl` the queue status
3. Expected: something distinguishing "no agent has been seen" from "an agent is
   here with nothing to do"
4. Actual: neither is representable

### Verification Steps

1. Restart the server; `curl` queue status — confirm no contact recorded
2. Run `corpus queue idle` in another terminal; `curl` again **while it is still
   parked** — confirm contact is recorded now, not only after it returns
3. Post an `@agent` comment so the park returns; run `claim-all`; `curl` — confirm
   contact refreshed
4. Stop the agent; wait past the window; `curl` — confirm the timestamp has not
   moved
5. Drive the UI hard (open documents, edit, search) with no agent running —
   confirm contact stays unrecorded, i.e. the UI cannot fake an agent
6. Restart the server with an agent still parked — confirm it refills within the
   long-poll timeout without intervention

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Pre-fix reproduction logged
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-078]` prefix
