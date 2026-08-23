# [CONTRACT-083] Three queue routes return a 409 they do not declare

## Domain
contract

## Status
done

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

- [x] All three routes declare `409` with the same response shape `/defer` uses.
      All four are `409: CONFLICT_RESPONSE`, and a test asserts the four
      serialize to one identical response object.
- [x] The prose says what the conflict **is**. `complete` and `fail` copy
      `/defer`'s sentence verbatim with the verb swapped ("`409` when the event
      is not `in-progress`: only claimed work can be completed / failed / …").
      `abandon` states its own admitted set, because it genuinely refuses a
      different thing — see "One divergence" below.
- [x] `openapi.json` regenerates to 34 changed lines in 6 hunks, all inside the
      three operations; the client to +41/-2 in the same three. No other leaf
      moved.
- [x] Checked. **It cannot be extended to this class.** Reasoning below.
- [x] Noted against SERVER-119. Not widened.

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

**Model: Opus 5 (1M context).**

#### The sweep question — answered "no", with the reason

CONTRACT-059's sweep works because the **trigger** of its `403` is a value in the
request body — `origin: null` — and that field's own published description says
"user-only … refused for an agent actor". The rule "a user-only request field
implies a declared `403`" therefore reads a fact the document already carries, so
a field added tomorrow is covered with no edit to the test.

This class has no such anchor. The trigger is **the event's current status on the
server**, and it appears nowhere in the document:

- Not in the request. `complete` and `abandon` take a path id and an actor
  header, nothing else. `fail` adds one optional annotation.
- Not in the response either. `QueueEvent` publishes **no `status` field at
  all** — that is a deliberate, long-standing choice (it is why the CLI prints
  "event <id> is complete" rather than claiming the transition).
- Nothing in the document states which statuses a verb admits. `CLAIMED_ONLY` and
  `ABANDONABLE` are server constants in `apps/server/src/queue/service.ts`.

So no sweep over `openapi.json` can derive that a `409` is owed here. Making it
derivable means publishing the transition table — the server declaring its own
rules — which is exactly SERVER-119's territory and is deliberately **not** built
here.

A weaker document-side sweep *is* expressible ("an operation whose description
mentions a `409` must declare one"), and it was considered and rejected as
theatre: it would not have caught these three, whose prose said nothing about a
`409` either. It guards prose-vs-declaration drift, not this class.

What landed instead is an honest **enumeration** of the four settle verbs, with a
vacuity guard that fails if a fifth queue-settling route appears without being
listed, and a docblock stating plainly that it is an enumeration and why.

#### Files changed

- `packages/contract/src/routes/queue.ts` — `409: CONFLICT_RESPONSE` on
  `completeEvent`, `failEvent`, `abandonEvent`; `description` added to the first
  two (they had none) and extended on the third.
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` —
  regenerated.
- `packages/contract/src/openapi.test.ts` — new describe block (11 tests).

#### One divergence from "the same words", stated rather than hidden

The issue and the task framing both say "four routes refusing the same thing".
Three of them do. **`abandon` does not**, and the server is explicit about why
(`ABANDONABLE`, `apps/server/src/queue/service.ts:282-291`): abandon is the
operator's give-up, not the agent's report, so SPEC.md §7's console offers it
beside `retry` on a **failed** job. It admits `pending`, `in-progress`,
`deferred` and `failed`, and refuses only `processed` (and a repeat).

So the **declaration** is identical for all four — that is the part that had to
be copied, and it was. The **prose** for `abandon` states its own rule, and
labels itself the exception, because writing the claim rule there would have been
a lie in matching prose. The E2E below shows the server's own two messages side
by side, which is the evidence for the split.

#### Commands run, with real output

```
$ npm run build && npm run generate -w packages/contract
EXIT=0
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ git diff -U0 packages/contract/openapi.json | grep -E "^[+-]" | grep -v "^[+-][+-]" | grep -c .
34
$ git diff -U3 packages/contract/openapi.json | grep -E "^@@"
@@ -9239,6 +9239,7 @@     # complete: the 409 slot
@@ -9308,6 +9309,16 @@    # complete: the description
@@ -9318,6 +9329,7 @@     # fail: the 409 slot
@@ -9398,6 +9410,16 @@    # fail: the description
@@ -9509,7 +9531,7 @@     # abandon: the description (the only replaced line)
@@ -9579,6 +9601,16 @@    # abandon: the 409 slot

$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
EXIT=0
 Test Files  70 passed (70)
      Tests  2928 passed (2928)
```

#### Falsification

First attempt was a **false negative worth recording**: removing the `409` from
the committed `openapi.json` and re-running left all 11 tests green. `openapi.test.ts`
reads `buildOpenApiDocument()` — the in-memory document built from the route
definitions — not the committed file. The committed file's integrity is CI's
drift check, not this suite's.

Falsified properly, at the source (`409: CONFLICT_RESPONSE` deleted from
`completeEvent` in `routes/queue.ts`):

```
× declares 409 on /api/queue/{id}/complete post
  → expected undefined to be defined
× refuses with one shape, not four
  → expected 2 to be 1 // Object.is equality
      Tests  2 failed | 9 passed | 539 skipped (550)
```

Restored, re-run, green.

#### Against a real server

Scratch workspace at `<scratchpad>/ws`, its own server on **port 8766** (the CLI
chose it — the user's 8765 was never touched, and was confirmed still listening
after my server stopped). Real event `evt_3zozvcrtjujf` from a real thread.

```
=== A. complete an event NOBODY CLAIMED (pending) ===
corpus: 409 conflict: queue event evt_3zozvcrtjujf is pending; only in-progress work can be completed
EXIT=5

=== C. claim it, then complete it ===
event evt_3zozvcrtjujf is complete.
EXIT=0

=== D. complete it AGAIN ===
corpus: 409 conflict: queue event evt_3zozvcrtjujf is already processed
EXIT=5

=== E. fail an already-processed event ===
corpus: 409 conflict: queue event evt_3zozvcrtjujf is processed; only in-progress work can be failed
EXIT=5

=== F. abandon an already-processed event ===
corpus: 409 conflict: queue event evt_3zozvcrtjujf is processed; only pending, in-progress, deferred or failed work can be abandoned
EXIT=5
```

All three previously-undeclared `409`s reproduced against the real server, and
each now matches a declaration. Note E against F: that is the divergence above,
in the server's own words.

#### Note for SERVER-119 (not widened)

This is that issue's **third** instance — after CONTRACT-059
(`PUT /api/docs/{id}`, `403`) and the `PUT /api/docs/{id}` `403` gap that
CONTRACT-058's sweep found. Its case is now made from three rather than argued
from one. Two things this instance adds to its record, both arguments for
building it exactly as scoped and no wider:

1. **The gap was found by a human reading a commit, not by any check.** Three
   routes shipped a release refusing something they declared impossible.
2. **It is undetectable from the contract side.** The reasoning above is a
   demonstration that a document-only sweep cannot reach this class — which is
   precisely why the check has to sit at the server's response seam, where
   CONTRACT-058 already located it (`apps/server/src/docs/write-fixture.ts`).

## Completion Checklist (domain agent)
- [x] Tests written and passing — 11 new, `packages/contract` 2928/2928 green
- [x] `/lint` passes — eslint 0, prettier clean, `tsc --noEmit` clean in all four
      workspaces
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
