# [INFRA-042] A budget-stopped run still testifies against the product

## Domain

infra

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: INFRA-037 (whose cut-short clause this parallels)
- Related: INFRA-036 (the family: the harness blaming the product for its
  own stopping)

## Spec References

- None. Harness-internal.

## Summary

Found in the v0.34.0 release pass (2026-09-06). INFRA-037 decided a
**cut-short** run (runner exit) contributes no universal findings, because
its workspace is mid-flight. A run **ended by budget** is stopped mid-flight
by the harness for the same reason — yet it still contributes universal
findings: scenario 11 runs 8 and 10 (both `ended by budget`) each carry a
`user`-authored-commit finding, and run 10 a `doc check exited 6` finding,
all counted against the scenario's grade.

The findings themselves may be real (AGENT-074 tracks the product half).
What is harness-wrong is the asymmetry: two ways of being stopped
mid-flight, one excused and one counted.

## What to build

Decide deliberately, as INFRA-037's criterion demanded for cut-short: either
budget-ended runs are excluded from universal findings for the same
mid-flight reason, or the asymmetry is justified in writing (a budget end is
graceful — the harness waits out the quiescence hold first? verify what the
runner actually does at budget) and the decision recorded in score.ts's doc
comment. Whichever way: the same narrowness rule — the clause must not
swallow a genuine hand-edit on a completed run.

## Acceptance Criteria

- [ ] What "ended by budget" actually does to the workspace is established
      from run.ts, not assumed
- [ ] The exclusion decision is made, tested both ways, and recorded beside
      INFRA-037's clause
- [ ] Scenario grades change only through that decision — no scenario's
      threshold moves

## E2E Verification Log

_Implementing agent fills; state the model._
