# [UI-136] Three surfaces are drawn larger than the room they open into

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-130 (which measured the first), UI-129 (which measured the second), SHARED-057

## Spec References

- SPEC.md **§10** — the search overlay, the composer, and *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Reconciled by UI-142 (2026-08-21) — finding 1 is closed, 2 and 3 stand

UI-142 audited SPEC.md §10's rider of 2026-08-21 (SHARED-061) and asked whether
these three are that same defect seen from the other side. The answer differs
per finding, and the split is the reason this issue is not simply closed.

**Finding 1 is folded in and done.** It *is* SHARED-061: the card's bound did not
consult the box that actually bounded it. Both halves are now fixed in
`packages/kit/src/address/ComposerAddress.tsx`.

- The card's **width** is derived from the row it sits in, clamped by the
  bounding ancestor's right edge, so inside `.search-panel` it lands 8px inside
  the panel instead of taking a fixed 240px.
- The **ceiling walk** (`clipperOf`) now stops at any bounding ancestor rather
  than only at a scrollport. Its docblock quotes the earlier rejection verbatim
  and records why the premise expired: bounding to the clip cost three visible
  rows only because the card was 240px wide, and the width constant is gone.

Measured at 1280×720, the card's top against the panel's (negative = inside):

```
                            3 lanes         20 lanes
before UI-142               25px cropped    25px cropped
after the width fix alone    0px            80px cropped   ← briefly worse
after the clip walk         6px inside      6px inside
```

The acceptance criterion this issue set — *"must not squeeze a three-lane list to
one visible row"* — holds: at 581px of card those three lanes share one row.

**Findings 2 and 3 are deliberately kept apart.** They are not this rule.

- **2, the reader column's async width**, is SHARED-057's first sentence — *a
  value that arrives later than the box laid out against it*. Nothing about it is
  a bound chosen too small; the bound is simply not known yet. A different half
  of §10, and `settledReader()` is still the open question.
- **3, the reply foot at 336px**, is SHARED-057 clause 2 — *what yields when a
  row runs out of room*. The room there is the column, and the column's width is
  the user's own choice, so there is no larger room being refused. SHARED-061
  does not reach it.

Both keep their acceptance criteria unchanged. Finding 1's may be struck.

## Summary

Three findings from the v0.15.0 fixes, all **pre-existing**, all left rather than
folded into a P0 or a P1 whose scope they are not.

**1. The search panel clips the global composer's address card.** Found by
UI-130. `.search-panel` sets `overflow: hidden`, and the card has always been
drawn taller than the room above the composer's line there — **157px against
132px** — so its top padding and its lead are cropped. UI-130 deliberately bounds
the card to the nearest **scrollport** rather than to the nearest clip, because
bounding to the clip squeezed a three-lane list to one visible row and broke
UI-127's compose test. The reasoning is written into `clipperOf`'s docblock.

**2. A reader column resolves its width asynchronously.** Found by UI-129 while
stabilising a spec: a column measured **345px at first paint and 558px settled**.
Everything laid out against that width moves when it lands. That agent worked
around it in the test with a `settledReader()` helper that waits for two
identical readings — a test-side repair for a product-side fact.

**3. The reply composer's foot is over-full at the default column width.** Found
by UI-137. At 336px — the default, not the 560px reading width its slot was
measured against — `Reply ⌘↵` clips, before that change and after it. UI-137's
slot makes it worse in no case and better at 560px, but the foot's composition is
a question about what that row should drop first, which is `apps/ui`'s and not
the kit's.

The second is the same class as three of the audit's six clusters: **a value that
arrives later than the box laid out against it** (SHARED-057 names it in its
first sentence).

## Why these are one issue

Both are *placement against a container whose size is not yet known*, rather than
a box that follows its own content. They are the residue of the same sweep, and
solving either probably teaches the other.

## Acceptance Criteria

- [x] The global composer's address card is fully visible inside the search
      overlay, with its lead and padding intact, at 1280×720 and at the smallest
      viewport the suite exercises — **closed by UI-142, re-measured here**
