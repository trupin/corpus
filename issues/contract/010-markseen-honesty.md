# [CONTRACT-010] `MarkSeenResult.unread` honesty + client attachment-path exclusion

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — same honesty class as CONTRACT-006's `appended` fix; the pattern is established.

## Dependencies

- Depends on: CONTRACT-006
- Blocks: — (PR #9 merge blocker: pr-reviewer MAJOR finding 5; MINOR finding 20 rides along)

## Spec References

- SPEC.md §5 — read state
- PR #9 review, findings 5 and 20

## Summary

`MarkSeenResult.unread` is `z.literal(false)` ("Always false") while `MarkSeenRequestSchema` supports partial marks (`lastSeenTs` before the last turn) — after which the thread is by the contract's own definition still unread. A client trusting the mutation response clears the badge that the next `GET /api/docs` re-raises. Same defect class as the `appended: true as const` literal CONTRACT-006 fixed. The CONTRACT-002 AC pinned this shape; that pin is adjudicated defective (orchestrator, 2026-07-27).

Rider (finding 20): `FetchPaths` excludes `/events` but keeps `GET /attachments/{path}`, whose `application/octet-stream` response `openapi-fetch` JSON-parses by default — exclude it with the same don't-call-this-that-way rationale.

## Acceptance Criteria

- [ ] `MarkSeenResult.unread` becomes a plain boolean whose description states the partial-mark semantics; server handler updated to compute it (SERVER-021's session consumes this).
- [ ] `GET /attachments/{path}` excluded from `FetchPaths` alongside `/events`.
- [ ] All standing invariants; artifacts regenerated; round-trips; the CONTRACT-002 AC pin is annotated as superseded in that issue file.

## Technical Design

Mirror the CONTRACT-006 `appended` change mechanically.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
