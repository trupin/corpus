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
- _(added 2026-07-28, sprint-014 Adjudications 12/13)_ `docs/cli.md` documents a `~~~form` fence
  that `FORM_FENCE_PATTERN` does not recognize — a docs/grammar divergence to settle with (9);
  and nothing validates a form's shape at post time (the comment skill is the v1 enforcement
  point) — decide whether post-time validation joins the settled grammar.
- _(added 2026-07-29, UI-013 finding-12 residual)_ an answer turn on disk names an option but not
  the form it answers, so after a reload the UI's form↔answer pairing falls back to an order rule
  (multi-form threads can mis-attribute). Closing it fully needs a field on the answer turn
  (`formTs` or equivalent) — a contract+server rider to decide alongside the grammar. Note:
  SERVER-029 removed the SQL fence translation (projected `has_form` column reads the one TS
  grammar), so a grammar change now costs only a projection rebuild.

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