- [x] Whatever bounds it there does **not** squeeze a three-lane list to one
      visible row — UI-130 tried that and it failed UI-127's compose test —
      **re-measured here: 4 of 4 rows visible, no scrollbar**
- [x] A reader column's width is settled before content is laid out against it,
      or the content tolerates the change without moving — **closed by UI-146 +
      UI-149, and now asserted per animation frame for both renderers**
- [x] `settledReader()` in the e2e helpers is no longer needed to hide a product
      fact — either it is deleted, or its docblock says which product behaviour it
      still legitimately waits for — **kept, and its docblock now says so**
- [x] The reply composer's foot fits at the **default** 336px column width, with
      a stated rule for what yields first — the audit's rubric is that controls
      keep their size and variable text truncates (SHARED-057 clause 2)
- [x] A browser test measures each, falsified by reverting

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx` — `clipperOf`, and read its
  docblock before changing what it bounds to
- `apps/ui/src/search/` — `.search-panel`'s `overflow`
- the reader column's width resolution
- `apps/ui/e2e/` — the helper and the measurements

### Key Implementation Details

**Read `clipperOf`'s docblock first.** It records exactly why bounding to a clip
was rejected once, and a fix that re-derives that decision without reading it will
re-derive the failure too.

### Edge Cases

- A composer inside the focus shell
- The comment popover, which has no scrollport above it and is already correct
- A column being dragged wider while a card is open

## Testing Strategy

Browser geometry tests. jsdom implements no layout, so neither of these is
visible to a unit test.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Open the search overlay, open the composer's address card, measure its top
   against the panel's clip
3. Load a reader column cold and measure its width at first paint and settled
4. Confirm nothing laid out against it moved

## E2E Verification Log

**Model: opus.** Chromium via Playwright against the real Vite dev server on
`CORPUS_UI_PORT=5399`, `npm run build` first. All three findings were re-measured
before any code was written, because two of the three had been fixed by other
issues in the meantime and a fix for a defect that is gone is a re-theme.

### Finding 1 — the search panel's clip: **already closed by UI-142, verified**

The card's top against `.compose-panel`'s clip, negative meaning inside, with
`.address-lead` and the lane list measured beside it:

```
roster   viewport     card w×h    top    bottom   lanes visible   list scrolls
 3       1280×720     581×131.6   −6.3   −48.2    4 of 4          no
 3        900×600     581×131.6   −6.3   −48.1    4 of 4          no
