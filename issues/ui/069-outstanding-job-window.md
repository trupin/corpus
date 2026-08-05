# [UI-069] Drop the 50-job window from the outstanding-request lookup

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-056
- Blocks: —

## Spec References
- SPEC.md §8 (the honest pending indicator), §11 (the board)

## Summary
The consumer half of CONTRACT-030 / SERVER-056, and the reason both were filed.

`apps/ui/src/thread/outstandingAgentRequest.ts` answers "does the agent still owe
this thread an answer?" by scanning the console's unfiltered job list, which the
server truncates to `DEFAULT_RECENT_JOBS = 50`. The module's docblock now states
that bound explicitly — including the false negative it produces (a deferred or
long-queued job falls out of the window and the "working…" row vanishes while the
reply is still coming) — and `outstandingAgentRequest.test.ts` pins it with a
test that will fail the moment the behaviour changes. Both are placeholders for
this issue.

Once the filtered query exists, this becomes a two-line change plus the removal
of a paragraph of apology.

## Acceptance Criteria
- [ ] `useOutstandingAgentJob` asks the filtered query (by `originId`, and by
      status if the contract offers it) instead of scanning the console list
- [ ] The docblock's "what this answers, and inside what window" section is
      **deleted**, not softened — the window is gone or it is not fixed
- [ ] The window-pinning test is replaced by one that proves the opposite: a job
      buried behind more than `DEFAULT_RECENT_JOBS` newer rows is still found
- [ ] `packages/kit/src/row/useRowSignals.ts` gets the same treatment, or
      SERVER-054's honest server-side answer makes its job lookup redundant —
      decide which, and say so
- [ ] Nothing regresses on the shared-key economics: say how many requests a
      board full of cards now issues, and why that is acceptable

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/outstandingAgentRequest.ts` and its test
- `packages/kit/src/row/useRowSignals.ts` if it is still the caller

## Testing Strategy
Replace the window-pinning test with a buried-match test at the transport level
(`readerFixture`), so it proves the *request* changed rather than the scan.

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
