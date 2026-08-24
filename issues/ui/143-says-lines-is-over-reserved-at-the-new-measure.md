# [UI-143] `--says-lines: 4` is over-reserved now that the card has room

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-142
- Related: SHARED-061, SHARED-057, UI-137

## Spec References
- SPEC.md **§10** — SHARED-057's reserve rule and SHARED-061's room rule, which are one rule in two halves

## Summary

Raised by UI-142's implementer against its own fix, 2026-08-21.

`--says-lines: 4` reserves four lines for a lane's §7 statement in the composer
address card. That reservation was measured when the card was 240px wide. UI-142
widened it to the room it actually has — 400px in the reported case — and at the
wider measure **no §7 statement reaches four lines**, so an ordinary card now
carries roughly two lines of white space.

## Why it was left, and why that reasoning is worth keeping

The implementer declined to shrink it, and the argument is the same one
SHARED-061 was written on:

> a smaller count is a constant re-measured at one measure, and the measure is
> no longer one thing.

That is right. Changing `4` to `2` would fix the reported card at the width it
happens to have today and would be wrong again the moment the card is wider or
narrower — which, after UI-142, it now legitimately is. The defect is not the
number's value; it is that the reservation is expressed in **lines** while the
thing it reserves for is measured in **characters at a width**.

## What to build

A reservation derived from the room, as SHARED-061 requires of a bound:
the statement's own height at the card's actual width, reserved so it does not
move when it arrives late (SHARED-057's requirement, which is what
`--says-lines` exists for and must survive).

**Both halves must hold at once**, and that is the whole difficulty:
- the box must not grow when the statement lands (SHARED-057), and
- the box must not reserve room the statement cannot use (SHARED-061).

The honest shape is that the reserve is computed from the width the card has,
not chosen ahead. UI-142's `roomFor()` already measures the room in both axes
and is the obvious place to start.

## Acceptance Criteria
- [x] The card reserves the height its statement can actually occupy at its
      current width
- [x] The statement arriving still moves nothing (SHARED-057 unbroken — this is
      the criterion the original reserve exists for)
- [x] No new pixel or line constant: the reserve is derived
- [x] Measured at three card widths, including the narrow case that motivated
      `4` in the first place, and the wide case UI-142 created
- [x] The white space in the reported case is gone

## Testing Strategy
A geometry spec asserting the relationship — the reserve equals the rendered
statement's height at that width — never a pinned line count or pixel value.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24.

### What changed

- `packages/kit/src/address/ComposerAddress.tsx` — `reserveLines(says,
  statements)`, a measurement rather than a constant. A probe carrying
  `.recipient-says`' own class is appended beside the real element, given the
  real element's width and released from the clamp, and each candidate sentence
  is measured in it; a single short word gives the height of one line, measured
  rather than computed from `line-height`. The fit sets `--says-lines` from that.
- The **candidate set is closed and preview-independent**: one sentence per
  roster row, composed exactly as the rendered statement is (`statementFor` plus
  the default-here note), plus the no-row sentence. It does not include
  `previewed`, so hovering cannot change what the box was sized for — which is
  the distinction that keeps this inside SHARED-057 rather than being the
  content-driven sizing UI-127 removed. A **pick** does change it (the verb
  differs for a chosen lane) and refits, which is a deliberate act with no
  pointer feedback.
- **Capped by the room**, because `AgentLane.summary` is free text: the card is
  measured at a one-line reserve, and the spare is the room minus everything in
  the card that cannot shrink minus one lane row — the same floor the height fit
  already takes, for the same reason. The smaller of want and afford wins; a
  statement past it truncates in place with the whole of it on this element's
  `title` and the row's.
- `packages/kit/src/address/address.css` — `--says-lines: 4` → `1`, documented
  as a **floor and not a measurement**: every browser replaces it in the layout
  effect before the first paint of an open card, so it stands only where there
  is no layout to ask.

### Measured in a real browser (chromium, 1440×900, `CORPUS_UI_PORT=5373`)

`apps/ui/e2e/address-room-geometry.spec.ts` → *"the statement's reserve is
derived from the width the card has"*, three column widths, four lanes producing
four statements of four different heights.

**Before** — the fit disabled and `--says-lines: 4` restored (a real
falsification: source patched, `npm run build -w packages/kit`, run, restored):

| column | statements, natural height | reserve | verdict |
| --- | --- | --- | --- |
| 240px | 50.4 / 100.8 / 67.2 / 33.6 | 67.2 (4 lines) | **two lines short** of §7's missing-profile statement |
| 560px | — | — | passed by coincidence |
| 900px | 50.4 / 67.2 / 33.6 / 33.6 | 67.2 (4 lines) | **two lines of white space** — the reported defect |

Both failures at once, from one constant: too small at the floor and too large
at the wide end, which is exactly what "a constant re-measured at one measure"
buys once the measure stops being one thing.

**After**: all three widths satisfy `tallest ≤ reserve < tallest + one line`.
The assertion is that relationship and never a number — a pinned line count
would be the defect written down as a test.

### The other half, still true

`still holds still while the pointer previews every lane in turn` — the
statement's box is byte-identical across a preview of all four lanes, and the
four sentences really do differ. The pre-existing `the statement's box is a
reserve, and the longest sentence §7 allows does not move it` and the whole of
`address-geometry.spec.ts` (UI-127's oscillation suite) are green unchanged.

### Runs

- `vitest run packages/kit/src/address` — 40 green.
- Playwright, `-c apps/ui/playwright.config.ts --workers=1`: 90 specs green
  across `address-room-geometry`, `address-geometry`, `resident-badge-geometry`,
  `lane-meta-geometry`, `reveal`, `pending-claim`, `resident`, `comments-tab`.

### One thing the spec had to learn

The first version of the geometry helper read `scrollHeight` for each
statement's natural height and **measured nothing**: `.recipient-says` has a
fixed `height`, and `scrollHeight` is never smaller than `clientHeight`, so
every sentence reported the reserve's own height and both bounds held trivially.
Only the liveness check on the fixture caught it. The helper now takes the clamp
and the height off the real element, reads the natural height, and puts them
back — a different question from the one the implementation asks (a detached
probe), so a fit that agreed with itself and disagreed with the page would show
up.
