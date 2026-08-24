# [SERVER-119] Nothing checks that a status the server returns is one the contract declares

## Domain

server

## Status

done

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

- [x] Every response flowing through the fixture is checked against the declared
      responses for its operation, and an undeclared status fails the test that
      produced it — naming the operation and the status, not a generic assertion
- [x] **Proved non-vacuous by removing each of CONTRACT-058's and
      CONTRACT-059's declarations in turn** and confirming the suite goes red at
      `roster.test.ts` and `provenance.test.ts` respectively. Those two are the
      known-answer cases and the only honest way to show the wrapper works.
      CONTRACT-083's `409` was proved the same way, at `queue/routes.test.ts`
- [x] Tests that deliberately exercise undeclared behaviour, if any exist, have
      an explicit opt-out rather than the check being loosened for everyone —
      one exists, and `500` is exempt globally with its reasoning written down.
      **That exemption needs a decision; see below**
- [x] The failure message tells the reader what to do — declare the status, or
      stop returning it — since the fix is a contract change in another domain
- [x] Note what it cannot cover: routes with no integration test, and the two
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

**Model: Opus 5 (1M context).**

### The change

`apps/server/src/docs/write-fixture.ts`, plus three lines elsewhere that *use*
it. The seam is `server.app.request`, not the fixture's four helpers: suites
reach past those, and `roster.test.ts` — one of the two known-answer cases —
builds its park with `ws.server.app.request` directly.

- `CONTRACT_OPERATIONS` — every `ALL_CONTRACT_ROUTES` entry as
  `createContractPathMatcher(route.path)` plus its declared status set, sorted so
  a literal path resolves before a parameterized one.
- A response whose method and path match an operation and whose status is not in
  that set **throws**, naming the operation, the status, what is declared, and
  the two ways to fix it.
- It also `console.error`s the same sentence before throwing. That is not
  decoration: `roster.test.ts`'s park helper is
  `done.catch(() => new Response(null, { status: 499 }))`, so the throw is
  swallowed and the whole file reports `expected 499 to be 422` and nothing else.
  Measured — the first falsification run produced exactly that and no message.
- `withUndeclaredStatus(reason, run)` is the opt-out, and it **fails when it was
  not needed**, so a stale escape hatch cannot sit there hiding the next one.
- `checkDeclaredStatuses(server)` is exported so a suite that builds its own
  server can ask for it. One does.

### What the check found on its first run

The full suite, before any opt-out existed: **8 failures across 7 files**, all
real and all in two classes.

```
POST /api/boards/order      answered 500 (declares 200, 400, 401, 404)
POST /api/capture           answered 500 (declares 201, 400, 401, 413)
POST /api/docs/{id}/archive answered 500 (declares 200, 400, 401, 404, 422)
POST /api/threads           answered 500 (declares 201, 400, 401, 404, 413, 422)
POST /api/threads/{id}/turns answered 500 (declares 201, 400, 401, 404, 413, 422)  ×2
POST /api/upgrade           answered 404 (declares 202, 401, 409)
```

**Class 1 — `500`.** Seven of the eight. Every one is a test that injects a
filesystem failure on purpose and then asserts SPEC.md §11's promise: the
attachment survives, the source folder is restored, the reorder does not
half-apply. **No route in `packages/contract` declares `500` anywhere.**

**Class 2 — `404` on a declared-but-unmounted route.** `json-body.test.ts`'s
sweep walks every mutating route in the contract, and the upgrade pair
CONTRACT-058 found is declared without being mounted.

### The two exemptions, and why they are different shapes

**`404` on the unmounted route is a per-call opt-out**, at the one site:
`withUndeclaredStatus("declared-but-unmounted routes answer 404", …)` in
`json-body.test.ts`. One test, one reason, and it fails if it stops being needed.

**`500` is exempt globally**, and that is a judgment I am flagging rather than
burying. It is the envelope `app.onError` puts on any unhandled throw on any
route; whether a mutating route should declare it is a contract question over
roughly sixty routes, in another domain, and a check in `apps/server` must not
make the suite red until someone answers it. Exempting it costs this check
nothing against the class it exists for — CONTRACT-058's `422`, CONTRACT-059's
`403` and CONTRACT-083's three `409`s are all statuses a handler *chose*, and all
are still caught. **If the contract ever declares `500`, deleting one constant
tightens the check by itself.**

### Non-vacuity — each known-answer case removed in turn, restored after

`packages/contract` was rebuilt between each (the server resolves it through
`dist/`), and each file was restored byte-for-byte.

```
1. queue.ts:100  `422: UNKNOWN_SCOPE_RESPONSE` removed
   → roster.test.ts   4 failed | 27 passed
   → GET /api/queue/idle answered 422, which the contract does not declare
     (it declares 200, 204, 400, 401).

2. docs.ts:254   `403: FORBIDDEN_RESPONSE` removed
   → provenance.test.ts  1 failed | 20 passed
   × refuses an agent with a 403, the same doctrine as delete
   → PUT /api/docs/{id} answered 403, which the contract does not declare
     (it declares 200, 400, 401, 404, 409, 422).

3. queue.ts:235  `409: CONFLICT_RESPONSE` removed  (CONTRACT-083's instance)
   → queue/routes.test.ts  2 failed | 48 passed
   × refuses to re-settle a settled event, in either direction
   × refuses to settle an event nobody claimed, and 404s an unknown id
   → POST /api/queue/{id}/complete answered 409, which the contract does not
     declare (it declares 200, 400, 401, 404).
```

All three instances the issue is built from are caught, each at the file the
issue predicted.

### What it cannot cover, stated so a green suite is not mistaken for completeness

- A route with no integration test says nothing here.
- A status a test never provokes says nothing here.
- The **opposite** direction — a declared status no handler returns, which is
  what CONTRACT-058 found in the upgrade pair — is invisible to this check by
  construction. `app.test.ts`'s mounted-route sweep is what covers it.
- **Sixteen suites build their own server** with `createServer` and are
  unchecked. `queue/routes.test.ts` is the seventeenth and now calls
  `checkDeclaredStatuses` itself, because that is where CONTRACT-083's `409`s
  were asserted green. Wiring the other sixteen is sixteen more files and this
  issue is deliberately one.

### Suite

```
VITEST_MAX_THREADS=4 vitest run apps/server --reporter=verbose
  Test Files  203 passed (203)
       Tests  4584 passed (4584)      exit 0
```

`apps/server/src/docs/write-fixture.test.ts` is the new file: seven tests over
the parts a counterfactual cannot show — that a declared status passes, that an
unclaimed path is left alone, that the message says what to do, that an opt-out
admits its case, and that a stale opt-out fails.

### Needs your decision

**Should mutating routes declare `500`?** Seven tests assert one today. I have
exempted it rather than pre-judging a sixty-route contract change from
`apps/server`. If the answer is yes, it is a CONTRACT issue and this check
tightens the moment it lands.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-119]` prefix
