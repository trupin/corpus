# [CONTRACT-014] Form-fence grammar edges + SSE token transport decision

## Domain

contract

## Status

todo

## Priority

P2

## Model

fable — one grammar decision with cross-component blast radius, one security posture decision.

## Dependencies

- Depends on: CONTRACT-007, CONTRACT-013
- Blocks: SERVER-029 (detector alignment consumes the settled grammar)

## Spec References

- PR #10 review (2026-07-28), findings 9/10

## Summary

- (9) `schemas/form.ts:50` — `FORM_FENCE_PATTERN` diverges from CommonMark at edges (closing
  fence need not start a line; matches inside an outer 4-backtick block), so renderer and
  detector can disagree on "carries a form". Settle the grammar (document the chosen subset or
  align to CommonMark), then SERVER-029 aligns the SQL detector.
- (10) `client/events.ts:53-55` — the SSE bearer token travels as `?token=` (EventSource
  limitation): request logs + `currentUrl()` exposure. Localhost-bound today; make the
  documented decision (accept with rationale, or move to cookie/header transport) BEFORE
  remote-server setups arrive.

## Acceptance Criteria

- [ ] Fence grammar settled, documented, tested at the edges; consumers referenced.
- [ ] SSE token transport decision recorded in the schema docblock (and SPEC if user-visible).

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
