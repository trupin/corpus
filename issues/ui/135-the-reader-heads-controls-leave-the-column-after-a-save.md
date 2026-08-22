# [UI-135] The reader head's controls leave the column after a save

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
- Related: UI-113 (a column never shrinks when you open something)

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§10** — the reader and its head

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

- [x] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec records the bounding boxes of `⋯` and `⤢`, drives the save
      chip through all five of `saveChipText`'s outputs, and asserts **both
      buttons' boxes are identical in every state**
- [x] The same spec asserts `head.scrollWidth <= head.clientWidth` in every state,
      with the longest `Back` label the component permits — the head never
      overflows, so nothing is ever clipped
- [x] The save chip's full text stays reachable when it is truncated, per
      SHARED-057 clause 2 — a `title`, or the existing detail surface. It must not
      be silently cut. **The box is reserved to the ordinary state** (120px, the
      wider of `committed · git ✓` and `save failed — retry`), not to the worst
      case — changed on review, see the E2E log §2
- [x] `.reader-id` may still move, or may be pinned — but if it moves, it is the
      **only** thing that moves, and that is asserted — it is **pinned**: with the
      chip's box reserved there is nothing left to push it
- [x] The column variant (`Column.css:348,363`) is covered by the same spec, at
      the narrowest column width `board/columnWidth.ts` permits. `Column.css` was
      **not edited**: its head rules set type and spacing only, so the base rules
      in `Reader.css` reach the column variant unopposed
- [x] `⤢` staying `disabled`-rather-than-unmounted while the doc loads
      (`ReaderHead.tsx:135`), and `SaveChip` rendering an empty element rather
      than nothing (`SaveChip.tsx:41-48`), both survive — those are already the
      right pattern and the fix must not undo them
- [x] **Falsification**: restore `flex: none` on the item that was given a shrink
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

