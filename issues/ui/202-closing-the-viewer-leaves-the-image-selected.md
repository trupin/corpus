# [UI-202] Closing the image viewer leaves the image selected, and the next keystroke deletes it

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
- Related: UI-201 (which found it)

## Spec References

- SPEC.md **§5**: a document's body is what the person wrote

## Summary

Found during UI-201 (2026-10-12) in a real workspace. It is present on
prosemirror-view 1.42.5 and 1.42.6 alike, so it is older than the security
bump. It loses data silently:

1. Open a document and click its image to open the viewer. Press Escape.
2. Click in another paragraph. The caret appears there, but the editor still
   has the image selected (`.ProseMirror-selectednode` stays on it).
3. Type or paste. The keystroke replaces the image. Typing `Z` turned
   `[Before, <image>, After]` into `[Before, Z, After]`.

## Acceptance Criteria

- [ ] Reproduced against the real app before any change
- [ ] After the viewer closes, a click elsewhere moves the selection with the
      caret, and no keystroke can replace the image
- [ ] A test pins the sequence and fails on the current behaviour

## E2E Verification Log

_Implementing agent fills; state the model._
