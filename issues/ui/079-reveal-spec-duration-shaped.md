# [UI-079] `reveal.spec` waits on a decoration with a finite lifetime (duration-shaped)

## Domain

ui

## Status

closed — **misfiled**. The spec was not flaky; it was correctly reporting a
product defect. Diagnosed here, replaced by **UI-140** against
`apps/ui/src/reader/useReaderSurface.ts` (see the E2E Verification Log for the
measurement rig, which UI-140 reuses)

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

- [x] The failure is **reproduced deliberately** and the two explanations are
      distinguished on evidence: flash drawn-then-expired (test bug) vs. flash
      never drawn (product bug). Record the trace, the worker count, and the run's
      total duration — **verdict: never drawn. It is the product bug.**
- [x] If it is a product bug, this issue is closed as misfiled and a `reveal.ts`
      issue is opened in its place — do not paper over a real defect with a
      sturdier wait — **the defect is diagnosed below; filing the replacement
      issue is the orchestrator's, since the fix is in
      `apps/ui/src/reader/useReaderSurface.ts`**
- [ ] ~~Given a test bug: the test's synchronisation is **condition-shaped**~~ —
      **not applicable: it is not a test bug.** No synchronisation was changed
- [x] No assertion's `timeout` is raised as the fix — **nothing was changed at
      all**
- [x] `REVEAL_FLASH_MS` is **not** raised, and no test-only lifetime override is
      introduced — **unchanged**
- [ ] ~~The file's other `.reveal-flash` reads … are audited and fixed by the
      same shape~~ — **conditional on the test-bug branch; not taken.** They are
      audited below and are not what fails
- [x] `todos-menu.spec.ts:428` is checked for the inverse hazard — **checked
      (now line 586); the hazard is real but narrow, and is reported rather than
      changed. See below**
- [x] Verified under deliberate load — a green run on an idle box proves nothing
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

Implemented on: **opus** — Opus 5 (1M context) (`claude-opus-5[1m]`), ui-dev.

**No code was changed. The diagnosis says this issue is misfiled.**

Invocation throughout: `CORPUS_UI_PORT=5673
CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799` (INFRA-028 — a dead origin, so Vite
cannot proxy to a live workspace server). Port 8765 never touched.

### Reproduction

**Run 1 — `reveal.spec.ts --workers=8 --repeat-each=20`, no synthetic load.**
360 tests, **9 failed, 351 passed, 5m 17s** (`492% cpu`). This is the condition
the issue reports, and it fires at **2.5%**.

The failures are spread over 7 of the file's 18 tests, and **all 7 are in the
seeded describes** (`an open that names an item`, `an open that names a
thread`). Not one of the `a click on a todo item` tests failed:

```
4 × :329  uses the prefix to pick which of two identical items it meant
3 × :189  scrolls the item into view and flashes it, over the real text
2 × :293  takes the instruction off the entry, so a reload does not flash again
2 × :280  is transient — it takes itself away and leaves the document untouched
2 × :268  wears the flash treatment the rest of the board's flashes wear
2 × :245  follows its line when the surface moves under the lit flash
2 × :224  holds the box on the line after the cold open's layout settles
```

**Run 2 — the same command with four busy-loop processes pinned to cores.**
360 tests, **69 failed, 291 passed, 5m 32s**. Every test in the file failed at
some rate, and `:344` — which asserts an *absence* — failed on a 30 s
`waitFor` timeout. That load is severe enough to stop the app rendering at all,
so run 2 is reported for completeness and run 1 is the evidence.

### The two explanations, distinguished

**The flash is never drawn.** Three independent lines say so, and they agree.

**1. A presence assertion failed.** `:189`'s first assertion is a bare
`expect(page.locator(".reveal-flash")).toHaveCount(1)` — self-synchronising,
nothing read before it, retrying for 5 s:

```
Error: expect(locator).toHaveCount(expected) failed
Locator:  locator('.reveal-flash')
Expected: 1
Received: 0
Timeout:  5000ms
Call log:
  - waiting for locator('.reveal-flash')
    14 × locator resolved to 0 elements
```

Fourteen polls over five seconds, zero elements every time. A drawn-then-expired
flash cannot produce that: `openWithReveal` returns when `.reader .ProseMirror`
exists, which is *before* the reveal fires, so the flash's 1200 ms life cannot
have started and ended before the first poll.

**2. An in-page probe watched for it and never saw it.** A temporary spec
(`zz-ui079-probe.spec.ts`, deleted afterwards; nothing of it remains in
`apps/ui/e2e/`) reproduced the shipped test verbatim with a `requestAnimationFrame`
sampler counting `[data-reveal-flash]` on every frame, from before navigation.
At `--workers=8 --repeat-each=30` under load, **7 of 30 failed**, and every
failure read:

