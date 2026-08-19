# [SERVER-129] A designation stores and reports its weight

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-067
- Blocks: CLI-053, UI-125, UI-126, AGENT-039
- Related: SHARED-055 (signed 2026-08-19)

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per message"* (rider signed 2026-08-19)
- SPEC.md **§7** — the weight rider: a stated weight is honoured, never substituted

## Summary

CONTRACT-067 lets a designation carry `weight`, a weight **level key** from the workspace's own tier table, and `Resident` reports it. This is the server half: the designate route accepts it, the thread's frontmatter stores it, every `Resident` the server returns (thread, thread summary, roster row) reports it, and the `resident.designated` event payload carries the same `Resident` so the orchestrator launches the listener at that weight (AGENT-039).

**Decided by the orchestrator, 2026-08-19:**

- The stored shape is `resident.weight` in the thread's frontmatter beside `name` and `docId` — one key, absent when none was chosen. `null` on the wire means *none chosen, the listener runs at whatever the launcher picks*.
- The server **does not validate the key against the tier table**. The table is the workspace's own skill text, which the server never reads (it is read client-side by `@corpus/kit`). The server stores what the contract's `RequestedWeightSchema` accepts, as it already does for a message's `weight`. A level that no longer exists is the launcher's to report, per §7's weight rider — CONTRACT-067 decision 4.
- Re-designating the **same** profile with a **different** weight is a write, not a no-op: the resident's weight changed. Today `ResidentChange.result` is null for a re-designation of the same agent; it must be non-null when the weight differs, and the event is enqueued, because the listener has to be relaunched at the new weight.

## Acceptance Criteria

- [ ] `POST .../resident` with `weight` stores it; `GET` on the thread, the thread summary, and `GET /api/agents` all report it on `Resident.weight`
- [ ] Omitting `weight` stores none and reports `null` — an existing designation file with no key reads back as `null`
- [ ] The `resident.designated` event payload's `resident` carries `weight`
- [ ] Same profile, different weight: written, event enqueued. Same profile, same weight: the existing no-op
- [ ] Release removes the key with the rest of the `resident` block
- [ ] Falsified: drop the frontmatter write and the report test goes red

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — `toFrontmatter`-style writer at `:147-150`, the no-op comparison near `:226`
- `apps/server/src/threads/read.ts` — `storedResident`, `currentResident`
- `apps/server/src/core/resident.ts` — the stored-shape parser
- `apps/server/src/agents/roster.ts` — roster rows
- tests beside each

### Key Implementation Details

Read `resident.ts`'s docblock on re-designation and `read.ts:170`'s re-resolution. `weight` is **stored, not re-resolved** — unlike `docId`, it is the person's choice and has nothing to resolve against.

### Edge Cases

- A thread whose frontmatter `resident` block has `weight` but no `name` — a general resident with a weight, legal
- A legacy block with unknown keys — whatever `storedResident` does today for unknown keys stays

## Testing Strategy

Route tests through the real Hono app against a temp workspace, in the shape `resident.test.ts` uses.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate with `--weight heavy` (via curl or CLI-053); `GET /api/threads/<id>` shows `resident.weight: "heavy"`; `GET /api/agents` shows it on the lane
3. `corpus queue claim` (or read the event) — payload carries the weight
4. Designate without a weight — `null`
5. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-129]` prefix
