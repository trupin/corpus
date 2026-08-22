# [UI-069] Drop the 50-job window from the outstanding-request lookup

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-056
- Blocks: —

## Spec References
- SPEC.md §8 (the honest pending indicator), §10 (the board)

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
- [x] `useOutstandingAgentJob` asks the filtered query (by `originId`, and by
      status if the contract offers it) instead of scanning the console list
- [x] The docblock's "what this answers, and inside what window" section is
      **deleted**, not softened — the window is gone or it is not fixed
- [x] The window-pinning test is replaced by one that proves the opposite: a job
      buried behind more than `DEFAULT_RECENT_JOBS` newer rows is still found
- [x] `packages/kit/src/row/useRowSignals.ts` gets the same treatment, or
      SERVER-054's honest server-side answer makes its job lookup redundant —
      decide which, and say so
- [x] Nothing regresses on the shared-key economics: say how many requests a
      board full of cards now issues, and why that is acceptable

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/outstandingAgentRequest.ts` and its test
- `packages/kit/src/row/useRowSignals.ts` if it is still the caller

## Testing Strategy
Replace the window-pinning test with a buried-match test at the transport level
(`readerFixture`), so it proves the *request* changed rather than the scan.

## E2E Verification Log
Ran on **opus** (orchestrator, directly — the session's subagent limit was reached).

**`useRowSignals` deliberately does NOT get the same treatment**, which was the
issue's open question. The two hooks look alike and their economics are
opposite: the thread hook runs once per **open reader**, so a filtered query per
thread costs a handful of requests; `useAgentActivity` runs once per **card**, so
the same change on a column of two hundred rows would issue two hundred requests
under two hundred distinct `["jobs", {originId}]` keys — destroying the single
shared key that is the stated reason neither row signal is drilled down as a prop.

The row keeps the console query, and loses less than it looks. A job leaves the
window by *waiting* — deferred on a lock, or behind a backlog — and a row whose
thread is waiting on the agent has `DocRow.awaitingAgent` set by the server,
which is neither windowed nor a scan. So the dot stays lit on the evidence that
survives; what degrades is the dot's *label*, from the job's `lastLine` to a
description of the wait. Both docblocks now state this, each pointing at the
other.

- The window-pinning test is **replaced by its opposite**, and moved to the
  transport as the issue asked: `readerTransport` now answers `/api/jobs` the way
  the server does (`recent` bounds the console list, ignored once `originId` is
  given), so a caller that went back to scanning fails the test. A fixture that
  returned everything regardless of the query would have let it pass.
- The new test buries the deferred job behind `DEFAULT_RECENT_JOBS` newer rows,
  asserts the hook finds it, **and** asserts the request carried
  `originId=…&status=pending,in-progress,deferred` — proving the request changed
  rather than the scan.
- `OUTSTANDING_STATUS_PARAM` is derived by joining `OUTSTANDING_STATUSES`, so the
  filter sent and the predicate applied cannot disagree about "outstanding".
- `apps/ui` + `packages/kit` **2810/2810**; ESLint and Prettier clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
