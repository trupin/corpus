# [SERVER-115] Six emitters never name `["agents"]`, and this release is what makes them bite

## Domain

server (contract-coordinated)

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-055 (the published `emittedBy` for `["queue"]`)
- Blocks: nothing formally — but see below, it should land **with or before**
  UI-108/UI-109
- Related: SERVER-114 (the same defect shape, found first), CONTRACT-045

## Spec References

- SPEC.md **§7** — *"Who is running is a **read**, never a push"*
- SPEC.md **§9.4** — invalidate keys

## Summary

`SERVER-114` fixed one emitter that failed to name a key the changed fact is
cached under. Its sweep found **six more of the same shape**, all in the same
direction: a fact that changes what `GET /api/agents` would answer, emitted
without ever naming `["agents"]`.

| Where | What changes about the roster |
| --- | --- |
| `queue/project.ts:39` | queue transitions — the roster's `summary` reads the same `events` / `jobs.last_line` |
| `watcher.ts:463` | job-log appends — same `summary` |
| `docs/write.ts:1195` | a designated thread's title changes |
| `projection/routes.ts:52` | projection rebuild (also the boot catch-up path) |
| `watcher.ts:291` | out-of-band thread edits |
| `watcher.ts:457` | out-of-band queue-event file moves — **a second copy of `QUEUE_QUERY_KEYS`** |
| `docs/delete.ts:104` | deleting a designated root thread |

**They are latent only because nothing caches `/api/agents` yet**, and that is
precisely why this is P0 rather than backlog: `UI-108` (the composer offers the
recipient) and `UI-109` (the board shows who is resident, and who is live) are
**in this release**, and both exist to put the roster on screen. The day either
lands a cached `useAgents`, all seven rows above become live staleness bugs —
a recipient picker that keeps offering an agent that left, a board that keeps
showing a resident whose thread was deleted.

So the choice is to fix them now or to ship the feature and the bugs together.

**Note the trap at `watcher.ts:457`**: it is a *second copy* of
`QUEUE_QUERY_KEYS`, so fixing the shared constant would silently miss it. That
duplication is worth removing as part of this, not merely working around.

## Why it is contract-coordinated

Adding `["agents"]` to `QUEUE_QUERY_KEYS` rewrites the frame of every queue
transition, and contradicts the contract's published `emittedBy` for that key.
The vocabulary has to say the new truth first, or the server and the published
description disagree — which is exactly the drift `CONTRACT-052` spent a pass
cleaning up in a different corner.

## Acceptance Criteria

- [ ] Every listed emitter names `["agents"]` where it changes what the roster
      would answer, and does not where it does not — a blanket addition that
      makes unrelated writes re-read the roster is a different defect
- [ ] The duplicate `QUEUE_QUERY_KEYS` at `watcher.ts:457` is removed in favour
      of the shared constant, or the duplication is justified in a comment
- [ ] `CONTRACT-055` lands the vocabulary change; the server does not ship a
      frame the published description denies
- [ ] Tests assert the **whole key list** at each site, as SERVER-114's does —
      "something was emitted" is what let this survive
- [ ] Each test checked red against the current emit

## Technical Design

### Files to Create/Modify

The seven sites above, their tests, and `apps/server/src/queue/index.ts` (the
shared constant).

### Notes

`SERVER-114` established the rule to apply: *an emit names every key a route
carrying the changed fact is cached under, not the key of the route the fact is
named after.* Every row here is a failure of that one rule.

## Testing Strategy

Per-site unit assertions on the emitted key list. If an integration test can
show a roster going stale and then not, it is worth more than any of them.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-115]` prefix
