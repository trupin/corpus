# [CONTRACT-059] `PUT /api/docs/{id}` returns 403 and declares none

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Related: CONTRACT-058 (whose sweep found it), SERVER-119 (the check that
  would have caught it), SERVER-110 (which added the detach field)

## Summary

`apps/server/src/docs/update.ts`'s `changedFields` throws `forbidden(…)` when a
non-user actor sends `origin: null`, and `apps/server/src/docs/provenance.test.ts`
exercises it. **`updateDoc` declares no `403`.**

The sharp part: `originDetachField`'s **published description already says**
"user-only, refused for an agent actor". So the contract states the behaviour in
prose and omits it from the machine-readable half — the same gap `CONTRACT-058`
just closed on `idle`, in a different register. A consumer reading descriptions
knows; a consumer generating handlers does not.

`openapi.test.ts`'s existing "declares 403 on the user-only route" `it.each`
lists only the three routes that predate the detach field, which is why nothing
caught it.

Found by `CONTRACT-058`'s structural sweep, which deliberately did not fix it —
a second route's contract change belongs in its own commit.

## Acceptance Criteria

- [ ] `updateDoc` declares `403: FORBIDDEN_RESPONSE`, with prose carrying the
      `x-corpus-author: agent` phrasing the existing test asserts
- [ ] The route is added to `openapi.test.ts`'s `it.each`, so the list stops
      being a snapshot of what existed when it was written
- [ ] `openapi.json` regenerated; shape diff reported and confined to the added
      response
- [ ] Non-vacuity checked by counterfactual, as CONTRACT-058 did — a declaration
      test that passes with the declaration removed is not a test

## Testing Strategy

Generation and drift. The real protection is `SERVER-119`.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-059]` prefix
