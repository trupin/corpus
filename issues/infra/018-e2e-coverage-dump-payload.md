# [INFRA-018] Halve the e2e coverage payload at the collector: half of every dump is Vite-internal

## Domain
infra

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: INFRA-017
- Blocks: —

## Spec References
- INFRA-004 (the combined coverage gate)

## Summary
Follow-up INFRA-017 deliberately did not take, because verifying it requires a
full `npm run e2e` and that run's global setup would have destroyed the 2.2 GB
corpus INFRA-017 was measured against.

Measured during INFRA-017: each browser dump is ~10 MB across **363 entries**,
and **53 of those entries — 4.2 MB, half the payload — are Vite client, HMR and
prebundled-dep code** that the reporter's `entryFilter` discards anyway. At 237
specs that is ~1.1 GB written to disk, read back, and JSON-parsed for nothing.

INFRA-017 fixed the defect (dumps are now streamed, and the same
`isRepoSourceEntry` predicate is applied before the rewrite as well as being
handed to monocart), taking peak RSS from 4.04 GB to 1.24 GB. This issue is the
remaining lever: stop *writing* what is always discarded.

`apps/ui/e2e/coverage.ts` can apply `isRepoSourceEntry` at `stopJSCoverage()`
time. The predicate already exists and is exported from `scripts/coverage-gate.ts`
— reuse it rather than restating it, so the collector and the merge cannot drift
about what counts as repo source.

Ride-along from the PR #19 re-review (MINOR): `scripts/coverage-gate.ts`'s
`readBrowserDumps` guards the `readFileSync` carefully — naming the file and
explaining that a concurrent `npm run e2e` empties the directory — and then
`JSON.parse`s the contents unguarded. A truncated dump (collector killed
mid-write, disk full) throws a bare `SyntaxError` with no filename, in the one
function whose reads now span the entire merge. Give the parse the same
treatment as the read.

## Acceptance Criteria
- [ ] The collector drops non-repo entries before writing; on-disk
      `coverage-raw/browser-v8/` roughly halves (report before/after bytes)
- [ ] A truncated/unparseable dump fails with the offending filename, like the
      unreadable-file path already does
- [ ] One predicate, shared with the merge — not a second copy
- [ ] Merged gate numbers are unchanged: all four metrics identical to a
      pre-change full run, proven by diffing `coverage-summary.json`
- [ ] `e2e-attribution.json` still attributes the same files
- [ ] Merge peak RSS re-measured and recorded

## Technical Design
### Files to Create/Modify
- `apps/ui/e2e/coverage.ts` — filter at collection
- `scripts/coverage-gate.ts` — export the predicate if it is not already reachable

### Notes
- This needs a full `npm run e2e` before and after. Coordinate with the
  orchestrator: it destroys `coverage-raw/browser-v8` on every run, and nothing
  else may be measuring against that directory at the time.

## Testing Strategy
Full e2e before and after; compare on-disk bytes, merged summary JSON, and peak
RSS. Unit coverage for the collector-side filter.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
