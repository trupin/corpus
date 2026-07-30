# [UI-017] Never leave an empty untitled document behind

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-006 (editor), UI-005 (reader navigation)
- Blocks: —

## Spec References
- SPEC.md §11 — documents/editor (needs a spec-writer pass: define the create/abandon behavior before implementation)

## Summary
User request (2026-07-29, follow-up phase after PR #11): creating a document in the UI
and exiting without typing anything currently leaves an empty, untitled document in the
corpus. Desired behavior: exiting a still-empty new document deletes it — equivalently,
never persist an empty + untitled document from the UI create flow. Design question for
the spec pass: create-then-delete-on-exit vs. defer-creation-until-first-content (the
latter avoids commit noise in the git audit trail but changes when the doc id exists,
which threads/anchors may assume). Server participation (a delete or deferred-create
call) makes this potentially cross-domain — decompose after the spec amendment if so.

## Acceptance Criteria
- [ ] spec-writer amends SPEC.md with the chosen behavior (user-signed-off)
- [ ] Exiting a new document that has no title and no body content leaves no document behind (board, search, disk, git all clean per the chosen design)
- [ ] A new document with any content (title or body) persists exactly as today
- [ ] No orphaned locks/threads from the abandoned doc

## Technical Design

### Files to Create/Modify
- apps/ui document create/exit flow (locate from UI-005/UI-006); possibly a server/contract rider after decomposition

### Key Implementation Details
To be refined after the spec amendment.

### Edge Cases
- Exit via navigation, tab close, and SSE-driven board refresh mid-edit.
- Content typed then fully deleted before exit — still "empty"?
- Autosave (UI-013 buffer semantics) interacting with the abandon path.

## Testing Strategy
Vitest for flow logic; Playwright e2e for the abandon path.

## E2E Verification Plan

### Verification Steps
1. Real app: create doc → exit untouched → board shows nothing, `data/docs/` clean, no commit (or per chosen design)
2. Create doc → type → exit → persists

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
