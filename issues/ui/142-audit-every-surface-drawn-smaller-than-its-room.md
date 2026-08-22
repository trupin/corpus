# [UI-142] Audit: every surface drawn smaller than the room it has

## Domain
ui

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-061
- Related: UI-128 (the audit this mirrors), UI-130, UI-136, SHARED-057

## Spec References
- SPEC.md **§10** — *"a surface is as large as its place allows"* (rider authorized 2026-08-21), and SHARED-057's paragraph immediately above it, which it completes

## Summary

The user reported the composer's address popover as unreadable — *"The size of
this window is so small I can't even see what's in it"* — and asked for the
class rather than the instance: *"Do an audit for these kinds of issues around
element size and fix them."*

SHARED-061 is the rule, authorized before this audit runs so that findings can
be checked against a paragraph rather than against taste. This issue is the
sweep.

## What to look for

The rule gives three checkable questions, and every finding must answer one of
them with a **measurement in a real browser**, not a reading of CSS:

1. **Is the bound a constant?** A `max-width`, `max-height` or a `--*-cap` in
   pixels, chosen once, that never consults the viewport, the host column, or
   the distance from the anchor to the edge. The reported defect is exactly
   this: `address.css` carries `max-width: min(330px, 86vw)` and
   `--address-pop-cap: 280px`.
2. **Does ordinary content need a scrollbar at a comfortable window size?** Not
   pathological content — ordinary. A lane list showing two of its lanes with
   `scroll for the rest` while the window is half empty is the reported symptom.
3. **Is the surface much smaller than what it opens over?** A popover a third
   the width of its column, a panel that could take the space beside it and does
   not.

## Where UI-128 already pointed

**Read UI-128's ledger first.** It recorded 31 latent sites, eight flagged as
promotion candidates, and it named three surfaces *"drawn larger than the room
they open into"* — the search overlay clipping the composer's card, a reader
column resolving its width asynchronously, and the reply footer over-full at the
default column width. Those are the same family seen from the other side and are
tracked as **UI-136**. Reconcile with it rather than re-filing it: if UI-136's
three are really this defect, say so and fold them in.

## Method, taken from UI-128 because it worked

- Read **every** stylesheet in `apps/ui/src` and `packages/kit/src`, in full.
  UI-128 read 28 and its value came from completeness, not sampling.
- Grep is a starting point, not the audit: `max-width`, `max-height`,
  `min-width`, `--*-cap`, `overflow: auto`, `overflow-y: scroll`. A constant
  bound is the signal; a scrollbar beside empty space is the confirmation.
- **Measure each reachable finding in a real browser at more than one window
  size.** A defect that only shows at 1440px is still a defect, and one that
  disappears at 1440px was never measured.
- **Rank by the order a person meets it.** UI-128 ranked six clusters and the
  ranking is what made the fixes tractable.
- Separate **reachable** from **latent** and say which is which. Do not fix a
  latent site silently; list it.

## The first finding is already known

`packages/kit/src/address/address.css` — the composer address card. Fix it as
part of this issue: it is what the user reported, and it should not wait behind
a sweep. Note the file's own comment, *"Every section keeps its size; the lane
list's is the one that gives"*, which was a reasonable decision under a rule
that only pointed one way and is now the wrong default.

**This file is in `packages/kit`.** The browser loads `packages/kit/dist`, so
nothing you change here is visible until `npm run build -w packages/kit`. Three
false negatives in the last release came from this exact trap.

## Acceptance Criteria
- [x] Every stylesheet in `apps/ui/src` and `packages/kit/src` read in full, and
      the count reported — **28**, listed in the log
- [x] A ledger: reachable findings ranked, latent findings listed, compliant
      surfaces counted — the shape UI-128 produced
- [x] Every reachable finding carries a browser measurement at two window sizes
- [x] The address card is fixed, and the user's screenshot case is re-measured
- [x] Every fix is bounded against real room — viewport, host, or anchor
      distance — and no fix introduces a new pixel constant
