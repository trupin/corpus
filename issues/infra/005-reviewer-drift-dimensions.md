# [INFRA-005] Reviewer drift dimensions: interface-docs + spec-code

## Domain

infra

## Status

done

## Priority

P1

## Dependencies

- Depends on: INFRA-003
- Blocks: —

## Spec References

- CLAUDE.md — Git Workflow rule 3 (reviewer requirement)
- `.claude/agents/pr-reviewer.md` — the artifact under change

## Summary

Extend the pr-reviewer beyond INFRA-003's initial scope with two drift-focused check dimensions, both user-requested: (1) **interface-docs drift** — CLI/API changes must move their self-describing artifacts (registry/`--help`, `docs/cli.md`, `openapi.json`, generated client) in the same PR (landed via PR #3); (2) **spec-code drift, bidirectional** — code contradicting SPEC.md, new user-observable product behavior missing from SPEC.md, and SPEC.md edits contradicting untouched sections are all blocking findings (PR #4). This issue exists so reviewer-rule evolution is issue-traceable rather than riding on closed issues.

## Acceptance Criteria

- [x] Interface-docs drift dimension present with the hand-edit detection heuristic (generated file changed without source-of-truth change).
- [x] Spec-drift dimension present, bidirectional, with the tooling/dev-process carve-out (no spec coverage required for non-product changes).
- [x] Context discipline stays coherent: every check the rules mandate is reachable within the granted context (targeted SPEC.md search; targeted read of code a spec edit claims to describe).
- [x] Absence claims ("not in spec") have a defined search protocol and a downgrade path when absence can't be confidently established.
- [x] Severity assignments coherent with the file's severity legend (contradiction on a mainline user path may be CRITICAL).
- [x] All SPEC.md changes require user sign-off, stated uniformly across bullets.

## Technical Design

### Files to Create/Modify

- `.claude/agents/pr-reviewer.md` — the two dimensions + context grants

### Key Implementation Details

SPEC.md remains the source of truth for product behavior; the reviewer enforces that it and the code may not diverge silently in either direction. Context stays minimal: targeted searches, never end-to-end reads; heading-level scans allowed as a map.

### Edge Cases

- Spec-only alignment PRs (no code touched): the reviewer may read the specific code the spec edit describes — located by targeted search — without violating context discipline.
- Vocabulary mismatch between diff and spec: search feature synonyms and scan section headings before asserting absence; if still uncertain, file MINOR (question) rather than a wrong MAJOR.

## Testing Strategy

Dogfood: each rule change is itself reviewed by the pr-reviewer under the new rules (PRs #3, #4).

## E2E Verification Plan

### Verification Steps

1. Open the rule-change PR; spawn pr-reviewer on it; verify the verdict engages the new dimensions.

## E2E Verification Log

### Post-Implementation Verification

- PR #3 (interface-docs drift): reviewer APPROVE with 3 MINOR findings, all addressed pre-merge.
- PR #4 (spec drift): reviewer returned REQUEST_CHANGES with 2 MAJOR + 3 MINOR — including catching that the change rode on closed INFRA-003 (this issue is the fix) and an unfollowable context grant in the spec-edits bullet. All five findings addressed; re-review verdict recorded in the PR.

## Completion Checklist (domain agent)

- [x] Tests written and passing (dogfood reviews)
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[INFRA-005]` prefix (squash title)
