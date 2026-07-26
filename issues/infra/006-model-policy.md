# [INFRA-006] Per-issue model recommendations; pr-reviewer pinned to Fable

## Domain

infra

## Status

done

## Priority

P1

## Model

opus — mechanical template/docs wiring of a user-stated policy. (Implemented directly by the orchestrator in-session.)

## Dependencies

- Depends on: INFRA-005
- Blocks: —

## Spec References

- CLAUDE.md — Model Policy, Orchestration Loop step 7, Git Workflow rule 3

## Summary

User-stated policy: don't spend Fable on tasks that don't need it — implementation defaults to Opus, with Fable reserved for judgment-heavy work; the pr-reviewer, which makes the judgment calls about the codebase's direction, always runs on Fable. Wire this through the issue template (new **Model** section), the filing/decomposition/orchestration skills, CLAUDE.md, the reviewer's frontmatter (`model: fable`), and the open issues.

## Acceptance Criteria

- [x] `issues/TEMPLATE.md` has a Model section (opus default; fable for judgment-heavy work; reviewer exempt from the field).
- [x] `/issue` and `/decompose` set a Model recommendation on every filed issue; `/implement` passes it as the spawn-time model override (missing ⇒ opus).
- [x] CLAUDE.md documents the Model Policy and forbids downgrading the pr-reviewer.
- [x] `.claude/agents/pr-reviewer.md` frontmatter pins `model: fable`.
- [x] Open issues carry recommendations: SHARED-001 → fable (spec revision), CONTRACT-001 → opus, INFRA-004 → opus.
- [x] Specialized agents pinned in frontmatter: spec-writer → fable; evaluator, sprint-planner, context-manager → opus; haiku carve-out documented (read-only exploration only, never writes).
- [x] Escalation ladder documented: ambiguity → escalate, not guess; two failed evaluator/reviewer rounds → re-spawn on fable and correct the issue's recommendation.
- [x] Orchestrator-side judgment work (adjudicating findings, /decompose, spec-change prep) named fable-tier, never delegated below.
- [x] Implementing agents record the actual model in the E2E Verification Log (template instruction + /implement verification check).

## Technical Design

### Files to Create/Modify

- `issues/TEMPLATE.md`, `.claude/skills/{issue,decompose,implement}/SKILL.md`, `CLAUDE.md`, `.claude/agents/pr-reviewer.md`, the three open issue files, `issues/PLAN.md`

### Key Implementation Details

The recommendation is advisory-by-default, binding-at-spawn: the orchestrator reads it when spawning and applies it as the Agent-tool model override. The reviewer pin lives in agent frontmatter so it holds regardless of what model the orchestrator session runs on.

### Edge Cases

- Issue with no Model section (legacy/forgotten): orchestrator treats as opus.
- An opus-run domain agent that hits genuine architectural ambiguity escalates to the orchestrator rather than deciding — same escalation path as before; the policy doesn't change who decides, only who executes.

## Testing Strategy

N/A (process/docs). Consistency check: template, skills, and CLAUDE.md name the same default and the same exception.

## E2E Verification Plan

### Verification Steps

1. Next `/implement` run spawns a domain agent with the issue's recommended model; next `/pr` run spawns the reviewer on fable.

## E2E Verification Log

### Post-Implementation Verification

- Policy wired across template/skills/CLAUDE.md/agent frontmatter in this PR; grep-verified the default (opus) and exception (reviewer → fable) are stated identically in all four places.
- Runtime verification deferred to the next implementation cycle (no domain-agent spawn occurs in this docs-only PR); the reviewer run on this very PR executes under the new frontmatter pin.

## Completion Checklist (domain agent)

- [x] Tests written and passing (N/A — consistency check done)
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[INFRA-006]` prefix (squash title)
