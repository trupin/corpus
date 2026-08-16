# [UI-112] The comment popover can be moved, and what it is about stays lit while you write

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-110 (the same complaint one surface over — writing and reading what
  you are writing about are currently exclusive), UI-111 (the same popover)

## Spec References

- SPEC.md **§11** Document view — *"selecting text pops a floating toolbar
  (formatting + **Comment**); commenting captures the text-quote selector and
  opens a thread composer"*
- SPEC.md **§11** Thread view — a comment on a selection inside a turn: *"the
  selection becomes the child thread's text-quote anchor (§6), **is highlighted
  in the turn** the way an anchor is highlighted in a document"*
- SPEC.md **§6** — anchors and how a highlight is painted

## Summary

Two complaints about the same modal, reported together:

> I want to be able to move the comment modal (sometimes, it is above content I
> need for the comment). The selected content should be highlighted in the
> document / thread immediately so I don't lose track of what is selected while
> scrolling.

**The popover lands where the selection is, which is exactly where the thing you
are writing about is.** For a short quote that is right; for anything where the
comment needs the surrounding paragraph — a figure two lines up, the sentence the
pronoun refers to — the box is sitting on the evidence.

**And the highlight arrives too late to help.** `useTurnComments.tsx` says it
plainly: *"the highlight is the anchor the server resolved, painted over the
turn."* So the selection is lit **after** the comment is posted — at the moment
it stops mattering. While composing, which is the only time you need to know what
you have got hold of, the browser's own selection is all there is, and it is lost
the moment focus moves to the composer or the view scrolls.

## What it should do

**The popover can be moved, and stays where it was put.** Dragged by a handle,
kept within the viewport, and it does not fight the selection: reopening for a
new selection places it afresh, since a position chosen for one passage means
nothing for the next.

**The selection is lit the moment the popover opens**, in the document and in a
turn alike, the way §6 paints an anchor — so scrolling away to check something
leaves a visible mark where you will come back to. It goes out when the popover
closes without sending; on send it is replaced by the real anchor, which is the
same paint by a different owner.

## Acceptance Criteria

- [ ] The popover can be dragged, by an affordance that says so, and is operable
      from the keyboard — §11 adds no exclusive-pointer capability
- [ ] It cannot be dragged off-screen, and survives a scroll of the surface
      beneath it
- [ ] A position is per-opening, not persisted: a new selection opens a fresh
      popover in the default place
- [ ] The selection is highlighted **on open**, before anything is sent, in a
      document body and in a rendered turn
- [ ] The provisional highlight is visibly the same paint as an anchor's (§6),
      because it is about to become one — but it disappears cleanly if the
      comment is abandoned, leaving nothing behind
- [ ] Scrolling the surface with the popover open leaves both the popover and the
      highlight where they belong: the popover where it was put, the highlight on
      its text
- [ ] Nothing about the composer key contract, the ask-agent toggle or (with
      UI-111) attachments changes

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/CommentPopover.tsx` — the drag handle and its bounds
- `apps/ui/src/anchors/` — the provisional highlight, painted from the pending
  selector rather than from a resolved anchor
- `apps/ui/src/thread/useTurnComments.tsx` — the same for a selection in a turn

### Notes

The highlight machinery already exists; what is new is painting it from a
selector the server has not seen yet. Keeping one painter for both cases is what
makes "the same paint" true rather than approximately true.

**Watch the ProseMirror interaction**: the document body is an editable surface,
and a decoration that survives an edit while its text is being typed over is a
decoration that has to reconcile. A provisional highlight over a *live* selection
in an editable document may need to yield on edit rather than reconcile — say
which, and why, rather than discovering it.

## Testing Strategy

Component: the drag bounds, the per-opening reset, the highlight's appearance on
open and its removal on abandon. E2E: open the popover on a long document, scroll,
assert both the popover and the highlight are still where they should be — the
scroll is the apparatus, exactly as in UI-110.

## E2E Verification Plan

### Verification Steps

1. Select a passage mid-document, open the comment popover
2. The passage is lit immediately
3. Drag the popover clear of the passage; scroll up — the highlight is still
   visible on its text, the popover still where it was dropped
4. Press escape without sending — the highlight goes, leaving no mark
5. Repeat on a selection inside a rendered turn

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-112]` prefix
