# [UI-055] The design mockup still shows and binds the old composer keys

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-052
- Blocks: —

## Spec References
- SPEC.md §11 composer key contract (SHARED-009 Amendment 1, signed 2026-08-03)

## Summary
Noted by UI-052 and deliberately left alone: `design/index.html` — the living UI
mockup, authoritative for look and feel — still shows `Reply ↵`, `Ask ↵`,
`Capture ⌘↵` and `⇧↵ newline`, and its prototype JavaScript still binds those
keys. The amended §11 supersedes it, so the app is right and the mockup is stale.

Left out of UI-052 because several agents were working in the tree and rebinding
prototype JS is an unrelated chore. It matters because the mockup is what gets
consulted for "how should this look" — a stale key label there will be copied
into something eventually.

## Acceptance Criteria
- [ ] Labels updated: `Reply ⌘↵`, `Comment ⌘↵`, `Ask ⌘↵`, `Capture ⇧⌘↵`, and the
      hint reads `↵ newline`
- [ ] The prototype's key bindings match the contract (`↵` newline, `⌘↵` primary,
      `⇧⌘↵` secondary)
- [ ] The mockup's composer fields are multi-line where the app's now are, so the
      mockup does not disagree about the shape either
- [ ] Nothing else in the mockup changes

## Technical Design
### Files to Create/Modify
- `design/index.html`

## Testing Strategy
Visual check; the mockup carries no test suite.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] `/lint` passes (prettier covers the file)
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
