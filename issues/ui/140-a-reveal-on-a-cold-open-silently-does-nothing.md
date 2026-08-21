# [UI-140] A reveal on a cold open silently does nothing when the body is slow

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: UI-063 (whose anchored row leads to its anchor through this seam)
- Related: UI-079 (which diagnosed it and was misfiled as a test bug), UI-037
  (the reveal seam), PLUGINS-010

## Spec References

- SPEC.md **§11** — *"Selecting an anchored row reveals it at its anchor in the
  document"*, and the reveal-on-open behaviour UI-037 built

## Summary

Filed from UI-079's diagnosis, 2026-08-21. UI-079 was filed as a duration-shaped
test hazard — a spec waiting on a decoration with a finite lifetime. It is not.
The agent sent to make the spec sturdier measured it instead and found the spec
was right: **the flash is never drawn.**

`apps/ui/src/reader/useReaderSurface.ts:255-275` retries the reveal
`REVEAL_RETRIES × REVEAL_RETRY_MS` = 5 × 80ms ≈ **320ms** from the moment
`hasContent` goes true, then calls `revealedCallback` — spending the navigation
instruction — **whether or not anything was drawn**.

The comment above it says so deliberately: *"Giving up counts as honouring it"*,
which is right for a quote the document no longer contains. But it does not
distinguish **"not there"** from **"not there yet"**, and on a cold open the
editor is still mounting its own DOM.

So "open this document **at this**" opens the document at the top, draws no
flash, and forgets what it was for — with no signal to the user and nothing left
to retry from.

## Measured, not inferred

`reveal.spec.ts --workers=8 --repeat-each=20`: **9 failed of 360 (2.5%)**, no
synthetic load, on a 2026 laptop. **~19%** with four cores otherwise busy.
Failures hit 7 of 18 tests, all in the seeded cold-open describes; the
todo-click describe, which reveals into an already-mounted reader, never failed.

Three agreeing lines of evidence:

