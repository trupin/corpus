# [UI-138] A lane's liveness word re-cuts the name beside it, on a 15-second clock

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
- Related: UI-134 (which found it), UI-131 (which holds the surface), SHARED-057

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§7** — presence: a lane is live exactly while it holds a parked scoped `idle`

## Summary

Found by UI-134's implementer and flagged as out of its scope, then found again
by PR #53's reviewer as a residual with **no owner at all** — not a latent row in
UI-128's ledger, not in UI-136, and in no issue. Filed here so it has one.

`.lane-meta` (`apps/ui/src/console/console.css`) renders a **word** rather than a
number: `live`, `lapsed`, `waiting`, `unknown`. It carries `margin-left: auto`,
so its width decides where `.lane-name` beside it is cut. The words differ in
length, and the value changes on a **fifteen-second** clock as presence is
re-evaluated — so the name re-cuts itself while a person reads the roster, with
nobody touching anything.

It is the same defect as the counts UI-134 fixed, one axis over: `tabular-nums`
cannot help, because the variation is in letters rather than digits.

## Why it was left

UI-134's remit was digit stability, and this is a word. UI-131 was holding the
surface at the time. Neither is a reason it should have ended up unowned, and
the ledger correction in UI-128 records that.

## Acceptance Criteria

- [x] `.lane-meta`'s width does not depend on which of its four words it holds
- [x] `.lane-name` is cut at the same point in all four states — measured before
      and after a state change, not asserted by eye
- [x] The reservation is sized against the four real words, and the measurement
      is stated (SHARED-057 clause 3)
- [x] A browser test drives a lane through at least two liveness states and
      asserts the name's box is unchanged. **Falsify** by removing the reservation
- [x] If a workspace can produce a fifth word, say what happens to it

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/console.css` — `.lane-meta`
- `apps/ui/e2e/` — the geometry assertion

### Key Implementation Details

Read UI-131's `.lane-weight` fix in the same file: a fixed `ch` width with
ellipsis, chosen because a `min-width` computed from arrived content is the same
reflow with a later trigger. The same reasoning applies, and the vocabulary here
is closed at four words, so it is easier.

### Edge Cases

- A lane whose presence flips while the pointer is on its row
- The orchestrator's row, which has no resident but does have liveness

## Testing Strategy

A browser geometry test — the clock and the layout are both things jsdom cannot
see.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. A roster with a long lane name; measure the name's box
3. Drive the lane from `live` to `lapsed`; measure again
4. Confirm unchanged

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24. Real browser (chromium), 1180×760,
`CORPUS_UI_PORT=5373`, `apps/ui/e2e/lane-meta-geometry.spec.ts`.

### What was measured before the constant was changed

The warning in the brief was taken literally: what `ch` resolves against here is
`.lane-meta`'s own computed font, which is `.lane`'s `var(--mono)` at 11px —
`.lane-name` overrides to `--sans` 12px and `.lane-meta` does not. So the unit
really is "characters of mono", the same unit `.lane-weight` above it is sized
in. Nothing measured is taken on a box the reservation itself changes, and the
reserve has no content input, so there is no feedback path to oscillate.

### Reproduction, before the fix

The fix reverted in the tree, the new spec run against it, one designated lane
seeded `live` with a fresh stamp, `page.clock` advanced past
`AGENT_PRESENCE_WINDOW_SECONDS` (960 s) plus 30 s so the 15-second tick
re-evaluates presence:

```
.lane-meta   live → lapsed      26.5px → 39.75px      (+13.25)
```

Nothing was touched. The word grew by 13.25px and `.lane-name` beside it lost
the same, on a `<button>` a person clicks.

### The fix

`apps/ui/src/console/console.css`:

```css
.lane-meta { margin-left: auto; width: 8ch; text-align: right;
             overflow: hidden; text-overflow: ellipsis; }
```

**8ch is one character past the longest word**, exactly as `.lane-weight` above
it is one past the longest shipped label. The vocabulary is closed at four
(`LaneLiveness`, `@corpus/kit`): `live` 4, `lapsed` 6, `waiting` 7, `unknown` 7.
`text-align: right` keeps the word where `margin-left: auto` alone put it, so the
reservation changes what the name can rely on and not where the word is drawn.

### After, measured

1. **Three words in one frame** — a roster holding a live lane, a lapsed one and
   a never-parked one. The three `.lane-meta` boxes are the same width to within
   0.05px, and so are the three `.lane-name` boxes (the rows carry the same long
   title, so the names are a direct read of what the word cost them).
2. **The transition on the clock** — `live → lapsed` with nobody touching
   anything: `.lane-meta` unchanged to within 0.05px, and `.lane-name`'s box
   **identical** (`toEqual`, all four numbers).
3. **All four words in one box** — each written into the live element and the box
   read back. Two assertions, because "every word fits" is trivially true of a
   box with no reservation: first that the four `clientWidth`s are **one** value,
   then that each word's `scrollWidth` fits inside it.

### The fifth word

There cannot be one from a workspace: `laneLiveness` maps every roster row onto
those four, and `unknown` comes only from `unknownLaneRow`, for a lane the roster
does not list — which this tab never renders. If one ever arrived it would
ellipsize in place rather than widen the box, and the row's own `title`
(`laneStatement`) carries the lane's liveness in a sentence. No `title` was added
to `.lane-meta` itself: nested titles do not merge, and one there would hide the
row's whole sentence on hover of that element.

### The orchestrator's row

Covered by the first test — the orchestrator's lane is one of the rows counted,
has no resident and does have liveness, and its `.lane-meta` is the same box.

### Runs

Playwright, `-c apps/ui/playwright.config.ts --workers=1`: 3 specs green here,
90 green across the whole set this batch touched.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-138]` prefix
