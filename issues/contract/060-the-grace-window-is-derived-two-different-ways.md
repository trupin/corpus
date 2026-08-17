# [CONTRACT-060] The grace window is derived two different ways, and both tests pass by coincidence

## Domain

contract (and server)

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Related: SERVER-112, CONTRACT-045

## Summary

The presence grace window is computed twice, from **different multiplicands**:

- `packages/contract/src/schemas/queue.ts:343` —
  `AGENT_PRESENCE_WINDOW_SECONDS = DEFAULT_IDLE_TIMEOUT_SECONDS * 2`, pinned by
  `queue.test.ts:501`
- `apps/server/src/queue/liveness.ts:65-71` — documented as deriving from the
  **max**, and `liveness.test.ts:47` pins
  `LANE_GRACE_MS === MAX_IDLE_TIMEOUT_SECONDS * 1000 * 2`

**Both tests pass only because `DEFAULT === MAX === 480`.** Change either
constant alone and exactly one test fails — and the surviving one will certify a
window that no longer follows the rearm gap it was supposed to.

The argument at `queue.ts:335` is that the window is written as a multiple *so
that it follows the rearm*. A second copy following a different multiplicand
defeats exactly that argument, silently, at the moment somebody tunes a timeout.

Found by PR #48's third review. It is the same shape as the CRITICAL that review
round opened with — one rule written twice — arriving through a constant rather
than a walk.

## Acceptance Criteria

- [ ] One derivation. The server reads the contract's constant rather than
      re-deriving it, or the contract publishes the multiplicand it means and
      both cite it
- [ ] A test fails if `DEFAULT_IDLE_TIMEOUT_SECONDS` and
      `MAX_IDLE_TIMEOUT_SECONDS` stop being equal **and** the window still
      derives from the wrong one — the current tests both pass in that world,
      which is the defect
- [ ] `liveness.ts`'s docblock says which multiplicand is correct and why. §7
      guarantees the window is longer than a rearm gap, and a rearm gap is
      bounded by the **max**, so the reasoning should be stated once and cited
- [ ] Checked red by making the two constants differ

## Testing Strategy

Unit. The counterfactual — set the constants apart and confirm the suite goes
red in the right place — is the test that matters.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-060]` prefix
