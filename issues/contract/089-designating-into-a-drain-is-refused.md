# [CONTRACT-089] Designating into a drain is refused, with its reason

## Domain

contract

## Status

todo

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

- [ ] `POST /api/threads/:id/resident` declares a **409** for a thread whose
      release is still draining
- [ ] The refusal body carries **how many events are outstanding**, so the
      message a person reads is specific rather than "try again later"
- [ ] The description states the rule and its reason, citing §7 — a reader of the
      contract must not have to open the spec to learn why this is refused
- [ ] It says the condition is **transient and self-clearing**, so nothing treats
      it as a permanent state of the thread
- [ ] `409` and not `423` or `503`: the existing error vocabulary in this package
      decides it. Match what the package already does for a conflicting state
      rather than introducing a code it does not use
- [ ] `openapi.json` and the generated client regenerate cleanly

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

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-089]` prefix
