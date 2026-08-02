# [UI-039] Column query editor: autocomplete + syntax help

## Domain
ui

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
- SPEC.md §5 views / §11 column configure (the query editor surface)

## Summary
Live dogfood report (2026-08-02, screenshot): editing a column's query presents
a bare text input holding the raw query (`type=todo`) with no assistance at
all. User directive: at minimum (a) autocomplete while typing — field names
(type, tags, status, folder, due, …) and, after a field, its actual values
from the projection (types in use, existing tags, statuses); (b) a help
affordance in/next to the input opening a concise query-syntax reference
(fields, operators, combinators, examples) so a user can learn the language
without leaving the editor.

## Acceptance Criteria
- [ ] Typing in the query input suggests field names; after `field=`/operator,
      suggests real values from the workspace (via existing projection
      endpoints — no new routes unless escalated)
- [ ] Suggestions follow the app's existing autocomplete conventions (the §11
      smart-input machinery, arrows/↵/esc)
- [ ] A visible help button on the editor opens a syntax reference with
      examples; dismissible; keyboard reachable
- [ ] Invalid queries surface the existing error state unchanged
- [ ] No behavior change to query execution itself

## Technical Design
### Files to Create/Modify
- Column configure/query editor components; reuse the §11 autocomplete
  machinery if practical (smart input already suggests docs/skills/agents)
- Help content colocated with the editor; sourced from the actual parser's
  grammar so it cannot drift silently — escalate if the parser lives
  server-side without an introspectable surface

## Testing Strategy
Component tests for suggestion sources + help toggle; e2e for the flow.

## E2E Verification Plan
Real app: open a column's query editor; field + value autocomplete works
against real workspace data; help opens and matches the shipped grammar.

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
