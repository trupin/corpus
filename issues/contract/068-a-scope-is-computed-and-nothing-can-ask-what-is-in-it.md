# [CONTRACT-068] A scope is computed, and nothing can ask what is in it

## Domain

contract

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-125
- Related: SERVER-111 (which computes scope at enqueue time)

## Spec References

- SPEC.md **§7** — a resident owns its thread's whole **scope**: the thread, its
  subthreads, and every artifact whose provenance walks back to it
- SPEC.md **§7** — membership is **computed, never stored**; nothing carries a
  scope marker
- SPEC.md **§9.2** — the HTTP API

## Summary

Requested by the user, 2026-08-19: *"There's nowhere I can see the list of active
agents and what is their scope. I want… the designated agents as well as what
documents / threads are attached to their scope."*

The roster half exists: `GET /api/agents` lists designated lanes, and
`corpus agents` prints them. **The scope half does not exist at any layer.**

§7 makes membership computed rather than stored — nothing carries a marker, and
it is derived by walking `origin` and `parent`. The server does this at **enqueue
time**, for one artifact, to decide which lane an event belongs to
(`apps/server/src/queue/scope.ts`). Nothing walks the other direction: *given a
lane, what is in it?*

So the question the user is asking has no answer to return.

## Why this is the hard half of UI-125

The console tab is a view. This is the thing it would view, and it does not
exist. Filing them together would hide that.

**And the direction matters.** The existing walk is cheap because it climbs from
one artifact to its lane — bounded by the depth of the graph. The inverse is a
search over every document and thread whose provenance *might* reach a given
thread, which is a different cost and a different implementation.

## What to decide

1. **Is it a query or a projection?** Computing it per request keeps §7's
   "computed, never stored" literally true. A projected membership table would be
   fast and would be the stored marker §7 forbids — unless it is understood as a
   cache that `db rebuild` reconstructs, which is what the projection already is
   for everything else
2. **What does it return?** Ids and titles, or full rows? §7's retrieval
   discipline says one frugal line per hit and never a body, and a scope listing
   should follow it
3. **Is it bounded?** A long-lived conversation's scope grows without limit. A
   listing with no bound is the enumeration §7 forbids the agent from doing
4. **Does the agent get it too, or only the board?** A resident asking "what do I
   own" is a reasonable question, and it is the same endpoint

## Acceptance Criteria

- [ ] Given a designated thread, the API answers what is in its scope
- [ ] The answer is derived by the **same walk** the queue routes with, not a
      second implementation — `scripts/mention-offer-parity.test.ts` is the
      precedent for what happens when one rule gets two implementations
- [ ] It is bounded, and the bound is stated in the description
- [ ] §7's "computed, never stored" is either still literally true, or the record
      says why a cache is consistent with it and `db rebuild` reconstructs it
- [ ] `openapi.json` and `schema.generated.ts` regenerated, never hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/` — the new route
- `packages/contract/src/schemas/` — the response
- regenerated artifacts

### Key Implementation Details

**Read `apps/server/src/queue/scope.ts` and `packages/kit/src/recipient/scopeWalk.ts`
before designing the response.** Those two are one walk with one seam, and their
docblock records what happened when they were two: *"A composer said 'Orchestrator
will answer' about a conversation the server routed to Ana, a person pressed the
row they had just read, and Ana never heard about the conversation on the draft
she wrote."*

Whatever this returns must come from that same walk.

### Edge Cases

- A thread with no resident — the orchestrator's lane is not a scope
- An artifact reachable by both `origin` and `parent` to different scopes; §7
  claims at most one scope and SHARED-044 records that the four clauses do not
  guarantee it
- A scope containing an archived document
- A very large scope

## Testing Strategy

Parity with the enqueue-time walk over a derived fixture, in the shape
`scripts/mention-offer-parity.test.ts` uses — a hand-written fixture tests the
cases its author imagined.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident; create a subthread and a document written from it
3. Ask for the scope; confirm it holds exactly what the queue would route there
4. Confirm an unrelated document is absent
5. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-068]` prefix
