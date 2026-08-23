# [UI-145] The context menu's ceiling never applies, and the row menu scrolls at five items

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-061
- Related: UI-142 (which recorded the wrong number as latent), UI-143, UI-094 (which measured it)

## Spec References
- SPEC.md **§10** — *"a surface is as large as its place allows"* and *"a bound is derived from the room, not chosen as a number"* (SHARED-061, signed 2026-08-21)
- SPEC.md **§10** — the right-click context menu

## Summary

Measured by UI-094's implementer in Chromium, 2026-08-21, while working on the
row menu.

`apps/ui/src/menu/menu.css` declares:

```css
.ctx-menu { max-height: min(60vh, 420px); }
```

**That rule never applies.** `packages/kit`'s `autocomplete.css` sets
`.ac-menu { max-height: 200px }`, the two selectors tie on specificity at one
class each, and the kit sheet loads last. So the number in force is **200px**,
not 420, and not `60vh`.

Measured on a 720px viewport:

```json
{"items": 5, "clientHeight": 198, "scrollHeight": 253, "maxHeight": "200px"}
```

**The row menu already scrolls at five items**, with 520px of viewport unused.

## Why this is P1 rather than the P2 it looked like

UI-142 audited every surface against SHARED-061 and listed this one as **latent**
— *"the `420` binds above a 700px viewport; measured content 157px, no scrollbar
today"*. That reading was of the **stylesheet**, not of the **cascade**. The
audit's own method says a finding is confirmed by a browser measurement and a
constant bound is only the signal; here the signal was read correctly and the
confirmation measured a rule that was never in force.

So this is a live SHARED-061 breach — *"scrolling is for content that cannot fit,
never for content that was not given room"* — and it is on the surface a person
reaches by right-clicking anything.

**It also generalises, and that is the more valuable half.** Any bound in
`apps/ui` that ties on specificity with a `packages/kit` bound loses silently,
because kit loads last. This is the only one anyone has measured. **Sweep for
others** rather than fixing this one line.

## What to build

1. Fix the ceiling so the menu is bounded by the room it has, per SHARED-061 —
   and derive it, rather than picking a larger number. UI-142's `roomFor()` in
   `packages/kit/src/address/ComposerAddress.tsx` is the worked precedent.
2. **Sweep `apps/ui` and `packages/kit` for other bounds that tie on specificity
   across the two sheets**, and report what you find even where nothing is
   currently reachable.
3. Decide whether `.ctx-menu` and `.ac-menu` should share a selector at all. Two
   different surfaces answering to one class is why this happened, and renaming
   one is cheaper than remembering the cascade.

## Decisions to make and record

- **Whether a completion menu and a context menu want the same bound.** UI-142
  recorded a deliberate reason for the completion menu's 200px: a completion list
  is filtered by typing, so a small window is not a cage. A context menu is not
  filtered by anything. If they differ, they must not share a selector.
- **How to stop this recurring.** A test that asserts the *computed* bound rather
  than the declared one is the only guard that would have caught this — a rule
  read from the stylesheet passes while the cascade overrides it.

## Acceptance Criteria
- [x] The context menu's bound is the room it has, measured in a browser at two
      viewport sizes
- [x] Five items do not scroll on a 720px viewport
- [x] A completion menu keeps whatever bound is right for it, with the reason
      stated
- [x] The cross-sheet specificity sweep is reported, including "nothing else
      found" if that is the answer
- [x] A test asserts the **computed** bound, not the declared one

## Testing Strategy
A geometry spec reading `getComputedStyle(...).maxHeight` and `scrollHeight`
against `clientHeight` — the measurement UI-094 used. Asserting the CSS source
would pass today and is exactly the mistake being fixed.

---

## What was built

