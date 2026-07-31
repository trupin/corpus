# [INFRA-013] npm-audit gate: zero findings, enforced at pre-commit and CI

## Domain
infra

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-016 (router 8 clears the last known advisories — user decision 2026-07-31: upgrade first, then strict gate)
- Blocks: —

## Spec References
- None product-behavioral — dev-harness validation (user request 2026-07-31)

## Summary
User directive: `npm audit` must report **zero vulnerabilities of any severity** —
no allowlist, no severity floor — enforced in BOTH the pre-commit hook and CI's
validate workflow. Sequenced after UI-016 (the two react-router moderates are the
only current findings; post-router-8 the tree audits clean — verified 2026-07-31).

Design points for the implementing agent:
- Gate command: `npm audit --audit-level=low` (or `--json` + a small checker for an
  exact zero-count assertion — pick whichever gives a crisp failure message naming
  each advisory; document the choice). Workspaces are covered by the root audit.
- **Pre-commit offline behavior (orchestrator default, reviewer may challenge):**
  fail on findings; if the registry is UNREACHABLE, print a loud warning and
  continue — a network outage must not block local commits; CI is the fail-closed
  backstop. CI always fail-closed.
- Keep the hook fast: audit uses the lockfile + one registry round-trip; measure and
  record the added latency. If it exceeds ~5s locally, raise it in the report (the
  user chose pre-commit knowingly; do not silently move it to pre-push).
- CI: a dedicated step in the validate workflow, early (before build), so audit
  failures are cheap and clearly labeled.

## Acceptance Criteria
- [ ] A dependency with any-severity advisory fails pre-commit AND CI with the advisory named (drill: temporarily pin a known-vulnerable version in a scratch branch of the tree, prove both gates catch it, revert — never commit the vulnerable pin)
- [ ] Clean tree: both gates pass; pre-commit latency measured and recorded
- [ ] Registry unreachable: pre-commit warns loudly and proceeds; CI fails closed
- [ ] No allowlist mechanism exists anywhere in the implementation

## Technical Design
### Files to Create/Modify
- `.githooks/pre-commit`, `.github/workflows/` validate workflow (+ any small script under `scripts/` with tests if a checker is written)

## Testing Strategy
Script-level tests if a checker script exists; the drill in the acceptance criteria is the E2E.

## E2E Verification Plan
The vulnerable-pin drill both locally (hook) and on a scratch CI run; clean-state pass; offline simulation (block the registry host) for the pre-commit warn-and-proceed path.

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
