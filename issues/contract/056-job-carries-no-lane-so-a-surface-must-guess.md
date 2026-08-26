# [CONTRACT-056] `Job` carries no lane, so a surface showing "who is waiting on this" has to guess

## Domain

contract (then server, then ui)

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-109 (which found it and worked around it in display only),
  SERVER-111 (the lane stamp), CONTRACT-051

## Spec References

- SPEC.md **§7** — *"Two kinds of event do not take the lane of the scope they
  fall in"*: a message that named a recipient takes that recipient's lane, and a
  `resident.designated` takes the orchestrator's lane whoever is designated

## Summary

`SERVER-111` stamps every event with its lane, and the projection mirrors
events into jobs — but **`Job` (`packages/contract/src/schemas/job.ts`) carries
no lane**. `UI-109`'s issue assumed the mirror had put one there. It had not.

So a surface that wants to say *who is waiting on this* has to re-derive the
lane by walking the scope, and **the walk is wrong for exactly the two cases §7
carves out**:

- a `resident.designated` event, which takes the **orchestrator's** lane
  whoever is designated — because a resident does not announce itself to itself
- a message that **named a recipient**, which takes that recipient's lane

`UI-109` saw the first one live: for the seconds after designating a thread, the
card reads *"waiting for researcher"* about an event **the orchestrator holds**.

**This is display only and never routing** — the server stamps the lane and
routes on it, and no client decision depends on the walk. So it is a wrong
sentence, not a misrouted event, which is why it is P1 rather than P0 and why it
was documented at the head of `PendingIndicator.tsx` rather than worked around
with a special case.

## Why the fix is a contract change rather than a UI one

The client cannot compute the answer. The two carve-outs are facts about how the
event was *enqueued* — which recipient it named, and what kind of event it is —
and the second is not recoverable from the scope at all. Re-deriving a value the
server already holds is the shape of the whole class of bugs this release spent
its time on: `SERVER-114`'s invalidation, `CONTRACT-052`'s descriptions, and
`SHARED-044`'s two routes into one scope are all one fact stated twice and
allowed to drift.

## Acceptance Criteria

- [x] `Job` carries its event's lane, as stamped — not a derivation
- [x] The projection mirrors it (`SERVER-111` already stores `events.lane`, so
      this is a mirror, not a new fact)
- [ ] `UI-109`'s scope-walk fallback in `PendingIndicator.tsx` is removed — the
      consumer half, **UI-176**
- [x] A test covers **both** carve-outs, since they are exactly what the walk
      gets wrong: a `resident.designated` reads as the orchestrator's, and a
      recipient-named message reads as the recipient's
- [x] `openapi.json` regenerated and swept structurally, per CONTRACT-052's
      discipline

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/job.ts`
- `apps/server` — the projection's job mirror
- `apps/ui/src/thread/PendingIndicator.tsx` — remove the fallback

### Notes

Three domains, so this is likely three issues under one dependency chain rather
than one. Split it at the seams when it is scheduled.

## Testing Strategy

Contract: schema and generation. Server: the mirror, with both carve-outs.
UI: the pending row reads the field rather than walking.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26. Wire half only; the server
fills it in SERVER-156 and the consumer drops its walk in UI-176.

### The description carries the argument, because the next reader will re-derive it

A field that simply appeared would be computed again by whoever came next — the
walk *looks* right, and is right for the ordinary event. So the published prose
names both carve-outs and says which one settles it:

> the walk cannot be made right, it can only be replaced

`resident.designated` could in principle be special-cased by a client that knew
the rule. A message that **named a recipient** could not: the recipient is a fact
about how the event was enqueued and is not in the scope at all. That is the half
that makes this a contract change rather than a client fix, and a test pins the
sentence.

### And what it is not

**Display material, never routing.** The server stamps the lane and claims on
it; nothing a client decides changes where an event goes. What this fixes is a
surface saying *waiting for researcher* about work the orchestrator holds — a
wrong sentence, not a misdelivered event. Pinned, because a reader who thought
this steered delivery might try to change it.

**One reading of a missing stamp, not two.** An event written before lanes
existed reads as the orchestrator's, exactly as the claim path reads it.

### Falsification

Softening the unrecoverable-carve-out sentence:

```
× names both carve-outs, and which of them cannot be worked around
  Tests  1 failed | 3 passed
```

### Checks

```
vitest run packages/contract      3008 tests passed   exit 0
eslint packages/contract/src         0 errors         exit 0
generate (openapi.json + client)     clean
```
