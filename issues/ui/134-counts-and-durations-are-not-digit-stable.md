# [UI-134] Counts and durations are not digit-stable

## Domain

ui

## Status

todo

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

- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec renders each affected span at a one-digit value, records its
      bounding box and its right-hand neighbour's, changes the value to two
      digits, and asserts **both boxes are unchanged**
- [ ] The assertion covers at least one span per surface — board, reader, console,
      kit row, plugin — not one span in total
- [ ] `humanizeElapsed`'s unit crossings are covered: `59m → 1h 00m` and
      `23h 59m → 1d 00h` are the widest jumps in the set and are not solved by
      digit width alone
- [ ] Nothing is achieved by changing what a count *says*. Truncating `128` to
      `99+` would be a separate product decision and is **not** in scope
- [ ] **Falsification**: remove the numeric setting and watch the spec fail

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

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-134]` prefix
