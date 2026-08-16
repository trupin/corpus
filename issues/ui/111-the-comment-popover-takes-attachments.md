# [UI-111] The comment popover takes no attachments, and §11 says every composer does

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
- Related: UI-070 (attachments in every composer, through one kit surface — the
  issue this one is the missing half of), UI-112 (the same popover, moved and
  anchored)

## Spec References

- SPEC.md **§11** Thread view — *"**Every composer takes attachments.** Wherever
  a comment can be written — the global composer, a thread's reply box, **a
  comment on a document selection**, a comment on a turn or on a selection within
  one, and any composer a plugin contributes — files can be added by picker,
  paste or drag-and-drop, and appear as chip previews before sending (§6). A
  comment is a comment wherever it starts; which surface it was written in
  decides nothing about what it can carry."* _(Rider signed 2026-08-05.)_

## Summary

**This is a spec-compliance defect, not a feature request.** The user reported it
as a gap — *"I also want to be able to attach artifacts (e.g. screenshots) when
commenting from the modal. Right now, that's only available in other composers,
not that one"* — and the rider signed 2026-08-05 already promises exactly that,
naming "a comment on a document selection" in its own list.

`apps/ui/src/anchors/CommentPopover.tsx` contains **no** attachment code at all:
no picker, no paste handler, no dropzone, no pending chips. `ThreadComposer.tsx`
carries the intake hook in fourteen places. So the one composer where a
screenshot is most obviously wanted — commenting on a passage, about a thing you
are looking at — is the one composer that cannot take one.

The sentence the rider closes with is the whole of the requirement: *"A comment
is a comment wherever it starts; which surface it was written in decides nothing
about what it can carry."*

## Acceptance Criteria

- [ ] The comment popover accepts attachments by **all three** routes §6 names:
      the 📎 picker, pasting an image or file, and drag-and-drop with a visible
      dropzone highlight
- [ ] Pending attachments preview as removable chips before sending, exactly as
      they do in the reply box — same component, not a second implementation
- [ ] A comment may be **attachment-only**, with no text, as §6 allows
- [ ] The attachments land on the created thread's first turn, which is where a
      comment-on-a-selection's content goes
- [ ] The composer key contract is untouched (§11): `↵` newline, `⌘↵` sends
- [ ] The same audit is run across every surface the rider names, so this issue
      closes the **class** and not one instance: the global composer, the reply
      box, the document-selection popover, a comment on a turn, and a comment on
      a selection within a turn. Any other one that cannot take a file is named
      here, fixed, or filed

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/CommentPopover.tsx` — the intake hook and its three routes
- `apps/ui/src/thread/PendingAttachments.tsx` — reused, not reimplemented

### Notes

`ThreadComposer` is the reference implementation: `intake` supplies
`onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop`, `onPaste`, `pending`,
`remove` and `restore`, and the failure path puts the attachments back when the
server refuses the turn. Whatever is extracted for reuse should keep that
restore-on-failure behaviour — a comment that loses its screenshot because the
post failed is worse than one that could never take it.

## Testing Strategy

Component: the three intake routes on the popover, the chips, attachment-only
send, and restore-on-failure. A test that asserts the class list rather than the
behaviour would pass against a dropzone that never fires.

## E2E Verification Plan

### Verification Steps

1. Select text in a document, open the comment popover
2. Paste an image → chip appears; drop a file → dropzone highlights, chip appears
3. Send with no text → the thread is created carrying the attachment
4. Repeat for a comment on a turn and on a selection within a turn

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-111]` prefix
