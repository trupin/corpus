# [AGENT-005] Orchestrate skill: delegate jobs to subagents by default

## Domain
agent-runtime

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Depends on: AGENT-002 (orchestrate skill)
- Blocks: —

## Spec References
- SPEC.md §7 — "Orchestrator skill" paragraph, amended and signed off 2026-07-30 (SHARED-004): **delegate everything** (no inline path), bound **10** concurrent subagents, parallelism gated on non-overlapping touched-sets (overlapping work serial, dispatch order), subagent **model scales with task weight** — the concrete tier table (including **Opus 5**) lives in the skill, not the spec. Outcomes recorded only from subagent reports (`agent.done` wake-back, `reap-stale` recovery); all invariants (CLI-only, locks, job-log lines, trace lines) bind subagents.

**Scope note (user clarification 2026-07-30): this is the PRODUCT orchestrator** — the orchestrate skill `corpus init` installs into a user's workspace. It does not change this repo's dev harness, whose ~3-agent machine-load cap stands. Keep the distinction explicit in the skill text.

## Summary
User request (2026-07-29, follow-up phase after PR #11): the product's orchestrator
agent currently works jobs inline, so it can only take tasks from the queue serially —
while it is deep in one task it is closed to new queue events. Change the orchestrate
skill so the default is to **delegate each job to a subagent** and return to parking on
the queue, keeping the orchestrator open to new tasks and enabling concurrent job
processing. Needs design judgment (hence fable): which jobs still warrant inline
handling, how subagent failures surface back into the queue/thread protocol, how the
CLI-only invariant and trace-line emission (AGENT-004) carry into subagents, and
machine-load bounds on concurrent subagents.

## Acceptance Criteria
- [ ] spec-writer amends SPEC.md §7 to describe delegation behavior (WHAT, user-signed-off) before implementation
- [ ] Orchestrate skill delegates queue jobs to subagents by default; the parent promptly resumes queue parking
- [ ] Subagent failures/deferrals surface through the existing job protocol (no silently lost jobs)
- [ ] Trace lines and CLI-only invariant hold inside subagents (transcript-provable, as AGENT-003/004 established)
- [ ] Concurrency bound documented and enforced (machine-load discipline)

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` (+ any subagent persona files the design calls for)

### Key Implementation Details
To be refined after the spec amendment; study how the dev harness's own orchestrator/domain-agent split handles reporting and failure escalation — it is the working precedent.

### Edge Cases
- Two subagents mutating the same document (lock contention → deferral protocol).
- Subagent dies mid-job: job must not evaporate.

## Testing Strategy
Live `claude` session drills with retained transcripts (the AGENT-003/004 methodology).

## E2E Verification Plan

### Verification Steps
1. Real workspace, real queue: enqueue two jobs; verify the second is picked up while the first's subagent still runs; verify both complete and trace correctly.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
