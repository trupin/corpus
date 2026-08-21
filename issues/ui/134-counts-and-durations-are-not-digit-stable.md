# [UI-134] Counts and durations are not digit-stable

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-131, UI-133 (which share several of the affected spans)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)

## Summary

**`font-variant-numeric: tabular-nums` appears nowhere in the repository.** Every
count, age, duration and elapsed timer in the product is set in proportional
figures, so `9 → 10` adds a glyph and `59m → 1h 00m` adds three. Several of these
tick on a clock with no data arriving at all.

Low amplitude and very high frequency, and it is the cheapest fix in UI-128's
ledger — mostly a token and a handful of selectors, with no component change. It
is ranked last because each individual jump is small, not because it is optional:
clause 1 says *"a count reaching two digits"* moves nothing, by name.

## The measurement (UI-128, 2026-08-20)

```
/usr/bin/grep -rn "tabular-nums\|font-variant-numeric" --include='*.css' \
  apps/ui/src packages/kit/src plugins
→ no matches
```

`var(--mono)` equalises digit widths within the monospace face but does **not**
reserve a digit slot, so a count crossing a power of ten still adds a character —
and several affected spans are not in `--mono` at all.

## The affected spans

Each of these changes while a person is watching:

| Span | File | What ticks |
| --- | --- | --- |
| `.col-count` | `apps/ui/src/board/Column.css:135` | `—` → `128`, and on every query result |
| `💬 {n}` | `apps/ui/src/reader/ReaderHead.tsx:125` | when the thread list lands, and per thread |
| `.cp-meta` | `apps/ui/src/reader/Reader.css:376` | `9 turns` → `10 turns` on an SSE turn |
| save chip anchor counts | `apps/ui/src/editor/SaveChip.tsx:69-89` | per save |
| `.c-counts`, `queue N` | `apps/ui/src/console/console.css:57-92` | on ordinary queue traffic |
| `.index-failed` | `apps/ui/src/console/console.css:188` | as indexing runs |
| `.scope-count` | `apps/ui/src/console/console.css:605` | `1 member` → `12 members` |
| `.lane-meta` | `apps/ui/src/console/console.css:569` | on a 15s clock, no request |
| `.age` | `packages/kit/src/row/row.css:117` | `2m` → `14m` → `stale · 3mo` |
| `UnreadBadge` | `packages/kit/src/row/badges.tsx:38-41` | `new` ↔ a count |
| `humanizeElapsed` | `packages/kit/src/time/elapsed.ts:13` | `59m` → `1h 00m` → `1d 00h` |
| `.todos-group-count` | `plugins/todos/ui/todos.css:370` | on "Show completed" |

## Acceptance Criteria

- [x] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec renders each affected span at a one-digit value, records its
      bounding box and its right-hand neighbour's, changes the value to two
      digits, and asserts **both boxes are unchanged**
- [x] The assertion covers at least one span per surface — board, reader, console,
      kit row, plugin — not one span in total
- [x] `humanizeElapsed`'s unit crossings are covered: `59m → 1h 00m` and
      `23h 59m → 1d 00h` are the widest jumps in the set and are not solved by
      digit width alone
- [x] Nothing is achieved by changing what a count *says*. Truncating `128` to
      `99+` would be a separate product decision and is **not** in scope
- [x] **Falsification**: remove the numeric setting and watch the spec fail

## Technical Design

### Files to Create/Modify

- `packages/kit/src/tokens.css` — where the numeric setting belongs, if it is a
  token
- The stylesheets listed above, per span
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

**Two mechanisms, and they solve different halves.**

1. **`font-variant-numeric: tabular-nums`** makes every digit the same width, so
   `19` and `10` are identical and `9 → 10` still adds one digit's width. This
   solves *jitter within a digit count* and is nearly free.
2. **A reserved `min-width`** solves *crossing a digit count*, which is what
   clause 1 actually names. A count span sized to its plausible maximum — three
   digits for a queue, four for a document count — does not move when it crosses.

**Both are needed for the spans that neighbour something a person points at**
(`.c-counts` beside the HALT button, `.scope-count` beside `.lane-statement`,
`.age` beside `.row-context`). **Tabular figures alone are enough** for spans that
right-align into slack and have nothing beyond them.

