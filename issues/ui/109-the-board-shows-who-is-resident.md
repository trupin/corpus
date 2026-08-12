# [UI-109] The board shows who is resident, and who is live

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-108]
- Blocks: —

## Spec References
- SPEC.md §8 as amended by SHARED-043 — presence; the pending indicator's wording per lane

## Summary
Presence rendering. A designated thread wears its resident: a badge on the thread card
(name + live/lapsed/waiting dot) sourced from the same `["agents"]` roster the composer
uses. The pending indicator learns lanes: on a thread whose recipient is a live resident,
the waiting tiers read as that resident working (`researcher is working…`); on a lapsed
lane, the indicator says the orchestrator will answer — never a claim that a gone listener
is working (the same honesty rule as UI-097's queued-vs-working distinction, which this
must compose with, not fork from).

## Acceptance Criteria
- [ ] Resident badge on `ThreadCard` for designated roots: resident name, liveness dot, summary line on hover/expand; updates over the invalidate stream
- [ ] `PendingIndicator` (`apps/ui/src/thread/PendingIndicator.tsx:20-31,58-79`) names the lane's consumer when it is a resident; tier thresholds unchanged; wording composes with UI-097's waiting-to-be-picked-up tier (queued-and-unclaimed on a resident lane reads "waiting for researcher")
- [ ] Lapsed-lane honesty: a pending request on a lapsed lane reads as waiting for pickup with the fallback named ("waiting — researcher is away, the agent will pick this up")
- [ ] Designation controls surfaced where user acts live: designate/release on a standalone thread's card menu (user-only actions; drive the CONTRACT-051 routes; agent-def names offered from the same autocomplete source as `@` mentions, `MENTION_DOC_TYPE`)
- [ ] Scope visibility: a document whose `origin` chain reaches a designated root shows a quiet provenance line ("part of *Q3 planning* — researcher") linking to the root thread
- [ ] No SSE payload extensions; everything reads through existing query keys plus `["agents"]`

## Technical Design

### Files to Create/Modify
- `apps/ui/src/thread/ThreadCard.tsx` — badge
- `apps/ui/src/thread/PendingIndicator.tsx` + `outstandingAgentRequest.ts` — lane-aware wording
- Thread card menu component — designate/release actions
- Document header component — provenance line
- Reuse `packages/kit/src/query/useAgentsRoster.ts` (UI-108)

### Key Implementation Details
The indicator must not add a data dependency to render its default tiers — lane wording is
an enhancement over the roster query, and the indicator's existing behavior is the
fallback whenever the roster is unavailable. Coordinate with UI-097 rather than
duplicating: if UI-097 is unimplemented when this lands, implement the composed wording
here and mark UI-097's criteria accordingly in a PR note, per the no-two-mechanisms rule.

### Edge Cases
- Designation while a pending indicator is showing: wording flips on invalidation, elapsed clock keeps its original start (SPEC.md:398 — clock runs from when the request was written)
- A resident answering a summoned message on a foreign thread: that thread's indicator names the picked resident too (`recipient` is on the event; the outstanding-jobs row carries the lane per SERVER-107's mirror)

## Testing Strategy
Component tests: badge states, indicator wording matrix (live/lapsed/waiting ×
claimed/unclaimed), menu actions with the typed E2E stub, provenance line resolution.

## E2E Verification Plan

### Verification Steps
1. Real server + UI; designate th_x from the thread card menu → badge appears, roster row exists
2. Start the listener → dot flips live; post → indicator reads "researcher is working…"
3. Kill the listener past grace; post → indicator names the fallback honestly
4. Open a document created by the resident → provenance line links back to th_x

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] Committed with `[UI-109]` prefix
