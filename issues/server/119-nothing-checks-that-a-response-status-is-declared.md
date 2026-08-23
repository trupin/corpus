# [SERVER-119] Nothing checks that a status the server returns is one the contract declares

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Related: CONTRACT-058, CONTRACT-059, CONTRACT-083 (the gaps it would have
  caught), CONTRACT-055 (which established where a cross-check belongs)

## Summary

Two routes have now been found returning a status the contract does not declare
— `GET /api/queue/idle`'s `422` (`CONTRACT-058`) and `PUT /api/docs/{id}`'s
`403` (`CONTRACT-059`). Both were found by a person sweeping by hand, once,
while doing something else.

`CONTRACT-058` established that the check **cannot** live in `packages/contract`
— it may not import `apps/server`, and nothing there can know which statuses a
handler reaches. It also identified where it can, and the proposal is good
enough to quote:

> `apps/server/src/docs/write-fixture.ts` — the single seam every server
> integration test's `request`/`post`/`put`/`del` funnels through into
> `server.app.request`. Wrapping it to assert each response's status is declared
> for the matching operation (resolved with the server's own
> `createContractPathMatcher` over `ALL_CONTRACT_ROUTES`) turns the entire
> existing server suite into the cross-check for one wrapper — and would have
> caught **both** gaps, since `roster.test.ts` asserts the 422 and
> `provenance.test.ts` asserts the 403.

That is the shape worth building: one wrapper, and every integration test the
repo already has becomes evidence.

## Third instance (CONTRACT-083, 2026-08-23) — the case is now made from three

**This issue is not widened by the note below.** Its scope, its acceptance
criteria and its one file are unchanged. What follows is evidence, recorded so a
future reader does not have to take the argument on one example.

SERVER-145 made the queue's terminal states terminal, and **three** routes then
shipped a `409` they declared impossible: `POST /api/queue/{id}/complete`,
`POST /api/queue/{id}/fail` and `DELETE /api/queue/{id}`. `/defer` declared its
`409` only because it had carried the rule since SERVER-030. CONTRACT-083 fixed
the declarations.

Two things this instance adds, both arguments for the wrapper exactly as scoped:

1. **Found by a person reading a commit, again.** SERVER-145's implementer
   noticed while doing something else and routed it. Same discovery mechanism as
   the first two — which is to say, no mechanism.

2. **CONTRACT-083 demonstrated that the contract side cannot reach this class**,
   which sharpens why the check has to sit at the server's response seam.
   CONTRACT-059's sweep works because its `403` is triggered by a request field
   whose own published description states the rule, so the document can be made
   to check itself. A queue `409` is triggered by the **event's current status on
   the server**, which appears in no request, in no response (`QueueEvent`
   publishes no `status` field at all), and in no declaration — the admitted sets
   are server constants (`CLAIMED_ONLY`, `ABANDONABLE` in
   `apps/server/src/queue/service.ts`). No sweep over `openapi.json` can derive
   that a `409` is owed. A weaker document-side sweep was considered there and
   rejected as theatre: it would not have caught these three either.

So the class the contract can self-check is the smaller one, and this issue owns
the rest. Three routes' worth of `409` is what a green run of the existing queue
integration tests would have reported on the day SERVER-145 landed.

## Acceptance Criteria

- [ ] Every response flowing through the fixture is checked against the declared
      responses for its operation, and an undeclared status fails the test that
      produced it — naming the operation and the status, not a generic assertion
- [ ] **Proved non-vacuous by removing each of CONTRACT-058's and
      CONTRACT-059's declarations in turn** and confirming the suite goes red at
      `roster.test.ts` and `provenance.test.ts` respectively. Those two are the
      known-answer cases and the only honest way to show the wrapper works
- [ ] Tests that deliberately exercise undeclared behaviour, if any exist, have
      an explicit opt-out rather than the check being loosened for everyone
- [ ] The failure message tells the reader what to do — declare the status, or
      stop returning it — since the fix is a contract change in another domain
- [ ] Note what it cannot cover: routes with no integration test, and the two
      declared-but-unmounted upgrade routes CONTRACT-058 found. Say so rather
      than letting a green suite imply completeness

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/write-fixture.ts`

### Notes

`createContractPathMatcher` over `ALL_CONTRACT_ROUTES` already exists and is what
resolves a request to its operation.

## Testing Strategy

The wrapper's own test is the counterfactual above.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-119]` prefix