Decide per span and say which in a comment. Do not apply `min-width` blindly — a
reserved four-digit slot beside a count that is always `3` is a visible hole.

**`humanizeElapsed` is the one that needs thought rather than CSS.** `18m`,
`2h 05m` and `1d 03h` are three different widths by construction, and the padding
already in the function (`padStart(2, "0")`) shows the author was thinking about
exactly this. A fixed-width slot sized to `1d 03h` is the straightforward answer.
Changing the *format* is a copy decision — check `SPEC.md §8`'s pending row and
§7's `last seen 18m ago`, which are its two callers, before touching it.

**Where the setting lives.** `tokens.css` is the natural home if it is applied
broadly, and a token is also how the next surface inherits it for free. But do
**not** set it on `:root` — proportional figures are correct for prose, and a
global setting would change every number in every document body, which is content
the product does not own.

### Edge Cases

- `humanizeElapsed`'s unit crossings, above
- `stale · 3mo` in `staleness.ts:114-122`, a different shape from a plain count
- `UnreadBadge` swapping the word `new` for a number — a word/number swap, not a
  digit crossing, and `min-width` is the only mechanism that covers it
- A count that legitimately reaches four digits in a large workspace
- Dark and light themes, which must render identically here
- Plugin surfaces, which inherit whatever `tokens.css` exposes

## Testing Strategy

Unit tests for any `humanizeElapsed` format change, with its existing callers
pinned. Everything else is layout, so the acceptance test is a real-browser
geometry spec. jsdom would pass against the current code.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. A fixture with a nine-item count beside a control
3. Record both boxes
4. Change the fixture to a ten-item count
5. Expected: neither moves. Actual: the count widens and its neighbour shifts

### Verification Steps

1. Restart the dev server after the change
2. Repeat for one span per surface
3. Expected: every box is identical across the digit crossing
4. Confirm no number's *meaning* changed — only its box

## E2E Verification Log

