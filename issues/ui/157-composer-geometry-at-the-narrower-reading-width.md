# [UI-157] The composer's address line misbehaves at the path column's 440px

## Domain
ui

## Priority
P2

## Status
done

## Model
opus

## Dependencies
- Depends on: UI-149 (which found it)
- Related: SHARED-061 — nothing resizes because of what it holds

## Spec References
- SPEC.md §10 — "UI — the board", the reader and its composers

## Summary

Found by UI-149's implementer while porting the e2e suites to the new default
reading width, and **reproduced with a probe rather than inferred** from a
failing assertion.

A path column is 440px at base, where a query column's reader used to be 560px.
At the narrower width the composer's address line can wrap, or scroll under a
click, when the composer's foot sits at the clipped edge of the reading surface:
the click's `pointerdown` scrolls the foot into view and the `mouseup` lands
somewhere else, so the click misses its target.

Surfaced through `address-room-geometry` and `resident`. Both suites are ported
and green — they now open at a seeded 560 width through "Open here", which
preserves the claims they were written to make. **So this issue is not a red
test. It is a behaviour nobody is asserting.**

## Why it is filed rather than fixed

UI-149 was already the largest change in Phase 41, and the honest scope of this
one is the composer's geometry at any narrow width — not the width UI-149
happened to choose. It belongs with SHARED-061's rule: a surface is as large as
its place allows, and a control inside it must stay reachable at every width the
place can take, rather than at the one width the tests happen to use.

## Acceptance Criteria
- [x] A composer at 440px keeps its address line and its send control reachable
      by pointer, with no scroll-under-click
- [x] Measured across the width range a path column can actually take, not at
      one chosen number — 240, 336, 440, 560 and 960, which is
      `MIN_COLUMN_WIDTH` to `MAX_COLUMN_WIDTH`
- [~] The ported suites can drop their seeded 560 width and still pass — **not
      done, and it should not be**: their seed is not a workaround for this
      defect. `address-room-geometry.spec.ts` measures the card against *the
      room its place offers*, so the width it opens at is its fixture, not a
      guard. See "The seeded 560" below.
- [x] A test fails when the geometry regresses — a click that misses is
      invisible to any assertion that only checks the element exists

## Testing Strategy
Playwright, with a real pointer sequence rather than a synthetic click, at
several widths.

## E2E Verification Plan
### Verification Steps
1. Open a document in a path column at 440px.
2. Put the composer's foot at the clipped edge.
3. Click the address line with a real pointer, and again at 560 and at the
   maximum width.

## Left behind, not fixed (2026-08-23)

**The composer's hint shows 31px of a 107px sentence at 440px.** UI-157's
implementer measured it and flagged it as a design smell rather than a defect,
and I agreed and left it.

It is **compliant**: the foot's yield order says the hint is the only item that
ever gives, and what is cut is revealed on its `title`, which is SHARED-057's
rule. The full 107.5px shows at 336 and at 560+, and 15.9px at 240.

What is off is the tuning, not the rule. The yield order was set when 560 was
the reading width. Phase 41 made 440 the default path column, so the width that
now shows the *least* hint is the width most people read at.

Not filed as its own issue because it is a judgment about a default, not a
correctness question, and this release had four sentences already.

## E2E Verification Log

**Model: opus.** Chromium via Playwright against the real Vite dev server on
`CORPUS_UI_PORT=5399`, viewport 1280×720, `npm run build` first.

### Reproduced, and it is not what the filing says it is

The filing describes *"the composer's address line can wrap, or scroll under a
click, when the composer's foot sits at the clipped edge"*, at a path column's
440px. Probed first at nine widths from `MIN_COLUMN_WIDTH` to
`MAX_COLUMN_WIDTH`, with the reader scrolled fully to the bottom:

- **the address line never wraps and is never clipped.** Its box is
  140.5×23 at every width from 240 to 960 — `address.css`'s `--address-slot`
  (`17ch + 33px`) is a `min-width`, so it is a reserve and not a preference. Its
  own `scrollWidth` equals its `clientWidth` in all nine.
- **no press missed**, with the composer fully scrolled into view.

The failure only appears with the composer's foot at the **fold**. Scrolling so
the address line's box ends 4px above the reading surface's bottom edge — visible
and pressable, with the rest of the composer clipped below — and then pressing it
with `mouse.move` / `mouse.down` / `mouse.up`:

```
column  shortfall   line y: before → at pointerdown   popover opened
336px      4px      639   → 596      (moved 43px)     no
336px     12px      631   → 596      (moved 35px)     no
336px     20px      623   → 596      (moved 27px)     no
336px     30px      613   → 596      (moved 17px)     no
440px      4px      638.8 → 623      (moved 15.8px)   no
440px     12px      630.8 → 623      (moved  7.8px)   yes
560px      4px      639.1 → 623      (moved 16.1px)   no
```

**Nothing scrolled.** `.reader-scroll`'s `scrollTop` is identical before the
press, at `pointerdown` and at `mouseup` in every row above. What moved is the
composer itself, and instrumenting every scrollable ancestor found the cause:

    stateBefore   composer y=603.8  active=""
    stateAtDown   composer y=560.8  active="address-line"