**`apps/ui/src/menu/menuModel.ts`** — a new pure `menuRoom(anchorTop,
contentHeight, viewportHeight, margin)`, beside the existing
`clampToViewport`. It returns `{ top, maxHeight }` where `maxHeight` is a
subtraction and never a literal: `viewportHeight - margin - top`. A menu too
tall for the room below the pointer first **slides up** to claim more of it,
exactly as far as it needs, and accepts a scrollbar only when the whole window
is not enough. `MENU_MARGIN` (4) replaces the loose `4`s already in the file.

**`apps/ui/src/menu/ContextMenu.tsx`** — a `useLayoutEffect` measures the menu
and applies `{ top, maxHeight }` **inline**. Inline is the point, not an
implementation detail: an inline declaration cannot lose a specificity tie, and
the number has to be computed anyway because the room depends on where the
pointer was. No dependency list, so a menu whose items change while it is open
(delete arming its confirmation) is re-measured; an equality guard stops the
loop. `scrollHeight + (offsetHeight - clientHeight)` is the natural border-box
height and is stable whether or not a ceiling is already clipping it.

**`apps/ui/src/menu/menu.css`** — `.ctx-menu { min-width; max-height }` is gone.
The ceiling that remains is `.ac-menu.ctx-menu { max-height: calc(100vh - 8px) }`
— two classes so it **cannot** lose a tie, and still a derivation (the whole
window less the margin at each edge) rather than a constant. It is only the
value before the measurement lands.

### How this satisfies SPEC.md §10 (SHARED-061)

- *"A bound is derived from the room, not chosen as a number."* The ceiling is
  `viewportHeight - margin - top`. There is no pixel literal in it, and the
  measurements below show it changing with the window at a fixed pointer.
- *"Scrolling is for content that cannot fit, never for content that was not
  given room."* A menu scrolls only after taking the window from margin to
  margin. Measured: at 260px of window height a 351px menu sits at `top: 4`
  with `max-height: 252px` and scrolls. At 720px the same menu does not.
- *"…so that a larger window makes it larger."* 720 → 1080 at the same pointer
  moves the ceiling 558 → 918.
- **SHARED-057 still holds.** The content is read to decide how far up the menu
  slides, not to size a box that has a place of its own. A menu is drawn at the
  size of its own items by definition, has no place until a pointer gives it
  one, and nothing here re-measures on a clock or a fetch.

## Decisions recorded

**1. A completion menu and a context menu do not want the same bound, so they
no longer share a declaration.** `.ac-menu`'s `200px` stays exactly as it is. A
completion list is narrowed by typing — the next keystroke shortens it, so a
small window over a long list is a step in a loop rather than a cage, and 200px
keeps the composer's own line in view while the list is open. A context menu is
filtered by nothing: every item it will ever show is already on screen, so its
whole content is what a person has to read. `menu-room-geometry.spec.ts` asserts
both halves — the completion menu still computes `200px` and carries no inline
bound, and it is the one test in the file that passes with the fix reverted.

