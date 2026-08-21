# [UI-130] The reader head's controls leave the column after a save

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
- Related: UI-113 (a column never shrinks when you open something)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§11** — the reader and its head

## Summary

The reader's head is a flex row in which **no item can shrink**. `.back` and
`.save-chip` are `flex: none`, and `.reader-id` is `white-space: nowrap`, so its
min-content is the whole string. The row therefore has exactly as much give as
`margin-left: auto` can spend, and when that runs out the row overflows a
`.col { overflow: hidden }` parent and the `⋯` and `⤢` buttons are clipped away.

The content that spends the slack is the save chip, whose text grows *because the
person just typed*, and the Back label, which is a parent document's title. The
two controls that disappear are the two a person reaches for immediately after
editing.

## The measurement (UI-128, real Chromium, 2026-08-20)

**Part 1 — the ordinary case.** A reader at its default width, each save-chip
string in turn:

```
""                                        head_w=558 id_x=390 chip_w=  0 expand_x=507
"saving…"                                 head_w=558 id_x=346 chip_w= 44 expand_x=507
"committed · git ✓"                       head_w=558 id_x=283 chip_w=107 expand_x=507
"committed · git ✓ · 3 anchors moved"     head_w=558 id_x=169 chip_w=221 expand_x=507
"committed · git ✓ · 12 anchors orphaned" head_w=558 id_x=144 chip_w=247 expand_x=507
```

`.reader-id` travels **246px**. The buttons hold — while slack exists.

**Part 2 — the slack running out.** The same head with a `Back` label that is a
real document title (`.back` is capped at `max-width: 40%`, so this is a label
the component itself permits) and the longest save chip:

```
head=19..577  scrollW=655  clientW=558  lastRight=674
kids= back@31..245 reader-id@253..354 save-chip@362..608 expand@616..644 expand@652..674
```

**655px of content in a 558px box.** `⤢` ends at x=674 against a head that ends
at 577 — **97px outside the column**, and clipped by `.col { overflow: hidden }`.

## Acceptance Criteria

- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec records the bounding boxes of `⋯` and `⤢`, drives the save
      chip through all five of `saveChipText`'s outputs, and asserts **both
      buttons' boxes are identical in every state**
- [ ] The same spec asserts `head.scrollWidth <= head.clientWidth` in every state,
      with the longest `Back` label the component permits — the head never
      overflows, so nothing is ever clipped
- [ ] The save chip's full text stays reachable when it is truncated, per
      SHARED-057 clause 2 — a `title`, or the existing detail surface. It must not
      be silently cut
- [ ] `.reader-id` may still move, or may be pinned — but if it moves, it is the
      **only** thing that moves, and that is asserted
- [ ] The column variant (`Column.css:348,363`) is covered by the same spec, at
      the narrowest column width `board/columnWidth.ts` permits
- [ ] `⤢` staying `disabled`-rather-than-unmounted while the doc loads
      (`ReaderHead.tsx:135`), and `SaveChip` rendering an empty element rather
      than nothing (`SaveChip.tsx:41-48`), both survive — those are already the
      right pattern and the fix must not undo them
- [ ] **Falsification**: restore `flex: none` on the item that was given a shrink
      budget and watch the spec fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/Reader.css` — `.reader-head` and its children (`:30-75`)
- `apps/ui/src/board/Column.css` — the column variant (`:348,363`)
- `apps/ui/src/reader/ReaderHead.tsx` — if a `title` is added for the revealed text
- `apps/ui/src/editor/SaveChip.tsx` — only if the copy itself is shortened
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

**The rule is clause 1, and the shape of the answer is already in the codebase
one file away.** `Column.css:135`'s `.col-count` is the same problem solved
correctly: the count is async and digit-growing, but `.col-title` truncates
(`min-width: 0` + ellipsis) and the auto margin absorbs the rest, so `＋` and `⋯`
never move. The reader head has the auto margin and **no yielding item**.

Decide which item yields, and say so in a comment:

- **`.save-chip` is the natural candidate.** It is the item whose text grows, its
  long forms are informational rather than identifying, and clause 2 says to
  reveal the whole of it elsewhere. Give it `min-width: 0; overflow: hidden;
  text-overflow: ellipsis` and a `title`.
- **Or reserve it.** `saveChipText` has five outputs and the longest is
  `committed · git ✓ · 12 anchors orphaned`. Sizing the chip to a measured
  worst case is the straightforward reading of *"the box is sized for the text
  people actually have"* — but note the anchor count is unbounded, so a hard
  reservation still needs a truncation rule behind it.

Shortening the copy is legitimate and may be the best answer: `committed · git ✓
· 12 orphaned` says the same thing 8 characters shorter, and the full sentence
already exists in the save state the chip reads.

**Do not fix this by widening the head or the column.** The column's width is the
view document's, deliberately (`Column.css:10`, `board/columnWidth.ts`), and a
head that demands a minimum width would make the content decide the column, which
is the same rule broken one level up.

### Edge Cases

- The narrowest column `columnWidth.ts` permits
- A `Back` label at its full `max-width: 40%`
- Focus mode, which uses a different head
- A document with threads, so the `💬 n` button is present — measured in UI-128 as
  *not* pushing the controls, and that must stay true
- `saving…` → `save failed`, the error branch
- Zero anchors, so the chip is at its shortest, and 3-digit anchor counts

## Testing Strategy

Unit tests for any copy or derivation change. The defect is layout, so the
acceptance test is a real-browser geometry spec. The chip's five strings can be
driven either through a real save whose response reports remapped anchors, or by
mounting the reader in each `SaveState` — a real save is preferred, because it
also proves the state actually reaches the chip.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. Open a document from a parent with a long title, so `Back` is at its cap
3. Record the bounding boxes of `⋯` and `⤢`
4. Edit the document so a save reports remapped or orphaned anchors
5. Expected: the buttons do not move. Actual: the head's content reaches 655px in
   a 558px box and both buttons are clipped

### Verification Steps

1. Restart the dev server after the change
2. Repeat the reproduction in the reader and in a column reader
3. Expected: `scrollWidth <= clientWidth` throughout, and both buttons' boxes are
   byte-identical across all five chip states
4. Confirm the chip's full text is still reachable when truncated

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-130]` prefix
