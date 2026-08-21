# [UI-133] The console strip's height is its text, and the board pays for it

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-098 (the agent pill), UI-125 (the Residents tab)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§11** — the console strip, where all agent and system status lives

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

- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec records `.board`'s bounding box, drives the strip through
      its states — no index status, an index status with a long detail sentence, a
      failed count, a skipped plugin warning, a server that never answers — and
      asserts **the board's box is identical in every one**
- [ ] `.console-strip` has a fixed height, and the spec asserts
      `strip.scrollHeight <= strip.clientHeight` in every one of those states, so
      nothing is silently clipped either
- [ ] Every strip child that can carry server text truncates in place and reveals
      the whole of it — the strip already uses `title=` at `ConsoleStrip.tsx:54`
      and `:156`, so extending that is the cheap answer
- [ ] `.c-plugin-warn` gets a CSS rule. A class with no rule is how this got in
- [ ] The index pill does not push `.c-counts` when it materialises: either its
      slot is reserved, or it sits after the `.spacer` where nothing follows it
- [ ] The strip stays **honest** under UI-098's rule. Reserving a slot must not
      turn an unanswered query into a claim: the agent pill's fifth word,
      `unknown`, and the counts' honest zeroes both survive
- [ ] **Falsification**: remove the fixed height and watch the board-geometry
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

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-133]` prefix
