# [INFRA-044] Branches back to 90, under the honest ruler

## Domain

infra

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-043 (the instrument change that re-baselined it)

## Spec References

- None. Gate policy.

## Summary

Vitest 4's AST-aware remapping enumerates branches in never-entered code,
which Vitest 3 scored as fully covered — the same tree reads 93.07% on the
old instrument and 89.64% on the new. INFRA-043 re-baselined the branches
threshold to 89.5 rather than write tests mid-security-fix. This issue is
the climb back: close ~72 branches and restore the 90.

The measured biggest chunk: `packages/contract/src/release.ts` — 11
functions, no test, 0 of 66 branches (Vitest 3 called that 100%). Covering
it alone reaches 89.97%.

## Acceptance Criteria

- [ ] `packages/contract/src/release.ts` gains real tests
- [ ] The merged gate passes at branches >= 90 and the threshold in
      `scripts/coverage-config.ts` returns to 90 in the same commit
- [ ] Any remaining sub-90 gap is closed by tests, never by globs

## E2E Verification Log

_Implementing agent fills; state the model._
