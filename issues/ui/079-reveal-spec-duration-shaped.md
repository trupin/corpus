# [UI-079] `reveal.spec` waits on a decoration with a finite lifetime (duration-shaped)

## Domain

ui

## Status

todo

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: **INFRA-020** (todo) — the standing rule this issue applies: "Where the
  wait is a race with no slack, make it deterministic — **wait on the condition,
  not on a duration**." This issue is a third instance of that class, filed
  separately because its mechanism is specific and its evidence is incomplete.
  **UI-080** — the sibling e2e-timing issue from the same sweep, different
  mechanism (focus, not lifetime).

## Spec References

- — (test hygiene; no product behaviour is in question)

## Summary

`apps/ui/e2e/reveal.spec.ts:268` — the test "wears the flash treatment the rest of
the board's flashes wear" — asserts against `.reveal-flash`, a **decoration the
product deliberately destroys on a timer**. `apps/ui/src/reader/reveal.ts:26` sets
`REVEAL_FLASH_MS = 1200`, and `reveal.ts:314-316` removes the whole layer when it
fires:

```
const timer = setTimeout(() => {
  layer.remove();
}, REVEAL_FLASH_MS);
```

So the element under test has a 1200 ms life, and the test's synchronisation
budget is spent *before* the first assertion runs. `openWithReveal`
(reveal.spec.ts:93-123) ends by waiting for `.reader .ProseMirror` — the editor
surface, not the flash — and then the test does a `page.evaluate` round trip to
read `--accent-wash` from the document element (lines 271-273) **between** the
reveal firing and the first assertion. Under contention that round trip, plus
whatever the reveal itself took to locate and draw, can outlast the 1200 ms.

The failure is then misleading rather than merely annoying: line 274 retries
`toHaveCSS("background-color", …)` against an element that no longer exists and
fails at the 5 s expect timeout as *element not found*, which reads like the flash
was never drawn — a product bug — rather than like it was drawn and expired.

This is duration-shaped in the precise sense INFRA-020 names: the test passes
because a race usually resolves fast enough, not because anything guarantees the
ordering.

## Why this test and not its siblings

Worth stating, because the file is full of `.reveal-flash` waits that are fine:

- **Presence assertions are self-synchronising.** `toHaveCount(1)` at lines 192,
  226, 247, 284, 297, 513, 539, 560, 569, 594, 640 retries until the element
  appears — a slow reveal makes them wait, not fail. They still race the 1200 ms
  removal, but their whole job completes the instant the element exists.
- **Removal assertions budget for the lifetime explicitly.** Line 285 and line 581
  use `toHaveCount(0, { timeout: 4000 })` — 4000 chosen against 1200, correctly.
- **Line 268's test is the only one that reads a *property* of the flash**, which
  means it must (a) find the element and (b) still have it while three separate
  assertions run, and it inserts an unrelated `page.evaluate` between the reveal
  and the first of them. It is the one place where the element's lifetime is a
  precondition for work that has not started yet.

The mitigations elsewhere are accidental rather than designed, so a fix here
should not stop at line 268 — see acceptance criteria.

## The evidence that is still owed — read this before closing

**This was observed at 8 workers and has not been reproduced at gate defaults.**
That is a real limitation on the diagnosis, not a formality:

- The mechanism above is derived from reading the code, not from a captured
  failure with a timestamp. The alternative explanation — the reveal genuinely
  failed to draw under load, i.e. a product bug in `reveal.ts`'s find-and-draw
  path — produces the *same* error message, and nothing observed so far
  distinguishes them.
- INFRA-020 records exactly this trap and the tell that resolves it: "A test that
  fails without contention is not load-sensitive; it is racy, and the code may be
  too. Check the duration of the run before adding a test to this list." The
  `requeueDeferredFor` failures looked like load flakes and were a torn read in
  the queue (SERVER-060). Assuming this one is a test bug because it appeared
  under load would be the same mistake.

So the first acceptance criterion is **not** the fix; it is establishing which
failure this is. Concretely: reproduce it deliberately (`--repeat-each` at high
worker counts with the machine loaded), capture whether the flash was **drawn and
removed** or **never drawn**, and only then change the test. If it was never
drawn, this issue is misfiled and the real one belongs in `reveal.ts`.

## Acceptance Criteria

- [ ] The failure is **reproduced deliberately** and the two explanations are
      distinguished on evidence: flash drawn-then-expired (test bug) vs. flash
      never drawn (product bug). Record the trace, the worker count, and the run's
      total duration
- [ ] If it is a product bug, this issue is closed as misfiled and a `reveal.ts`
      issue is opened in its place — do not paper over a real defect with a
      sturdier wait
- [ ] Given a test bug: the test's synchronisation is **condition-shaped** —
      nothing it needs is read after the thing it needs may have vanished. In
      particular the `page.evaluate` for `--accent-wash` does not sit between the
      reveal and the first assertion on the flash
