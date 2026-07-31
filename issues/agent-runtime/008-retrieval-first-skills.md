# [AGENT-008] Retrieval-first stewardship rules in the product skills

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-019
- Blocks: AGENT-009

## Spec References
- SPEC.md §1 retrieval principle (SHARED-006 Edit 1), §7 Retrieval discipline rules (Edit 4)

## Summary
Bind the three signed rules into `assets/workspace/claude/skills/{orchestrate,comment}/SKILL.md`:
**search before reading** (locating content is `corpus search`/`corpus doc related`;
reading a body is a separate deliberate act on a retrieved id), **never enumerate the
corpus** (no wholesale listing/reading to find something), **subagents receive
anchors, not documents** (delegated dispatches carry task + top-k ids/heading
paths/snippets; the subagent retrieves what it needs itself). Rules bind the
orchestrator and every subagent (§7's "every invariant binds subagents"). Weave into
the existing delegation (N=10) and comment-handling text — don't bolt on a section
that contradicts the surrounding flow; update the subagent-dispatch brief template to
carry anchors.

## Acceptance Criteria
- [ ] Both skills state the three rules and use the verbs in their worked examples; no remaining instruction tells the agent to list/read the corpus wholesale
- [ ] Dispatch template passes top-k anchors; explicitly forbids forwarding whole documents
- [ ] Skill text stays consistent with the delegation/defer/trace-line rules already there (read the whole files first)

## Technical Design
### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md`, `assets/workspace/claude/skills/comment/SKILL.md`

## Testing Strategy
Prose-only change: `/usr/bin/grep` audits for contradicting instructions; `npm run format:check` on the touched files. The workspace-template copy test (if one exists in apps/cli) still green.

## E2E Verification Plan
`corpus init` a scratch workspace (explicit path under the job tmp dir) and read the installed skills: rules present, examples use `corpus search`.

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
