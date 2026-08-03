# [AGENT-011] Orchestrate: reflect-on-edit handling for doc.edited events

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-026
- Blocks: —

## Spec References
- SHARED-008 rider; SPEC §7/§8 loop; AGENT-008 retrieval-first rules

## Summary
Teach the orchestrate skill to handle `doc.edited`: fetch the diff via
`corpus doc diff` (the event's range), reflect, act. The reflection is
retrieval-first: from the changed content, `corpus search`/`corpus doc
related` to find documents the change ripples into; where it does, update
them (ordinary stewardship edits, stated in a reply/trace) or open a
comment where the right move is a question; where it does not, acknowledge
briefly on the document's own surface (a short whole-document-thread note or
the established acknowledgment convention — decide against the existing
thread conventions, don't invent a new surface). Judgment guidance: trivial
edits (typos, formatting) get silent completion (complete the event, no
acknowledgment spam); substantive edits get the reflection. The skill must
restate the actor-scoping guarantee (its own edits never produce events) so
the model doesn't defensively self-suppress.

## Acceptance Criteria
- [ ] Orchestrate SKILL.md handles doc.edited with the reflect procedure and
      the triviality guidance; fits section-count constraints (see domain
      knowledge 2026-08-02)
- [ ] One worked example (fetch diff → related check → one update + trace)
- [ ] E2E: real queue drill — user edit → event → agent session reflects,
      updates a genuinely related doc, completes the event

## Technical Design
### Files to Create/Modify
- assets/workspace/claude/skills/orchestrate/SKILL.md; template tests

## Testing Strategy
Skill-text assertions; the real drill per the E2E plan.

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
