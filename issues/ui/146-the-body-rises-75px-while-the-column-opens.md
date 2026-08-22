# [UI-146] The document body rises 75px after it is on screen, while the column opens

## Domain
ui

## Status
done

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

## The decision, 2026-08-22 — option 3, and why the others lost on measurement

**Chosen: the column does not animate its width while it is showing a
document.** `.col.reading` drops `width` from the transition list, and the
reading floor is applied in a **layout** effect rather than an effect, so the
width is decided in the same commit the reader mounts in. Two halves, both
load-bearing — each was disabled in turn and the specs went red for it.

Every option below was measured on the same note, sampling `.doc-body` on every
animation frame from the frame it first existed in.

**Baseline, to have the numbers this decision is made against.** Frames from
the body's first paint:

```
t=221  colW=336    bodyTop=444.5  bodyW=306    closing=990.4  formH=161.4
t=241  colW=403.8  bodyTop=422.3  bodyW=373.8  closing=919.6  formH=146.9
t=253  colW=466.4  bodyTop=361.3  bodyW=436.4  closing=858.7  formH=106.2
t=286  colW=508.2  bodyTop=346.8  bodyW=478.2  closing=747.0  formH=91.7
t=303  colW=523.3  bodyTop=346.8  bodyW=493.3  closing=722.7  formH=91.7
```

Body top **+97.7px**, measure **+211.2px**, and the closing paragraph —
the body's *interior* — **267.7px**. Right-click on the second paragraph while
the column was still easing: `scrollTop` 0 → **103**, body top 422.3 → 243.8.
The same right-click on a settled column, twice over: `scrollTop` 0, nothing
moved. The reported defect, entire.

**Option 2 (the form reserves its widest row count) was rejected on
measurement, not on cost.** The form's height is 69.7px of the 97.7px the body
top moves. The other 28px, and **all 267.7px of the interior movement**, come
from the body re-wrapping as its measure grows 306 → 517.2px — which pinning
the form's rows cannot touch. It also cannot stop the 103px scroll, because
that is Chromium reacting to a reflow the option leaves in place. So option 2
buys a permanent 69.7px of dead space at the top of every wide reader and still
leaves a person's text moving under them. It is a partial fix priced as a
permanent one.

**Option 1 (the body does not paint until the column settles) works, and costs
the whole transition.** It removes the movement by removing the window, at the
price of ~250ms of empty reader on every open — and it removes nothing that
option 3 does not also remove, while adding a wait. Rejected: a delay is a cost
paid on every open, and the movement it prevents can be prevented for free.

**Option 4 (accept and amend §11) was rejected on the measurement above.** The
right-click case is not a coordinate artifact — the document travels a quarter
of the viewport at the instant a person opens a context menu on a word. That is
the movement v0.15.0 was named for ruling out, on the ordinary path.

**Option 3, measured after the change.** Every one of the ~110 sampled frames
equals the first painted frame: `bodyTop` 346.8, `bodyW` 517.2, `closing`
722.7, `scrollTop` 0. Same for a warm cache in a second column. Same across
select-then-right-click with no settle between the steps.

**What was checked before choosing it.**
- **SHARED-061 is untouched.** `.fm-form` still derives its row count from the
  room the column gives it. What changed is only that the room stops passing
  through every intermediate value on its way to its own.
- **A drag still behaves exactly as UI-113 signed it.** A drag never eased —
  `.col.resizing` sets `transition: none` so the edge tracks the pointer — and
  that rule is declared after the new one, so it still wins when a column is
  doing both. `column-width.spec.ts`'s 11 tests, including "the edge can be
  dragged while a reader is open" and "does not snap back on close", all pass
  unchanged.
- **What it does cost:** an arrow-key resize *of a column that has a reader
  open* is now instant instead of eased, as is a width arriving from another
  browser. A column with no reader open still eases both. Judged right: while a
  document is on screen in a column, nothing about that column moves gradually.
- **The appearance is already shipped and signed.** `design/index.html`'s own
  `prefers-reduced-motion` guard turns this exact transition off, and
  `app/global.css` carries it — an instant open is what every reduced-motion
  user has always seen. Option 3 gives everyone the reduced-motion appearance
  for the one case where the motion moves prose. This is a deliberate departure
  from the mockup's eased open, on §11's own terms: the mockup is authoritative
  for look and feel, and §11's rider is authoritative for what may move.

## Acceptance Criteria
- [x] A decision, with the rejected options and their costs, recorded here
- [x] Whatever is chosen, the body does not move under a reader who has begun
      reading it — asserted per animation frame in
      `apps/ui/e2e/column-open-geometry.spec.ts`, no rider needed
- [x] `image-geometry.spec.ts`'s local `settledReader` and `e2e/settle.ts`'s
      shared one are reconciled — one helper, in `e2e/settle.ts`, reading
      `.doc-main` so it covers a document reader and a thread reader alike
