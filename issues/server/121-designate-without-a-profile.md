# [SERVER-121] Designate a resident without naming a profile

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-061
- Blocks: UI-122, CLI-049, AGENT-033

## Spec References

- SPEC.md **§7** — the SHARED-048 rider
- SPEC.md **§9.2** — `POST /api/threads/:id/resident`, `GET /api/agents`

## Summary

Accept a designation that names no profile, store it, put it on the roster, and
carry it in `resident.designated` — with **every other resident behaviour
unchanged**, which is the load-bearing half of this issue.

`apps/server/src/threads/resident.ts:179` resolves `request.name` through
`resolveMentionTarget` and refuses when it misses. A general designation never
reaches that lookup at all; a **named** one still must, and must still refuse.

## Acceptance Criteria

- [ ] A designation naming no profile succeeds on a standalone thread and makes
      the thread a lane
- [ ] A designation naming a profile behaves exactly as it does today, including
      the `404` for a name that resolves to nothing
- [ ] The thread's frontmatter records a general residency in a form that
      round-trips through the projection and is legible on disk to a person
      reading the markdown
- [ ] `GET /api/agents` lists the lane with a general resident, `live` computed
      exactly as it is for a profiled one
- [ ] `resident.designated` is enqueued on the **orchestrator's** lane as today,
      carrying whatever CONTRACT-061 defined for a general resident
- [ ] Lane routing, scope walking, presence, the grace-window fallback, release,
      and **resolution releasing the resident** are provably unchanged — each
      covered by a test that would fail if a general resident took a different
      path
- [ ] `assertRecipientResolvable` / `assertScopeIsLane` treat a general-resident
      lane as a lane: `isDesignatedRoot` currently requires
      `resident_name IS NOT NULL`, which a general residency must still satisfy
      or presence and recipients silently break

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — the designate path
- `apps/server/src/core/resident.ts` — the resident value read off frontmatter
- `apps/server/src/projection/schema.ts` + the document projector — how a
  general residency is stored in `threads.resident_name` / a sibling column
- `apps/server/src/agents/roster.ts` — the roster row
- `apps/server/src/queue/scope.ts` — `isDesignatedRoot`'s predicate

### Key Implementation Details

**The projection column is the sharp edge.** `isDesignatedRoot` asks
`resident_name IS NOT NULL`, and three separate things lean on it: the lane
predicate, `assertRecipientResolvable`'s `422`, and `assertScopeIsLane`'s refusal
of a park on a non-lane. Whatever represents "designated, no profile" **must
make that predicate true**. Decide deliberately between a reserved column value
and a second column, and write down which and why — a `NULL` name with a
separate `designated` flag is the shape that keeps "is a lane" and "has a
profile" as the two independent questions they now are.

**Do not let a general resident borrow a fake name.** If the projection stores
a sentinel string in `resident_name`, that string reaches the roster, the
composer's recipient list and the board badge, and will be indistinguishable
from a real agent-def with the same title.

**Frontmatter must stay hand-editable.** §7 calls designation *"user-only state
on the thread, set and released like any other thread field"*, and
`packages/contract/src/schemas/extra.ts:70` already reserves `resident`. A
person opening the markdown should be able to tell a general residency from a
profiled one without consulting the code.

### Edge Cases

- **Replacing in both directions** — general → profiled, profiled → general.
  Single-valued replacement, one write, one commit.
- **Releasing a general resident** — `DELETE` is idempotent as today.
- **Resolving the thread** releases a general resident with it
  (`threads/status.ts:45`), and the release must be visible on the roster.
- **A parented thread** is still refused, profile or no profile.
- **An in-flight park on a lane whose residency went general** keeps its park —
  `assertScopeIsLane`'s documented rule that presence is asked at the request
  and never re-asked of one already admitted.

## Testing Strategy

Route tests for both designation shapes and both refusals. Projection tests that
`isDesignatedRoot` is true for a general residency. Queue tests that an event in
a general-resident scope is stamped with that lane, that a scoped claim sees it,
and that an unscoped claim does not while the lane is live. A release/resolve
test asserting the lane leaves the roster. **Falsify each: break the general
path and watch the specific test go red** — several of these would pass against
a server that quietly routed general residents to the orchestrator.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a throwaway workspace on a port that is **not 8765 and not
   5173**; start the real server
2. `corpus thread create`, then designate with no profile through the real HTTP
   route
3. `GET /api/agents` shows the lane; the thread's markdown on disk shows the
   residency; `git log` shows the auto-commit
4. Post a message in the thread; `corpus queue claim-all --scope <th_…>` sees it
   and an unscoped claim does not
5. Resolve the thread; the lane leaves the roster
6. Repeat 2–5 with a **named** profile and confirm the behaviour is identical
7. Stop the server and confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-121]` prefix
