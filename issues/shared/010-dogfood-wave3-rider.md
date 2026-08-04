# [SHARED-010] Dogfood wave 3 — two SPEC amendments (SIGNED 2026-08-04)

## Domain
shared

## Status
todo — signed by the user 2026-08-04; apply to SPEC.md at phase kickoff
(orchestrator), before UI-063 and UI-066 start.

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-063, UI-066

## Spec References
- §6 Anchoring (orphaned anchors), §11 Document view

## Summary
Two live reports on 2026-08-04, both asking for control over surfaces the spec
currently fixes. Shapes chosen by the user; the reasoning behind each option is
recorded in the issue files.

---

### Amendment 1 — a comments list, filterable, in both hosts

**User:** _"For comments that are no longer anchored in the document (bc the doc
changed), we should show them in a separate list of comments which I can filter
per resolved / open. I also want to see anchored comments there, and I want to be
able to filter based on anchored / unanchored state as well. That list of
comments should be available in full screen and in column view."_

**Shape chosen:** _"A tab beside the document"_ — the column header carries a
Document / Comments switch, so the list gets the full column width.

Today §11 says only that "whole-document comments and orphaned threads listed
below the body". That is a passive tail: no filters, no anchored comments in it,
and no way to answer "what is outstanding on this document?" The
**open-and-unanchored** comment is the one that most needs attention — the
document moved out from under a question nobody answered — and it is currently
the hardest state to find.

REPLACE, in §11 Document view, the clause "Whole-document comments and orphaned
threads listed below the body":

> A document's comments are also available as a **list**, reached by a
> Document / Comments switch in the reader's header and present in both column
> view and full screen. The list holds **every** thread on the document, anchored
> or not, and filters on two independent axes — **open / resolved** and
> **anchored / unanchored** — because the combination is the point: an open,
> unanchored comment is a question the document has moved out from under.
> Selecting an anchored row reveals it at its anchor in the document; an
> unanchored row opens its thread and says why it has no anchor. Whole-document
> comments and orphaned threads remain listed below the body.

---

### Amendment 2 — the reader's width is the reader's choice

**User:** _"I want to be able to resize documents so they look wider. I don't see
a valid reason why the width of a document needs to be capped to a such small
width. It's fine to cap it, but I want to be able to resize to the desired width,
both in column and full screen mode."_

**Shape chosen:** _"Everything stretches uniformly"_ — prose included, not a
break-out where only tables and fences widen. The user was offered the
prose-keeps-its-measure variant and declined it; what you drag is what you get.

The body is capped at a `62ch` reading measure today. That is a defensible
default for prose and a poor fit for what people put in documents — wide tables,
fenced prompts, pasted output. The cap stays; who sets it changes.

APPEND to §11 Document view:

> The document body has a comfortable default width, and the reader can
> **change it** — in column view and in full screen — with the width persisting
> across navigation and reload the way the rest of the app's navigation state is
> sticky. Widening applies to the whole body uniformly, prose included. Anchored
> thread placement follows the body when it moves, and the control is operable
> from the keyboard like every other affordance (§11 adds no exclusive-pointer
> capability).

---

## Acceptance Criteria
- [ ] Both amendments applied to SPEC.md verbatim at phase kickoff, each with a
      signed-2026-08-04 marker
- [ ] Amendment 1 replaces the below-the-body clause rather than duplicating it
- [ ] UI-063 and UI-066 do not start before the text is in place

## Technical Design
### Files to Create/Modify
- `SPEC.md` §11

## Testing Strategy
None — spec text. The domain issues carry the tests.

## E2E Verification Log
_N/A — spec change._

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-010]` prefix
