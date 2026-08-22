# [UI-133] The console strip's height is its text, and the board pays for it

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-098 (the agent pill), UI-125 (the Residents tab)

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§10** — the console strip, where all agent and system status lives

## Summary

`.console-strip` has **no `height` and no `min-height`**, and `.console { flex:
none }` sits against `.board { flex: 1 }`. So any strip child that wraps takes
its extra line **out of the board**, and every column and every open reader
shortens — with no gesture from the person, on a line that always renders.

Two children can do it. `.c-plugin-warn` (`ConsoleStrip.tsx:54`) has **no CSS
rule anywhere in the repository**, which makes it the one wrappable, shrinkable
item in a row where everything else is `nowrap`. And `.index-detail`
(`console.css:181-186`) sets `overflow-wrap: anywhere` and wraps **by design** —
it accommodates the server's free-text progress sentence rather than revealing
it, which is clause 2 inverted.

## The measurement (UI-128, real Chromium, 2026-08-20)

The strip at rest, then with one realistic skipped-plugin sentence appended:

```
rest      : strip_h=40 board_h=623 board_bottom=679
with warn : strip_h=62 board_h=601 board_bottom=657
```

**+22px on the strip is −22px on the board**, and the board's bottom edge rises
by the same amount. `console.css:1-9` and `Console.tsx:14-28` both promise this
cannot happen.

A second, related site with the same cause: `ConsoleStrip.tsx:145` mounts the
whole index pill only once `GET /api/index/status` answers. `index: current · 273
indexed` is roughly **210px** appearing between the agent pill and `.c-counts`,
which pushes the counts right on the first frame after the answer arrives.

## Acceptance Criteria

- [x] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec records `.board`'s bounding box, drives the strip through
      its states — no index status, an index status with a long detail sentence, a
      failed count, a skipped plugin warning, a server that never answers — and
      asserts **the board's box is identical in every one**
- [x] `.console-strip` has a fixed height, and the spec asserts
      `strip.scrollHeight <= strip.clientHeight` in every one of those states, so
      nothing is silently clipped either
- [x] Every strip child that can carry server text truncates in place and reveals
      the whole of it — the strip already uses `title=` at `ConsoleStrip.tsx:54`
      and `:156`, so extending that is the cheap answer
- [x] `.c-plugin-warn` gets a CSS rule. A class with no rule is how this got in
- [x] The index pill does not push `.c-counts` when it materialises: either its
      slot is reserved, or it sits after the `.spacer` where nothing follows it
- [x] The strip stays **honest** under UI-098's rule. Reserving a slot must not
      turn an unanswered query into a claim: the agent pill's fifth word,
      `unknown`, and the counts' honest zeroes both survive
- [x] **Falsification**: remove the fixed height and watch the board-geometry
      assertion fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/console.css` — `.console-strip` (`:17-27`),
  `.index-status` / `.index-detail` / `.index-failed` (`:169-192`), and a rule for
  `.c-plugin-warn`
- `apps/ui/src/console/ConsoleStrip.tsx`, `apps/ui/src/console/IndexPill.tsx`
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

**The strip is one line and it always renders.** Give it a height. Everything
inside it then has a fixed box to live in, and the question becomes what each
child does when its text is longer than that box — which is clause 2, and the
answer is truncate-and-reveal.

`.index-detail`'s `overflow-wrap: anywhere` was chosen deliberately, so read the
comment at `console.css:181-182` before replacing it. The reasoning there is that
a progress sentence cut at the strip's edge stops explaining. **That reasoning is
right and the conclusion is wrong under SHARED-057**: the answer is to truncate
the strip's copy and put the whole sentence where it can be read — the pill's
`title`, or the console body, which is the detail view that already exists for
exactly this.

**`.c-plugin-warn` is the more urgent half.** It has no rule at all, so it
inherits nothing and is bounded by nothing. Whatever the sizing decision is for
the strip, this class needs to be named in the stylesheet, `nowrap`, and given a
`title`. A class that renders with no rule is a fault regardless of this issue.

**Reserving the index pill's slot is a judgment call.** A reserved 210px hole in
the strip on a workspace with no index is worse than the pill arriving. Prefer
moving it after the `.spacer` (`console.css:33`) so its arrival displaces
nothing, and check that against `design/index.html`, which is the authority on
strip order.

### Edge Cases

- No index at all, so the pill never mounts
- An index detail sentence long enough to wrap at a narrow window
- `9 failed` → `147 failed`
- A plugin id long enough to wrap on its own
- `ServerStatus` swinging `checking server…` → `corpus 1.2.3` → `server
  unreachable` after paint (`ConsoleStrip.tsx:15-39`)
- A narrow window, where the strip is tightest
- The drawer open, where the board is already short

## Testing Strategy

Unit tests for any derivation change in `consoleModel.ts`. The defect is layout,
so the acceptance test is a real-browser geometry spec that measures **the
board**, not the strip — the board moving is the harm, and asserting on the strip
alone would pass a fix that merely moved the growth somewhere else.

**Check every stub that answers `/api/index/status` before trusting a green
run.** `stubCorpus`'s `{}` fallback answers routes nobody wrote a handler for, and
both `stubCorpus` and `boardFixture` have been wrong this way before.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. Record `.board`'s bounding box at rest
3. Produce a strip state that wraps — a skipped plugin with a long id, or an index
   detail sentence at a narrow window
4. Expected: the board does not move. Actual: the strip grows 22px and the board
   loses 22px

### Verification Steps

1. Restart the dev server after the change
2. Walk every strip state listed in the acceptance criteria
3. Expected: `.board`'s box is identical throughout, and the strip never clips
4. Confirm every truncated string is reachable in full
5. Confirm the agent pill still says `unknown` before the queue answers

## E2E Verification Log

Implemented on: **opus**. Real Chromium via Playwright against the real Vite dev
server (`CORPUS_UI_PORT=5289`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8899`, a
port with nothing behind it). Viewport pinned at 1000×720.

