# [UI-159] The column strip took the comment composer's room, and its Send button left the viewport

## Domain
ui

## Priority
P0

## Status
done

## Model
opus

## Dependencies
- Depends on: UI-151 (which caused it), UI-148 (which fixed the same class once)
- Related: SHARED-061 — nothing resizes because of what it holds; a bound is
  derived from the room available

## Spec References
- SPEC.md §10 — "UI — the board", the reader and its composers

## Summary

**A regression introduced by Phase 41, measured rather than guessed.**

UI-151 added the column strip below the board bar. Together with the bar UI-148
added, the shell now spends vertical room the comment composer's placement rule
was derived without. The composer opens with **47px of room below it where the
suite requires more than 64**, and its Send button lands outside the viewport —
where a real pointer cannot reach it.

Three end-to-end tests fail on the phase branch, all of them the same cause:

```
apps/ui/e2e/attachments.spec.ts:273  puts the file on the same request as the quote
apps/ui/e2e/attachments.spec.ts:297  re-opens holding the words and the chip when refused
apps/ui/e2e/comment-move.spec.ts:146 moves where it is put, and stays there
```

Playwright's own trace names the symptom exactly: *"element is outside of the
viewport — retrying click action"*, 54 times, then a timeout.

UI-150's implementer attributed it by measurement rather than by reading: with
`.colbar { display: none }` and nothing else changed, all seventeen specs in
that set pass.

## Why it is P0 and in the release

This is not a stale assertion about a surface the phase replaced — those were
UI-149's 37 ported specs, and they were ported precisely because their claims
still hold. This one is a live defect on the path a person takes to comment on
a passage. Shipping a navigation release that breaks commenting is worse than
shipping no navigation release.

## The shape of the fix

This is the **third** time in one phase that a control's geometry was written
against a viewport that later changed underneath it:

1. UI-145 — a menu ceiling that was a constant, clipping at five items.
2. UI-148 — `usePopoverDrag` clamped a popover to the viewport while dragging
   and never on opening, so a composer near the foot opened with Send
   off-screen.
3. This one — the same composer, put back off-screen by chrome added above it.

So the fix is not another subtraction with a new number in it. The composer's
room must be **derived from the space its place actually leaves**, at the moment
it opens and whenever the chrome above it changes, in the way SHARED-061
requires. If that is what `usePopoverDrag`'s opening clamp already does, then
what it measures is wrong rather than when it measures.

## Acceptance Criteria
- [x] The three failing specs pass without being weakened, re-seeded or skipped
- [x] The composer's Send control is reachable by a real pointer with the board
      bar and the column strip both present, and with a path open
- [x] The room is derived from the chrome actually present, not from a constant
      that happens to fit today. Adding another 8px band above must not break it
- [x] A test fails if the chrome grows — add the band, watch it go red
- [x] The fix is falsified: remove it and watch the specs fail again

## Testing Strategy
Playwright, measuring computed geometry against the real chrome. A unit test
over the placement function if the derivation can be made pure.

## E2E Verification Plan
### Verification Steps
1. Real app, board bar and column strip present, a path open.
2. Select a passage near the foot of a document.
3. Click Send with a real pointer.
4. Repeat with the console drawer open, which takes more room again.

## E2E Verification Log

**ui-dev, 2026-08-23, on opus.** Real Vite dev server (`CORPUS_UI_PORT=5399`),
real Chromium at 1280×720 driven by Playwright, transport stubbed at `fetch` as
every spec in `apps/ui/e2e` does. Every number below was read off the running
layout with `getBoundingClientRect`, before and after, never inferred from a
failing assertion.

### 1. Reproduction, before touching any code

The three specs failed exactly as filed: `attachments.spec.ts:273` and `:297`
timed out on `[data-comment-send]` with *"element is outside of the viewport —
retrying click action"*, and `comment-move.spec.ts:146` failed
`expect(down).toBeGreaterThan(64)` with **`Received: 47`**. The whole file pair
took 1.4 minutes, most of it the 54 retries.

### 2. The chrome, measured

```
topbar        0 …  57   (57)
board bar    57 …  95   (38)   ← UI-148
column strip 95 … 141   (46)   ← UI-151
board       141 … 679  (538)   ← what is left
console     679 … 720   (41)
```

The 84px the two new bands take is the whole of the regression.

### 3. The composer, before and after

Same drill both times: open `doc_note` in a column, select the first paragraph,
right-click → Comment, then attach `shot.png`.

| | composer box | Send button |
| --- | --- | --- |
| **before**, empty | 547 … 712 | 685 … 701 |
| **before**, one chip | 547 … **762** | **735 … 751** |
| **after**, empty | 328 … 493 | 466 … 482 |
| **after**, one chip | **278** … 493 | 466 … 482 |

