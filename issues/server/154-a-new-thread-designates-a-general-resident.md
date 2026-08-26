# [SERVER-154] A new standalone thread designates a general resident

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-088
- Blocks: —

## Spec References

- SPEC.md §7 — rider A signed 2026-08-25, including: _"The designation costs
  nothing until there is work. A listener is started when its lane has something
  pending and none is running, not when the thread is created."_
- SPEC.md §10 — rider B signed 2026-08-25

## Summary

Implements CONTRACT-088. `POST /api/threads` with no parent, and
`POST /api/capture`, designate a general resident unless the caller chose
otherwise.

**Nothing here starts a listener.** Rider A's lazy-launch clause makes the
designation a thread field and nothing more; AGENT-053 is what starts listeners,
from the pending count. Building a launch here would be a second launcher beside
the orchestrator's.

## Acceptance Criteria

- [ ] A standalone thread created with no designation stated gets a **general
      resident** — no profile, per §7's _"naming none is the ordinary case and
      requires nothing to exist first"_
- [ ] An explicitly stated **none** creates a thread with no resident
- [ ] A named profile is designated, with §7's existing missing/archived rules
      unchanged — do not re-decide them
- [ ] A thread **with a parent** is refused, naming the rule
- [ ] `POST /api/capture`'s filing thread is designated the same way
- [ ] `resident.designated` is enqueued exactly as it is for an explicit
      designation, on the **orchestrator's** lane (§7). This is what lets
      AGENT-053 learn a conversation exists at all
- [ ] **No listener is started by this code path**, and a test asserts it: rider
      A's lazy clause is load-bearing, and a launch here would run one agent per
      thread created
- [ ] The response carries the designation made

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts`
- the capture route's thread creation
- the designation write, which already exists for `POST /api/threads/:id/resident`
  and must be **reused rather than reimplemented**

### Key Implementation Details

The designation write already exists. Call it from creation in the same
transaction as the thread write, so a created thread is never briefly resident-less
— a window in which the orchestrator would see its events as unowned.

**One `resident.designated` per designation**, whether it came from creation or
from the explicit route. Two shapes of the same event would give AGENT-053 two
cases to handle for one fact.

### Edge Cases

- A capture that creates several documents and one filing thread: only the thread
  designates.
- Creation refused after the designation was written: one transaction, or the
  designation must not survive.

## Testing Strategy

The three states, the parent refusal, the capture path, and the no-listener
assertion. Falsify the last by starting a listener in this path and watching it
go red.

## E2E Verification Plan

Real server: `corpus thread create` (or the Ask route) with each of the three
states, then read the thread and the roster. Confirm a resident exists, that
`resident.designated` landed on the orchestrator's lane, and that **no listener
is running** — the roster's `live` is false and stays false.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-154]` prefix