**2. The two surfaces keep sharing `.ac-menu`, and no *bound* is ever declared
on a tying selector again.** Renaming was considered and rejected: the frame is
deliberately shared (`menu.css`'s own opening comment — "a right-click menu that
looked like a different product would be the tell that it *is* a different
implementation"), and a rename would leave the next author free to add a tying
declaration to the new name. What is enforced instead is structural — the real
bound is inline, and the fallback is on two classes.

**3. The load order is not changed here, deliberately.** `main.tsx` imports
`./app/App` on the line above its kit stylesheets, which is *why* every kit rule
is injected after every app rule. Flipping those lines is the one-line systemic
fix, and it would also change turn typography across the app (see the sweep).
That is a visible change with no acceptance criterion in this issue, so it is
reported rather than smuggled in.

## The cross-sheet specificity sweep

Method: parse every rule in `apps/ui/src/**/*.css` and `packages/kit/src/**/*.css`,
keep the single-class selectors (the case where a tie is silent), pair them with
classes that actually co-occur in a `className` in the JSX, and report every
shared property. Five pairs came back. Three are false positives, confirmed by
reading the call site. **Two are live, and both were then confirmed in
Chromium**, because the audit method that got this wrong the first time was
reading the stylesheet instead of the cascade.

| pair | properties | verdict |
| --- | --- | --- |
| `.ctx-menu` ↔ `.ac-menu` | `max-height`, `min-width` | **live — this issue.** Both lost. `min-width: 220px` never applied either; 250px is what shipped |
| `.turn-markdown` ↔ `.doc-body` | `font-family`, `font-size`, `line-height`, `max-width` | **live — not fixed here.** See below |
| `.thread-conversation` ↔ `.doc-body` | `font-family`, `font-size` | **live — not fixed here.** Same cause |
| `.cp-item` ↔ `.ac-item` | `display`, `width`, `padding`, `border-radius` | false positive — `MenuItems.tsx` picks one **or** the other by ternary, never both |
| `.chip` ↔ `.r-chip` | 7 properties | false positive — `Row.tsx` writes `` `r-chip ${chip.chipClass}` `` and `REASON_CHIP_CLASSES` is `r-reply` / `r-form` / `r-stale` / `""`, never `chip` |

### The two live findings this issue does not fix

`apps/ui/src/reader/Reader.css` asks a turn's markdown for the surrounding sans
body — `.turn-markdown { font-family: var(--sans); font-size: 12.5px; max-width:
none }`, with the comment *"A turn's markdown inherits the surrounding sans body,
not the serif measure."* `Turn.tsx` renders `className="doc-body turn-markdown"`.
Measured on a real turn in a column reader, 1280×720:

```json
{"fontFamily": "\"Iowan Old Style\"", "fontSize": "15px", "maxWidth": "517.222px"}
```

The kit's `.doc-body` wins all four. `.thread-conversation` (`DocView.tsx:500`)
loses the same way, and reads serif 15px where its rule asks for sans 12.5px.
`design/index.html:329` is authoritative for look and feel and says
`.turn-body { color: var(--ink); font-family: var(--sans); }` — so the app is
currently rendering turns in the wrong face, and `FocusMode.css`'s
`.focus .turn-markdown` (two classes) means **the same turn changes typeface
when it enters full screen**.

**Recommended follow-up (a new UI issue): flip the two lines in `main.tsx` so the
kit's stylesheets are imported before `./app/App`.** That is the root cause of
all three findings, it makes `apps/ui` able to override the kit as every author
in this repo has assumed it could, and it needs its own before/after screenshots
because it changes typography on the reading path. It should not ride along in a
menu-height fix.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). All measurements in Chromium via
Playwright against the real Vite dev server on `CORPUS_UI_PORT=5273`
(`apps/ui/e2e/`, transport stubbed by `stubCorpus`, real React, real layout).

### Reproduction, before any code changed

Right-click on a row, `getComputedStyle` off the painted `[data-ctx-menu]`:

| window | items | computed `max-height` | box | content | room it had | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 5 | `200px` | 198 | 253 | 558 | **scrolls**, 558px of room, 200 used |
| 1280×720 | 7 | `200px` | 198 | 351 | 474 | **scrolls** |
| 1280×1080 | 5 | `200px` | 198 | 253 | 918 | **scrolls**, and the ceiling did not move |
| 1280×1080 | 7 | `200px` | 198 | 351 | 834 | **scrolls** |

