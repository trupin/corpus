# [UI-049] Images open full-size on click, and inline attachment images actually load

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 3)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view, as amended by SHARED-009 Amendment 3
- §6:222 "Posted turns render images inline and other files as download chips"

## Summary
Live report 2026-08-03: _"Images should be clickable. When clicking, it opens it
in full screen so I can see the detail."_

Two halves, and the second is a bug the user has not hit yet.

**The viewer.** No image anywhere in the app is clickable.
`packages/kit/src/markdown/MarkdownView.tsx` overrides exactly two tags (`pre`,
`a`) and has no `img` override, so a markdown image renders as a bare `<img>`
with no handler, no wrapper, no data attribute. The only CSS is
`markdown.css` `.doc-body img { max-width: 100% }`. No lightbox/zoom component
exists anywhere in the repo. Turn attachment images are additionally capped at
`240×180` (`thread.css` `.turn-att-img`), so today there is **no way at all** to
see an attached image at full size.

**The broken path.** There are two image routes and they behave differently:
- **Trailing turn attachments** go through `TurnAttachments.tsx` →
  `useAttachment`, which fetches the bytes **with the workspace bearer token**
  and hands back a `blob:` URL — necessary because `/attachments/*` sits behind
  `headerAuth` and `<img src>` sends no `Authorization` header.
- **Any other image** — an attachment referenced mid-prose in a turn, or any
  `![](attachments/…)` in a **document body** — goes through `MarkdownView` as a
  plain relative `<img src>`, unauthenticated, resolved against the SPA route. It
  silently never loads.

So an attachment referenced at the end of a turn renders and the same attachment
referenced one line earlier does not.

## Acceptance Criteria
- [ ] Clicking any rendered image opens it full-screen over the app: turn
      attachments, images in document bodies, images in focus mode
- [ ] `esc` closes the viewer and returns focus to the image that opened it
- [ ] The viewer sits above focus mode and the search overlay, and takes escape
      precedence over both while open (see `useEscapeStack` priorities)
- [ ] Keyboard-reachable: the image is focusable and `↵` opens the viewer
- [ ] Non-image content is unaffected — no wrapper that changes prose layout
- [ ] Images referencing workspace attachments load **wherever they appear**,
      through the same authenticated path turn attachments already use, with the
      object URL revoked on unmount (no leak per rendered body)
- [ ] Remote and `data:` images keep working untouched
- [ ] A missing/failed attachment degrades visibly (alt text or a broken-image
      affordance), never a silent blank

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/MarkdownView.tsx` — an `img` override
- A viewer component — decide whether it belongs in `packages/kit` (the kit
  renders the markdown that contains the images, and plugin surfaces render
  through the same `MarkdownView`) or in `apps/ui`. If it lands in `apps/ui`,
  the kit needs a seam so a kit-rendered image can open an app-owned viewer —
  say which and why; do not duplicate the escape/layer logic.
- `packages/kit/src/query/useAttachment.ts` — the authenticated fetch to reuse
- `apps/ui/src/reader/useEscapeStack.ts` — layer registration
- `apps/ui/src/thread/TurnAttachments.tsx` — clickable, and reconcile the 240×180
  cap with the viewer

### Notes
- `FocusMode` is a **document** reader, not a generic overlay host; do not try to
  reuse it as the viewer shell.
- Watch the interaction with UI-042 clipboard work and the selection menu: an
  image click must not fight a text selection or a right-click.

## Testing Strategy
Component tests for the `img` override and the viewer (open, esc, focus return,
layering). E2E in a real browser: attach an image to a turn, click it, assert the
full-size element; put `![](attachments/…)` mid-prose in a document body and
assert it actually loads (this is the regression that pins the bug).

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
