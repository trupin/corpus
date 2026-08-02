# [PLUGINS-008] Legacy frontmatter-items todo renders a silently empty body

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: —

## Spec References
- SPEC.md §12 todos (body-checkbox format, `corpus todos migrate`)

## Summary
Live dogfood report (2026-08-02, v0.1.0): a workspace whose todo documents
predate the PLUGINS-005 body-checkbox redesign (items under `items:` in
frontmatter, empty body) renders a reader with the stats card populated (the
projection still counts frontmatter items) and a completely empty body — no
checkboxes, nothing to toggle, select, comment on, or right-click. Every todo
affordance silently vanishes with no clue; the remedy (`corpus todos migrate`)
is undiscoverable from the UI. Cost the user all todo functionality until
diagnosed by hand.

## Acceptance Criteria
- [ ] A todo document with frontmatter `items:` and an empty body shows an
      explicit legacy-format notice in the reader naming `corpus todos migrate`
      (agent-side verb — the notice explains the agent/CLI runs it)
- [ ] Legacy items render read-only under the notice (visible, not interactive),
      so content is never invisible
- [ ] A migrated document renders exactly as today — the notice never shows
- [ ] Stats card behavior unchanged

## Technical Design
### Files to Create/Modify
- `plugins/todos/` reader-side surface (wherever the stats card is contributed)
- Possibly `packages/kit` if the plugin cannot see frontmatter extras — escalate
  to a CONTRACT issue if the doc payload lacks the `items` extra

## Testing Strategy
Unit tests on the legacy-detection + rendering; e2e with a legacy fixture doc.

## E2E Verification Plan
Real app: create a legacy-format todo file on disk; reader shows the notice and
read-only items; run migrate; notice disappears and checkboxes work.

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
