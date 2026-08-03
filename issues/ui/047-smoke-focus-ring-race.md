# [UI-047] Flaky spec: the focus-ring check tabs before the app is interactive

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- —

## Summary
`apps/ui/e2e/smoke.spec.ts:223 › theme › focus rings match the prototype` was
reported **flaky** by CI on PR #19 (run 30785254409 — passed on retry, so it did
not fail the build). Diagnosed in passing during INFRA-017.

The spec fires three blind `page.keyboard.press("Tab")` immediately after
`page.goto("/")` with **no wait for the app to be interactive**. Every other
assertion in that spec waits for something; this one races React's first render,
so under load the third Tab lands somewhere other than `.btn-compose` and the
ring assertion reads the wrong element.

This is a test defect, not a product defect: the ring itself is fine, the spec is
asserting before there is anything to assert against. Likely fix is an
`await expect(compose).toBeVisible()` (or equivalent readiness wait) before the
presses — but check the whole spec for the same shape rather than patching the
one line, and prefer waiting on the thing being asserted over a fixed delay.

Verify with `--repeat-each` under deliberate CPU load, since a single green run
proves nothing about a race that only appears under contention.

## Acceptance Criteria
- [ ] The spec waits for interactivity before sending keys
- [ ] Any sibling assertion in the file with the same race is fixed too
- [ ] Stable under `--repeat-each=5` with the machine loaded
- [ ] No fixed-duration sleep introduced

## Technical Design
### Files to Create/Modify
- `apps/ui/e2e/smoke.spec.ts`

## Testing Strategy
Repeat runs under load; no product code changes expected.

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
