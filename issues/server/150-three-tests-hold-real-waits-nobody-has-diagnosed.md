# [SERVER-150] Three tests hold real waits, and one of them nobody has diagnosed

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: INFRA-020
- Blocks: —

## Spec References

- —


## Carried, deliberately (user decision, 2026-08-26)

Surveyed after v0.24.0, having gone untouched through three releases, and kept
open rather than closed or forced into a scope. The reasoning is recorded here so
it is not re-litigated every release: it is real, it is not urgent, and nothing
is blocked by it.

The alternative offered and declined was closing it on the grounds that the
test has never failed. INFRA-020 exists because two things this repository
carried as flakes turned out to be product defects a green suite could not see,
so *it has not failed yet* is exactly the argument that rule refuses.

## Summary

Filed out of INFRA-020, which established the rule and then declined to break it
in the commit that introduced it.

`npm run test:slow` over a full 4675-test `apps/server` run under a load average
of 19–25 reports **one** test at or above half its own budget:

- **`apps/server/src/folders/acts.test.ts:299` — 51%, 2537 ms, undiagnosed.**
  Nobody has named this one before. INFRA-020's rule is *diagnose before sizing*,
  so it was left alone rather than given a number. That is this issue's first job.

Two more were given stopgap budgets and say so in their own comments:

- **`apps/server/src/attachments/serve.real-listener.test.ts:139`** — 4328 ms
  idle, 4570 ms loaded. It is the first in its file to bind a real listener, so
  it pays a one-time warm-up its six siblings (241–266 ms each) do not. **The
  real remedy is a `beforeAll`**, not a larger budget.
- **`apps/server/src/events/sse.test.ts:306`** — 4042 ms idle, 4107 ms loaded.
  **Not warm-up.** It is last in its describe and its neighbours cost 33–110 ms,
  so it holds a real ~4 s wait. Recorded as an unverified hypothesis:
  `SHUTDOWN_GRACE_MS` is 5000. **The remedy is to remove the wait.**

Neither is load-sensitive. Both were re-measured under six added spinners (load
6.3–12.8) and moved 174 ms and 25 ms. They are slow, not contended — which is
exactly the distinction INFRA-020's diagnosis order exists to force, and exactly
what a bigger timeout would have hidden.

## Acceptance Criteria

- [ ] `acts.test.ts:299`'s 2537 ms is **diagnosed** — what the time is spent on —
      before anything is changed. A budget without a diagnosis is the thing
      INFRA-020 forbids
- [ ] `serve.real-listener.test.ts`'s warm-up moves to a `beforeAll`, so the cost
      is paid once rather than billed to whichever test runs first
- [ ] `sse.test.ts:306`'s wait is removed rather than waited out, or the
      hypothesis is disproved and the real cause recorded
- [ ] The stopgap `15_000` budgets come back down to whatever the fixed tests
      actually need, measured
- [ ] `npm run test:slow` reports zero findings afterwards, or the survivors
      carry a diagnosis

## Testing Strategy

No assertion in any of the three should change. If one has to, that is a
finding worth reporting rather than an edit worth making.

## E2E Verification Log

_(to be filled by the implementing agent)_
