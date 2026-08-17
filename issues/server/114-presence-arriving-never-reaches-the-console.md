# [SERVER-114] An agent arriving never reaches the console — presence invalidates the wrong key

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-112 (which wired the emitter)
- Related: CONTRACT-045 (whose stated rationale this breaks), UI-098 (which
  measured it), CONTRACT-053

## Spec References

- SPEC.md **§7** — *"Who is running is a **read**, never a push: the roster and
  each lane's liveness are read behind the ordinary invalidate keys (§9.4), like
  any other projection."*
- SPEC.md **§9.4** — invalidate keys

## Summary

`apps/server/src/app.ts:378` binds `onPresenceChanged → invalidate([AGENTS_KEY])`.

Since `CONTRACT-045`, presence is **also** carried on `GET /api/queue/status`,
and the console reads it from there. `useQueueStatus` is `staleTime: Infinity`
with no refetch on focus or reconnect, so an invalidation that names only
`["agents"]` never causes the queue status to be re-read.

**Measured by UI-098 against a real server**: a page showing `agent:
disconnected`, an agent parked underneath it, the server answering
`live: true` — and the pill **still read `disconnected` 150 seconds later**,
with one status request in the whole interval. It corrects on the next read of
the queue for any other reason: a reload, or any queue transition. Both were
observed.

**This makes v0.10.0's headline feature invisible in the ordinary case.** The
whole point of the presence work is that a person can see who is live; an agent
that connects and is not shown until something unrelated happens is the feature
not working. A *departure* is unaffected — the client expires a stale `live` on
its own 960 s window, which is why UI-098's departure test passed and this went
unnoticed.

The sharpest way to put it: `CONTRACT-045`'s own stated rationale for putting
presence on the queue status is that the strip refetches "on every `["queue"]`
invalidation". **The emitter does not honour that premise.**

## Acceptance Criteria

- [ ] An agent parking is visible to a console that is already open, without a
      reload and without waiting for an unrelated queue transition
- [ ] The fix is on the **emitter**, not in the UI. UI-098 deliberately did not
      work around it by reading the roster instead, because that would put
      `QueueStatus.agent` and `GET /api/agents` on one surface, which
      CONTRACT-053 records can legitimately disagree for a grace window
- [ ] A test that fails against the current single-key emit — assert the keys
      emitted, not merely that something was emitted
- [ ] **Sweep for the same shape elsewhere**: any other place a fact is carried
      on two routes but invalidated on one key. This one was found by measuring
      a UI, which is not a search. Report what the sweep covered even if it
      finds nothing
- [ ] Nothing about presence travels over SSE as data — §7 is explicit that it
      is a read, never a push, and the fix must stay an invalidation

## Technical Design

### Files to Create/Modify

- `apps/server/src/app.ts` — the `onPresenceChanged` binding
- the corresponding test

### Notes

The suggested fix is `invalidate([AGENTS_KEY, QUEUE_KEY])`. Confirm that is
sufficient rather than assuming: check what key `useQueueStatus` actually holds,
and whether any other consumer of presence reads a third key.

## Testing Strategy

Unit on the emitter's key list. If an integration test can observe a parked
agent becoming visible without a reload, that is worth more than the unit test
and should exist too.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first — this is a bug._

## Completion Checklist (domain agent)

- [ ] Reproduction logged before the fix
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-114]` prefix
