# [CONTRACT-057] A roster row cannot say a lane is working, so a reader has to guess or parse prose

## Domain

contract (server work follows in its own issue)

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Related: AGENT-029 (the defect that surfaced this), SERVER-112, CONTRACT-045
- Blocks: a server issue to populate the field (file when this lands)

## Spec References

- SPEC.md **§7** — *"Presence is the parked request, and nothing else"*
- SPEC.md **§7** — the lapse fallback and its grace window

## Summary

`AgentLane.live` is false for three different situations and a reader cannot tell
them apart: a listener that crashed, a listener the server has not observed since
it restarted, and **a listener in the middle of a turn**. The third is not an
edge case — §7 has a resident work its conversation inline, and the converse
skill tells it to await what it launches rather than park on it, so a turn longer
than the grace window is designed behaviour, and while it runs the lane reads
`live: false`.

The roster already computes the distinction. `apps/server/src/agents/roster.ts`'s
`workSummary` reads the lane's held work out of the projection and renders
`working <title>` for a lane holding an in-progress event, against `idle — last
active …` for one holding none. But it renders it into `summary`, whose contract
text says the opposite of what a decision needs:

> **The contract promises its bound and nothing about its content**: … how it is
> derived may change without a contract change. So it is for display only — a
> client must never parse it, key on it, or decide anything from it, **and
> everything a client needs to decide from is a field of its own on this row**.

That last clause is this issue. A caller that must decide something from "is this
lane working" has no field to decide from, and the only available signal is one
the contract forbids reading. AGENT-029 hit this as a real defect (the
orchestrator launching a second listener into a lane whose listener was mid-turn)
and repaired it at the lane instead, because a skill may not parse `summary`.
That repair is sound and stays; this field would let the launch stop being
speculative in the first place, and would give the UI a truthful third state.

## Acceptance Criteria

- [x] `AgentLaneSchema` publishes a structured field for "this lane is holding
      work it claimed" — a boolean, or a count, decided in the issue
- [x] Its description states what it is derived from and, explicitly, that it is
      **not** presence: a lane may hold work and not be live, which is exactly
      the case the field exists for
- [x] It states the one asymmetry a consumer must not get wrong — a lane holding
      work is *not* evidence a listener is alive, since a listener that died
      mid-event leaves its event held until `reap-stale` requeues it, so the
      field bounds a launch decision. ~~and must never suppress the §7 fallback~~
      — **that clause is stale**: v0.23.0 removed the fallback, so what it must
      never suppress is a *launch*, which is stricter and is what shipped
- [x] `summary`'s "everything a client needs to decide from is a field of its own
      on this row" is still true after this lands
- [x] The OpenAPI document is regenerated and the drift check passes

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — the new field on `AgentLaneSchema`
- `packages/contract/src/schemas/agents.test.ts` — its shape and its nullability
- `packages/contract/openapi.json` (generated) — regenerated

### Key Implementation Details

The field belongs on the roster row and **not** on `AgentPresence`. Presence is
published at two grains from one object (CONTRACT-045) and is defined by §7 as
the parked request; adding a work fact to it would make the console pill and the
recipient picker answer a question neither asks, and would put a second thing
inside a schema whose whole value is that both sites carry the identical one.

`live` is unchanged and keeps its meaning exactly. The new field is a sibling
observation, and the pair `{live: false, working: true}` is the state the whole
issue is about — it must be representable and must read naturally.

Do not name it after presence (`active`, `busy-live`, `here`). It says what the
lane is holding, not who is on it.

### Edge Cases

- **A lane holding work whose listener died.** The field is true and no listener
  exists. That is why it may only *inform* a launch, never suppress the fallback
  — which is claim-time and unaffected by this field.
- **The orchestrator holding a lapsed lane's work under the fallback.** Those
  events are stamped with that lane and are what `workSummary` already reads, so
  the field would be true for a lane whose listener is genuinely gone. The
  description has to say so: it is a fact about the lane's events, not about any
  agent.
- **The orchestrator's own row.** It has held work almost always; the field is as
  meaningful there as anywhere, but no consumer decides a launch from it.

## Testing Strategy

Schema unit tests in `agents.test.ts`; the OpenAPI snapshot/drift check.

## E2E Verification Plan

Against a real server: designate a resident, park a listener, post a message,
claim it scoped, and hold it without settling for longer than the grace window.
The row must read `live: false` with the new field true, and reading it must
answer the question `summary` currently answers in prose.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26. Wire half; SERVER-157
computes it, CLI-071 prints it, AGENT-055 decides from it.

### The issue's own criterion had gone stale, and the correction is stricter

It required the field "must never suppress the §7 fallback". **There is no
fallback** — v0.23.0 removed it. What the field must never suppress is a
**launch**, and that is a harder requirement than the one filed: under the
fallback a wrongly-suppressed launch cost warmth, because the orchestrator would
have done the work. Now it costs the answer.

So the published description states the asymmetry in those terms: a listener
that died mid-event leaves its event held until `reap-stale` requeues it, so
`working: true` **outlives the agent that earned it**, and the field bounds a
launch decision rather than asserting presence.

### Three fields, one decision

`live` answers *is anybody there*, `pending` answers *is anybody waiting*, and
`working` answers *is anything being done*. The description says which is which
and that all three are needed, because a reader who took one for the whole would
either launch onto a busy agent or never launch onto a dead one.

### `summary` keeps its promise, and a test says so

The roster already computed this and rendered it into `summary`, whose contract
forbids deciding from it. Lifting it out is what makes that promise true rather
than aspirational — so a test asserts `summary` still reads *"everything a
client needs to decide from is a field of its own on this row"* after this
landed, since that sentence is now describing something real.

### Falsification

Cutting the outlives-the-agent warning:

```
× says it is never evidence anybody is there, and why
  Tests  1 failed | 4 passed
```

### Checks

```
vitest run packages/contract      3013 tests passed   exit 0
eslint packages/contract/src         0 errors         exit 0
generate (openapi.json + client)     clean
```
