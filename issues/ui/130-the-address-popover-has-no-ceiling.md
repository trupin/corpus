# [UI-130] The address popover has no ceiling, and rises behind the reader head

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-127 (which measured it and made it 33px worse), SHARED-057

## Spec References

- SPEC.md **§10** — the composer, and *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

Found by UI-127's implementer while measuring the fix, 2026-08-20, and **not
caused by it**.

`.address-pop` has no maximum height and no flip. It grows upward from a
bottom edge, so a workspace with enough lanes produces a card taller than the
space above the composer. Measured at 1280×720 with **five lanes**: the card is
**312px** tall and its top reaches **y=112**, while `.reader-head` ends at
**y=159**. The card's top rows therefore sit behind the head, and the head takes
their pointer events — so those lanes cannot be clicked at all.

**UI-127 made it worse by 33px** and did not create it. Reserving four lines for
the statement adds that much to the resting card. That is stated plainly rather
than left for someone to discover: the fix was right, and it moved a pre-existing
edge closer.

A taller viewport does not help, because the composer sits under the last turn
rather than at the bottom of the reader.

## Why it is a separate issue from UI-127

A card that **resizes** and a card with **no ceiling** are different defects with
different fixes. UI-127's rule is SHARED-057's — size must not follow content.
This one is about a card whose size is legitimate and whose *placement* has no
bound. Folding them together would have meant shipping an unmeasured placement
change inside a P0 fix, on a control a person is currently unable to use.

## Acceptance Criteria

- [x] The popover never overlaps `.reader-head`, at 1280×720 and at the smallest
      viewport the suite exercises
- [x] With more lanes than fit, the card is bounded and its list scrolls — the
      bound is stated, and reaching it is visible rather than silent (SHARED-057:
      a listing that reached its bound says so)
- [x] Every lane remains reachable by pointer **and** by keyboard, including the
      first row, with five lanes and with twenty
- [x] A browser test measures the card's top against the head's bottom and
      asserts no overlap. **Falsify it** by removing the bound and watching it fail