Before the fix the box was pinned to the foot of the window at 712 = 720 − 8,
and the chip made it 50px taller **downwards**, putting its foot 42px past the
window and the Send button 31px past it. That is the click no pointer could
land, and `⌘↵` was the only way to send a comment with a file on it.

After the fix the words at 498…547 divide the board's 141…679 in two: 118px of
room under them (679 − 8 − 553) against 343 over them (492 − 8 − 141). The box
takes the larger side and ends at the words' top, at 492. The chip then grows it **upwards** from a foot that does not move: 493 before and
after, Send unchanged at 466…482, inside the board and inside the window.

### 4. With a path open, and with the console drawer open

`comment-move.spec.ts` opens its memo through the row menu's **Open here**,
which is a path column at 440px — the geometry UI-149 introduced and UI-157
filed against — and all seven of its cases pass. The drawer is covered by
`composer-room.spec.ts`'s third case, which opens the console first, re-reads
the room (its foot rises), then opens the composer, attaches a file, and clicks
Send with a real pointer: the request lands.

### 5. Falsification — the fix removed

`placeInRoom` put back to UI-148's rule (under the words, pulled into the
viewport) **and** the placement made one-shot again, which together are the code
as it stood before this issue:

```
6 failed
  attachments.spec.ts:273  puts the file on the same request as the quote
  attachments.spec.ts:297  re-opens holding the words and the chip when refused
  comment-move.spec.ts:146 moves where it is put               (Received: 47)
  composer-room.spec.ts:136 keeps its send control in the window and in the room
  composer-room.spec.ts:175 costs the composer nothing when another band is added
  composer-room.spec.ts:207 keeps its send control reachable with the drawer open
14 passed
```

The two halves were also falsified apart, which is worth recording because they
fail different tests:

| Mutation | Result |
| --- | --- |
| The side is not derived — always under the words | `comment-move.spec.ts:146` red at `Received: 47`, the other 19 green |
| The placement runs once, at the opening | all 20 green — **the flip alone already keeps this geometry safe** |

The second is an honest negative and is not papered over. The continuous
derivation is what holds when the *larger* side is the one under the words and
the box then grows past the room, which the browser suite does not reach at
1280×720. It is pinned in `CommentPopover.test.tsx` instead — "puts itself back
in the room when a chip makes it taller after it opened" and "re-places the box
when its size changes without a render" — and removing it turns both red.

### 6. Falsification — the chrome grown

`composer-room.spec.ts`'s band raised from 8px to 340px, nothing else changed.
The board is squeezed to 481…679 (198px) and the composer with a chip is 215px,
so its room can no longer hold it:

```
board  481 … 679   (198)
box    489 … 704   (215)   ← 25px outside its room
Send   677 … 693           ← still inside the window
```

The two assertions part exactly where they were designed to: line 194 (**Send is
inside the window**) passes, line 195 (**the composer is inside its room**)
fails. So a fourth band is caught by a named assertion about the room rather
than by a click timeout in an attachments spec, and the reachability claim —
the one that must never go red — does not.

An 8px band, the criterion in this issue, moves nothing: the room's top rises by
8, the words fall by 8, both sides of the arithmetic follow, and all three cases
stay green.

### 7. Automated suites

- `apps/ui` + `packages/kit` unit: **237 files, 4586 tests, 0 failures.**
- Playwright, whole suite, `--workers=1`: **576 tests, 0 failures** (11.8 min).
- `npm run build`, `tsc --noEmit` in every workspace, `eslint .`,
  `prettier --check`: clean.

### What the real cause was

Not the strip, and not a number that needed raising. `usePopoverDrag` had one
slot for a position and two writers: the person's drag, and the opening clamp
UI-148 added. The clamp wrote into `moved`, so from its first firing the box was
indistinguishable from a box somebody had carried — and the branch that adjusts
an *un-carried* box never ran again. The box then grew by an attachment chip
from a top already at the floor of the window.

Underneath that, the placement rule itself was a preference rather than a
derivation: *under the words, pulled up if it overflows*. Pulling up keeps a box
on screen only at the size it had that instant, and it leaves a box that fits
*just* — 47px to spare — wedged against the foot with nowhere left to be moved
to, which is what `comment-move.spec.ts:146` had been asserting all along.

Both are now derived. The words cut the room the chrome has left into two and
the box takes the larger part (`placeInRoom`); the room is
`[data-popover-room]`'s measured rectangle, which is the board's, which is by
construction the viewport minus every band above and below it. Nothing consults
a constant, and a band added above the board changes the answer without changing
a number.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-159]` prefix