`min-width` computed `250px` throughout, not the declared `220px`. This
reproduces the issue's own measurement exactly (`{"items":5,"clientHeight":198,
"scrollHeight":253,"maxHeight":"200px"}`) and adds the 1080 row, which is what
proves the value in force was a constant rather than `min(60vh, 420px)`.

### After

| window | items | computed `max-height` | box | content | top | bottom | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280×720 | 5 | `558px` | 253 | 253 | 158 | 413 | read, no scrollbar |
| 1280×720 | 7 | `474px` | 351 | 351 | 242 | 595 | read, no scrollbar |
| 1280×1080 | 5 | `918px` | 253 | 253 | 158 | 413 | read, no scrollbar |
| 1280×1080 | 7 | `834px` | 351 | 351 | 242 | 595 | read, no scrollbar |

`max-height` equals `innerHeight - top - 4` in every row, and moves 558 → 918
when the window grows at a fixed pointer. `scrollHeight === clientHeight`
everywhere.

Two further cases, both asserted in the spec:

- **Foot of the window.** With 24 filler rows so the column reaches the bottom,
  right-clicking the lowest visible row puts the menu's `top` above the click
  and its `bottom` at `innerHeight - 4`, with no scrollbar.
- **A window too short for the menu.** 1280×260, 7 items (351px of content):
  `top: 4`, `max-height: 252px` (= `260 - 2×4`), and it scrolls. The one honest
  scrollbar — the content genuinely cannot fit.

### Falsification — the tests were watched failing

Not a green run taken on trust. The fix was reverted in the working tree twice
and the same spec re-run each time.

**(a) Full revert** — `.ctx-menu { min-width: 220px; max-height: min(60vh,
420px) }` restored in `menu.css`, the inline `{ top, maxHeight }` removed from
`ContextMenu.tsx`. **5 of 6 tests failed**, with the bug's own numbers:

```
✘ is the room …, not a number       toBeCloseTo: Expected 558, Received 200
✘ five-item row menu … at 720px     toBeLessThanOrEqual: Expected <= 198, Received 253
✘ holds for a menu longer than five toBeLessThanOrEqual: Expected <= 198, Received 351
✘ slides up at the foot …           toBeLessThanOrEqual: Expected <= 198, Received 253
✘ bounds an unfittable menu …       toBeCloseTo(top): Expected 4, Received 56
✓ the completion menu keeps its own 200px bound
```

The sixth passing is the control: it asserts the bound the fix must **not**
touch, so it is correct for it to pass in both states.

**(b) Half revert — the interesting one.** The `.ac-menu.ctx-menu` CSS kept, only
the inline measurement removed. **3 of 6 failed**: the ceiling became `712px`
(the whole window) and the menu's bottom edge ran to `771` on a 720px window.
This is the falsification that matters for whoever maintains this next: the CSS
change alone is **not** the fix, and neither half can be simplified away.

Both reverts were undone and the spec re-run green (6/6) before finishing.

The trap the issue names was checked directly: **a spec that opened only a short
menu would pass with the bug present**, which is why every fixture here overflows
200px — 253px for the five-item menu and 351px for the seven-item one — and why
every assertion reads `getComputedStyle`, never the stylesheet.

### Checks

- `npx eslint apps/ui/src/menu apps/ui/e2e/menu-room-geometry.spec.ts` — clean.
- `npx prettier --check` on all five touched files — clean.
- `npx tsc --noEmit` in `apps/ui` — clean.
- `vitest run apps/ui/src` — **150 files, 3310 tests, all passing** (includes the
  5 new `menuRoom` cases in `menuModel.test.ts`, and the 14 pre-existing
  `ContextMenu.test.tsx` cases, which still pass because jsdom reports zero
  layout and `menuRoom` therefore leaves `top` where the placement put it).
- `npx playwright test menu-room-geometry context-menu autocomplete-keys
  chrome-keys key-conflict --workers=1` — **44 + 6 passing**, no regression in
  the menu's existing behaviour.
- `packages/kit` was **not** touched, so the dist trap does not apply to this
  change. It was still checked for: the only kit file involved,
  `autocomplete.css`, is unmodified.

## Files

- `apps/ui/src/menu/menuModel.ts` — `menuRoom`, `MENU_MARGIN`
- `apps/ui/src/menu/menuModel.test.ts` — 5 new cases
- `apps/ui/src/menu/ContextMenu.tsx` — the measuring layout effect
- `apps/ui/src/menu/menu.css` — the tying declarations removed
- `apps/ui/e2e/menu-room-geometry.spec.ts` — new, 6 specs
