# [SHARED-069] A document's content fills the document

## Domain
shared

## Status
todo

## Priority
P0 (critical path)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-163

## Spec References
- SPEC.md Section 10 — "UI — the board", Document view: _"The document body has a
  comfortable default width, and the reader can **change it** — in column view
  and in full screen — with the width persisting across navigation and reload…"_
  (rider signed 2026-08-04)
- SHARED-061 — nothing resizes because of what it holds, and a bound is derived
  from room rather than chosen as a number

## Summary

The user, 2026-08-23:

> I want the content of a document to fill the width of the document itself. I
> don't want to have to resize the document, then the content as well. The
> content fills the space.

Today a reader carries **two** widths. The column has one, in its view
document's frontmatter, dragged by the column's own edge. The body has a second,
browser-local per surface, dragged by its own handle (`apps/ui/src/reader/docWidth.ts`).
`docWidth.ts` states the split as a decision: _"Dragging the body wider therefore
never widens the column."_ The consequence is the user's complaint — widening a
column leaves the text where it was, and the text has to be widened again.

This issue carries the SPEC rider. UI-163 implements it.

## Acceptance Criteria

- [ ] The rider below is read back verbatim and **signed** before SPEC.md is
      edited.
- [ ] §10's body-width sentence is replaced, not appended to.
- [ ] The rider is dated and attributed, as every other rider is.
- [ ] `npm run spec:check` passes.

## The rider, as drafted — **unsigned**

> **A document's content fills the document.** The body is as wide as the reader
> holding it, and nothing inside a reader is sized separately from the reader.
> There is one gesture for how wide a document reads — a column's own edge on the
> board, and the window in full screen — and the body follows it with no second
> act. The body's own width control is removed, and so is the stored body width:
> a reading posture that had to be set twice was two answers to one question.
> Where a reader gives its body less than its full width — anchored threads in
> the margin are the case that exists — the body fills what is left, and the
> margin is part of what defines that room rather than something the body
> competes with. Anchored thread placement still follows the body, because the
> body still moves. A column's edge stays draggable and stays in the view
> document's frontmatter: it describes the view, it travels with it, and it
> remains the one thing a person sizes.

**What this changes about the product, stated plainly so the signature is
informed.**

**Full screen loses its only width control.** In a column the change removes the
second of two gestures. In full screen the body control is the *only* gesture, so
removing it means a document on a 1600px display reads at 1600px, less the thread
margin when it is up. That is what "the content fills the space" says, and it is
a real change to how a long document reads at that size. The alternative — the
body fills a column and keeps its handle in full screen — honours the complaint's
literal scope and keeps two answers to one question in the product. **The
recommendation is to fill, everywhere**, because SHARED-061 already says a bound
is derived from room rather than chosen as a number, and a comfortable measure is
a number chosen for typography.

**A stored preference is dropped, not migrated.** `corpus.docWidth` in browser
storage stops being read. Anyone who had set a width gets their column's width
instead, with no notice, on the next load.

## Technical Design

### Files to Create/Modify
- `SPEC.md` — §10, Document view: the body-width sentence

### Key Implementation Details

One rider, read aloud on its own, then edited. Do not fold it in with
SHARED-068's: two riders read together is how a live contradiction hides, and
this project has already paid for that once.

### Edge Cases
- The margin column. `MARGIN_COLUMN_RESERVE` is 330px today, and the rider makes
  that reserve part of the room rather than a subtraction from a chosen number.
- A column narrower than what was `MIN_DOC_WIDTH` (320px). The body fills it. The
  floor now belongs to the column's own drag, which already has one.

## Testing Strategy

None — this issue edits prose. The check is `npm run spec:check` and the user's
signature.

## E2E Verification Plan

### Verification Steps
1. `npm run spec:check`
2. Read the amended §10 paragraph back and confirm it describes one width

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