`thread.css`: `.composer:focus-within { position: sticky; bottom: -1px }`. The
browser gives focus on `mousedown`, so the pin is established **inside the
click** — the box lifts to the bottom of the reading surface, `mouseup` fires at
the old coordinates over whatever is there now, and no `click` is dispatched at
all. The second press always works, because the composer is pinned and steady by
then, which is exactly why no existing spec caught it.

So it is **not a scroll**, **not the address line**, and **not about width**.
Width only sets the size of the jump: at 336 the foot wraps onto two rows, so
there is more composer below the fold to lift (43px) than at 440 (16px).

### Every focusable control in the foot, not only the address line

At 440px, each control placed 4px above the fold and pressed:

```
control              moved   focus after     acted?
address line         yes     address-line    no  (popover count 0)
◉ ask agent toggle   yes     toggle on       no  (aria-pressed still "true")
📎 attach            yes     clip            —   (a file dialog cannot be read)
reply field          yes     textarea        —   (a caret cannot be read either)
Reply ⌘↵             no      —               —   (disabled, so unfocusable)
```

The attach button and the field are recorded as moving, not as failing: what a
lost press costs a file dialog or a caret is not observable from a spec. Send is
spared only because it is disabled without a draft — with a draft it is
focusable, so it takes focus on `mousedown` like the rest.

### The fix

`apps/ui/src/thread/composerPin.ts` plus one rule in `thread.css`. A composer
that was **not already pinned** when a press began is held unpinned until that
press is over: `pointerdown` sets `data-composer-pressing`, `pointerup` and
`pointercancel` clear it, `.composer[data-composer-pressing] { position: static }`.
The arrival is not removed — it happens after the press instead of inside it.

Two other repairs were rejected, and both are recorded in the module's docblock
so nobody re-derives them. The first was built and measured; the second follows
from what the first measured and was not built:

1. **Scroll the reading surface by the shortfall as the pin lands.** Implemented
   and measured: it stops the pin lifting the box a second time, but the box has
   already arrived at the pin line — at 336px the address line still went
   639 → 596. Nothing that pins can also leave the box where it was.
2. **Hold the composer unpinned until the reader is next scrolled.** Removes the
   arrival entirely, and with it UI-110 on its own reported path: click into a
   composer at the fold, scroll up to re-read, and the box you are typing in
   scrolls away.

### After, measured

Same fixture, same presses, at 240 / 336 / 440 / 560 / 960 and shortfalls of 4,
12, 20 and 30px:

```
column  shortfall   line y: before → at pointerdown → after   popover
336px      4px      639   → 639   → 596                       opened
336px     30px      613   → 613   → 596                       opened
440px      4px      638.8 → 638.8 → 623                       opened
560px      4px      639.1 → 639.1 → 623                       opened
```

`movedUnderThePointer` is **false** in all twelve, the popover opens in all
twelve (it opened in 6 of 12 before), and the toggle now reports
`aria-pressed="false"` with `focus="toggle"` — it toggles.

The arrival still happens, and the numbers say when: the line is where it was at
`pointerdown`, and at the pin line afterwards.

### The seeded 560

The criterion asking the ported suites to drop it is answered *no*, and
deliberately. `address-room-geometry.spec.ts` seeds `extra: { width: 560 }` to
give the address card a **room to be measured against** — its assertions are
ratios of card to row, and its own comment says the reply composer's foot is
434px at that width whatever the column does. Nothing in it is waiting out this
defect: it opens the card with `locator.click()`, which re-resolves and scrolls
first, so it never met the jump at all. Removing the seed would change what those
tests measure, not what they tolerate. The width range this defect really lives
across is covered by the new file instead.

### Tests, and their falsification

`apps/ui/e2e/composer-press.spec.ts` — 16 tests. Every press is a real pointer
sequence at coordinates read off the layout, never `locator.click()`, because
Playwright's click scrolls the target into view first and would have gone green
against the defect.

- **CSS half removed** (`position: static` deleted from the new rule):
  **11 of 16 red**, at every width including 240 and 960 — which is itself the
  evidence that the defect is width-independent.
- **JS half removed** (`useSteadyComposerPin()` commented out of `Shell`):
  the same 11 red.
- Restored: 16 green.

`apps/ui/src/thread/composerPin.test.ts` — 6 jsdom tests for the two guards
(never flag an already-pinned composer, never leave a flag behind). Falsified by
deleting each guard in turn: the "already-pinned" test and the "no release"
test go red respectively, and the other four stay green.

The three foot-geometry tests in the same file were falsified separately by
`flex-wrap: nowrap` plus a shrinkable send button — red at 240 and 336, green at
440 and wider, which is honest: a foot only has to yield where the room runs out.

### Full suite

`npm run build`, `npm run lint`, `npm run typecheck -w apps/ui -w packages/kit`,
`vitest run apps/ui packages/kit` (242 files, 4649 tests) and the whole
Playwright suite all pass.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-157]` prefix