- `reveal.spec.ts:189`'s bare `toHaveCount(1)` failed with `14 × locator
  resolved to 0 elements` over 5s
- an in-page rAF sampler alive for 9.4s recorded `drawn=false` on every failure
  while `items=3` and `stored=reveal-consumed` — the instruction was spent
- uncontended, the same probe draws at t=843ms and removes at ~2000ms. Under
  load one PASS drew at **t=4325ms**, thirteen times the budget.

## Why this is P0 and in this release

UI-063 is this release's headline surface and its central act is *selecting an
anchored row reveals it at its anchor*. That act runs through this seam. A
comments list whose rows lead nowhere on one open in forty — one in five on a
loaded machine — has not shipped the thing the release is named for.

## What to build

Two things are worth deciding together, and the issue does not pre-decide them:

1. **Should the budget be frames rather than milliseconds?** A loaded machine
   has fewer frames per second, which is exactly when a millisecond budget
   shortens in real terms. The current budget is at its weakest precisely when
   the work is slowest.
2. **Should spending the instruction be conditional on having drawn something?**
   Giving up must stay possible — a quote the document no longer contains must
   not retry forever — but "not there" and "not there yet" need telling apart.

Whatever is chosen, a reveal that gives up should not do so silently: a person
who asked to be taken somewhere and was not is owed something.

## Acceptance Criteria

- [x] A cold open with a reveal target draws its flash under contention, not
      only on an idle machine — **the seeded cold-open describes, which carried
      all 9 baseline failures, go 200/200 at the same rig**
- [~] `reveal.spec.ts --workers=8 --repeat-each=20` passes 360/360, run with
      other cores loaded — the same rig that measured the defect. **Met once
      (360/360, 6.5 min, 09:31) and then blocked by a concurrent regression in
      `apps/ui/src/reader/**` that is not this issue's — see the log's
      "What is still red, and whose it is"**
- [x] A reveal target the document genuinely no longer contains still gives up,
      and does not retry forever — `revealPatience`'s `absent` verdict, and the
      `REVEAL_WAIT_MS` ceiling behind it
- [x] Giving up is not silent — `revealMissNotice`, raised through `useToast`
- [x] The instruction is not spent on a reveal that drew nothing, or if it is,
      the reason is written down where the next reader will find it — **it is
      spent, and Decision 2 below records why**
- [x] `reveal.spec.ts` is **not** made sturdier to accommodate the fix — UI-079
      declined to do that deliberately, and it is the only alarm on this surface
      — **the file is byte-for-byte unchanged: no assertion added, none
      weakened, no timeout touched**

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/useReaderSurface.ts` — the retry budget and the callback
- `apps/ui/src/reader/reveal.ts` — the budget constants

### Notes

UI-079's log holds the full measurement rig and should be read before
re-measuring anything: the per-frame sampler, the load generator, and the exact
`--repeat-each` invocation are all recorded there.

## Testing Strategy

The defect is a race that fires on one open in forty, so a single green run
proves nothing. Use UI-079's rig: `--workers=8 --repeat-each=20` with cores
loaded, before and after.

## E2E Verification Plan

1. Reproduce at the measured rate before touching anything
2. Fix
3. Re-run the same rig and report the rate, not a pass/fail

## The two decisions

### Decision 1 — the budget is counted in **both** units, because it is two budgets

**Chosen.** The give-up budget is `REVEAL_QUIET_FRAMES = 20` **frames**. The
ceiling behind it is `REVEAL_WAIT_MS = DISCOVERY_BUDGET_MS + 2000` = 4000
**milliseconds**. They are different units because they measure different
things.

- The quiet budget asks *"how many chances has the renderer had to change this
  surface?"*, and a frame is exactly one such chance. Counting that in
  milliseconds counts time the renderer may never have been given.
- The ceiling asks *"how long may a person be kept waiting?"*, which no number
  of frames answers — a hidden tab paints none, so a frame ceiling would never
  expire there.

**The premise the issue offered was measured and did not hold.** The issue
reasoned that a loaded machine has fewer frames per second, so a millisecond
budget shortens in real terms exactly when the work is slowest. At the load that
reproduces the defect that is **not what happens**: an in-page `rAF` sampler
recorded **58 fps on the failing runs and 56 fps on the idle ones** (1166 ticks /
20088 ms against 394 / 7039). Frames were not scarce. What was late was the
*work* — plugin discovery — while `rAF` kept ticking at full rate. So a frame
budget of N and a millisecond budget of N×16 would have behaved identically here,
and switching units alone would have fixed nothing.

**Rejected: keep one millisecond ladder and lengthen it.** It is a guess
calibrated to one laptop — simultaneously too long on an idle machine, where a
genuinely-missing quote burns the whole budget walking a document, and still
arbitrary under load heavier than the load it was tuned on. It also keeps
re-walking the document during a stall, which is the worst moment to add work.

**Rejected: count everything in frames.** The ceiling would then never expire in
a background tab, so a reveal could sit pending for as long as the tab stayed
hidden.

The unit was never the fix. **Decision 2 was.**

### Decision 2 — spending the instruction stays unconditional, and the give-up condition changes instead

**Chosen.** The instruction is spent in every terminal case — drawn, `absent`,
or `unresolved`. What changed is *when a reveal is allowed to reach a terminal
case at all*: it may no longer conclude "absent" from a surface that has told it
nothing.

`revealPatience` (in `reveal.ts`) reads the surface once per frame and:

- **has not changed since the reveal started** → say nothing, keep looking. This
  is the `Loading…` gap, and it is *not there yet*.
- **changed once and has now been still for `REVEAL_QUIET_FRAMES`** → the
  surface finished arriving, and a search that found nothing is evidence. This
  is *not there*, and it is how a quote the document genuinely no longer
  contains still stops being asked for.
- **`REVEAL_WAIT_MS` elapsed either way** → the ceiling, so a surface that never
  settles terminates rather than searching forever.

**Why the instruction is still spent when nothing was drawn** — the reason the
issue asked to have written down where the next reader will find it, and it is
in `useReaderSurface.ts`'s effect comment too. A reveal lives on the navigation
entry, in `localStorage`. Leaving one pending does not buy a retry: it makes
Back and a reload silently re-attempt a reveal that has already failed, against
a document that has moved on further, with nothing in between that would make
the next attempt different. Keeping it looks kinder than it is. What replaces it
is an account rather than a retry.

**Rejected: hold the instruction when nothing was drawn.** Above.

**Rejected: hold it only in the `unresolved` case** (surface never settled) and
spend it in the `absent` case. Two terminal states with two different storage
behaviours, for a case the fix makes vanishingly rare, and it still leaves a
half-state on the entry that only a reload could clear.

### Giving up is not silent

`revealMissNotice` builds the notice and `useReaderSurface` raises it through
`useToast`, so it lands in the toast stack *and* in the session's Notices tab.
Two reasons, two messages, two tones, because they are two different facts:

- `absent` → `“Book the passport appointment” is no longer on this document.`
  (`info` — the document moved on, which is ordinary.)
- `unresolved` → `Could not show “…” — the document did not finish loading.`
  (`error` — this session failed at something it was asked to do, and that is
  worth the marker on the console.)

A conversation is named as `that conversation` rather than by its id, which is a
key and not a name.

## E2E Verification Log

Implemented on: **opus** — Opus 5 (1M context) (`claude-opus-5[1m]`), ui-dev.

Invocation throughout: `CORPUS_UI_PORT=5773`, no `CORPUS_SERVER_ORIGIN`
(INFRA-028 — the suite cannot reach a workspace server at all). Port 8765 never
touched. UI-079's rig reused verbatim: `reveal.spec.ts --workers=8
--repeat-each=20`, no synthetic load, on the same 2026 laptop.

### 1. Reproduced first, at the measured rate

`reveal.spec.ts --workers=8 --repeat-each=20` → **9 failed, 351 passed, 336.5 s**
(2.5%). That is UI-079's number to the test: 9 of 360, ~5m 20s. All nine in the
seeded cold-open describes, none in `a click on a todo item`.

### 2. What the gap actually is — the probe corrected the diagnosis

UI-079's diagnosis said "on a cold open the editor is still mounting its own
DOM". A per-frame in-page sampler (`zz-ui140-probe.spec.ts`, deleted; nothing of
it remains in `apps/ui/e2e/`) recording every change to
`.reader-scroll`'s text length, `.ProseMirror` count and `.reveal-flash` count
says otherwise. Every timeline has the same three states:

```
FAIL  t2:len0/pm0/n0/b0   t6895:len8/pm0/n0/b0   t8628:len1774/pm1/n1/b0
PASS  t2:len0/pm0/n0/b0   t826:len8/pm0/n0/b0    t968:len1774/pm1/n1/b0  t1008:…/b1
```

`len8` with `pm0` is **`Loading…`** — `DocView.tsx:415`'s
`doc === undefined || discovery === "pending"` branch. It is not the editor
mounting. It is **plugin discovery**, and while it is pending the reader shows
eight characters and no document at all.

The gap from placeholder to rendered body, measured:

| condition | placeholder → body |
| --- | --- |
| idle | 142–181 ms |
| 8 workers, passing runs | 256–694 ms |
| 8 workers, **failing** runs | **1067–1733 ms** |

The budget it had to beat was `REVEAL_RETRIES × REVEAL_RETRY_MS` ≈ 320 ms. Every
failure is a gap longer than 320 ms and every pass is a gap shorter. That is the
whole defect, and it is why no surface heuristic based on "has the surface gone
quiet" could work on its own: **during that gap the surface is perfectly still.**

**One hypothesis checked and discarded**, so nobody re-derives it: StrictMode's
double-invoked effect does *not* kill the retry ladder. Instrumenting the ladder
in a real browser recorded `attempts=2,3,4` — the double-invoke happens on mount,
and the reveal effect first becomes active later, when `hasContent` flips. The
ladder is used in full.

### 3. After the fix, the same rig

| run | result | notes |
| --- | --- | --- |
| baseline | **9 / 360 failed** (2.5%), 336 s | the number to beat |
| after, item branch | **1 / 360 failed**, 343 s | `:565`, geometry |
| after, item branch | **1 / 360 failed**, 444 s | `:367`, thread reveal |
| after, item branch | **0 / 360 failed**, 6.5 min | clean |
| targeted, `-g "is one-shot too\|reveals the first of the duplicates"` | **1 / 80 failed** | `.thread-card.flash` never appeared |

The 1-in-80 residual was **the same defect one request over**, and it is fixed
too. `jumpToThread` fired the instant the *document* had content, but
`reader.threads` is a second request: `rows.current` was empty, no row matched,
nothing expanded, and the instruction was spent — `useReaderDoc`'s
`threadsSettled` comment already says an empty list reads the same whether the
document has no conversations or the list has not landed. Both destinations now
climb the same ladder, and the settled flag is part of what the thread reveal
*reads* rather than something beside it.

After the thread fix, on the describes that carried **all nine** baseline
failures:

```
reveal.spec.ts -g "an open that names" --workers=8 --repeat-each=20
→ 200 passed (5.3 min)
```

**200 / 200**, against 9 / 200 at baseline in exactly those tests.

Repeated once more at the end of the session, after the last edit and after
waiting out a *second* agent's concurrent Playwright run (`--workers=3`, which
had cost an intervening run 11 failures and four minutes purely to contention):
**199 / 200, 5.8 min**. The single failure is `:189`'s
`expect(scrolled).toBeGreaterThan(0)` — `scrollTop === 0`, the signature of the
concurrent regression below. Its `.reveal-flash` count assertion, on line 193,
**passed**: the flash was drawn. Drawing the flash is what this issue owns, and
it drew.

### 4. What is still red, and whose it is

A **concurrent regression landed in `apps/ui/src/reader/**` mid-session** and it
is not this issue's. Two facts establish that:

- At 09:31 the full rig ran **360 / 360** with this fix in. The regression
  appeared afterwards. One later run captured the cause on the way in:
  `[WebServer] [vite] Internal server error: apps/ui/src/reader/Reader.tsx:
  Expected corresponding JSX closing tag for <DocWidthContext.Provider>` — a
  half-saved file being served to the browser.
- **A/B, with this issue's two files reverted to their original contents**:
  `reveal.spec.ts -g "opens its document scrolled to that line|spends the
  instruction" --repeat-each=5` → **10 / 10 failed**, identically. And
  `-g "expands and flashes the thread|is one-shot too" --repeat-each=20` → **3 /
  40 failed** with the fix and **3 / 40 failed** without it, the same rate either
  way.

The symptom, for whoever owns it: **on a todos-column item click the reader
opens but never scrolls** — `.reader-scroll`'s `scrollTop` stays `0`, and the
flash box reads 584 px (and sometimes 28.9 px) from the line it should be on. It
is deterministic, 20/20, not a race. `apps/ui/src/reader/DocWidthContext.tsx` and
`Reader.tsx`'s new `useDocWidthSurface` / `DocWidthContext.Provider` are the
untested suspects — a layout effect that re-applies a measure after the reveal
has scrolled would produce exactly this. **Escalated rather than touched**, per
the file-ownership constraint.

The full-rig number cannot reach 360/360 while that is live: the last full run
was **50 / 360 failed, and 46 of the 50 are in `a click on a todo item`**, the
describe the A/B proves is broken without this change.

### 5. Unit verification, and the falsification of it

- `apps/ui/src` — **3310 passed, 154 files**, `VITEST_MAX_THREADS=4`.
- `tsc --noEmit -p apps/ui` — clean. `eslint` — clean, no rule disabled.
  `prettier --check` — clean.
- **Falsified, twice**, because a test that cannot fail proves nothing:
  - Removing the `arrived` guard from `revealPatience` — which restores the old
    rule, a budget that runs from the start — turns **3 tests red**: `keeps
    looking, past any millisecond budget, while the surface has not moved`,
    `does not give up on a surface that has told it nothing`, and `draws the
    flash when the body arrives long after that budget`.
  - Making the thread branch jump unconditionally — the old rule — turns **2
    tests red**: `waits for the list rather than spending the instruction on an
    empty one` and `gives up, and says so, once the list has answered without
    it`.

### 6. `reveal.spec.ts` was not touched

Not one assertion added, not one weakened, no `timeout` raised, `REVEAL_FLASH_MS`
unchanged. UI-079 refused to harden it because it is this surface's only alarm,
and the refusal held: the alarm is what measured the before and the after.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 5 new unit tests in `useReaderSurface.test.tsx`,
      14 in `reveal.test.ts`; both new mechanisms falsified against the old rule
- [x] `/lint` passes — eslint, prettier and `tsc --noEmit` all clean
- [x] E2E verification log filled in with concrete evidence, before and after
- [x] Self-review
- [x] Acceptance criteria verified — one marked `~`, blocked by a concurrent
      regression in files this issue may not touch, with the A/B that proves it