20       1280×720     581×132     −5.9   −48.2    18 of 21        yes
20        900×600     581×132     −6.0   −48.1    18 of 21        yes
```

The card is 6px inside the panel at the top and 48px clear at the bottom, at both
viewports. The lead is drawn (13.9×15.2 at x=382, inside the card). And the
criterion UI-130's attempt broke — *"must not squeeze a three-lane list to one
visible row"* — holds: an ordinary three-lane roster shows all four rows with no
scrollbar. A twenty-lane roster scrolls, which is a roster longer than any card
can hold and is honest.

The reconciliation note above was right and nothing was changed for this finding.

### Finding 2 — the reader column's async width: **closed by UI-146 + UI-149**

Filed as *"345px at first paint and 558px settled"*. Both causes are gone: UI-146
stopped the column animating open, and UI-149 removed the reader-open widening
altogether (rider 3 — a column renders at its chosen width, reading or not).

Sampled `.doc-main`'s width on every animation frame for 4 s, starting **before**
the row was clicked so the first painted frame is in the record, and recording
only frames whose width differs from the one before:

```
conversation via a path column        [{t:154, w:410, x:390}]
conversation opened in a 336 column   [{t:195, w:306, x:33 }]
note via a path column                [{t:180, w:410, x:390}]
note opened in a 336 column           [{t:205, w:306, x:33 }]
```

One frame each. There is no second width.

`settledReader()` is **kept, not deleted**, and its docblock now says why — the
criterion's second branch. It no longer hides a product fact; what it still waits
for is content arriving into a box that already has its measure: an image
decoding into its reserved space, and a thread's turns rendering. Measured on a
conversation, the body's first two distinct frames are

```
{top: 346.7, left: 15, width: 410, closing:  346.7}
{top: 348.7, left: 15, width: 410, closing: 1032.4}
```

— 410px wide in both, differing only in what is inside them.

**Test.** `column-open-geometry.spec.ts` asserted this per animation frame for a
**document** body only. A conversation is a different renderer over a different
tree, so all three of its tests could pass while a thread reader still moved. A
fourth test was added for the conversation, with a weaker assertion that is the
honest one — `assertMeasureNeverMoved`: every frame's `left` and `width` equal the
first painted frame's, while the interior is allowed to fill in. Falsified by
running it with `assertNothingMoved` instead, which fails on `closing`
346.7 → 1032.4: the sampler really is seeing the frames before the turns land, so
a width that moved in that window would be caught.

### Finding 3 — the reply composer's foot: **`Reply ⌘↵` no longer clips**

Measured at nine widths across `MIN_COLUMN_WIDTH` (240) to `MAX_COLUMN_WIDTH`
(960), reply composer on a 30-turn conversation, 1280×720:

```
column   foot rows   address    toggle    hint (shown/whole)   send      send clipped
 240        3        140.5 ✓    69.5 ✓     15.9 / 107          50.6 ✓    no
 280        2        140.5 ✓    69.5 ✓     55.9 / 107          50.6 ✓    no
 336        2        140.5 ✓    69.5 ✓    107.5 / 107 ✓        50.6 ✓    no
 440        1        140.5 ✓    69.5 ✓     31.4 / 107          50.6 ✓    no
 500        1        140.5 ✓    69.5 ✓     91.4 / 107          50.6 ✓    no
 560        1        140.5 ✓    69.5 ✓    107.5 / 107 ✓        50.6 ✓    no
 700        1        140.5 ✓    69.5 ✓    107.5 / 107 ✓        50.6 ✓    no
 960        1        140.5 ✓    69.5 ✓    107.5 / 107 ✓        50.6 ✓    no
```

`Reply ⌘↵` is 50.6px wide with `scrollWidth === clientWidth` at every one of
them, and so is the toggle, and so is the address line. **The clip UI-137
reported is gone** — its own `flex: none` on the controls and `flex: 1 1 0` on
the hint is what removed it, and the rule is written out in `thread.css`. Nothing
was changed here for this finding either.

The stated yield order is what the numbers show. The hint is the only item that
ever gives, and it gives progressively — whole at 336 and at 560 and wider,
55.9px at 280, 31.4px at 440 (where the foot is one row and the room is
tightest), 15.9px at 240. Where it truncates it reveals: the whole sentence is on
its `title`, which the new test checks whenever `scrollWidth` exceeds
`clientWidth`. `flex-wrap` is the last valve, and it engages exactly where
`thread.css` says it does — two rows at 336 and below, three at 240.

**Test.** Five tests in `apps/ui/e2e/composer-press.spec.ts`, one per width,
asserting that the controls and the address line are unclipped, that nothing is
painted outside the foot's own box, and that a truncated hint carries its whole
sentence. Falsified with `flex-wrap: nowrap` and a shrinkable send button: red at
240 and 336, green at 440 and wider — honest, because a foot only has to yield
where the room actually runs out.

### What was actually still broken, and where it went

Probing finding 3 turned up the defect UI-157 was filed for, in a state neither
issue describes: with the composer's foot at the **fold** of the reading surface,
the first press on any of its controls was swallowed, at every width from 240 to
960. `:focus-within` pins the composer, the browser gives focus on `mousedown`,
so the box lifted between the press and its release and the `mouseup` landed
somewhere else. That is fixed under UI-157 — `apps/ui/src/thread/composerPin.ts`
— and the measurements are in that issue's log.

### Full suite

`npm run build`, `npm run lint`, `npm run typecheck -w apps/ui -w packages/kit`,
`vitest run apps/ui packages/kit` (242 files, 4649 tests) and the whole
Playwright suite all pass.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-136]` prefix