- [x] Whatever bounds it does not reintroduce content-driven sizing — the resting
      card's height must still not depend on which lane is previewed (UI-127's
      spec stays green)

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/address.css` — `.address-pop`
- `packages/kit/src/address/ComposerAddress.tsx` — only if a flip needs measuring
- `apps/ui/e2e/address-geometry.spec.ts` — the overlap assertion

### Key Implementation Details

**Read UI-127's E2E log first** for the measurements and the fixture that
produces five lanes. Its spec deliberately uses a three-row fixture, which clears
the head by 80px — so the existing suite passes and proves nothing about this.

A maximum height with an internal scroll is the smaller change. Flipping the card
below the composer is the other option and costs more: the composer sits mid-
document, so below is not reliably clearer than above.

### Edge Cases

- A composer inside the focus shell, where the surrounding chrome differs
- The comment popover host, which is itself already positioned against a selection
- One lane, where the card does not render rows at all

## Testing Strategy

A browser geometry test. jsdom implements no layout, so a unit test cannot see
this at all.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Five lanes, 1280×720: measure the card's top and the head's bottom
3. Click the topmost lane row; confirm the click reaches it
4. Repeat with twenty lanes

## E2E Verification Log

### Implementation (ui-dev, 2026-08-20, implemented on: opus)

Real Chromium against the real Vite dev server on **5283** (server origin
`127.0.0.1:8893`, never 5173 / 8765), through the whole app: board → row →
reader → reply composer → address line → popover, and again through the global
composer and a document selection's comment composer.

#### 1. Reproduced first, and the mechanism was not quite the one reported

Measured before anything changed, twenty lanes at 1280×720:

```
.reader-head    115.9 → 159.2
.reader-scroll  159.2 → 666.1      the scrollport
.address-pop   -248.1 → 419.1      667px tall
```

The card is bottom-anchored inside `.reader-scroll`, so the ceiling that matters
is **the scrollport's top edge and not the window's**. `document.elementFromPoint`
at each row's centre, before the fix:

```
orchestrator … th_lane_6   off-screen        (12 rows)
th_lane_7, th_lane_8       HEADER.topbar
th_lane_9                  HEADER.col-head
th_lane_10                 DIV.col-title-row
th_lane_11, th_lane_12     DIV.reader-head
th_lane_13 … th_lane_18    row               (6 rows)
```

So the issue's claim is confirmed and sharpened: the chrome above the scrollport
takes the pointer events, and `.reader-head` is only one of four things doing it.
At 1280×400 it was **eighteen of nineteen** rows unreachable.

One correction for the record: **five lanes did not reproduce it at 1280×720.**
The five-lane card is 328px with its top at y=166.6, which clears the head by
7px. The card's top is a function of where the composer sits, and the composer
sits under the last turn — so the roster size and the conversation's length both
move it. Twenty lanes reproduce it at every viewport; five reproduce it at
1280×400 (top y=−66). Both are pinned.

#### 2. The bound, and the measurements behind it

**Three numbers, and only the first is a constant.**

- **`--address-pop-cap: 280px`** — the ceiling. Measured, not round: the ordinary
  roster fits whole under it. The orchestrator plus two conversation lanes, with
  UI-127's four-line statement reserve and a resident's weight sentence, is a
  **256px** card, so nothing about the ordinary case scrolls. The fourth lane is
  where the list starts to scroll, and says so. `design/index.html` caps a
  popover list (`.ac-menu`) at 200px, which is the same register.
- **The room above the line**, measured when the card opens and written as
  `--address-pop-room`: the distance from the card's bottom edge to the top of
  its nearest **scrollport**, less a 6px margin. Above a reply composer on a
  one-turn conversation at 1280×720 it is **254px**; at 1280×400 it is **102px**.
  It is the room and not the cap that makes the guarantee, because a constant
  cannot follow a window that shrinks or a composer scrolled near the top of its
  reader.
- **One row is the floor**, read back rather than declared. The parts that cannot
  shrink are not all the same height — a resident's weight sentence is three
  lines where a level row is one — so the smallest useful card is a measurement:
  the natural height, less the list's full content, plus one row. Where the room
  will not take even that, `--address-pop-shift` moves the card **down** until
  its top is 6px inside the scrollport. A clamp, never a flip: the card stays
  where a person looks for it, and at 1280×400 it covers its own composer rather
  than the head.

Only `.recipient-lanes` scrolls. The statement and the weight section are the
parts UI-127 stabilised and they stay outside the scroller, `flex: none`.

After the fix, the same four cases:

```
                     card      top     head bottom   list client/scroll   rows reachable in place
five   @1280×720     280      214.8    159.2         76 / 124             4 of 5
twenty @1280×720     254      165.1    159.2        142 / 555             5 of 20
five   @1280×400     227      164.8    159.2         23 / 124             2 of 5
twenty @1280×400     135      165.1    159.2         23 / 555             1 of 20
```

Every remaining row is reachable by scrolling the list, and the spec presses the
last one to prove it. The card's width is **240px** at every host, unchanged —
which is what UI-127's four-line reserve is measured against, so it is asserted
rather than assumed.

#### 3. Reaching the bound is visible, in two ways

- **It is said.** Beside the `to` lead, on the line the lead already occupies, the
  card writes `20 lanes · scroll for the rest` — so the note costs the card no
  height and is inside SPEC.md §10's rider rather than an exception to it. It
  appears only when the list really is short of its content (`scrollHeight >
  clientHeight`), and a three-lane roster that fits shows nothing. Both are
  pinned, because a note that always showed would be a decoration.
- **It is drawn.** `.recipient-lanes` carries the board's own scrollbar
  vocabulary (`design/index.html`'s `.col-list` and `.reader-scroll`: 8px,
  `var(--line)`, radius 99px). Styling `::-webkit-scrollbar` also takes the list
  off macOS's overlay scrollbars, which are invisible until you have already
  scrolled — exactly the affordance a capped list cannot afford to hide.
  `scrollbar-gutter: stable` reserves the gutter always, so a roster that grows
  past the ceiling does not re-wrap the rows already there.

One more thing the bound made necessary: the card now **opens showing the
person's own pick**, scrolling the list locally so the effective row is in view.
`address.css` already says a row that vanished would take the pick off the screen
with it, and a list scrolled away from it is the same loss by another route.

#### 4. Falsification — the bound removed, the kit rebuilt

`max-height` and the shift deleted from `.address-pop`, `npm run build -w
packages/kit`, full spec re-run: **8 of the 12 new tests failed**, with the
pre-fix numbers exactly.

```
with twenty lanes at 1280×720 …
  Error: the card rose into the head ({"x":95,"y":-248,"width":240,"height":667})
  Expected: >= 159   Received: -248
