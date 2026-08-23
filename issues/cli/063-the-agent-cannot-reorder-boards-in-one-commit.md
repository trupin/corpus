# [CLI-063] The agent cannot reorder boards in one commit, and the UI now can

## Domain
cli

## Priority
P2

## Status
todo

## Model
opus

## Dependencies
- Depends on: CONTRACT-080 (the route), CLI-060 (the board verbs)

## Spec References
- SPEC.md §2 — the CLI is the agent's whole surface
- SPEC.md §9.2 — `POST /api/boards/order`
- SPEC.md §10 — rider 2: "reordering boards writes `order` on every board, in one commit"

## Summary

Raised by PR #58's second review.

Rider 2's "in one commit" was unmet in the UI, and CONTRACT-080 fixed it with
`POST /api/boards/order`. **The agent has no verb for that route.** Its only
lever is `corpus doc edit <id> --order N`, one document at a time — the exact
shape the review condemned in `moveBoard`.

The board-order agent argued this is not a gap, on the ground that §4's commit
window belongs to a *party*, so the agent's several writes already fold into one
commit. That is true and it is the reason this is P2 rather than P1. But it
makes the agent's compliance an accident of the window's timing rather than a
property of the act, and the window can close between two writes.

`assets/workspace/data/docs/boards/attention.md` currently tells the agent to
reorder by changing `order` on each board document, which is correct today and
would need one line changed if a verb arrives.

## Acceptance Criteria
- [ ] `corpus board order <id> <id> …` calls `POST /api/boards/order` and prints
      what the act says it wrote
- [ ] The seed board's guidance names the verb instead of the per-document edit
- [ ] A test asserts one commit, against real git history rather than against
      the number of requests — that is the claim the rider makes
- [ ] The refusals the route already declares are shown, not swallowed

## Testing Strategy
Vitest for the verb, and a real-workspace test counting commits.

## E2E Verification Plan
### Verification Steps
1. Reorder three boards through the verb in a real workspace.
2. `git log` shows one commit naming three files.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CLI-063]` prefix
