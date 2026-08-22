# [UI-049] Images open full-size on click, and inline attachment images actually load

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 3)
- Blocks: —

## Spec References
- SPEC.md §10 Thread view, as amended by SHARED-009 Amendment 3
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
- [x] Clicking any rendered image opens it full-screen over the app: turn
      attachments, images in document bodies, images in focus mode
- [x] `esc` closes the viewer and returns focus to the image that opened it
- [x] The viewer sits above focus mode and the search overlay, and takes escape
      precedence over both while open (see `useEscapeStack` priorities)
- [x] Keyboard-reachable: the image is focusable and `↵` opens the viewer
- [x] Non-image content is unaffected — no wrapper that changes prose layout
- [x] Images referencing workspace attachments load **wherever they appear**,
      through the same authenticated path turn attachments already use, with the
      object URL revoked on unmount (no leak per rendered body)
- [x] Remote and `data:` images keep working untouched
- [x] A missing/failed attachment degrades visibly (alt text or a broken-image
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

_Implemented by **ui-dev** on **Opus 5 (1M context)**, 2026-08-03._

### Decision: where the viewer lives, and why

**The seam is in the kit; the viewer is in `apps/ui`.**

`packages/kit/src/markdown/imageViewer.tsx` publishes a React context —
`ImageViewerProvider` / `useImageViewer()` — and every image the kit renders
opens through it. `apps/ui/src/image/ImageViewer.tsx` is the overlay itself,
mounted once by `ImageViewerHost` inside `Shell`.

Three reasons, in order of weight:

1. **There must be exactly one escape chain.** `useEscapeStack` is a module-level
   registry in `apps/ui`, and the viewer has to outrank focus mode and the search
   overlay. A viewer in the kit could not register in that chain (the dependency
   direction forbids `packages/kit → apps/ui`), so it would need a second
   registry — two layers each believing they are topmost, and one `esc` closing
   both. The brief's "do not duplicate the escape/layer logic" is exactly this.
2. **The kit has no application root.** A `position: fixed` overlay is portalled
   to `document.body` and has to sit at a known z-index relative to the reader
   (20), focus mode (35) and the search overlay (40). Those numbers are the app's
   vocabulary; the kit ships tokens, not a z-order.
3. **The precedent is already in this file.** `MarkdownView` renders `[[ref]]`
   links and does *not* own navigation — the host supplies `onOpenRef`. The
   viewer is the same shape: the kit knows what an image is, the app knows what
   is above what.

A **context** rather than a prop, because `MarkdownView` renders from six hosts
and `TurnAttachments` is not a `MarkdownView` at all. A prop is something every
host must remember to thread, and the hosts that would forget it are precisely
the ones this issue exists to fix.

`FocusMode` was not reused as the shell, per the issue's note: it is a document
reader with a nav stack, a frontmatter form and an editor in it. The viewer
shares the escape chain with it and nothing else.

### Pre-fix red — the attachment bug, against the real server

Real `corpus init` workspace at `/tmp/ui049-ws`, real server on `127.0.0.1:8766`
(never 8765), real Vite on `5982` with `CORPUS_SERVER_ORIGIN` pointed at it, real
Chromium via Playwright. Turn `th_ep2rky4x` carried the *same kind of* reference
twice — one mid-prose, one trailing:

```
Mid-sentence: ![shot.png](attachments/th_ep2rky4x/t1/shot.png) and then some words.

![plan.png](attachments/th_ep2rky4x/t1/plan.png)
```

The route is genuinely guarded — `curl` against the running server:

```
no bearer   -> 401
with bearer -> 200 image/png 116
```

With the `img` override and the editor's image node view removed (the pre-fix
rendering), the browser reported:

```
PRE-FIX, the turn's images:
  [{"alt":"shot.png","cls":"","src":"attachments/th_ep2rky4x/t1/sho","naturalWidth":0,"clickable":null},
   {"alt":"plan.png","cls":"md-img turn-att-img","src":"blob:http://localhost:5982/b83","naturalWidth":48,"clickable":"button"}]
PRE-FIX, the document body's image:
  [{"alt":"shot.png","src":"attachments/th_ep2rky4x/t1/shot.png","naturalWidth":0}]
PRE-FIX, viewer present anywhere: 0
PRE-FIX, /attachments traffic:
    /attachments/th_ep2rky4x/t1/plan.png type=fetch auth=bearer   -> 200
    /attachments/th_ep2rky4x/t1/shot.png type=image auth=none     -> 401
```

