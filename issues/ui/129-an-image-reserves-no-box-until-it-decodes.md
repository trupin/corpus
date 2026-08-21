# [UI-129] An image reserves no box until it decodes

## Domain

ui

## Status

done

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

- [x] An image occupies its final box **before** the bytes arrive. The `<img>`
      never measures `0x0`
- [x] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec holds the attachment response open, records the bounding
      box of a sentinel paragraph below the image, releases the response, waits
      for `naturalWidth > 0`, and asserts the sentinel's `y` **did not change**
- [x] The same assertion holds in all three surfaces the one renderer serves: a
      document body (`.doc-body img`), a turn attachment (`.turn-att-img`), and
      the editor
- [x] A **broken** image — the remote URL that never answers, already covered by
      `apps/ui/e2e/images.spec.ts` — leaves the reserved box and does not collapse
      it, or collapses it before first paint. It must not collapse *later*
- [x] The existing `images.spec.ts` assertions on `naturalWidth` and on the
      unauthenticated 401 path stay green
- [x] **Falsification**: revert the reservation, rebuild `packages/kit`'s `dist/`,
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

Implemented on: **opus**. Real Chromium through Playwright, real Vite dev server
on `5286`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8896`. Every measurement below
comes from `Element.getBoundingClientRect()` through Playwright's `boundingBox()`,
rounded to whole pixels.

### Decision taken: the wire carries no dimensions, so the box is stated

Checked first, as instructed. **`packages/contract` publishes no attachment
dimensions**, and says so deliberately —
`packages/contract/src/schemas/attachment.ts` states: *"There is deliberately no
`AttachmentRef` resource here: the projection's `turns` table carries only
`body_md` (SPEC.md §9.1), so no endpoint can produce a structured attachment
list."* The contract publishes `AttachmentFileSchema`, `AttachmentFilesSchema`
and `AttachmentPathSchema` — a path, a name and bytes, no width and no height.
Nothing was added to the contract.

Decision **2** was therefore taken: a stated placeholder box, the same before the
bytes, during them and after them.

**The ratio is 4:3, and the box is 240×180.** Not chosen freshly —
`design/index.html` line 468 already states `.turn-att-img { max-width: 240px;
max-height: 180px }`, which is the one image box the mockup draws anywhere. That
also answers the rider's own test, *"the box is sized for the text people
actually have, measured against real content rather than a placeholder"*: what a
person attaches to a turn is a screenshot, which fills a 4:3 box or is capped by
it. The picture is placed with `object-fit: scale-down`, so anything larger is
contained and anything smaller is left at its own size rather than blown up.
`--md-img-box-w` / `--md-img-box-h` retune it per surface.

**Known tradeoff, stated rather than hidden.** A *small* image — the 48×36 test
fixture, an inline badge — now sits inside a 240×180 reservation with visible
slack around it. That is decision 2 working as specified ("a wrong-but-stable box
beats a box that changes"), and it is the cost of a box that cannot be derived
before the bytes. If the contract later carries dimensions, option 1 replaces
this and the slack disappears.

### The fixtures

Two sizes, because the issue says so itself — the 48×36 PNG "is the floor, not
the case a person has". The mid-prose reference and the document body use it; the
turn's trailing attachment is a generated solid **900×600** PNG, the size of a
pasted screenshot. That covers both halves of `object-fit: scale-down` and both
ends of the displacement.

### Reproduction (pre-fix, and again as the falsification)

The defect is layout, so the reproduction and the falsification are the same
experiment. `GET /attachments/*` is held open by a Playwright route, a sentinel
paragraph beneath the image is measured, the response is released, and the
sentinel is measured again. With the reservation removed from
`packages/kit/src/markdown/markdown.css` and **`npm run build -w packages/kit`
re-run** (per the ui-dev note of 2026-08-16). Two consecutive runs, identical:

```
SENTINEL[turn body, 48x36]        y=411 -> y=421   delta= +10px
SENTINEL[turn attachment, 900x600] y=540 -> y=829   delta=+289px
SENTINEL[editor body, 48x36]       y=310 -> y=320   delta= +10px
SENTINEL[under remote, broken]     y=388 -> y=391   delta=  +3px
picture (turn attachment)          y=478 -> y=488   delta= +10px
picture (remote, on failure)       y=376 -> y=354   delta= -22px
```

and the boxes themselves, while held open:

```
pending placeholder   84x26   (a chip hugging its label)
remote image loading   0x0    (UI-128's exact measurement, reproduced)
```

**289px** is a real screenshot in a real conversation, and it is the number that
matters: everything below that turn drops by more than a screenful the moment
the bytes land. It exceeds UI-128's stated 180px ceiling because the falsified
build has neither the reservation nor the old `max-height` cap — with the cap
alone the displacement was up to 180px.

### After the fix

Reservation restored, `npm run build -w packages/kit` re-run, same experiment,
same fixtures. Two consecutive runs, identical:

```
SENTINEL[turn body]                y=565 -> y=565   delta=0
SENTINEL[turn attachment]          y=849 -> y=849   delta=0
SENTINEL[editor body]              y=464 -> y=464   delta=0
SENTINEL[under remote, broken]     y=690 -> y=690   delta=0
picture (turn attachment)          y=632 -> y=632   delta=0
picture (editor body)              y=271 -> y=271   delta=0
picture (remote, on failure)       y=498 -> y=498   delta=0
```

Every box measures **240×180** in all three states — pending chip, decoded
picture, failed remote image — on all three surfaces, and the 900×600 screenshot
is contained into the same box rather than sizing it.

Five consecutive runs of the shipped spec, green.

### One thing the spec had to learn not to blame on images

The first version of the geometry spec was flaky about one run in three, and the
cause was not an image. **A reader column resolves its width asynchronously**:
measured 345px at the first paint and 558px once settled, in which the document
title and several paragraphs wrap differently. A `before` measurement taken
inside that window makes the sentinel appear to move 28px for a reason that has
nothing to do with a picture. `settledReader()` waits for two identical
consecutive width readings, so the spec measures the image and only the image.
The instability is the column's, not this issue's, and it is documented in the
spec rather than smoothed over.

### Two defects the first browser run exposed, both fixed

1. **A broken `<img>` ignored the reservation.** Chromium stops treating an image
   whose load failed as replaced content and renders its `alt` as inline text,
   and `width`/`height` do not apply to a non-replaced inline box. Measured
   collapse: **240×180 → 63×24**. Fixed with an explicit `display: inline-block`
   on `.md-img`, and pinned by the third spec.
2. **The turn attachment strip still moved 3px.** `CorpusImage` puts the host's
   class on the *picture* only, so `.turn-att-img`'s `display: block` and
   `margin-top: 6px` reached one of the three states and not the other two. The
   stacking and the gap moved up to `.turn-atts`, which cannot tell the three
   apart — which is what makes it the right place for them.

### Regression runs

- `e2e/images.spec.ts` — 6 passed. `naturalWidth`, the `blob:` source, the 401
  path and the full-screen viewer are all unchanged.
- `e2e/thread.spec.ts` — 20 passed. Its mockup-parity probe was updated: it
  measured `max-width`/`max-height` on a bare `.turn-att-img`, and now measures
  `width`/`height` on the `md-img turn-att-img` pair `CorpusImage` actually
  composes. The mockup's 240×180 is still the number asserted.
- `e2e/attachments.spec.ts`, `e2e/compose-keyboard.spec.ts`,
  `e2e/todos-menu.spec.ts`, `e2e/editor.spec.ts`, `e2e/turn-comment.spec.ts` —
  all passing. `.att-chip img { height: 34px }` is untouched: a composer chip is
  a plain `<img>`, never a `.md-img`.
- `packages/kit` + `apps/ui/src` unit suites — 4079 passed. Four failures are
  **not this issue's**: `packages/kit/src/index.test.ts` reports an undeclared
  `lanesCappedNote` export (UI-130, in flight), and
  `apps/ui/src/editor/markdown/corpus.test.ts` round-trips `issues/ui/128-…md`'s
  own table. Both were failing before this change.
- `tsc --noEmit` clean in `packages/kit` and `apps/ui`. ESLint clean. Prettier
  clean.

Nothing about how images are stored, fetched or authorised was touched.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-129]` prefix


### After PR #53's review, 2026-08-20

**MAJOR raised and fixed.** The reviewer found the universal 240×180 reservation
regressed **document-body** images from natural-size-under-a-width-cap to a fixed
thumbnail: a 900×600 diagram in a body rendered at ~530px and legible before, and
at 240×180 after, making click-to-zoom the ordinary reading path. That is
SHARED-057 clause 3 read backwards — *"revealing is the uncommon case"* — and it
is the **same mistake UI-135 made and reversed** in this release, one surface
over.

**The box is now per surface, through the retune hooks the first pass had already
built and left unused:**

- A **document body** takes the default: `width: 100%` of its measure, with
  `aspect-ratio: 4 / 3` and `height: auto`. So a body image is back to its
  reading size, and the reservation adds only the stability. At the measure there
  is nothing more of the picture to show, which is what makes revealing genuinely
  uncommon.
- A **turn's attachment strip** sets `--md-img-box-w: 240px` on `.turn-atts`, and
  the height follows the ratio to the mockup's own 180px. A thumbnail beside a
  message is what the mockup draws and what an attachment is.

The height is never a pixel number: it follows the used width, so a column
dragged narrow shrinks the box rather than leaving a tall empty one. All three
states still share the box, so the no-jump guarantee is unchanged.

**Falsified by the orchestrator** after the implementing agent was killed by a
session limit mid-restore: forcing the default back to `240px` fails 4 of the
image-geometry specs; restored, 4 pass. The kit was rebuilt before each run,
because `apps/ui` reads it from `dist/`.

**Verified**: `packages/kit/src/markdown` unit tests, and `image-geometry`,
`thread`, `attachments` — 24 e2e specs, all green.

**A bookkeeping note.** This issue's e2e spec changes were swept into UI-047's
commit by an over-broad `git add apps/ui`. The content is right and the
attribution is not; recorded here rather than rewritten, because the commits were
already made and the record is cheaper to correct than the history.