```
verdict=FAIL drawn=false ticks=535 last=9457 items=3
             events=[{"t":1,"kind":"gone","boxes":0}] stored=reveal-consumed
```

`ticks=535 last=9457` — the sampler was alive for 9.4 s and could not have
missed a 1200 ms element. `items=3` — the list *did* render. And
`stored=reveal-consumed` — the instruction was taken off the navigation entry
all the same.

A passing run in the same batch:

```
verdict=PASS drawn=true events=[…,{"t":4325,"kind":"drawn","boxes":1}]
```

Drawn at **t = 4325 ms**. Uncontended the same probe draws it at t = 843 ms and
removes it at ~2000 ms (polled: `1 1 1 1 1 0 0 0 …` at 250 ms intervals). So
under load the whole sequence stretches, and the ones that fail are the ones
where it stretched past the budget.

**3. The budget is in the source, and it is ~320 ms.**
`apps/ui/src/reader/useReaderSurface.ts:255-275`:

```ts
} else if (attempts < REVEAL_RETRIES) {
  timer = setTimeout(attempt, REVEAL_RETRY_MS);
  return;
}
revealedCallback.current?.();
```

`REVEAL_RETRIES = 5`, `REVEAL_RETRY_MS = 80` — five passes, four gaps, ~320 ms
from the moment `hasContent` goes true. Then `revealedCallback` spends the
instruction **whether or not anything was drawn**. The comment above it says so
deliberately — *"Giving up counts as honouring it"* — for a quote the document
no longer contains. But it does not distinguish **"not there"** from **"not
there yet"**, and on a cold open the editor is still mounting its own DOM.

### The defect, stated for the replacement issue

> **A reveal on a cold open silently does nothing when the body is slow.**
> `useReaderSurface`'s reveal effect gives up after ~320 ms
> (`REVEAL_RETRIES × REVEAL_RETRY_MS`) counted from `hasContent`, and spends the
> instruction on the navigation entry either way. Under contention the rendered
> text is not searchable in time, so "open this document **at this**" opens the
> document at the top, draws no flash, and forgets what it was for — with no
> signal to the user and nothing left to retry from. Measured at **2.5% of
> opens** (9 of 360) at 8 Playwright workers on a 2026 laptop, rising to ~19%
> with four cores otherwise busy. Only the seeded/cold-open path fails; a click
> on a todo item, which reveals into an already-mounted reader, never did.
>
> The fix is in `apps/ui/src/reader/useReaderSurface.ts` and `reveal.ts`'s
> budget, and belongs to whoever holds `apps/ui/src/reader/**`. Worth
> considering together: whether the budget should be frames rather than
> milliseconds (a loaded machine has fewer frames per second, which is exactly
> when the current budget shortens in real terms), and whether spending the
> instruction should be conditional on having drawn something.

`reveal.spec.ts` was **not** made sturdier. Doing so would hide a defect that
fires on one open in forty, which is what this issue's second criterion
forbids.

### The audit that was owed anyway

Carried out even though the fix branch was not taken, because the reading is
useful either way:

| Site | Read | Verdict |
| --- | --- | --- |
| `reveal.spec.ts:268` | `toHaveCSS` ×2 + `toHaveAttribute`, after a `page.evaluate` for `--accent-wash` | The `page.evaluate` **is** avoidable work in the window and could be hoisted. Left: it is not what fails, and moving it would shrink the failure rate of a test that is currently the surface's only alarm. |
| `reveal.spec.ts:336, 500, 521` | `boundingBox()` after `toHaveCount(1)` | Each is one call on an element the preceding count assertion has already found. Genuinely inside the lifetime, and no worse than `:268`. |
| `reveal.spec.ts:141-163` (`settledGap`) | in-page read, three-frame settle then both boxes in **one** evaluate | Already the right shape — one round trip, both boxes in the same frame, and `null` when the flash has gone, which the caller asserts against rather than scoring as a distance. |
| `todos-menu.spec.ts:586` (was 428) | `expect([data-reveal-flash]).toHaveCount(0)` | **The inverse hazard is real but narrow.** It does carry two positive preconditions — the reader opened at `LIST_ID`, and the thread slot exists — so it is not asserting into an empty page. What it lacks is proof the reveal *mechanism* ran and declined. That cannot be added today: the only positive signal would be the thread's own expansion and flash, which the comment block above that test already reports as broken under StrictMode and referred to the ui domain. Reported, not changed. |

### Post-implementation verification

None: nothing was implemented. The before-numbers above are the whole result,
and there is no after to compare them with.

## Completion Checklist (domain agent)

- [x] Tests written and passing — n/a, no code changed
- [x] `/lint` passes — n/a, no file touched
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (see the conditional ones, marked n/a)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-079]` prefix