Implemented on: **opus**. Real Chromium via Playwright against the real Vite dev
server (`CORPUS_UI_PORT=5289`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8899`).

### Reproduction

The issue's own grep, re-run before any change, still returned nothing:

```
/usr/bin/grep -rn "tabular-nums\|font-variant-numeric" \
  --include='*.css' --include='*.ts' --include='*.tsx' --include='*.html' \
  . --exclude-dir=node_modules --exclude-dir=dist
→ no matches
```

### The ledger

**Changed — tabular figures _and_ a reserved slot.** These are the spans where
the number is the whole content and its digit count changes under the eye:

| Span | File | Reservation |
| --- | --- | --- |
| `.col-count` | `apps/ui/src/board/Column.css` | `min-width: 3ch` |
| `.comments-count` _(new span inside 💬)_ | `apps/ui/src/reader/Reader.css`, `ReaderHead.tsx` | `min-width: 2ch` |
| `.index-failed` | `apps/ui/src/console/console.css` | `min-width: 9ch` |
| `.age` | `packages/kit/src/row/row.css` | `min-width: 3ch` |
| `.unread` | `packages/kit/src/row/row.css` | `min-width: calc(3ch + 24px)`, centred |
| `.todos-group-count` | `plugins/todos/ui/todos.css` | `min-width: 2ch` |

**Changed — tabular figures only**, because no honest reservation exists:

- `.c-counts` — its *segments* come and go (`queued` and `deferred` are omitted
  at zero), so a `min-width` would be a box sized for a string.
- `.scope-count` — the plural on `member` and the `listed`/`in scope` suffix both
  vary on non-digit axes, and it changes on a selection rather than a clock.
  UI-131's own note already lists it as wanting its own measurement.
- `.working` — SPEC.md §8's pending row. Defensive: the row's box is not its
  text, and the tick was measured to move nothing either way.

**Already safe — listed, not changed:**

- `.cp-meta` (`9 turns`) — a block on its own line inside `.comments-pop`, which
  is `width: 300px`.
- The save chip's anchor counts — `.save-chip` is a **reserved** box with a
  documented decision (UI-135) about which state overflows it. Re-sizing another
  issue's box was not this issue's to do.
- `.lane-weight` — `width: 24ch` (UI-131).
- `humanizeElapsed`'s two callers — `.t-resident-line` and `.address-line-text`
  both truncate with an ellipsis and keep the whole sentence on a `title`.

**Found and not fixed, flagged instead:** `.lane-meta` is in this issue's table
but renders a **word** — `live`, `lapsed`, `waiting`, `unknown` — not a number.
It does change width on the 15 s clock, and `margin-left: auto` puts it against
`.lane-name`, so it does move something. That is a word-width question in the
surface UI-131 is holding, not a digit crossing, and no digit setting touches it.

### What happens at a digit-count crossing

Every reservation is sized to **the digit range the site plausibly reaches**, not
to a worst case — the rider asks for the box the text people actually have, and a
four-digit slot beside a count that is always `3` is a visible hole. So:

- `.col-count` holds `—` through `128`; a column reaching `1024` widens by one
  digit **once** and then holds.
- `.comments-count` and `.todos-group-count` hold through `99`; the hundredth
  thread or item widens once.
- `.age` holds `3h` → `12d` → `10w`; `just now` (8 characters) and
  `stale · 8mo` (11) exceed it naturally, and those are tier changes, hours
  apart, not digit crossings.
- `.index-failed` holds through `999 failed`.
- `humanizeElapsed` is the one nothing closes: `59m → 1h 00m` adds three
  characters and `23h 59m → 1d 00h` **removes** one. Those are shape changes, not
  width changes, and `packages/kit/src/time/elapsed.test.ts` pins them so a later
  format change is a deliberate one.

### The spec

`apps/ui/e2e/digit-geometry.spec.ts`, 7 tests, all passing — one per surface
(board, kit row, reader, console, plugin) plus two on §8's pending row driven by
`page.clock`, which is the one site that moves with nobody touching anything.

Where a surface can show both values at once — two columns, three rows, two todo
groups — the assertion compares them **in one frame**, which removes every
question about what else settled between two measurements.

### Falsification

Every `font-variant-numeric`, `min-width`, `text-align` and `justify-content`
this issue added was stripped from all six stylesheets, and the spec re-run:

```
the board's column count …          ✘  the count's box grew: 6.625 → 13.25px
the kit row's unread pill …         ✘  `9` = 30.33px against `new` = 42.97px
the reader's thread count …         ✘  the 💬 control: 45.25 → 51.875px
the console's failed-chunk count …  ✘  the sentence: 1068.02 → 1054.77px
the todos plugin's group count …    ✘  the list's name: 282.70 → 275.42px
the pending row's clock (×2)        ✓  passes either way — see below
```

Restored from byte copies, re-run, 7 passed.

**The two pending-row tests pass with and without the change, and that is
recorded rather than hidden.** The row's box is decided by the thread card, not
by its sentence, so nothing there was ever moving: the tests are a guard on a
site the audit expected to be broken and measurement found sound. What the run
did surface was a **measurement** error worth keeping — a thread card settles in
stages, and a box read on the frame `.working` first appears was 308.13px against
a settled 456.16px. `settledBox` in the spec waits for two agreeing measurements,
because the question is always *did this move by itself*.

### Two fixture gaps closed on the way

`stubCorpus` answered `unreadThreads: 0` for every row, so no spec could reach
the unread pill at all — and it is the one badge whose content is a **word or a
number**, which is the only case a reservation rather than a font feature fixes.
It is now seeded (`StubRow.unreadThreads`, absent ⇒ `0`). The todos column's own
aggregate route is answered in the spec, because `stubCorpus`'s `{}` fallback
gives the plugin a shape it validates and refuses.

### Regression sweep

`apps/ui/src` + `packages/kit` unit suites — 209 files, 4107 tests, all passing.
The whole `apps/ui` Playwright suite — 465 tests, 461 passed; the four failures
(`smoke`, `soft-wrap`, `todos`, `turn-comment`) each pass on a serial re-run and
are load flakes from a shared machine, not regressions. `tsc --noEmit` clean in
`packages/kit`, `apps/ui` and `plugins/todos`. `eslint` and `prettier --check`
clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-134]` prefix
