# [CLI-057] `doc show` takes one id, so reading five documents costs five processes

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Related: CLI-058 (the per-invocation cost this multiplies), CLI-055

## Spec References
- SPEC.md **§2** — the CLI surface

## Summary

Reported from live use, 2026-08-21. `corpus doc show a b` is refused.

Accepting several ids replaces five calls with one and saves roughly **840ms**
each time. The reporter's reasoning is worth keeping: *"Returning more rows is
free next to the cost of asking, since latency is flat against payload."* That
is the same observation behind CLI-058, measured from the other end.

## Decisions to make and record

1. **What the output looks like for several documents.** `--json` should be an
   array; the human rendering needs a separator that a reader can scan and that
   a `sed` script cannot mistake for content.
2. **What happens when one id of five does not exist.** Failing the whole call
   punishes the four that were fine. Reporting per id is friendlier and needs an
   exit code that says "partial" honestly rather than 0.
3. **Whether a bound is needed**, and if so, whether exceeding it truncates or
   refuses. §11's stated-cap rule says a listing that reached its bound must say
   so rather than ending quietly, and the same principle applies here.
4. **Whether the same shape belongs on `thread show`.** Do not build it here
   without at least saying why the other verb is different.

## Acceptance Criteria
- [ ] `doc show a b c` returns all three
- [ ] `--json` is an array, stable in the order asked for
- [ ] A missing id among present ones is reported per id, not by failing all
- [ ] The exit code distinguishes all-found from partial
- [ ] One id still behaves exactly as it does today — no output change

## Testing Strategy
Unit over the multi-id path including the partial case. One end-to-end read of
three real documents.

## E2E Verification Log
_[Agent fills — state the model]_
