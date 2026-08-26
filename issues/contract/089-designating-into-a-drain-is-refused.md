# [CONTRACT-089] Designating into a drain is refused, with its reason

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-072
- Blocks: SERVER-153

## Spec References

- SPEC.md §7 — rider C signed 2026-08-25: _"A thread whose release is still
  draining refuses a new designation, naming the outstanding events, since
  designating into a drain is the one way left to hand the same turns to two
  agents."_

## Summary

Rider C leaves exactly one seam. Release hands a lane's pending events to the
orchestrator. If a person designates again before that drain finishes, the
orchestrator is working events a new listener would also see — the double-answer
rider C exists to prevent, arriving through the one door left open.

The decision recorded in SHARED-072 was to **refuse**, over abandoning the drain
(which narrows the seam without closing it) and over keying lanes by
`designationId` (clean by construction, and the largest change of the three).

This issue is the wire half: the refusal, and a body that says what is
outstanding.

## Acceptance Criteria

- [x] `POST /api/threads/:id/resident` declares a **409** for a thread whose
      release is still draining
- [x] The refusal body carries **how many events are outstanding**, so the
      message a person reads is specific rather than "try again later"
- [x] The description states the rule and its reason, citing §7 — a reader of the
      contract must not have to open the spec to learn why this is refused
- [x] It says the condition is **transient and self-clearing**, so nothing treats
      it as a permanent state of the thread
- [x] `409` and not `423` or `503`: the existing error vocabulary in this package
      decides it. Match what the package already does for a conflicting state
      rather than introducing a code it does not use
- [x] `openapi.json` and the generated client regenerate cleanly

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/threads.ts` — the resident route's error
  responses
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerate

### Key Implementation Details

Read `apps/server/src/errors.ts` and the package's existing error schemas before
choosing the shape. This repository has a documented preference for a refusal
that names what is at fault, and for not inventing a second error vocabulary
beside a working one.

The count belongs in a **field**, not only in the prose message, so a client can
render it without parsing — the same rule CONTRACT-087 applies to `summary`.

### Edge Cases

- A thread released long ago with a drain that completed: not draining, so not
  refused. The condition is about outstanding work, never about having been
  released.
- Designating a thread that never had a resident: unaffected.

## Testing Strategy

Schema tests for the error body, and a description assertion that it names §7's
reason. Falsify by deleting the reason sentence.

## E2E Verification Plan

Against the real server once SERVER-153 lands: release a thread holding pending
events, designate immediately, read the 409 and its count, let the drain finish,
designate again and succeed.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### I minted a new error code, and the repository's own tests refused it

First attempt added `draining` to `ERROR_CODES` with a `DrainingError` body,
reasoning from `StaleKeyError`'s docblock: *"two different refusals on one status
must stay tellable apart at the place clients actually branch — the `code`."*

Three existing tests went red, and they were right:

```
× did not mint a second code for the same fact          (CONTRACT-058)
× gives the three 409s distinguishable codes
× gives 413 the bad_request body, leaving the error union closed
```

The rule is more precise than the sentence I quoted. This package has settled the
question **twice** — `ReattachConflictError` and `PatchConflictError` are *both*
`code: "conflict"`, told apart by `reason` vocabularies that do not overlap — and
its own comment says why: *"the two state refusals narrow `conflict` with a
`reason` rather than each claiming a code of its own, and one `code` never means
two things."*

So this is `conflict` with `reason: "draining"`, beside `has-parent`. A third
code would have been the same fact wearing a new name, which is exactly what
`unknown_recipient`'s test forbids.

**Worth keeping**: the guard that caught it was not a test of my change. It was
the closed-union invariant, defending a rule I had read and misapplied.

### The two refusals on this route are opposites

`has-parent` can **never** succeed. `draining` is about to succeed, in seconds.
A client that could not tell them apart would offer *"try again"* where trying
can never work, and *"this thread can never have a resident"* where it is about
to have one. The `reason` description says that in those words, and a test pins
it.

### The count is a field

`PatchConflictError.matches` is the same idea for the same reason: *"try again
later"* does not tell a person whether later is a second or an hour, and a client
scraping a number out of `message` parses prose the server is free to reword.
`0` under `has-parent`, at least one under `draining`.

### Falsification

Changing `draining` to `no-match`, which `PatchConflictError` already uses:

```
× narrows `conflict` with a reason rather than minting a code
× does not overlap the other two conflict vocabularies
  Tests  2 failed | 3 passed
```

The overlap guard is the one that matters — it is what stops a caller reaching
the wrong route's narrowing and getting a plausible wrong answer.

### Checks

```
vitest run packages/contract      70 files, 3005 tests passed   exit 0
eslint packages/contract/src                      0 errors      exit 0
tsc -p tsconfig.build.json                                      exit 0
generate (openapi.json + client)                                clean
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[CONTRACT-089]` prefix
