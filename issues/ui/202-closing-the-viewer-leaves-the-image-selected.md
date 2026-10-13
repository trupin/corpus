# [UI-202] Closing the image viewer leaves the image selected, and the next keystroke deletes it

## Domain

ui

## Status

done

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

- [x] Reproduced against the real app before any change
- [x] After the viewer closes, a click elsewhere moves the selection with the
      caret, and no keystroke can replace the image
- [x] A test pins the sequence and fails on the current behaviour

## E2E Verification Log

Implemented on: **opus** (Claude Opus 5.5).

### Reproduction (before any change)

- **Real app.** `corpus init` a scratch workspace on port 8866 and `corpus
  server start` (serving the built `apps/ui/dist`). Then `corpus doc create
  --type note --title "Picture note"` with a 120×80 `data:` PNG between
  "Before the picture." and "After the picture.". A headless Chromium script
  opened the note from the "By status" board, clicked `img.md-img`, pressed
  Escape, then:
  - **Typed `Z` with no click** (300 ms pauses, human speed): the paragraphs
    went from `["Before the picture.", "[image]", "After the picture."]` to
    `["Before the picture.", "Z", "After the picture."]`. After Escape,
    `.ProseMirror-selectednode` count was 1, the editor's selection was
    `{"type":"node","anchor":22}`, and focus was on `IMG.md-img`.
  - **Clicked "After the picture." and typed `Z` at once**: DOM caret at
    `"After the picture.":18`, editor still `{"type":"node","anchor":22}`, and
    the result was again `[…, "Z", "After the picture."]`.
  - With 20 ms or more between the click and the key, the click case did not
    lose data. Chromium's `selectionchange` arrived ~15 ms after `mouseup`
    and moved the editor selection to `TextSelection` 43.
- **Dev server (Playwright, stubbed transport).** An event trace on
  `document` showed the full sequence. The `mousedown` on the image created
  `NodeSelection/9` in the editor, and the viewer then took focus.
  `ImageViewerHost` returned focus to the `img` on Escape, and the
  `NodeSelection` was still there.

### Root cause

The click that opens the viewer was handled twice. ProseMirror receives the
native `mousedown` on `view.dom` before React's root listener runs. TipTap's
default `NodeView.stopEvent` returns `false` for a `mousedown` on a selectable
node, so ProseMirror selected the image (`NodeSelection`, DOM selection
included). The same click then opened the viewer through `CorpusImage`'s
`onClick`. The viewer and the focus return were correct (SPEC.md §10). The
leftover was the selection that nobody asked for, hidden under the overlay.
Two paths then wrote over it:

1. **Key on the focused image.** TipTap's `stopEvent` keeps ProseMirror away
   from the key, but Chromium's default text insertion goes to the DOM
   selection. That selection still spanned the image node, so Chromium
   replaced it, and ProseMirror read back the mutation.
2. **Click elsewhere, then a fast key.** `LeftMouseDown.up` leaves the caret
   to the browser and learns of it only from the asynchronous
   `selectionchange`. `keydown`'s `forceFlush` reads nothing unless a flush is
   already scheduled. `editHandlers.keypress` then sees a non-text selection
   and runs `insertText` over the node.

This is not a focus-restoration defect: Escape must return focus to the image.
Clearing the selection on close would only hide the symptom. The fix stops
ProseMirror from seeing the press that opens the viewer.

### Fix

- `apps/ui/src/editor/ImageNodeView.tsx` wraps the `ReactNodeView`'s
  `stopEvent`. `opensTheViewer(event)` returns `true` for a primary-button,
  non-shift `mousedown` on `img.md-img[role="button"]`, and every other event
  goes to TipTap's own rule. A right-click (context menu) and a shift-click
  (extend a text selection) stay with the editor. So does a picture that
  cannot open (pending, broken, or no viewer mounted).
- `packages/kit/src/markdown/CorpusImage.tsx`: only the comment changed. It no
  longer says a click selects the image. Kit was rebuilt.

### Tests

- New e2e, `apps/ui/e2e/images.spec.ts` › "closing the viewer from a document
  body (UI-202)", 2 tests. Each opens the viewer, presses Escape, and asserts
  that focus is on the image and that `.ProseMirror-selectednode` count is 0.
  1. Click "After", type `Z` with no pause. Paragraphs must equal
     `["Before", "[image]", "AfterZ"]`.
  2. Type `Z` directly after Escape. The image must still be there and the
     text unchanged except for the `Z`.
- **Falsified.** With the wrap disabled (`stopEvent` = TipTap's own), both
  tests failed 3/3 (`--repeat-each=3`) on the selected-node check (Expected 0,
  Received 1). With that check made soft, both also failed on the data
  itself. Test 1 got `["Before", "Z", "After"]`. Test 2 got `img.md-img`
  count 0. With the fix: 3/3 passed.
- New unit tests, `apps/ui/src/editor/ImageNodeView.test.tsx` (12 cases):
  which presses `opensTheViewer` takes and which it leaves to the editor.
- `vitest run apps/ui/src/editor apps/ui/src/image` (VITEST_MAX_WORKERS=4):
  20 files, **1046 passed**.
- Playwright (`CORPUS_UI_PORT=5291`, because an ssh tunnel holds 5173):
  - `images`, `image-geometry`, `context-menu`, `clipboard`: **53 passed**.
  - `overlay-battery.spec.ts` in full: **75 passed**, including all four
    `overlay: image-viewer` entries.
- `eslint` and `prettier --check` on the touched files: clean.
  `npm run typecheck -w apps/ui` (includes `e2e/`) and `-w packages/kit`:
  clean.

### Post-fix, real app

`npm run build -w apps/ui`, then restarted the 8866 server and re-ran the same
script:

- Escape: focus on `IMG.md-img`, `.ProseMirror-selectednode` 0, editor
  selection unchanged (`text`, anchor 1).
- Type `Z` with no click: nothing was inserted, and the paragraphs were
  unchanged with `[image]` present.
- Click "After the picture." and type `Z` at once: `["Before the picture.",
  "[image]", "After the picture.Z"]`, with the editor selection at text 44.

Not exercised: a paste after close. The click path that paste would use is
the same one as test 1.
