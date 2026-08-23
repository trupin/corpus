# [CONTRACT-059] `PUT /api/docs/{id}` returns 403 and declares none

## Domain

contract

## Status

done

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

- [x] `updateDoc` declares `403: FORBIDDEN_RESPONSE`, with prose carrying the
      `x-corpus-author: agent` phrasing the existing test asserts
- [x] The route is added to `openapi.test.ts`'s `it.each`, so the list stops
      being a snapshot of what existed when it was written
- [x] `openapi.json` regenerated; shape diff reported and confined to the added
      response
- [x] Non-vacuity checked by counterfactual, as CONTRACT-058 did — a declaration
      test that passes with the declaration removed is not a test

## Testing Strategy

Generation and drift. The real protection is `SERVER-119`.

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context).

**What landed**

- `packages/contract/src/routes/docs.ts` — `updateDoc` declares
  `403: FORBIDDEN_RESPONSE`, and its description gains a paragraph naming the one
  user-only field: `origin: null` under `x-corpus-author: agent` is **rejected**
  with `403` and writes nothing, with §9.2's reason (detaching is a person's
  correction) and the boundary stated — every other field on the route is open to
  both parties, so the `403` is about that one key and never about editing. The
  phrasing matches the server's own refusal in
  `apps/server/src/docs/update.ts:286-292`.
- `packages/contract/src/openapi.test.ts` — the route joins the existing
  `it.each`, **and** the list stops being the only guard (below).

**The list is no longer a snapshot, because a sweep now derives it.** Adding one
entry to a hand-written list fixes this route and not the next one. The reason
the list could not have caught this one is structural: it enumerates routes that
are user-only **as routes**, and `PUT /api/docs/{id}` is user-only in **one
field** of an otherwise open body. So a new sweep reads the rule off the
document: *a request field whose published description says user-only implies its
operation declares `403`*. It walks each mutating operation's JSON request body,
resolving `$ref`s with a cycle guard and descending through `allOf`/`anyOf`/
`oneOf`, and matches `/user-only|refused for an agent/` on property descriptions.
Request bodies only — `DocRow.origin`, `DocFrontmatter.origin`,
`Thread.resident`, `ThreadSummary.resident` and `AgentLane.resident` all carry
the same prose in **responses**, where it describes a rule enforced on some other
route, and reading those as declarations would be false positives rather than
catches.

Its vacuity guard pins the swept set exactly, so a sweep over nothing fails:

```
expect(userOnlyRequestFields()) → ["PUT /api/docs/{id} → origin"]
```

**Counterfactual — the declaration removed, both tests fail**

```
$ # 403: FORBIDDEN_RESPONSE deleted from updateDoc's responses
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/openapi.test.ts
× author attribution > declares 403 on the user-only route /api/docs/{id} put and says why
× author attribution > a user-only request field implies its route declares 403 > declares 403 on every route carrying one
Tests  2 failed | 525 passed (527)
```

Restored afterwards; neither test can pass without the declaration.

**Shape diff, confined to the added response**

Regenerated after the change and diffed leaf by leaf against the previous
`openapi.json`:

```
ADDED:
   /paths//api/docs/{id}/put/responses/403/description
   /paths//api/docs/{id}/put/responses/403/content/application/json/schema/$ref
REMOVED:
   (none)
CHANGED:
   /paths//api/docs/{id}/put/description
```

The `$ref` is `#/components/schemas/ForbiddenError`, already published for the
three routes that declared it before, so no component moved.

**Tests, typecheck, lint**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
Test Files  68 passed (68)
Tests  2866 passed (2866)

$ npm run typecheck -w packages/contract → 0
$ npm run typecheck -w apps/cli          → 0    # the error union widened; nothing broke
$ npm run typecheck -w packages/kit      → 0
```

Widening a route's declared error union is additive for readers — a consumer
that narrows on `code` still compiles — which the two consumer typechecks
confirm rather than assume.

**Left to SERVER-119.** This closes the declaration gap only. The contract still
cannot check what the server emits, and the cross-check belongs at the server's
own `write-fixture.ts` seam (CONTRACT-058's finding).

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-059]` prefix
