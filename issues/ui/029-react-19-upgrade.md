# [UI-029] React 18 → 19 across apps/ui, packages/kit, plugins

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: UI-016

## Spec References
- None product-behavioral — dependency prerequisite (UI-016's react-router@8 requires React ≥19.2.7)

## Summary
UI-016's blocker (2026-07-31, measured): all react-router 8.x releases declare React
≥19.2.7 peers AND statically import `useOptimistic` (absent in 18) — no legacy-peers
workaround exists, and no router line below 8.3.0 is audit-clean. Upgrade React
18.3.1 → 19.x in apps/ui, packages/kit (peer range widened — the kit-manifest
adjudication is granted HERE, recorded per sprint-018 Adjudication 6's naming), and
plugins' dev deps. Feasibility already measured by UI-016's agent: every other React
consumer accepts 19 (react-query, tiptap, testing-library, react-markdown); zero
React-19-removed patterns in the codebase (/usr/bin/grep audit: no defaultProps,
ReactDOM.render, test-utils, string refs, no-arg useRef, JSX-namespace refs).

## Acceptance Criteria
- [ ] React/react-dom 19.x everywhere; kit peer range `^19`; no unmet peers, single hoisted React (`npm ls`)
- [ ] Full apps/ui + packages/kit suites green; hermetic e2e green; no behavior deltas beyond React's own (document any act() warnings resolved)
- [ ] plugins/ typecheck green against the widened kit peer

## Technical Design
### Files to Create/Modify
- package.json manifests (root/ui/kit/plugins dev), package-lock; code only where React 19 semantics force it (expected: none)

## Testing Strategy
Scoped suites per workspace; the phase gate is the single repo-wide run.

## E2E Verification Plan
Real app smoke walk (board, reader, focus, threads, console) post-upgrade.

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
