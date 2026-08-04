# [UI-063] A comments list with resolved/open and anchored/unanchored filters

## Domain
ui

## Status
todo — needs SPEC sign-off before implementation (new user-visible surface)

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-010 (the rider for this surface)
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring (orphaned anchors), §11 Document view (today: "Whole-
  document comments and orphaned threads listed below the body")

## Summary
Live report 2026-08-04: _"For comments that are no longer anchored in the
document (bc the doc changed), we should show them in a separate list of comments
which I can filter per resolved / open. I also want to see anchored comments
there, and I want to be able to filter based on anchored / unanchored state as
well. That list of comments should be available in full screen and in column
view."_

**What exists today.** §11 already says orphaned threads and whole-document
comments are "listed below the body". So there is a place unanchored comments go
— but it is a passive tail of the document, not a surface you can work: no
filters, no anchored comments in it, and nothing that answers "what is
outstanding on this document?"

**What is being asked for** is that list promoted into a real panel: every
comment on the document, filterable on two independent axes —
**resolved / open** and **anchored / unanchored** — and available in both column
view and full screen.

The two axes are genuinely independent and the combination is the point: an
*open, unanchored* comment is the one that most needs attention, because the
document moved out from under a question nobody has answered. Today that is the
hardest state to find.

## Design questions
- **SETTLED (user, 2026-08-04): a tab beside the document.** The reader's header
  carries a `Document / Comments` switch, so the list gets the full column width
  and rows can show quote, status and age legibly. The trade the user accepted is
  seeing one or the other, not both. Full screen uses the same switch. Signed as
  SHARED-010 Amendment 1; the below-the-body listing stays.
- **Does it replace the "listed below the body" behavior or coexist with it?**
  Two places showing the same orphans is the kind of duplication that drifts.
- **What does clicking a row do?** For an anchored comment, revealing it at its
  anchor is the obvious answer and the reveal seam (UI-037) already exists. For
  an unanchored one there is nothing to reveal to — decide and state it.
- **Filter state persistence.** SPEC §11 says navigation state is sticky; say
  whether the filters are, and per-document or global.
- **Counts.** A filter surface that does not say how many are in each state makes
  the user apply filters to find out. Consider showing counts on the controls.

## Acceptance Criteria
- [ ] A comments list showing every thread on the document, anchored and not
- [ ] Independent filters: resolved/open, and anchored/unanchored
- [ ] Available in both column view and full screen
- [ ] An anchored row leads to its anchor in the document (reuse UI-037's reveal
      seam; do not invent a second mechanism)
- [ ] An unanchored row still opens its thread, and says why it has no anchor
- [ ] Resolving/reopening from the list updates it without a reload
- [ ] The existing below-the-body listing is either subsumed or deliberately
      kept, with the reason stated
- [ ] Empty and single-item states read well — an empty list should say which
      filter is hiding things, not just be blank
- [ ] Keyboard reachable, consistent with the app's existing list conventions

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/` (the panel, its placement in both hosts)
- possibly `packages/kit` if a row primitive is shared
- the data is already available: a document's threads carry `status` and
  resolved-anchor state; confirm whether the projection exposes anchored-ness
  directly or it must be derived, and if derived, whether that belongs on the
  server rather than in each client

## Testing Strategy
Component tests for each filter combination including the empty results case;
e2e in the real app covering both hosts and the reveal-from-row path.

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
