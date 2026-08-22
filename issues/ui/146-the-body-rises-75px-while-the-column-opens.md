# [UI-146] The document body rises 75px after it is on screen, while the column opens

## Domain
ui

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Related: UI-093 (which introduced it), SHARED-057, SHARED-061, UI-113, UI-073

## Spec References
- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (SHARED-057) and *"a surface is as large as its place allows"* (SHARED-061)

## Summary

Measured by the agent fixing four e2e specs after UI-093 landed, and offered
rather than acted on. **This is new in v0.17.0 and should not be discovered by
someone else.**

`.fm-form` now renders at all times — before UI-093 it rendered only while
`editing`. Its grid is `repeat(auto-fit, minmax(min(16ch, 100%), 1fr))`, which
is SHARED-061 working as intended: the row count follows the column's width.
Opening a reader eases the column wider over 0.25s (`Column.css`,
`transition: width 0.25s ease`), and **the body paints inside that window**, so
the grid reflows 1→2→3 columns while it runs.

Sampled every 40ms in Chromium after `.reader .ProseMirror` appeared, on an
ordinary note:

| t | `.doc-main` width | `.fm-form` height | body top |
| --- | --- | --- | --- |
| 888ms | 317.2 | 146.9 | 422.3 |
| 971ms | 458.9 | 106.2 | 361.3 |
| 1011ms | 504.3 | 91.7 | 346.8 |
| ≥1095ms | 527.2 | 91.7 | 346.8 |

**The body rises 75.5px and drifts 210px horizontally, after it is on screen.**

Ruled out by the same agent: fonts (`document.fonts.status` was `loaded`
throughout and `62ch` measured 527.2px the whole time), `--doc-measure` (unset,
so the stylesheet's `62ch` was in force), and plugin discovery (panel and body
still land in one commit, so UI-073's guarantee holds).

## Promoted to P0, 2026-08-22 — it breaks an interaction, not only a coordinate

Filed as P1 on the judgment that this was a transition artifact only test
coordinates could see. **That judgment was wrong**, and PR #55's red CI is what
showed it. The agent diagnosing that failure sampled the reader at each step of
the ordinary path — open a note, select a sentence, right-click — over six runs:

```
after selectText   st=0    bodyTop=422  colW=436   <- column still easing open
after right-click  st=188  bodyTop=159  colW=560   <- the document jumped 188px
```

**A right-click landing while the column is still animating makes Chromium
scroll `.reader-scroll` by 188px** to bring the focused body into view. The
document moves a quarter of the viewport under the pointer *at the instant a
person opens a context menu on a specific word*. Where the column had already
settled, the same right-click scrolls nothing.

That is the ordinary path, not a test rig. And v0.15.0 was named **"nothing
moves under your cursor"** — shipping this would contradict the previous
release's headline on the surface it was named for.

**It is also not CI-only.** The same agent measured the underlying race at
**50/50 locally**: `.reader-scroll` lands at `scrollTop` 0 or 188 depending on
timing. The suite passing here was one lucky draw; CI is deterministic only
because it is slower.

**One honesty caveat from that agent, carried rather than papered over:** it
pinned the *trigger* — a right-click on the contenteditable, only while the
column is narrow — not the full reason Chromium scrolls only in that state.
That is this issue's to settle.

## The judgment this issue exists to settle

The agent judged it **correct** — everything in a column that is animating open
moves — and that reading is defensible. It is also not obviously right, and the
reason is the release v0.15.0 was named for.

- **SHARED-057 is not breached on its own terms.** The form's size follows its
  *place* (the column's width), never its *text*. That is the rule working.
- **But the effect is the one the rule exists to prevent.** The body is on
  screen at 888ms and still moving at 1011ms. A person can begin reading and
  have the text jump 75px under them. SHARED-057's own justification is that
  *"an element that grows pushes whatever is stacked above it"* — here it
  shrinks, and pushes the body up.

Before UI-093 this animation moved nothing vertically. So the magnitude went
from ~0px to 75px, and it did so in a release whose sibling rule was signed to
stop exactly this class of movement.

## Options, none free

1. **The body does not paint until the column settles.** Honest, and it delays
   first paint by ~200ms on every open — trading a jump for a wait.
2. **The form reserves its widest row count.** Removes the reflow, and wastes
   vertical space in a narrow column permanently — which is SHARED-061's
   complaint in the other direction.
3. **The column does not animate when a reader opens inside it.** The smallest
   change and it touches UI-113's signed resize behaviour.
4. **Accept it and say so in §11**, as the stated exception for a container the
   person just opened. Cheapest, and it needs a rider.

**Do not pick by cost.** Measure what a person actually sees at each, on a real
document, and decide from that.

## Acceptance Criteria
- [ ] A decision, with the rejected options and their costs, recorded here
- [ ] Whatever is chosen, the body does not move under a reader who has begun
      reading it — or §11 says why that is acceptable and a rider is signed
- [ ] `image-geometry.spec.ts`'s local `settledReader` and `e2e/settle.ts`'s
      shared one are reconciled — one helper, not two
- [ ] No new pixel constant as a bound

## Testing Strategy
The per-frame sampler above, in a geometry spec: assert the body's top is
unchanged from the moment it is first painted. That is a stronger claim than any
settle helper and is the thing a person cares about.

## E2E Verification Log
_[Agent fills — state the model]_
