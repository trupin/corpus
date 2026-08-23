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

and, on reading the consequence back:

> Full screen is different. I should be able to resize the content width when in
> full screen. The width in full screen and in column are both sticky and
> unrelated. There's a sticky width for full screen and one for columns. In full
> screen, the default width should be wider than the default for column.

Today a **column** reader carries two widths. The column has one, in its view
document's frontmatter, dragged by the column's own edge. The body has a second,
browser-local per surface, dragged by its own handle
(`apps/ui/src/reader/docWidth.ts`), defaulting to the stylesheet's `62ch`.
`docWidth.ts` states the split as a decision: _"Dragging the body wider therefore
never widens the column."_ The consequence is the complaint — a 900px column
still shows 62 characters of text, and the text has to be widened again.

Full screen has no column, so its body width is already the only gesture there.
It stays, it stays sticky, and its default stays wider.

This issue carries the SPEC rider. UI-163 implements it.

## Acceptance Criteria

- [ ] The rider below is read back verbatim and **signed** before SPEC.md is
      edited.
- [ ] §10's body-width sentence is replaced, not appended to.
- [ ] The rider is dated and attributed, as every other rider is.
- [ ] `npm run spec:check` passes.

## The rider, as drafted — **unsigned**

> **A document's content fills its reader, and a reader is sized once.** In a
> column the body is as wide as the column. The column's own edge is the single
> gesture, and the body follows it with no second act — the body's own width
> control is removed from the column reader, and so is its stored width there. A
> reading posture that had to be set twice was two answers to one question.
> **Full screen is the other case, and it keeps its control.** There is no column
> edge in full screen, so the body's own width is the one gesture there. It is
> sticky in the browser-local set, it survives navigation and reload, and it is
> **unrelated** to any column's width — neither follows the other. Full screen's
> default is **wider** than a default column, because full screen is where a
> document is read at length. Where a reader gives its body less than its full
> width — anchored threads in the margin are the case that exists — the body
> fills what is left, and the margin is part of what defines that room rather
> than something the body competes with. Anchored thread placement still follows
> the body, because the body still moves. A column's edge stays draggable and
> stays in the view document's frontmatter: it describes the view and travels
> with it.

**What this changes about the product, stated plainly so the signature is
informed.**

**One control is deleted, not two.** The column reader loses its body handle. Full
screen keeps its own, and keeps one sticky width across every document opened
there.

**How "wider by default" is met.** The stylesheet already defaults a column body
to `62ch` and full screen to `66ch`. After this rider the column's default is the
**column**, so the comparison that matters is `66ch` against a default column —
440px at base since Phase 41. `66ch` in the reader's serif already clears that,
so the rider asks for no new number. UI-163 pins the comparison with a
measurement rather than leaving it to a reading of two stylesheets.

**A stored preference is partly dropped.** `corpus.docWidth` keeps its full-screen
entry and stops reading its per-column entries. Anyone who had widened a body
inside a column gets that column's width instead, with no notice, on the next
load.

## Technical Design

### Files to Create/Modify
- `SPEC.md` — §10, Document view: the body-width sentence

### Key Implementation Details

One rider, read aloud on its own, then edited. Do not fold it in with
SHARED-068's: two riders read together is how a live contradiction hides, and
this project has already paid for that once.

### Edge Cases
- The margin column. `MARGIN_COLUMN_RESERVE` is 330px today. In a column the
  rider makes that reserve part of the room rather than a subtraction from a
  chosen number. In full screen it keeps its present job, because a chosen width
  is still what the drag sets there.
- A column narrower than what was `MIN_DOC_WIDTH` (320px). The body fills it. The
  floor now belongs to the column's own drag, which already has one.
- Full screen keeps `MIN_DOC_WIDTH` and `MAX_DOC_WIDTH`: it still stores a number.

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