### Reproduction, before any change

An exploratory spec measured `.board` and `.console-strip` across strip states.
The audit's numbers came back, on the nose:

```
rest                 strip_h=39.94  board_h=622.50  board_bottom=679.06
one skipped plugin   strip_h=45.88  board_h=616.56  board_bottom=673.13
drawer, "no model"      row_h=28.94  board_h=348.63
drawer, long sentence   row_h=44.88  board_h=332.69
```

The same run turned up a second fault the issue's Testing Strategy warned about:
**`stubCorpus` had no handler for `/api/index/status` or `/api/health`**, so the
`{}` fallback answered both and the strip read

```
"▴ console  agent: disconnected · queue 0  index: undefined · undefined/NaN  0 running · 0 done · 0 failed  corpus  HALT ○"
```

in every stubCorpus spec. `index: undefined · undefined/NaN` is wider than any
real pill, and every strip measurement in the suite was taken against it.

### After the change

`apps/ui/e2e/console-strip-geometry.spec.ts`, 7 tests, all passing. The board's
box is byte-identical across five states — no index status, an index status with
a long `detail`, `147 failed`, a skipped plugin, and a server that never answers
— and `strip.scrollHeight <= strip.clientHeight` holds in each. The drawer's
index row holds at 28.94px whether its sentence is `no model` or 190 characters,
and the board holds with it.

### Falsification, three separate reverts

1. **The whole CSS fix reverted** (strip height, `.c-plugin-warn`'s rule, the
   index row's height, `.index-detail` back to `overflow-wrap: anywhere`):

   ```
   the board's box is identical in every strip state  ✘
     a skipped plugin moved the board: height 622.5 → 600.625
   the strip is one line …                            ✘  height 40px → 61.8125px
   the drawer's index row …                           ✘  row 28.9375 → 44.875
   ```

   40 → 62 on the strip and 623 → 601 on the board, which is UI-128's
   measurement reproduced to the pixel.

2. **The strip's `height` alone removed**, child rules kept: the board assertion
   still passed and only the `40px` assertion failed (received `39.9375px`).
   Recorded because it is the honest reading of the fix — the child rules are
   the mechanism and the fixed height is the backstop that stops the *next*
   wrappable child taking a line off the board.

3. **The index pill moved back before `.c-counts`**: the counts jumped
   `x=335.05 → x=568.48` on the frame `GET /api/index/status` answered — the
   +233px the issue estimated at ~210px.

Every revert was restored from a byte copy and the suite re-run green.

### Regression sweep

`console.spec.ts`, `console-index.spec.ts`, `smoke.spec.ts`, `search.spec.ts`,
`reader.spec.ts` — 74 passed. `apps/ui/src/console` unit suite — 154 passed.
`tsc --noEmit`, `eslint`, `prettier --check` clean.

### Not done, and why

`.c-plugin-warn` keeps its inherited `--ink-2`. Whether a skipped plugin should
be `--sepia` or `--signal` in the strip is a look decision `design/index.html`
does not answer, and it is outside this issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-133]` prefix