with twenty lanes at 1280×400 …
  Expected: >= 159   Received: -400
with five lanes at 1280×400 …
  Expected: >= 159   Received:  -66
with five lanes at 1280×720 …
  expect(card.height).toBeLessThanOrEqual(280)   Received: 328
```

and the user-facing one, in the tool's own words:

```
TimeoutError: locator.click: Timeout 5000ms exceeded.
  - locator resolved to <button … data-recipient-lane="orchestrator" …>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
```

The note and the reachable-last-row tests failed too. **UI-127's five tests
stayed green throughout the falsification** — which is the point the issue makes
about its three-row fixture, now demonstrated rather than asserted.

Restored, rebuilt, **17 passed**.

#### 5. The other two hosts, and one thing found and deliberately not fixed

The ceiling is asked of the layout rather than named per host, so one rule serves
all three. Measured ancestor chains, with the card open:

- **The comment composer** (portaled to `document.body`, `position: fixed` against
  the selection): `DIV.composer-address` → `DIV.composer-foot` →
  `DIV.comment-pop` → `BODY (overflow-y: hidden)` → `HTML`. No scrollport, so the
  **window** is the ceiling. With twenty lanes the card is 280px at y=119.9,
  fully on screen, list 170/519, top row pressable — and it correctly sits
  **above** `.reader-scroll`'s top edge, because it is not inside it. It needed
  nothing different, and a new test pins exactly that.
- **The global composer**: same answer, the window, since `.search-panel` clips
  with `overflow: hidden` and nothing above it scrolls.

**Found, not fixed, and stated plainly:** `.search-panel` clips, and the compose
card has always been drawn taller than the panel has room for above the line —
**157px against 132px**, measured. Its top padding and lead are cropped there,
before this change and after it. Bounding to a *clip* rather than a *scrollport*
would repair that at the cost of squeezing a three-lane list to one visible row
(measured: `list client 22 / scroll 47`), and it broke UI-127's compose test on
the first attempt. The two are different in kind — what leaves a clip is cropped,
what leaves a scrollport is unreachable — so the walk looks for scrollports only,
the reason is written into `clipperOf`'s docblock, and the panel's clipped edge is
left for its own issue.

#### 6. Checks

- `apps/ui/e2e/address-geometry.spec.ts`: **17 passed** (UI-127's 5, unmodified,
  plus 12 new).
- Neighbouring pins — `recipient.spec.ts`, `weight.spec.ts`,
  `compose-keyboard.spec.ts`, `resident.spec.ts`, `residents-tab.spec.ts`:
  **46 passed**, the same count UI-127 recorded.
- Scoped unit run (`packages/kit apps/ui/src`): 4085 tests, 4081 passed. Two
  failures were mine and are fixed (`packages/kit/src/index.test.ts`'s exported-
  surface list needed `lanesCappedNote`); the remaining three are
  `apps/ui/src/editor/markdown/corpus.test.ts` round-tripping
  `issues/ui/128-…md`, whose table another agent was editing at the time — no
  file of mine is markdown.
- `tsc --noEmit`: clean in `packages/kit`. In `apps/ui` the only error is
  `e2e/reader-head-geometry.spec.ts(358,55): Property 'headRight' does not exist
  on type 'HeadGeometry'` — a file another agent was writing during this session
  (mtime 18:50), untouched by this work.
- ESLint and Prettier clean over every file touched. No rule disabled.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-130]` prefix
