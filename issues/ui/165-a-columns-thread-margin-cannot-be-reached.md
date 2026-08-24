# [UI-165] A column's thread margin cannot be reached by any gesture

## Domain
ui

## Status
done

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: UI-163
- Blocks: —

## Spec References
- SPEC.md Section 10 — Document view: _"in focus mode and wide layouts, threads
  sit Docs-style in the right margin, aligned to their anchors with connectors;
  in narrow columns they sit as chips at the anchor"_
- SPEC.md Section 10 — the fills-its-reader rider (signed 2026-08-23): _"Where a
  reader gives its body less than its full width — anchored threads in the margin
  are the case that exists"_

## Summary

**Found by UI-163's implementer while proving the rider's margin clause, and
escalated rather than guessed at.**

Two numbers make the column's margin mode dead code:

- `MARGIN_MIN_WIDTH` is **1100**, measured on `.doc-main`
- `MAX_COLUMN_WIDTH` is **960**, which is about **916** of content

A column cannot be dragged wide enough to earn a margin. So the "wide layouts"
half of §10's adaptive placement is reachable only in focus mode, and a column
always falls to the chips-at-the-anchor form however wide the user makes it.

This is not a regression from UI-163. Both constants predate it. UI-163 surfaced
it because the signed rider names the margin as *the* case where a reader gives
its body less than its full width, and proving that clause in a column required
applying `.with-margin` to the stylesheet directly — a test reaching past a
gesture no user can make. That is stated loudly in the spec file and in UI-163's
log rather than left implicit.

## The decision this issue needs

Three answers, and this is a product call rather than an implementation one:

1. **Lower `MARGIN_MIN_WIDTH`** so a wide column earns its margin. The margin
   card is 300px plus a 30px gap, so a 916px column would leave ~586px of body —
   narrower than the reading measure focus mode defaults to, but not absurd.
2. **Raise `MAX_COLUMN_WIDTH`** so a column can reach 1100. That makes one column
   most of a screen, which is what focus mode is for.
3. **Say the margin is focus mode's**, and amend §10 so "wide layouts" names the
   surface rather than a width. Honest, costs nothing, and makes the two
   constants agree with the spec instead of contradicting it.

**3 is the cheapest and 1 is the most faithful to the sentence as written.** Both
are defensible. Choosing needs the user, because §10's current wording promises
a behaviour the product does not deliver at any width, and either the wording or
the width has to move.

## Decided by the user, 2026-08-23 — lower the margin threshold

**Chosen: option 1.** `MARGIN_MIN_WIDTH` comes down so a wide column earns its
margin by dragging its own edge. At 916px of content the card takes 300px plus a
30px gap, leaving about 586px of body.

**Why it won.** The user signed a rider on 2026-08-23 that names the margin as
*the* case where a reader gives its body less than its full width. A constant
that makes that case unreachable in a column contradicts text signed the same
day. The most faithful reading of the signature is that the margin is meant to
happen.

**Rejected: amend §10 to say the margin is focus mode's.** Cheapest, and it would
have made the spec agree with the code by lowering what the spec promises. The
user chose to raise what the code delivers instead.

**Rejected: raise `MAX_COLUMN_WIDTH` to 1100.** It buys the behaviour by making
one column most of a screen, which is what focus mode already is — blurring the
two surfaces to satisfy a threshold.

**The cost, stated.** A column at its widest will read narrower than full
screen's default measure once the margin takes its 330px. That is the trade, and
it is the trade the margin always implied.

## Acceptance Criteria

- [x] The choice is made and written down, with the two rejected options and why
      each lost. — "Decided by the user, 2026-08-23" above.
- [x] If the answer changes a constant, a column can reach the margin **by
      dragging its edge**, and an e2e test proves it without touching the
      stylesheet. — `doc-width.spec.ts` › "earns the margin by dragging its
      edge, and fills the track the margin leaves". It drags
      `.col.reading .col-resizer` and touches no stylesheet.
- [x] If the answer changes §10, the amendment is drafted, read back to the user,
      and signed before it is applied. — **n/a**: option 3 was rejected, so §10
      is unchanged. The code moved to meet the text already signed.
