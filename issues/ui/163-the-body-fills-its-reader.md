# [UI-163] The body fills its reader

## Domain
ui

## Status
todo

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: SHARED-069
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board", Document view (body-width rider,
  SHARED-069)
- SHARED-061 — a bound is derived from room, never chosen as a number

## Summary

Delete the body's own width and its control. The document body fills the reader
that holds it — a column, or full screen — and the column's edge becomes the one
gesture that sizes a document.

## Acceptance Criteria

- [ ] The body's width handle is gone from the column reader and from full
      screen. No control in the reader sizes text independently of its host.
- [ ] The body fills its reader's content box at every column width, from the
      column's own minimum upward.
- [ ] With anchored threads in the margin, the body fills the room **left by**
      the margin. It does not overlap it, and it does not stop short of it.
- [ ] Dragging a column's edge moves the text with it, in the same frame, with no
      second act.
- [ ] `corpus.docWidth` is no longer read or written. A stored value from an
      older build changes nothing and produces no error.
- [ ] Anchored thread placement still tracks the body as it moves.
- [ ] The keyboard loses nothing: the removed control was keyboard-operable, and
      the column's edge already is.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reader/docWidth.ts` — deleted, with its constants
- `apps/ui/src/reader/DocWidthContext.tsx` — deleted
- `apps/ui/src/reader/docWidth.test.ts`, `docWidthControl.test.tsx` — deleted
- `apps/ui/src/reader/DocView.tsx`, `Reader.tsx`, `FocusMode.tsx` — the provider,
  the handle and the inline width go
- `apps/ui/src/reader/FocusMode.css`, `Reader.css`, `anchors.css` — the body's
  `max-width` becomes the host's box, and the margin grid keeps its reserve
- `apps/ui/e2e/doc-width.spec.ts` — rewritten as "the body follows the column",
  not deleted

### Key Implementation Details

**Delete, do not disable.** A width that is still stored and still read but never
shown is a second answer to one question that nobody can see. Every acceptance
criterion above is about there being one width, and a dormant one fails that.

**The margin is part of the room, not a subtraction from a number.** Today
`MARGIN_COLUMN_RESERVE` (330px) is taken off the room a *drag* may claim, because
the body's width was a number and the drag had to avoid a dead zone. With the
body filling, the grid decides: `.reader-scroll.with-margin` and
`.focus-inner.with-margin` already declare the two-track layout, and the body's
track is what the body fills. That is SHARED-061's shape — the bound is the room.

**Check what else reads the width.** `docWidth.ts` documents that anchored thread
placement follows the body. Find every consumer before deleting the module, and
make each one measure the body instead of reading a number.

**The e2e spec is rewritten, not dropped.** `doc-width.spec.ts` asserts a real
guarantee — that the body's width is what the reader chose. The guarantee changes
to "the body's width is the column's". Deleting the file would remove the only
browser-level assertion about either.

### Edge Cases
- A column at its own minimum. The body fills it and the reader stays usable.
- Full screen with the margin up and then down: the body grows and shrinks with
  the grid, with no stored number to disagree.
- A very wide display in full screen. Prose measures the viewport, less the
  margin. SHARED-069 names that consequence and the user signs it.
- An old `corpus.docWidth` blob in storage. Ignored, never parsed, never an error.

## Testing Strategy

Component tests: render a reader at three host widths and assert the body's
measured width equals the host's content box each time. Render with the margin up
and assert the body fills the remaining track.

**Falsify.** Reintroduce a `max-width` on the body and watch the width assertion
part from the host's box. A test that asserts only "the body has some width"
would pass with the bug in place.

E2E: drag a column's edge and assert the body's box moves with it in the same
gesture.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a document in a column
2. Drag the column's edge wider
3. Expected: the text widens with the column
4. Actual: the text stays where it was, and needs its own handle dragged

### Verification Steps
1. `npm run build -w packages/kit`, then restart the app
2. Drag a column's edge through its whole range and watch the text follow
3. Open the same document in full screen, with the thread margin up and down
4. Confirm no width handle remains on either surface
5. Confirm an old `corpus.docWidth` value in browser storage changes nothing

## E2E Verification Log

### Reproduction (bugs only)
_[Agent fills]_

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