Implemented on: **opus**. Real Chromium through Playwright against the real Vite
dev server (`CORPUS_UI_PORT=5285`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8895`).
Spec: `apps/ui/e2e/reader-head-geometry.spec.ts`.

### 1 — Reproduction (the unshrinkable head restored, 2026-08-20)

`Reader.css`'s head block was reverted to its pre-fix rules (`.back` and
`.save-chip` at `flex: none`, `.reader-id` at `nowrap`, no reservation) and the
new spec run against it. Five of seven tests failed, each on the defect:

```
holds every save state in one box …
  Error: committed · git ✓ · 3 anchors moved: scrollWidth
  expect(received).toBeLessThanOrEqual(expected)
  Expected: <= 558      Received: 630

survives the narrowest column …            Expected: <= 238   Received: 280
still fits … with conversations …          Expected: <= 238   Received: 334
reserves the chip's box …                  Expected substring: "retry"
                                           Received string:    "none"
leaves the ordinary head whole …           the back label is squeezed below
                                           its own cap
```

630px of content in a 558px box at the reading width, 280 in 238 at the
narrowest column, 334 in 238 once the document also carries conversations. Same
failure UI-128 measured (it reached 655 with a slightly longer parent title).
The rule is broken by an ordinary save.

### 2 — The reservation was changed after review: widest state → ordinary state

The first version shipped reserved `committed · git ✓ · 99 anchors orphaned` —
**246.55px**, the widest string `saveChipText` can reach. It satisfied every
acceptance criterion, and it was reversed on review, because it read SPEC.md
§10's third clause backwards: *"the box is sized for the text people actually
have, measured against real content rather than a placeholder, so revealing is
the uncommon case and not the ordinary reading path."* Spending 46% of the head
on a message almost no save carries left the **ordinary** reading width
permanently short — measured, with nothing unusual on screen at all:

```
reserved to the WIDEST state (246.55px) — reading width, long parent title
  .back        w=166   (its own cap is 214: squeezed 48px below it)
  .reader-id   w=83    (truncated — the id of the document you are looking at)
  .save-chip   w=203   (the reservation itself, shrunk by the row)
```

The box is now reserved to what a save **ordinarily** says. Two bounded strings
are in the reckoning and the wider wins: `committed · git ✓` (17 chars) and
`save failed — retry` (19 chars). The failure is included because `— retry` is
a *control* — a box that clipped it would leave a button whose label stops
mid-word, which is the same defect as a control pushed out of the column, one
element in. It costs two characters. The anchor tail is the uncommon case, so
the anchor tail is what truncates, with its whole string on the chip's `title`
(clause 2).

### 3 — Verification (the fix restored, ordinary-state reservation)

All seven tests pass. The head's six recorded states — `""`, `saving…`,
`committed · git ✓`, `… · 3 anchors moved`, `… · 12 anchors orphaned`,
`save failed — retry`, all reached through real typing and real `PUT`s — give
**byte-identical geometry**, in pixels measured from the head's own left edge,
at the reading width with a parent title long enough to cap `.back`:

```
head  scrollWidth=558  clientWidth=558  lastRight=546
.back        x=12   w=214  right=226     ← at its 40% cap (213.6), not below it
.reader-id   x=251  w=101  right=352     ← whole, `scrollWidth == clientWidth`
.save-chip   x=360  w=120  right=480     ← the reservation, unshrunk
⋯ (.expand)  x=488  w=28   right=516
⤢ (.expand)  x=524  w=22   right=546
```

Nothing moves at all — not the chip, not the id, not either control — and
`scrollWidth == clientWidth`, so nothing is clipped. `lastRight=546 ≤ 558`: ⤢
ends 12px *inside* the head it used to end 97px outside. The row now finishes
with **25px of slack still in its auto margin** (`.back` ends at 226, the id
starts at 251), which is the whole difference from §2: at the reading width the
head is no longer in shrink mode at all.

Widths measured against the shipped stylesheet, mono at 10.5px:

- the reservation (`save failed — retry`, 19 chars) is **120px**, and
  `committed · git ✓` draws inside it with room to spare — asserted directly:
  `.save-chip-text` has `scrollWidth == clientWidth` after a real save.
- the ordinary head with a **short** back label (`‹ Inbox`, 39px) puts the id
  and the chip in exactly the same places — `id x=251 w=101`, `chip x=360
  w=120` — because the auto margin, not the chip, absorbs the difference.
- narrowest column (`MIN_COLUMN_WIDTH`, reached through a 288px viewport, since
  `clampColumnWidth` measures the reading floor against the window): column
  240px, head `clientWidth=238`, `scrollWidth=238`. Everything variable yields
  and both controls hold: `.back` w=0, `.reader-id` w=60 (clipped), `.save-chip`
  w=72 (clipped), `⋯` x=168 w=28, `⤢` x=204 w=22 — ending at 226 inside a 238px
  row. **The same again with 💬 2 on the row**, the case that spends the last of
  the slack.

Both controls take a real click and do their real work at both column widths and
with 💬 present: ⋯ opens `.reader-head .comments-pop.open` (asserted visible,
then `esc`), ⤢ opens `.focus.open` (asserted visible, then `esc`).

Truncation is revealed, never cut (SHARED-057 clause 2): `.back`'s `title` is
`‹ <the whole parent title> — Back (shift-click, or ⇧esc: straight to list)`,
`.reader-id`'s is `doc_note · git ✓`, and the chip's is its whole text
(`committed · git ✓ · 12 anchors orphaned`), asserted in the browser.

### 3 — Falsification

The reproduction above **is** the falsification, run in that order, and it was
run twice — once against the widest-state reservation and again after the change
to the ordinary state. The second time: the unshrinkable head restored → five
failures with the numbers in §1 → restored → seven passes. During it the spec also caught a defect of its own making: with the
retry `<button>` *replacing* the chip, the chip measured 203px as a `<span>` and
247px as a `<button>` in the same row, because Chromium will not shrink a
`<button>` below its own content whatever `min-width` says. The retry control is
nested inside the chip now, so the flex item is one element in every state.

### 4 — Regression runs (after the reservation change)

- `apps/ui/src/editor` + `apps/ui/src/reader`: **1139 passed**. (Before the
  change, `apps/ui/src` in full was 3159 passed with 3 failures in
  `editor/markdown/corpus.test.ts` on UI-128's issue file — a markdown table
  round-tripping 4 cells as 5, unrelated to this issue. Those now pass.)
- e2e, one batch: `reader`, `editor`, `key-conflict`, `column-width`, `related`,
  `soft-wrap`, `plugin-late-arrival`, `edit-session-close`, `smoke`, `board`,
  `thread`, `anchors`, `reveal`, `collapse`, `context-menu`, `comment-move`,
  `reader-head-geometry` — **164 passed**.
- `tsc --noEmit` in `apps/ui`: clean. ESLint over `apps/ui/src` and
  `apps/ui/e2e`: clean. Prettier: clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-135]` prefix