- [x] **No fix breaks SHARED-057.** Each resized surface is re-checked for
      growth driven by content; the room is the input and the content is not
- [x] A surface that genuinely cannot be given its room says so
- [x] UI-136 is reconciled: its first finding is **folded in and closed**, its
      other two are kept apart with a reason (they are SHARED-057's half, not
      this one's)

## Testing Strategy

Geometry specs in the manner of `reader-head-geometry.spec.ts` and
`digit-geometry.spec.ts`, which already exist and are the precedent. A test that
pins a pixel constant is the wrong test — v0.15.0 lost a CI cycle to exactly
that, because a constant true on one machine's fonts is false on another's.
Assert the **relationship**: the surface is at least some fraction of its host,
or grows when the viewport does.

## E2E Verification Plan

Reproduce the reported case first, at the window size the user was at, and
record the measurement before any fix.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`), 2026-08-21, `phase-38-comments-have-a-place`.

Every number below is a `getBoundingClientRect` / `clientHeight` reading taken in
Chromium against the real Vite dev server (`CORPUS_UI_PORT=5973`, INFRA-028
isolation). No number is read off a stylesheet.

### 1. The sweep

**28 stylesheets** under `apps/ui/src` and `packages/kit/src`, read in full
(7 275 lines). The list, for the record:

```
anchors/anchors.css            app/global.css              board/Column.css
board/query/queryEditor.css    comments/comments.css       compose/compose.css
console/console.css            dev/DataProbe.css           editor/editor.css
image/ImageViewer.css          keyboard/keyboard.css       menu/menu.css
reader/FocusMode.css           reader/Reader.css           reader/reveal.css
reattach/reattach.css          search/search.css           shell/Board.css
shell/Shell.css                shell/Toasts.css            shell/Topbar.css
thread/thread.css              kit/address/address.css     kit/…/autocomplete.css
kit/…/composer.css             kit/markdown/markdown.css   kit/row/row.css
kit/tokens.css
```

Grep over `max-width`, `max-height`, `min-width`, `--*-cap`, `overflow: auto`
and `overflow-y` started the search. Every finding below was then confirmed or
dismissed in the browser at **two window sizes**.

### 2. Reproduction, before any fix

The reported case, with the ordinary roster the screenshot showed (nine lanes)
and with three:

```
surface / roster    viewport     card w×h    room above    the lane list
------------------  -----------  ----------  ------------  --------------------------
reply, 3 lanes      1280×720     240 × 255      254px      51 of 51 — fits
reply, 3 lanes      1440×900     240 × 255      254px      51 of 51 — fits
reply, 3 lanes      1728×1080    240 × 255      254px      51 of 51 — fits
reply, 9 lanes      1280×720     240 × 280      422px      142 of 219 — "9 lanes · scroll for the rest"
reply, 9 lanes      1728×1080    240 × 280      782px      168 of 219 — "9 lanes · scroll for the rest"
global compose      1440×900     240 × 158        —        inside a 638px action bar
```

All three of SHARED-061's questions answered yes:

1. **Constant?** `min-width: 240px` was the *used* width at every viewport —
   the card's containing block is `.composer-address` (~140px, the address
   pill), so shrink-to-fit always collapsed to the floor and
   `max-width: min(330px, 86vw)` was never once reachable. `--address-pop-cap`
   was `280px`.
2. **Ordinary content scrolling?** Nine lanes, 77px of the list behind a
   scrollbar, at a 1728×1080 window with **502px of the room unused**.
3. **Much smaller than what it opens over?** 240px against a 560px column
   (43%) and against a 434px composer foot (55%).

### 3. After the fix, same measurements

```
surface / roster    viewport     card w×h    room above    the lane list
------------------  -----------  ----------  ------------  --------------------
reply, 3 lanes      1280×720     400 × 239      254px      51 of 51 — fits
reply, 9 lanes      1280×720     400 × 191      422px      79 of 79 — fits, no note
reply, 9 lanes      1728×1080    400 × 191      782px      79 of 79 — fits, no note
global compose      1440×900     588 × 132        —        21 of 21 — fits
```

The nine-lane card is now **shorter** as well as wider: at a 378px measure the
rows wrap three to a line, so the two halves of the fix pay for each other. The
card is 92% of its 434px host row and 71% of the 560px column.

### 4. The second reachable finding — the new-list picker

`.ac-menu`'s shared `max-height: 200px`, on the menu the ghost column opens.
Seven items, nothing unusual:

```
                    viewport     menu w×h    items    shown     room below
before              1280×720     272 × 200   219px    198px       361px
before              1728×1080    272 × 200   219px    198px       541px
after               1280×720     272 × 221   219px    219px       361px
after               1728×1080    272 × 221   219px    219px       541px
```

### 5. UI-136's first finding, folded in

`.search-panel` is `overflow: hidden` and the card had always been drawn taller
than the room above the line inside it. Measured at 1280×720, card top against
panel top (negative = inside):

```
                            3 lanes            20 lanes
before UI-142               25px cropped       25px cropped
after the width fix alone    0px               80px cropped   ← worse
after the clip walk         6px inside        6px inside      right edge 8px inside
```

The width fix alone made that crop **worse**, because the card was given more
room above and the ceiling walk stopped only at scrollports. Extending the walk
to any bounding ancestor closes it. `clipperOf`'s docblock records the earlier
rejection verbatim and why its premise expired.

### 6. Falsification — each fix broken, each test watched to fail

| fix | mutation | what failed |
| --- | --- | --- |
| card width | deleted `width: var(--address-pop-w, auto)` | 5 tests: *"the card is 240px inside a 434px row"*, *"240px at 1280, 240px at 560"*, *"219px of lanes in a 142px list"* |
| card height | restored `Math.min(280, headroom)` in `fit()` | *"191px of lanes in a 168px list, with 708px of room above the line"* |
| new-list picker | restored `max-height: 200px` | both sizes: *"219px of items in a 198px menu, with 361px / 541px of room below it"* |

The kit dist trap was live for the height mutation: `address.css` is exported
from `src/`, so a CSS mutation bites at once, but `ComposerAddress.tsx` resolves
through `dist/` and needed `npm run build -w packages/kit` before the browser
saw either the mutation or its restoration. One restoration was verified as
*not* rebuilt and re-run before it was believed.

### 7. Gate

- `npm run build` ✓ · `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run format:check` ✓
- `vitest run packages/kit/src apps/ui/src/board` — 80 files, 1 221 tests ✓
- `npm run e2e` (full Playwright suite, `CORPUS_UI_PORT=5973`) — **518 passed, 0 failed**

One run of the full suite reported a single failure in `todos.spec.ts`
(*"draws the anchor layer's highlight on the commented item"* — the highlight
read as `"Call the "` mid-render). It is unrelated to this issue and flaky: the
spec passed alone and the whole `todos.spec.ts` file passed on re-run, and the
final full run was 518/518. It is the same shape as UI-117's finding about the
anchor layer being read before layout settles.

### 8. What was deliberately not changed

- **`--says-lines: 4`** stays. At the room-derived measure no statement §7 can
  produce reaches the reserve any more, so the one sentence that used to be
  revealed is now read — and the cost has inverted into about two lines of white
  space on an ordinary card. Every way of closing that was worse: a smaller line
  count is a constant re-measured at one measure, and the measure is no longer
  one thing; a reserve fitted to the statements would read the content to size
  the box, which is UI-127's oscillation. The reasoning is written into
  `address.css`.
- **`.ac-menu`'s shared 200px** stays for *completion* menus. A completion list
  is corpus-driven and filtered by typing, and the mockup's register for it is
  200px; only the new-list picker, whose items are a short bounded set, was
  overridden. See the ledger in the report for the rest.
