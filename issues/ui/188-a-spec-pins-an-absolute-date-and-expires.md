# [UI-188] A browser spec pins an absolute date, so it fails on a calendar rather than on a defect

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: `UI-187` (whose run surfaced it), INFRA-020 (a failing test is
  diagnosed before its timeout moves)

## Spec References

- SPEC.md **§10** — the foot's reflect ask and its relative-time label

## Summary

Found during `UI-187`'s full e2e run, 2026-09-02.
`apps/ui/e2e/foot-geometry.spec.ts:126` seeds `reflected:
"2026-08-19T10:00:00.000Z"` and asserts the label reads `Reflect · 5 changes
since 1w`. Fourteen days have now passed, so the label correctly reads `2w` and
the spec fails.

**It touches no code this release changed, and it fails on an unchanged tree.**
It is a calendar, not a regression — and it will go red in CI for every branch
until it is fixed.

`apps/ui/e2e/pending-claim.spec.ts:44` already has the right pattern:
`new Date(Date.now() - 5_000)`.

## Why this is worth an issue rather than a quiet fix

INFRA-020's rule is that **a failing test is diagnosed before it is changed**,
because two defects in this repository were carried as flakes for releases. The
diagnosis here is complete and cheap: the fixture is absolute, the product's
label is relative, and the two agree only for a week after the date was written.
Recording it keeps the fix from reading as an assertion someone weakened to get
a build green.

## Acceptance Criteria

- [x] The fixture is relative to now, so the assertion means the same thing on
      every future day
- [x] The assertion still pins the **space on either side of the count**, which
      is what the test was written for — the label's wording is incidental to it
- [x] A sweep for other absolute dates in `apps/ui/e2e/` that feed a relative
      label, so this is fixed as a class rather than one instance

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/foot-geometry.spec.ts` — the fixture at line 126 and the two
  assertions at 204 and 210

### Notes

- The test's subject is **geometry**: a flex row strips whitespace at the ends
  of anonymous flex items, so `Reflect ·  5changes since 1w` is what a person
  read while the DOM string was correct. Keep that subject intact — the exact
  relative word matters only insofar as the spaces around the count survive.

## Testing Strategy

The spec is the test. Falsify by re-introducing a fixed past date far enough
back that the label changes, and confirm the assertion no longer depends on it.

## E2E Verification Log

**Fixed 2026-09-02 (orchestrator, Opus 5).** The first attempt made only
`reflected` relative and the spec still failed — `expected three parts, saw 1`.
The cause is that the count is *changes since the last reflection*, so `updated`
and `reflected` mean something only **against each other**: moving one a week
back put it after the notes' fixed `2026-08-20`, the count became zero, and the
label lost the count span the geometry test measures. Both halves are now
relative — reflected at 7 days ago, notes updated at 6 — so the pair holds on
every future day. `npx playwright test foot-geometry`: 6 passed.

The sweep found no other instance: the remaining absolute dates in
`apps/ui/e2e/` are turn timestamps inside document bodies and feed no relative
label.

**Pre-fix reproduction, 2026-09-02 (ui-dev, Opus 5, during UI-187's e2e run):**
`npm run e2e` — 681 passed, 1 failed, the failure being this spec asserting `1w`
against a rendered `2w`.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