That is the issue's claim, measured: the trailing reference decoded at 48 px, the
same file one line earlier had `naturalWidth: 0` and its request went out with no
`Authorization` header and came back `401`. The Playwright spec fails the same
way on the pre-fix build (`e2e/images.spec.ts`, expected `[48, 48]`, received
`[0, 48]`).

### Post-fix — the same workspace, the same browser

```
STEP 1 — board rendered against the real server on 8766
  rows on the board: ["doc_tj5axbkz","th_ep2rky4x"]
STEP 2 — the turn's two images:
  [{"alt":"shot.png","cls":"md-img","src":"blob:http://localhost:59","naturalWidth":48,"role":"button","tabIndex":"0"},
   {"alt":"plan.png","cls":"md-img turn-att-img","src":"blob:http://localhost:59","naturalWidth":48,"role":"button","tabIndex":"0"}]
STEP 3 — the viewer: {"zIndex":"70","role":"dialog","ariaModal":"true","ariaLabel":"shot.png"}
         shown: {"naturalWidth":48,"renderedWidth":48,"src":"blob:http://"}
STEP 4 — esc closed the viewer; focus is on: IMG attachments/th_ep2rky4x/t1/shot.png
STEP 5 — ↵ on the focused image opened the viewer
STEP 6 — the document body's image: [{"alt":"shot.png","cls":"md-img","src":"blob:http://","naturalWidth":48,"role":"button"}]
STEP 7 — the viewer opened over focus mode
         first esc:  viewer gone, focus mode still open = true
         second esc: focus mode closed = true
STEP 8 — every /attachments request: 8 × type=fetch auth=bearer (+ the two noted below)
```

A missing file degrades visibly rather than blanking — same workspace, a note
referencing `attachments/…/missing.png`:

```
degraded chip: [{"text":"⚠ missing.png","title":"attachments/th_ep2rky4x/t1/missing.png could not be loaded.",…}]
surrounding prose still reads: A reference whose bytes are gone: ⚠ missing.png — and prose after it.
no blank <img> left behind: 0
```

### Known, bounded artifact (asserted, not hidden)

The two `type=image auth=none` requests in STEP 8 are TipTap's node-view
bootstrap: `ReactNodeViewRenderer` returns `{}` while `editor.contentComponent`
is still null, so ProseMirror builds the editor's DOM **once** from the schema's
own `renderHTML` before any React node view exists, and the browser asks for the
raw reference unauthenticated. It 401s, and the settled document contains only
the authenticated image. The same wart already renders a `[[ref]]` as its bare
anchor for a frame (`RefNodeView`). It is asserted explicitly in
`e2e/images.spec.ts` rather than papered over: no `img[src^="attachments/"]`
survives in the settled reader. Removing it means changing `Image`'s
`renderHTML`, which is also the clipboard's HTML serializer (UI-042's contract) —
out of scope for this issue.

### Automated gates

- `apps/ui/e2e/images.spec.ts` — 5 specs, all green against the real Vite dev
  server on `CORPUS_UI_PORT=5981`, with `/attachments` answered by a route that
  401s a request with no bearer exactly as `headerAuth` does.
- Regression sweep over the editor-adjacent suites (`images`, `editor`,
  `clipboard`, `anchor-layer`, `reveal`, `context-menu`, `thread`, `fences`):
  91 passed / 1 failed, and the failure is **not this issue's** — `editor.spec.ts`
  "the highlighted row is visibly the highlighted row" asserts `.ac-item.on`,
  and the kit's `autocomplete.css` now declares `.ac-item.active`; that rename
  belongs to the composer work in flight in this tree. `reveal.spec.ts` passes
  18/18 in isolation both with and without this issue's editor change (an earlier
  batch failure reproduced only under concurrent machine load).
- Unit: `packages/kit` + `apps/ui` — **2565 passed, 162 files**, of which 49 are
  new here (19 `attachmentSrc`, 15 `CorpusImage`, 2 `MarkdownView` img, 13
  `ImageViewerHost`).
- `npx eslint` (touched dirs, `--max-warnings 0`): no issues. `npx prettier
  --check`: clean. `npx tsc --noEmit` for `packages/kit` and `apps/ui`: clean.

Scratch workspace, dev server and browser all torn down; ports 5981, 5982 and
8766 verified free. Port 8765 was never bound.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
