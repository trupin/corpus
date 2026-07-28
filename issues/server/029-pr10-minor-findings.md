# [SERVER-029] Server hardening batch: PR #10 MINOR findings

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — two scoped fixes with the reviewer's diagnosis written.

## Dependencies

- Depends on: SERVER-016, SERVER-026
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), findings 8/15

## Summary

- (8) `docs/needs.ts:77-100` — the SQL `needs=form` detector disagrees with
  `FORM_FENCE_PATTERN` in both directions (unterminated fence → stuck "awaiting your answer"
  that the form route 404s; trailing-space info string → answerable but never surfaced). This is
  the exact disagreement `threads/forms.ts:14-21` says to file. Coordinate with CONTRACT-014
  (the pattern itself also drifts from CommonMark).
- (15) `docs/update.ts:128-152` — `EXTRA_MAX_BYTES` is per-request only; repeated merge patches
  under different keys grow a file's `extra` past the 64 KiB bound the contract advertises.
  Enforce the bound on the merged result.

## Acceptance Criteria

- [ ] Detector and renderer agree on "carries an unanswered form" for the divergent shapes.
- [ ] A merge patch that would grow `extra` past the bound is rejected 4xx with the file
      unchanged; test covers accretion across multiple requests.

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
