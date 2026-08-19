# [SERVER-130] The server answers what a scope holds

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-068
- Blocks: UI-125, CLI-054
- Related: SERVER-111 (the enqueue-time walk)

## Spec References

- SPEC.md **§7** — scope: the thread, its subthreads, every artifact whose provenance walks back to it; membership computed, never stored
- SPEC.md **§9.2** — the HTTP API

## Summary

CONTRACT-068 defines the route that answers *given a designated thread, what is in its scope*. This issue mounts it. The answer is derived by the **same walk** the queue routes with — `@corpus/contract`'s `walkScope`, which `apps/server/src/queue/scope.ts` already uses to climb from one artifact to its lane. Listing a scope is the inverse: every thread and document in the projection whose walk lands on this lane.

**Decided by the orchestrator, 2026-08-19** (CONTRACT-068 decisions 1–3):

- **A query, not a projection table.** Computed per request from the projection's existing `origin`/`parent` columns, so §7's *"computed, never stored"* stays literally true. The cost is a pass over the threads and documents the projection holds, each walked with `walkScope`; memoise the walk per request so a deep graph is not re-climbed per node. Measure it on a workspace of a few thousand artifacts and state the number in the log.
- **One frugal line per hit** — id, type, title, status, and how it got in (`origin` or `parent`), never a body.
- **Bounded** — the contract states a page size and a `truncated` flag. The server returns the first page in a stated order (the thread itself first, then by created time) and sets `truncated` honestly. No cursor in this release: the bound is there so a very large scope cannot become an enumeration, not to make paging a feature.

## Acceptance Criteria

- [ ] The route is mounted and answers for a designated thread
- [ ] A thread with no resident is a `404`/`409` per the contract's stated rule — the orchestrator's lane is not a scope
- [ ] Parity test: over a derived fixture, every artifact the **enqueue-time** walk routes to lane L appears in L's listing, and nothing else does — one walk, two directions, proven equal
- [ ] Bound honoured and `truncated` set
- [ ] An archived document in scope is listed, with its status
- [ ] Falsified: replace `walkScope` with `origin ?? parent` and the parity test goes red

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/scope.ts` — reuse, and possibly an exported inverse helper beside the existing climb
- `apps/server/src/agents/` or `apps/server/src/threads/` — the route handler, wherever CONTRACT-068 files it
- `apps/server/src/app.ts` (or the routes index) — mount
- a parity test in the shape of `scripts/mention-offer-parity.test.ts`

### Key Implementation Details

Read `queue/scope.ts`'s docblock and `packages/kit/src/recipient/scopeWalk.ts`'s. Those two are one walk with one seam. The inverse must call the same function, never re-implement the edge order.

### Edge Cases

- An artifact reachable by both `origin` and `parent` to different lanes (SHARED-044) — list it where `walkScope` puts it, which is what the queue would do
- A scope containing an archived document
- The thread itself — always first

## Testing Strategy

Route tests on the real app with a temp workspace, plus the parity test.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident; create a subthread and a document whose `origin` is the thread; create an unrelated document
3. `GET` the scope: the thread, the subthread and the document are listed; the unrelated document is not
4. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-130]` prefix