- [x] UI-163's e2e spec stops reaching past a gesture, or says permanently why it
      must. — the `classList.add("with-margin")` call and the paragraph
      explaining it are gone, replaced by the drag.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/anchors/` and `apps/ui/src/board/columnWidth.ts` — the constants
- `apps/ui/e2e/doc-width.spec.ts` — the margin assertion
- `SPEC.md` §10 — only under option 3, and only after a signature

### Key Implementation Details

Read UI-163's E2E Verification Log first. It records the measurement and the
workaround, and the workaround is the evidence this issue exists.

Whatever moves, the anchored card must stay level with its highlight across a
resize. UI-163 asserts that across a +240px change and it must keep holding.

### Edge Cases
- A column at exactly the threshold.
- The margin appearing and disappearing as a column is dragged across it — the
  body's fill must follow in the same frame, which is the rider's rule.

## Testing Strategy

An e2e test that drags a column's edge to the widest a user can reach and asserts
which placement the threads take. It must be able to fail: move the threshold and
watch the assertion flip.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a document with anchored threads in a column
2. Drag the column's edge to its maximum
3. Expected, per §10: threads in the right margin
4. Actual: chips at the anchor, at every reachable width

### Verification Steps
1. Repeat after the change, if a constant moved
2. Confirm the anchored card stays level with its highlight across the resize

## E2E Verification Log

Implemented by **ui-dev on opus** (`claude-opus-5[1m]`), 2026-08-23, branch
`phase-44-reach-and-size`. Every number below is `getBoundingClientRect` or
`clientWidth` off a real Chromium page driven by Playwright against the Vite dev
server on `CORPUS_UI_PORT=5399`, viewport 1600×900.

### Reproduction (bugs only)

A column reader holding one anchored conversation, opened with "Open here" so it
takes the column's own width, at four widths. `withMargin` reads
`.reader-scroll.classList`; `mainClient` is `.doc-main.clientWidth`, the number
the old threshold was compared against.

| column width | `.reader-scroll` content | `.doc-main` | `with-margin` | cards in margin |
| --- | --- | --- | --- | --- |
| 336 (default) | 306 | 306 | **false** | 0 |
| 700 | 670 | 670 | **false** | 0 |
| 900 | 870 | 870 | **false** | 0 |
| 960 (`MAX_COLUMN_WIDTH`) | 930 | 930 | **false** | 0 |

And by the gesture itself: from a 500px column, one pointer drag on
`.col.reading .col-resizer` out past the stop.

    BEFORE DRAG :: {"colWidth":500,"content":470,"withMargin":false,"cardsInMargin":0}
    AFTER  DRAG :: {"colWidth":960,"content":930,"withMargin":false,"cardsInMargin":0}

The drag reaches the stop and the margin never appears. `MARGIN_MIN_WIDTH` was
1100 against a `.doc-main` that maxes out at 930 — the gap is 170px, and no
gesture closes it. Confirmed as reported.

### A defect found while fixing it — the naive change flaps forever

Lowering the constant alone does **not** work, and this is why the fix is
structural rather than one number. The threshold was read off `.doc-main`, and
the margin's 330px comes *out of* `.doc-main`. So the moment the class goes on,
the measured box drops below the threshold that turned it on.

Measured: `MARGIN_MIN_WIDTH = 600`, still read off `.doc-main`, at a 900px
column, counting `class` attribute mutations on `.reader-scroll` with a
`MutationObserver`:

    FLAP :: class mutations in 1500ms = 62
    FLAP GEOMETRY :: {"colWidth":900,"content":870,"withMargin":false,"cardsInMargin":0}

41 toggles a second, forever, settling on no margin at all. A user would see a
flickering reader, not a margin.

The threshold therefore moved to the **host** — the box the `.with-margin` grid
is applied to, `.reader-scroll` in a column and `.focus-inner` in focus mode —
whose width does not change when the grid comes up. It is read border-box
(`getBoundingClientRect().width` less padding and border) so that a scrollbar
appearing inside the host cannot move it either. `marginHost()` is now the one
resolver for both effects, so the box that is measured and the box the class
lands on can never be two different elements.

### Post-Implementation Verification

`MARGIN_MIN_WIDTH` is now `MARGIN_BODY_MIN (520) + MARGIN_COLUMN_RESERVE (330)`
= **850**, measured on the host. 520 is `62ch` of the shipped 15px serif —
`.doc-body`'s own default measure — so the rule reads: the margin may take the
room the document does not need, never the room it does.

Same four columns, after:

| column width | host content | `.doc-main` | `with-margin` | body | margin box | cards in margin |
| --- | --- | --- | --- | --- | --- | --- |
| 336 | 306 | 306 | false | 306 | — | 0 |
| 700 | 670 | 670 | false | 670 | — | 0 |
| 900 | 870 | **540** | **true** | 540 | 300 | **1** |
| 960 | 930 | **600** | **true** | 600 | 300 | **1** |

The crossover, measured to the pixel — host content is the column's width less
30px (2px of column border, 28px of `.reader-scroll` padding):

| column width | host content | `with-margin` |
| --- | --- | --- |
| 860 | 830 | false |
| 875 | 845 | false |
| 878 | 848 | false |
| **880** | **850** | **true** — body lands on exactly 520 |
| 882 | 852 | true |

**By the gesture** — from 820px, one drag out to the stop and one drag back:

- Before: `with-margin` absent, `[data-anchor-slot="th_1"]` present in
  `.doc-main`, `.focus-margin` absent.
- After +400: `.col.reading` is `960px`, `with-margin` present,
  `.focus-margin > [data-thread-panel="th_1"]` present, and **no**
  `[data-anchor-slot]` left in the body — one conversation, one placement.
- Body 600px against a track of 600px (|Δ| < 1.5), so the body fills the track
  the margin leaves rather than the whole box.
- The card is level with its highlight: `cardTop === anchorTop`, measured from
  `.doc-main`'s own top.
- **It settles**: 0 class mutations in 600ms after the drag.
- After −300: `with-margin` gone, the slot back in the body, the body back to
  the whole room.

**The card stays level with its highlight across a resize** — the constraint
this issue had to keep. `doc-width.spec.ts`'s focus-mode test drags the width
handle +120 (a >150px body change) and re-asserts `cardTop === anchorTop`, the
margin still 300px wide, and the margin still inside the scroller. Green.

**The stylesheet is no longer touched by any test.** `doc-width.spec.ts`'s
margin test used to `classList.add("with-margin")` by hand and said so; it now
drags `.col.reading .col-resizer` and asserts what the app decides.

### Falsification

Both halves of the change were reverted in place and the test watched.

1. `MARGIN_MIN_WIDTH` back to `1100` (host-measured) →
   `earns the margin by dragging its edge` **fails**:
   `expect(locator).toHaveClass(/with-margin/)` received `"reader-scroll"`.
2. Threshold left at 850 but read off `element.clientWidth` (`.doc-main`) again
   → the same test **fails** the same way: the flapping class is off on the
   frame the assertion catches.
3. `.focus .turn-markdown` reverted (UI-166's change, same session) → this
   file's tests stay green, so the two changes are independent.

### Suites run

- `playwright doc-width.spec.ts cascade-order.spec.ts --workers=1` — **19
  passed** (4.5m).
- `playwright collapse.spec.ts anchor-layer.spec.ts turn-model.spec.ts
  anchors.spec.ts --workers=1` — **50 passed** (6.7m). These are every other
  spec that asserts on `.with-margin` or on a turn's placement. All of them use
  default-width (336px) columns, so none crosses the new threshold.
- `vitest run apps/ui packages/kit` — 4678 passed, 2 failed, both in
  `apps/ui/src/main.test.tsx`. **Pre-existing and load-sensitive, not this
  change**: on the committed tree the same file fails at 5040ms against a 5000ms
  budget, and on this tree with `--testTimeout=30000` both tests pass in 7.4s
  and 1.2s. Flagged to the orchestrator; it belongs with INFRA-020.
- `eslint apps/ui packages/kit` clean, `prettier --check` clean, `tsc --noEmit`
  clean in both workspaces.

### Left for the orchestrator

`MAX_COLUMN_WIDTH` (960) and the threshold (880 of column width) leave an 80px
band in which a column has a margin. That is the direct consequence of choosing
option 1 over option 2, and it is stated rather than widened.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
