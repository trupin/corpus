# [UI-129] An image reserves no box until it decodes

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-127 (the same rule, a different shape)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§8** — the conversation surface these images sit in

## Summary

`CorpusImage` renders every image in the product and gives none of them a size.
The `<img>` occupies **zero pixels** until the file decodes, and then takes its
natural size. Everything below it — the rest of the document, the later turns,
the turn's own `💬` and `✕` controls, the reply composer — moves down at that
moment, which is the moment a person is reading.

This is UI-128's **most reachable** finding and its cheapest broad fix: one
renderer serves the thread, the reader, the editor and every plugin, so one
reserved box fixes all four.

## The measurement (UI-128, real Chromium, 2026-08-20)

A document body with one **48×36** PNG and a sentinel paragraph beneath it, with
the attachment response held open and then released:

```
IMG before: box=0x0   sentinel_y=307
IMG after : box=48x36 sentinel_y=320
IMG moved sentinel by 13px
```

**13px is the floor**, produced by the smallest fixture in the repository.
`.turn-att-img` caps at `max-height: 180px`, so a screenshot in a turn displaces
up to **180px**. `.doc-body img` caps **width only**, so a tall screenshot in a
document body displaces an unbounded amount. A body with four images displaces
four times, at four different moments.

## Acceptance Criteria

- [ ] An image occupies its final box **before** the bytes arrive. The `<img>`
      never measures `0x0`
- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec holds the attachment response open, records the bounding
      box of a sentinel paragraph below the image, releases the response, waits
      for `naturalWidth > 0`, and asserts the sentinel's `y` **did not change**
- [ ] The same assertion holds in all three surfaces the one renderer serves: a
      document body (`.doc-body img`), a turn attachment (`.turn-att-img`), and
      the editor
- [ ] A **broken** image — the remote URL that never answers, already covered by
      `apps/ui/e2e/images.spec.ts` — leaves the reserved box and does not collapse
      it, or collapses it before first paint. It must not collapse *later*
- [ ] The existing `images.spec.ts` assertions on `naturalWidth` and on the
      unauthenticated 401 path stay green
- [ ] **Falsification**: revert the reservation, rebuild `packages/kit`'s `dist/`,
      and watch the new spec fail. A source-only revert in kit cannot falsify
      anything a consumer runs — see the ui-dev domain note of 2026-08-16

## Technical Design

### Files to Create/Modify

- `packages/kit/src/markdown/CorpusImage.tsx` — where the box is reserved
- `packages/kit/src/markdown/markdown.css` — `.doc-body img`
- `apps/ui/src/thread/thread.css` — `.turn-att-img`
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

`ViewableImg` (`CorpusImage.tsx:103-112,115`) builds `attrs` with `src`, `alt`,
`className`, `title` and `data-att-target` and **no `width`, no `height` and no
`aspect-ratio`**. The CSS beside it is `max-width` / `max-height` only, which
constrains an image that has decoded and says nothing about one that has not.

Three options, in the order they should be considered.

1. **Carry the dimensions.** If the attachment's width and height are knowable
   before the bytes — from the projection, or from the attachment metadata — set
   `width` and `height` attributes and let the browser reserve the box from the
   intrinsic ratio. This is the only option that reserves the *right* box.
   **Check with contract-dev whether the attachment row already carries them
   before designing around their absence.**
2. **Reserve a fixed box and letterbox into it.** A wrapper with the surface's
   own cap as its height (180px in a turn) and `object-fit: contain` on the
   image. The box never changes; the picture appears inside it. This is clause 1
   applied literally and needs nothing from the server.
3. **Reserve an aspect-ratio placeholder.** Weakest of the three, because a
   guessed ratio is still a guess, and a wrong guess reflows on decode exactly as
   today.

**Do not solve this by holding paint.** `DocView.tsx:378` holds paint for plugin
discovery and is the right pattern *there*, because discovery settles once.
Images arrive one at a time, over an unbounded window, and a body that waits for
all of them is a body that does not render.

**`.att-chip img { height: 34px }` (`composer.css`) is the fix already in the
tree**, on the composer's pending-attachment chips. It is a fixed height, so a
chip thumbnail does not reflow on decode. Copy that reasoning outward.

### Edge Cases

- The remote image that never answers (`images.spec.ts` covers it)
- The unauthenticated `/attachments/*` request, answered 401
- A 1×1 image — `images.spec.ts:26-31` explains why the fixture is 48×36 and not
  1×1, and that reasoning applies to any placeholder chosen here
- An image inside contenteditable, where a reflow also moves the caret
- `.md-img-pending` (`markdown.css:159-171`) is a separate ~22px inline state.
  Whatever box is reserved must match it, or the pending→image transition becomes
  a second jump

## Testing Strategy

Unit tests for whatever attribute derivation is added. The defect itself is
layout, so the acceptance test is a real-browser geometry spec — jsdom implements
no layout and would pass against the current code.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. A document whose body embeds an attachment image, and a paragraph below it
3. Hold `GET /attachments/*` open; record the paragraph's bounding box
4. Release the response
5. Expected: the paragraph does not move. Actual: it moves down by the image's
   rendered height

### Verification Steps

1. Restart the dev server after the change
2. Repeat the reproduction in all three surfaces
3. Expected: the sentinel's `y` is identical before and after decode
4. Repeat against a **real** `corpus` workspace with a real screenshot pasted
   into a turn, and record the numbers — the stub's 48×36 fixture is the floor,
   not the case a person has

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-129]` prefix
