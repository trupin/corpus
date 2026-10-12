# [UI-201] Images stop rendering on the patched editor — they do not; the battery's `img` selector finds ProseMirror's separator

## Domain
ui

## Status
done — 2026-10-12, a test-selector fix; images never stopped rendering

## Priority
P0 (critical path) — it turned `CI / validate` red on the release branch.

## Model
opus

## Dependencies
- Depends on: SHARED-079 (commit 78229fdd, the `npm audit fix` that moved the lockfile)
- Blocks: the v0.37.0 release PR's green CI

## Spec References
- SPEC.md §10 — "clicking any rendered image … opens it full-screen over the app"

## Summary
Commit 78229fdd (`npm audit fix`) moved only `package-lock.json`. After it, the
four `overlay: image-viewer` entries of `apps/ui/e2e/overlay-battery.spec.ts`
timed out locally and in CI waiting for `.reader img` to become visible. The
report read this as "images stopped rendering in the reader". **They did not.**
prosemirror-view 1.42.6 now draws a hidden hack node,
`<img class="ProseMirror-separator" alt="">`, **before** every inline atom at
the start of a textblock, in every browser. The battery took "the first `img`
in the reader" as the picture, and that is now the 0×0 separator, which never
becomes visible. The fix is to the selector, not to the product, and the
security bump stays.

## The bisect

| Package | From → To | Advisory | Culprit? |
| --- | --- | --- | --- |
| prosemirror-view | 1.42.2 → 1.42.6 | GHSA-c8x8-7fp4-3x9w (XSS in paste, fixed in 1.42.3) | **Yes** — 1.42.6 |
| prosemirror-model | 1.25.11 → **1.25.12** (the "one package to 1.25.12") | none — pulled by view 1.42.6's `^1.25.12` | No |
| brace-expansion | 2.1.4 → 2.1.7, 5.0.9 → 5.0.12 (hoisted) | security, dev-only | No (not in the browser) |
| source-map-js | 1.2.1 → 1.2.2 | dev-only | No (not in the browser) |

- Reproduced on the new lockfile: 4/4 `image-viewer` battery tests fail with
  `locator.waitFor: Test timeout of 30000ms exceeded` and the call log
  `54 × locator resolved to hidden <img alt="" class="ProseMirror-separator"/>`.
- Swapped `node_modules/prosemirror-view` alone back to **1.42.5**, keeping
  prosemirror-model at **1.25.12** (lockfile untouched, Vite cache cleared):
  4/4 pass. So prosemirror-model 1.25.12 is not the cause. Its change (attribute
  validation in `NodeType.create`) is harmless here: no attribute in our schema
  declares a `validate`.
- prosemirror-view 1.42.6's changelog: "On Safari and Firefox, work around
  skipped cursor positions … by putting a dummy node in front of atomic inline
  nodes when they appear at the start of the block or right after another atom."
  The code (`NodeViewDesc.updateChildren`: `atBufferPos && child.isAtom &&
  !child.isText → updater.addHackNode("IMG", …)`) has **no browser check**, so
  Chromium gets the leading separator too.

## Root cause
`apps/ui/e2e/overlayRegistry.ts`'s `image-viewer` entry located the picture as
`page.locator(".reader img").first()`, and its `opener` (where focus must return
after Escape) as `'.reader [data-reader-doc="doc_pic"] img, .reader img'`. Both
assume every `<img>` in a reader is a picture. ProseMirror has always been free
to put its own hidden `img.ProseMirror-separator` nodes in the editor DOM
(1.42.2 already drew a trailing one after the image), and 1.42.6 puts one
**first**. A picture `CorpusImage` draws always carries `md-img` (the kit's
`IMAGE_CLASS`). Every other e2e spec that locates a picture already uses
`img.md-img`.

No product code keys on the `img` tag name (searched `apps/ui/src` and
`packages/kit/src` for `querySelector`/`closest`/`tagName`/`nodeName` against
`img`), and TipTap injects ProseMirror's own
`img.ProseMirror-separator { display: inline !important; border: none
!important; margin: 0 !important }`, so the extra node is 0×0 and changes no
layout.

## Acceptance Criteria
- [x] The four `overlay: image-viewer` battery tests pass on the patched lockfile
      (prosemirror-view 1.42.6, prosemirror-model 1.25.12).
- [x] The lockfile is unchanged: no `overrides`, no downgrade.
- [x] `scripts/check-audit.ts` reports zero advisories.
- [x] A real browser against a real workspace server shows a document image
      rendered, opens the viewer on click, and accepts paste.

## Technical Design

### Files to Create/Modify
- `apps/ui/e2e/overlayRegistry.ts` — the `image-viewer` entry's `opener` and
  `open()` locate `img.md-img`, never a bare `img`, with a comment saying why.

### Edge Cases
- The selector still fails if the picture never renders: `waitFor()` on
  `.reader img.md-img` waits for that element to be visible, so the battery
  keeps watching what it was written to watch.

