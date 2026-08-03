# [UI-056] The e2e stub misrepresents the server: anchors resolve worse than reality

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: an e2e spec for UI-051's turn-selection commenting

## Spec References
- SPEC.md §6 "Anchoring" (the resolution ladder the real server implements)

## Summary
Found by UI-051 (2026-08-03) while trying to write a Playwright spec for
selection-anchored child threads. Two gaps in `apps/ui/e2e/stubCorpus.ts`, and
the first is the dangerous kind — a stub that is **wrong**, not merely absent:

1. **`resolveAnchor` implements only rung 2 of the ladder** (unique `exact`). A
   framed selector for a duplicated phrase — the exact case §6's prefix/suffix
   framing exists to handle, and the case PR #19 shipped a MAJOR over — resolves
   perfectly against the real server and reports **`orphaned`** against the stub.
   So a spec asserting correct behavior fails, and a spec written to match the
   stub would encode a lie. Any future anchor work will hit this and may well
   "fix" the product to match the stub.
2. **No `GET /api/threads/{id}`**, so a `ThreadCard` never renders turns under
   the stub at all — which is why UI-051 shipped with real-browser verification
   and component tests, but no Playwright coverage.

UI-051 deliberately did not extend the shared e2e infrastructure while two other
agents were editing that directory. That was the right call in the moment and
leaves this issue owing the coverage.

## Acceptance Criteria
- [ ] The stub's `resolveAnchor` implements the same ladder the server does, or
      is honest about what it does not implement — a framed duplicate must not
      report `orphaned` when the real server resolves it
- [ ] A test pins stub and server against the same fixtures, so the two cannot
      drift again silently (this is the criterion that matters — the others are
      symptoms)
- [ ] `GET /api/threads/{id}` served, so `ThreadCard` renders turns
- [ ] An e2e spec for UI-051: select a phrase inside a turn, comment, assert the
      child thread's selector and that the highlight lands on the selected
      occurrence — including the duplicated-phrase case
- [ ] Existing specs that depend on today's stub behavior still pass, or are
      corrected where they encoded the stub's error

## Technical Design
### Files to Create/Modify
- `apps/ui/e2e/stubCorpus.ts`
- a new or extended spec covering turn-selection commenting
- consider where the shared resolution logic could live so stub and server
  genuinely share it rather than being compared

### Notes
- The real ladder is in `apps/server/src/` anchor resolution; `apps/ui/e2e` may
  not import from `apps/server`, so "share" likely means extracting to a package
  or pinning by fixture. Say which you chose and why.

## Testing Strategy
Fixture-driven parity between stub and server, plus the missing e2e.

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
