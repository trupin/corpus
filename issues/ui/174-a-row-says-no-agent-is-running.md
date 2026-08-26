# [UI-174] A row says no agent is running, not merely that work is queued

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-087, SERVER-155
- Blocks: —

## Spec References

- SPEC.md §8 — the pending-indicator rider, amended 2026-08-25: _"where the lane
  has no listener running, the row says **that**, and not merely that the work is
  queued: an agent that is not running is the reason nothing is happening, and it
  is the one thing a person can act on."_
- SPEC.md §7 — rider C: _"§7 owes a person a signal saying that in those words
  rather than leaving them to infer it from a lane that is merely not live."_

## Summary

Until rider C, a message waiting on a lapsed lane was picked up by the
orchestrator eventually, so "waiting to be picked up" was the whole truth.

**Now it is not.** With no fallback, a message on a lane whose listener is not
running waits indefinitely, and the only thing that changes it is a listener
starting. A row that still says "waiting to be picked up" would be describing a
temporary state that is not temporary.

## Acceptance Criteria

- [ ] A pending row on a lane with **no listener running** says so, in words
      about the agent rather than about the queue
- [ ] It is distinguishable from **three** other states, which §8 already
      separates: queued and claimable, being worked, and this one
- [ ] The elapsed clock keeps running from when the request was written, as §8's
      2026-08-12 rider requires. The wait is the wait
- [ ] **No fake diagnosis.** The UI says an agent is not running; it does not
      guess why, and it does not tell the person to go and start one unless the
      product actually gives them a way to
- [ ] The Residents tab (§11's console drawer) shows the pending count beside
      each lane's liveness, since that pairing is the whole signal
- [ ] Nothing resizes as a count arrives or changes (§10)
- [ ] The wording is checked against the one thing rider C's own text worries
      about: this must read as a fact a person can act on, never as the app
      apologising

## Technical Design

### Files to Create/Modify

- the pending indicator (§8) wherever it renders a waiting request
- the Residents tab in the console drawer
- `packages/kit/src/recipient/laneRows.ts` — the roster rows, which gain
  `pending`

### Key Implementation Details

`live` and `pending` are two fields and the message needs both. `live: false`
alone is not the condition — a lane with no work and no listener is idle and
perfectly healthy, and saying anything about it would be noise.

The condition is exactly **`pending > 0 && !live`**, which is the same pair
AGENT-053 launches from. Derive it once in `@corpus/kit` so the board and the
drawer cannot disagree.

### Edge Cases

- A listener between parks reads `live: true` because the grace window is applied
  server-side. Do not re-derive liveness in the client.
- The orchestrator's own lane: it is always the one running the UI's own work, and
  a "no agent running" badge on it means the whole workspace is stopped. Decide
  whether that is worth saying differently, and say which you chose.

## Testing Strategy

Unit tests over all four states, and over the `pending > 0 && !live` derivation
in kit. Falsify by keying the message on `live` alone and watching the
idle-and-healthy case go red.

## E2E Verification Plan

Real app with a real server: designate a thread, post a turn with no listener,
and read the row. Start a listener and read it again. Screenshot both.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-174]` prefix