- [x] No new pixel constant as a bound — every assertion is "equal to the first
      painted frame"

## Testing Strategy
The per-frame sampler above, in a geometry spec: assert the body's top is
unchanged from the moment it is first painted. That is a stronger claim than any
settle helper and is the thing a person cares about.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). ui-dev, 2026-08-22, branch
`phase-40-derived-status`. Chromium via Playwright against the real Vite dev
server, `CORPUS_UI_PORT=5273`, `--workers=1`, isolated from any workspace server
(INFRA-028).

**1. Reproduced before touching anything.** A throwaway probe spec sampled
`.doc-body` on every animation frame, starting *before* the row click, so the
first recorded frame is the first frame the body existed in:

```
PROBE open frames=109 moves=6
t=221  colW=336    bodyTop=444.5  bodyW=306    closing=990.4  formH=161.4
t=241  colW=403.8  bodyTop=422.3  bodyW=373.8  closing=919.6  formH=146.9
t=253  colW=466.4  bodyTop=361.3  bodyW=436.4  closing=858.7  formH=106.2
t=269  colW=489.3  bodyTop=361.3  bodyW=459.3  closing=761.5  formH=106.2
t=286  colW=508.2  bodyTop=346.8  bodyW=478.2  closing=747.0  formH=91.7
t=303  colW=523.3  bodyTop=346.8  bodyW=493.3  closing=722.7  formH=91.7
settled  colW=560  bodyTop=346.8  bodyW=517.2  closing=722.7  formH=91.7
```

Body top **+97.7px**, measure **+211.2px**, closing paragraph **267.7px** —
larger than the filed numbers because the filed table starts at 888ms, one
sample after the first paint.

**2. The P0 half, reproduced, three opens in one run:**

```
PROBE rightclick run=0 before={scrollTop:0,bodyTop:422.3,colW:370.2}
                       after ={scrollTop:103,bodyTop:243.8,colW:560}
PROBE rightclick run=1 before={scrollTop:0,bodyTop:346.8,colW:560}
                       after ={scrollTop:0,bodyTop:346.8,colW:560}
PROBE rightclick run=2 before={scrollTop:0,bodyTop:346.8,colW:560}
                       after ={scrollTop:0,bodyTop:346.8,colW:560}
```

Run 0 opens into a narrow column and the reader scrolls **103px** under the
pointer. Runs 1 and 2 reopen into the column the ratchet left wide, and nothing
moves — the animation is the whole difference, exactly as filed.

**3. A third failure mode the issue did not have.** With the transition off but
the width still decided in a `useEffect`, a document **already in the query
cache** (a second column, or a reopen) paints one frame at the old width:
`bodyTop` 444.5 at `colW` 336, then 346.8 eleven milliseconds later at 560.
That is why the fix has two halves.

**4. Option 3 measured before choosing it, without writing it.**
`design/index.html` and `app/global.css` already turn this transition off under
`prefers-reduced-motion`, so `page.emulateMedia({ reducedMotion: "reduce" })`
renders the proposed appearance on the unmodified build. It reported
`moves=1` — the body's first painted frame already at `bodyTop` 346.8, `bodyW`
517.2 — and `scrollTop: 0` on all three right-clicks. The decision was made
against that reading, not against the option's cost.

**5. After the change**, the same three probes: `moves=1` on a cold open,
`moves=1` on a warm-cache open in a second column, `scrollTop: 0` on every
right-click. The probe was then deleted and replaced by
`apps/ui/e2e/column-open-geometry.spec.ts`, which asserts the same claim as a
spec. Green 3×3 on `--repeat-each=3`.

**6. Falsified, both halves, separately.**
- CSS half disabled (`.col.reading` renamed): tests 1 and 2 fail, naming the
  seven distinct frames and the 97.7px rise; test 3 fails with a trailing frame
  at `scrollTop: 17`.
- Layout-effect half reverted to `useEffect`: tests 2 and 3 fail, test 1 passes
  — precisely the split the two halves predict.

**7. The full Playwright suite**, `--workers=1`: **535 tests, 534 passed, 1
failed** on the first run. The failure was `reader.spec.ts` asserting the
prototype's eased open —
`expect(styles[".col.reading"]["transition-property"]).toContain("width")` —
which is the behaviour this issue removes. It was rewritten to assert the new
rule in both directions: a reading column transitions `border-color` only, and
a column with no reader still transitions `width` over 0.25s. Re-run: **535
passed**. `tsc --noEmit`, ESLint and Prettier clean over every touched file.
Scoped unit tests for `apps/ui/src/board` and `apps/ui/src/reader`: 597 passed.

**8. Escalated, not fixed here.** `design/index.html` still draws the eased
open, so the mockup and the app now disagree on this one transition. The mockup
is outside `apps/ui`. Someone should either amend it or record the deviation.