- [ ] No assertion's `timeout` is raised as the fix. INFRA-020: "Do not fix these
      by raising timeouts across the board. A suite whose timeouts are all
      generous stops catching the thing timeouts exist to catch"
- [ ] `REVEAL_FLASH_MS` is **not** raised, and no test-only lifetime override is
      introduced — the decoration's duration is product behaviour that other tests
      (lines 285, 581) assert against
- [ ] The file's other `.reveal-flash` reads that depend on the element surviving
      subsequent work are audited and fixed by the same shape: the
      `boundingBox()` calls at lines 336, 500 and 521, and the in-page read inside
      `settledGap` (lines 141-163)
- [ ] `todos-menu.spec.ts:428` is checked for the inverse hazard: it asserts
      `[data-reveal-flash]` has count 0 with no positive precondition that the
      reveal mechanism ran at all, so it would pass spuriously if it ran before
      any flash could be drawn
- [ ] Verified under deliberate load — a green run on an idle box proves nothing
      here, and that is the whole reason this issue exists

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/reveal.spec.ts` — the test at line 268 and the audited sites above.
- `apps/ui/e2e/todos-menu.spec.ts` — line 428, the inverse-hazard check.
- **Not** `apps/ui/src/reader/reveal.ts`, unless the reproduction proves a product
  bug — in which case this issue is closed and a new one filed.

### Key Implementation Details

**Two selectors, one timer.** `.reveal-flash` is the per-rectangle box
(`reveal.ts:278`) and `[data-reveal-flash]` is the containing layer
(`reveal.ts:309`). Both die on the same `REVEAL_FLASH_MS` timer via
`layer.remove()`, and the layer can also be torn down early by `stop()`
(`reveal.ts:324-327`). A fix that gates on one and asserts on the other has not
narrowed anything.

**The visual life is shorter than the DOM life, and that matters for what a fix
may assert.** `apps/ui/src/reader/reveal.css:32` runs the keyframe over 1.2s and
lines 35-43 hold `opacity: 0` from 65% onward — so from roughly 780 ms the box is
invisible while still matching selectors and still returning a computed
`background-color`. A fix must not start asserting on visibility (`toBeVisible`),
which would narrow the window by a further third and make the test *more*
fragile while looking more correct.

**Read the invariants, not the ephemera, where possible.** The three things this
test actually pins are: the wash colour matches the board's accent token,
`pointer-events` is `none`, and the layer is `aria-hidden`. Two of those are
static facts about the stylesheet. Consider whether the token read can be hoisted
before the reveal is triggered — it does not depend on the flash existing — which
removes the round trip from the critical window without weakening any assertion.

### Edge Cases

- **`prefers-reduced-motion`.** `reveal.css:50-55` drops the animation but notes
  the element "is removed on the same timer either way", so a fix must not assume
  the animation's presence gates the lifetime.
- **A reveal that finds nothing.** `reveal.ts` gives up after a bounded number of
  passes ("the body may still be arriving", `reveal.ts:28`); no layer is created,
  so no flash ever appears. This is the never-drawn branch the reproduction must
  distinguish.
- **A second reveal while the first is live.** `stop()` removes the layer early;
  a test holding a locator across two reveals is looking at a replaced element.

## Testing Strategy

The subject *is* a test, so the strategy is measurement rather than new coverage:

- `npx playwright test reveal.spec.ts --repeat-each=20 --workers=8` with the
  machine deliberately loaded, before and after. Record pass counts both ways —
  a fix with no before-number is a guess.
- Capture a Playwright trace on failure and read the DOM at the failing assertion:
  the presence or absence of `[data-reveal-flash]` in the trace's snapshot is what
  distinguishes drawn-then-expired from never-drawn.
- Confirm the default-worker gate run (`npm run e2e`) still passes and did not get
  slower.

## E2E Verification Plan

This issue's subject is the e2e suite itself, so its E2E verification is the suite
under contention.

### Reproduction Steps (bugs only)

1. Load the machine (a parallel build, or a busy-loop per core).
2. `CORPUS_UI_PORT=5273 npx playwright test reveal.spec.ts --repeat-each=20 --workers=8`
3. Expected: green. Actual (reported): the flash-treatment test fails; capture the
   error text, the trace, and the run's total duration.
4. From the trace, determine whether `[data-reveal-flash]` ever existed in that
   run.

### Verification Steps

1. Apply the fix.
2. Re-run the identical loaded command. Expected: 20/20.
3. Re-run at default workers (`npm run e2e`) — expected green, no regression, no
   material slowdown.
4. Confirm no `timeout` value and no `REVEAL_FLASH_MS` was changed.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the
implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact command, worker count, machine load, failure text, run
duration, and the trace evidence that distinguishes drawn-then-expired from
never-drawn. If it cannot be reproduced at all, say so plainly and stop — an
unreproducible timing fix is a guess, and this issue's first criterion is the
diagnosis.]_

### Post-Implementation Verification

_[Agent fills: before/after pass counts under identical load, plus the
default-worker gate run.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-079]` prefix
