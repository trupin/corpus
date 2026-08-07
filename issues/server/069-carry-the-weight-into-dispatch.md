# [SERVER-069] Carry the chosen weight into the dispatch, and name it in the job log

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-039
- Blocks: UI-082

## Spec References

- SPEC.md §7 — the orchestrator-skill paragraph (a stated weight is honoured, not
  weighed again) and the console bullet (a dispatch names the weight it ran at)

## Summary

The server half of SHARED-022's missing middle — see CONTRACT-039 for how the
gap was found. The contract will carry a chosen level on the request; this issue
puts it where the dispatch can read it, and makes it visible afterwards.

**The visibility half is not decoration.** §7's console bullet naming the weight
a dispatch ran at is what makes the whole feature testable by an evaluator
reading SPEC alone — otherwise "honoured, not weighed again" is a claim only the
agent's own prose can support, which is exactly the shape of assertion this
project has repeatedly found to be false. It is also how a person tells a
request that was honoured from one that was not.

## Acceptance Criteria

- [ ] A level supplied on a request reaches the queue event's payload unaltered
- [ ] Absent stays absent — the server never substitutes a default, because
      absent means "the orchestrator decides" (§7) and a default here would
      silently remove that
- [ ] The server **records** the level and never **interprets** it: which model a
      level maps to is the skill's business (§7 keeps model names out of SPEC,
      and SHARED-022 keeps the level vocabulary in the workspace's own guidance).
      A server that validated levels against a list would freeze what the rider
      took pains to keep editable
- [ ] The job log names the weight a dispatch ran at, per §7's console bullet
- [ ] A job that ran in **stages** shows every one of them (SHARED-023's
      amendment to the same bullet) — so this and AGENT-018 must agree on what a
      stage records

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/` (the event payload) and the job-log write path.

### Notes

- **Do not enforce the level's meaning anywhere in the server.** The temptation
  is to validate against an enum for safety; the cost is that a workspace editing
  its guidance table then gets rejected by its own server. Shape-validate, pass
  through, record.
- SHARED-023 says a job may run in stages at different weights, with the
  *deciding* stage at the governing weight. Whatever this issue records must be
  able to represent more than one weight for one event, or AGENT-018's rule will
  be unobservable — check that before choosing a shape.

## Testing Strategy

Round-trip: a request carrying a level produces an event carrying it; a request
without one produces an event without one; the job log line names it. Plus a
staged case, once AGENT-018's shape is known.

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
