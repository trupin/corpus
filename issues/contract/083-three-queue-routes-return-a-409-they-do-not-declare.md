# [CONTRACT-083] Three queue routes return a 409 they do not declare

## Domain
contract

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: SERVER-145
- Blocks: —

## Spec References
- SPEC.md Section 9.2 — the route catalogue
- SPEC.md Section 7 — "nobody settles work they did not claim" (rider signed
  2026-08-13)

## Summary

SERVER-145 made the queue's terminal states terminal: `complete` and `fail`
accept only `in-progress`, and `abandon` accepts everything but `processed`.
A settle that does not hold the claim is refused with a **409**.

**Three routes now return that 409 and declare `200, 400, 401, 404`:**
`POST /api/queue/{id}/complete`, `POST /api/queue/{id}/fail` and
`DELETE /api/queue/{id}`. Only `/defer` declares it, because `defer` was the one
verb that already had an `onlyFrom` rule.

SERVER-145's implementer found this, did not reach into `packages/contract`, and
routed it. Nothing breaks at runtime — the CLI renders the refusal and exits 5 —
but the machine-readable half is wrong for three routes.

**This is CONTRACT-059's class, closed on `PUT /api/docs/{id}` earlier in this
same release.** It is filed and fixed here rather than left, because leaving it
would mean shipping a release that closed the gap on one route and opened it on
three.

## Acceptance Criteria

- [ ] All three routes declare `409` with the same response shape `/defer` uses.
- [ ] The prose says what the conflict **is** — work that is not claimed cannot
      be settled — rather than a generic conflict.
- [ ] `openapi.json` and the generated client regenerate, and the diff is
      exactly the added declarations. No other leaf moves.
- [ ] CONTRACT-059's sweep — the one that derives "a user-only request field
      implies a declared 403" from the document — is checked for whether it can
      be extended to this class. If it cannot, say why in the issue rather than
      leaving the reader to wonder.
- [ ] SERVER-119 (`nothing checks that a status the server returns is one the
      contract declares`) is still `todo`. Note against it that this issue is a
      third instance, so its case is made from three rather than argued from
      one. **Do not widen it.**

## Technical Design

### Files to Create/Modify
- `packages/contract/src/routes/queue.ts` — the three declarations
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerated
- `packages/contract/src/openapi.test.ts` — the pin

### Key Implementation Details

Copy `/defer`'s declaration rather than writing a fourth variant. Four routes
refusing the same thing should refuse it in the same words.

The interesting question is whether a **sweep** can catch this class the way
CONTRACT-059's catches the 403 class. A 403 is derivable from a published field
description; a 409 is derivable from nothing the document currently states. If
the answer is "not without the server declaring its transition rules", that is
SERVER-119's territory and belongs in a note there, not in a mechanism here.

### Edge Cases
- `/defer`'s existing declaration must not change.
- A consumer generating handlers from the document, which is the reader this
  issue exists for.

## Testing Strategy

`vitest run packages/contract`, plus the generated-artifact drift check. The
behavioural claim is "the document now says what the server does", so the test is
the declaration's presence and the regeneration's cleanliness.

**Falsify**: remove one declaration and watch the pin fail. A test that asserts
only "the route exists" would pass with all three missing.

## E2E Verification Plan

### Verification Steps
1. `npm run build && npm run generate -w packages/contract`
2. `git diff` shows only the three added declarations
3. Against a real server, settle an unclaimed event and confirm the 409 the
   document now declares is the one that arrives

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
