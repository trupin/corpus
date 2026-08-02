# [AGENT-010] Skills: reusable deliverables go in labeled fenced blocks

## Domain
agent-runtime

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
- SPEC.md §11 thread view copyable canvases (rider signed 2026-08-02)

## Summary
Companion to UI-041. The product agent's skills instruct it: any text the user
is expected to lift and reuse elsewhere — prepared prompts for other agents,
command lines, config snippets, drafted messages — is emitted inside a fenced
block with a short info-string label naming what it is (```prompt, ```command,
…), one deliverable per fence, prose outside the fence. The UI renders each
fence as a copyable canvas, so this convention is what makes the copy button
land on the right content.

## Acceptance Criteria
- [ ] comment (and orchestrate where it composes turns) SKILL.md carry the
      convention with a concrete example
- [ ] Wording keeps ordinary prose/code-discussion unaffected — only
      lift-and-reuse deliverables get fenced
- [ ] E2E: a real agent turn produced through the queue renders the labeled
      fence (verify with UI-041 landed, or assert the raw markdown shape)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md` (+ orchestrate if
  applicable)

## Testing Strategy
Skill-text assertions per existing agent-runtime test patterns.

## E2E Verification Plan
Real workspace: ask the agent for a prompt; the turn carries a labeled fence.

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
