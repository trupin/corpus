# [DOMAIN-NNN] Title

## Domain
<!-- The domain this issue belongs to (must match a directory in issues/) -->

## Status
todo | in_progress | done | blocked

## Priority
P0 (critical path) | P1 (important) | P2 (nice-to-have)

## Dependencies
- Depends on: [DOMAIN-NNN], ...
- Blocks: [DOMAIN-NNN], ...

## Spec References
- SPEC.md Section N — "Section Title"

## Summary
One paragraph: what this accomplishes and why.

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Technical Design

### Files to Create/Modify
- `path/to/file.ext` — purpose

### Key Implementation Details
Enough detail for an autonomous agent to implement without asking questions.

### Edge Cases
- ...

## Testing Strategy
How to verify this works (unit/integration tests with mocks are fine here).

## E2E Verification Plan
How to verify this against the **real running application** — no mocks, no test
clients, no in-memory databases. Start the actual application, exercise it through
its real public interfaces (HTTP endpoints, CLI commands, browser UI, etc.).

### Reproduction Steps (bugs only)
1. Start the application
2. [steps to trigger the bug through the real interface]
3. Expected: [what should happen]
4. Actual: [what goes wrong]

### Verification Steps
1. Restart the application after code changes
2. [steps to verify the fix/feature through the real interface]
3. Expected: [what should happen after implementation]

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. The evaluator will reject issues without credible proof._

### Reproduction (bugs only)
_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