## Testing Strategy
- Battery entry: `overlay-battery.spec.ts -g image-viewer`.
- Every e2e spec that names images, paste or attachments.
- Unit tests over `apps/ui/src/{editor,image,anchors,reader}` and
  `packages/kit/src/markdown`.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. On the 78229fdd lockfile, `npm run build`.
2. `CORPUS_UI_PORT=5373 npx playwright test --config apps/ui/playwright.config.ts apps/ui/e2e/overlay-battery.spec.ts -g image-viewer`.
3. Expected: 4 passed. Actual: 4 failed, waiting on a hidden `img.ProseMirror-separator`.

### Verification Steps
1. Re-run step 2 with the fix: 4 passed.
2. `corpus init` a scratch workspace, start its server, create a note with an
   image, open it in Chromium, read the DOM, click the image, paste.

## E2E Verification Log

Implemented on: **opus** (Claude Opus 5.5).

### Reproduction (bugs only)
- `npm install`, `npm run build` (kit `dist/` rebuilt from source, so the kit
  dist trap does not apply — and the fix does not touch kit).
- `CORPUS_UI_PORT=5373 playwright … overlay-battery.spec.ts -g image-viewer`:
  **4 failed** — `locator.waitFor: Test timeout of 30000ms exceeded`,
  `54 × locator resolved to hidden <img alt="" class="ProseMirror-separator"/>`.
  The page snapshot in the same failure shows the picture present:
  `button "The chart — open full screen"`.
- Bisect: prosemirror-view 1.42.5 + prosemirror-model 1.25.12 → **4 passed**
  (10.9 s). Restored 1.42.6 afterwards.
- Real app, before any change: `corpus init ws --port 8865`, `corpus server
  start` (serves the built `apps/ui/dist`), `corpus doc create --type note
  --title "Picture note" --file body.md` with a 120×80 PNG as a `data:` image
  between two paragraphs. In headless Chromium the editor's paragraph read:
  `<p><img class="ProseMirror-separator" alt=""><span class="react-renderer
  node-image" …><span class="doc-image" …><img alt="Gradient" class="md-img"
  role="button" …></span></span><img class="ProseMirror-separator"
  alt=""><br class="ProseMirror-trailingBreak"></p>` — the picture
  `md-img` loaded (`natural 120x80`, box 410×308, `complete: true`) and the two
  separators are 0×0. Screenshot showed the gradient between the two lines.
  Clicking the image opened `.overlay.image-viewer`. **Images render for real
  users; only the test's selector broke.**
- The same probe against a UI bundle rebuilt with prosemirror-view 1.42.5 drew
  `md-img, ProseMirror-separator` (no leading separator); on 1.42.6 it draws
  `ProseMirror-separator, md-img, ProseMirror-separator`. That is the whole
  difference.

### Post-Implementation Verification
- `overlay-battery.spec.ts -g image-viewer`: **4 passed** (10.3 s).
- All 16 e2e specs naming images, paste or attachments (`attachments`,
  `ask-designation-weight`, `column-open-geometry`, `clipboard`,
  `compose-keyboard`, `composer-room`, `context-menu`, `fences`,
  `format-toolbar`, `forms`, `images`, `image-geometry`, `overlay-battery`,
  `render-fixes`, `thread`, `turn-comment`): **243 passed** (5.8 min).
- Unit: `vitest run apps/ui/src/editor apps/ui/src/image apps/ui/src/anchors
  apps/ui/src/reader packages/kit/src/markdown` → 66 files, **2079 passed**.
- `eslint` and `prettier --check` on the changed file clean; `npm run
  typecheck -w apps/ui` clean (it includes `e2e/`).
- Real browser, real server, UI rebuilt on 1.42.6: picture present
  (`ProseMirror-separator, md-img, ProseMirror-separator`), caret at the end of
  the last paragraph, typed `Z`, then a keyboard paste (⌘V) of `PASTED` from the
  system clipboard: `['Before the picture.', ' [image]', 'After the
  picture.ZPASTED']`. An HTML paste (`and <strong>rich</strong> text`) landed as
  bold and saved to disk as `**rich**`.
- `node --import tsx scripts/check-audit.ts` → `npm audit reports 0
  vulnerabilities, all severities`.

### Found on the way, not caused by this bump (needs its own issue)
Clicking an image in a document opens the viewer and leaves ProseMirror's
`NodeSelection` on the image. After Escape, a click in another paragraph moves
the DOM caret there (`anchorNode` "After the picture.", offset 18) but the
editor keeps `.ProseMirror-selectednode` on the image. The next keystroke
**replaces the image**: typing `Z` gave `['Before the picture.', 'Z', 'After the
picture.']`, and a paste does the same. Reproduced identically on a bundle built
with prosemirror-view 1.42.5, so it predates 78229fdd. Silent data loss in a
document body: it wants a P1 issue of its own.

## Completion Checklist (domain agent)
- [x] Tests written and passing (the battery entry is the test; it now targets the picture)
- [x] `/lint` passes (eslint, prettier, typecheck on the touched workspace)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
