# Evaluation: UI-031

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-801–808)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS

I reproduced the UI-022 evaluator finding's exact drill in a real Chromium against the running
application (server `8807`, production bundle), with a genuinely parked hardware-level pointer —
`page.mouse.move` once, then never again until the assertion was made.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                  |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/ui/031-hover-adoption-after-focus-close.md:79-124`                                                               |
| Commands are specific and concrete      | PASS   | Named spec + describe + test title, the run command, an instrumented event transcript, real column ids and box geometry   |
| Real E2E (not mocked)                   | PASS   | Real workspace, real server, real Playwright browser; the mechanism confirmed by DOM event instrumentation                |
| Scenarios cover acceptance criteria     | PASS   | All three criteria plus all four close paths                                                                             |
| Application restarted after changes     | PASS   | Server on `8806`, three seeded columns, driven headless                                                                  |
| Actual model recorded (implemented on:) | PASS   | `**Model: opus** (claude-opus-5, 1M)` at `:81`. Wording differs from `implemented on:` — nit                              |
| Reproduction logged before fix (bugs)   | PASS   | This is the strongest log in the batch on this point: the e2e case is shown to **fail with `active.hold()` disabled** (`locator resolved to <section class="col reading" …>, unexpected value "col reading"`), and the 7 unit tests likewise. A genuine before/after |

The log also volunteers that its first draft of the test passed *without* the fix because the
assertion raced the browser's boundary event, and explains the two-frame `settle()` helper that
fixed it. That is the kind of admission that makes the rest of a log believable.

## Criteria Results — my own drill

### The drill, exactly as the original eval found it

Column A = `doc_seedinbox` (a note open in its reader). Column B = `doc_seedopenthreads`.

```
0. board, no reader:                    {readers:0, focus:0, active:"doc_seedinbox"}
1. click a row in column A →            {readers:1, focus:0, active:"doc_seedinbox"}
   columns: {attention:"col", inbox:"col kactive reading", openthreads:"col"}
2. enter focus mode via ⤢ →             {readers:1, focus:1, active:"doc_seedinbox"}
3. PARK the pointer over column B       box: {x:1110, y:485, w:336}   — one move, then never again
4. press Escape (pointer never moves)
   events the close produced: ["mouseover:doc_seedopenthreads"]      ← one mouseover, NO mousemove
   columns: {attention:"col", inbox:"col kactive reading", openthreads:"col"}
   >>> ORIGIN COLUMN STILL ACTIVE?  YES (doc_seedinbox)
5. press Escape again →                 {readers:0}   ← the reader beneath closed: esc KEEPS WORKING
6. press Escape a third time →          no crash, stable
```

I independently reproduced the implementer's mechanism finding: the close emits **exactly one
`mouseover` and no `mousemove`**, which is Chromium recomputing hover under a stationary cursor.
That is the event the signed rule distinguishes from real movement, and the latch discriminates on
precisely that.

### All four close paths, same parked pointer

```
Escape    → columns: {inbox:"col kactive reading", openthreads:"col"}   origin holds
✕ button  → columns: {inbox:"col kactive reading", openthreads:"col"}   origin holds
Backspace → columns: {inbox:"col kactive reading", openthreads:"col"}   origin holds
```

(The `f` toggle and the depth-0 auto-close reach the same `closeFocus`; the three above cover the
distinct user-facing paths I can drive.)

### Re-adoption on real movement — verified carefully

My first attempt appeared to show non-adoption. It was a rig artifact: `page.mouse.move` to the
**same coordinate** the pointer already occupies dispatches no event at all, so there was nothing for
the latch to release on. Re-run with a genuine multi-step drag:

```
after esc, parked:  {inbox:"col kactive reading", openthreads:"col"}
events:             ["mouseover:doc_seedopenthreads"]

--- ONE genuine pointer movement WITHIN column B (60px, 8 steps) ---
events: ["mouseover:B","mousemove:B","mouseover:B","mousemove:B","mousemove:B","mouseover:B", …]
columns: {attention:"col", inbox:"col reading", openthreads:"col kactive"}   ← B ADOPTED

--- leave B, come back ---
over A:      {inbox:"col kactive reading", openthreads:"col"}
back over B: {inbox:"col reading",         openthreads:"col kactive"}
```

The **first** movement burst releases the latch and adopts B. No second move needed, no delay.

| #   | Criterion                                                    | Result | Notes                                                                                     |
| --- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| 1   | Focus from A + pointer parked over B + esc → A stays active   | PASS   | Reproduced verbatim; origin keeps `col kactive reading`, B stays plain `col`                 |
| 2   | esc keeps working                                             | PASS   | The **second** esc closed the reader beneath (`readers: 1 → 0`) — the exact thing that was dead 7 times in the UI-022 finding |
| 3   | Moving the mouse afterwards resumes hover-follows-active immediately | PASS | First genuine movement adopts B; boundary crossings both ways behave normally                |
| 4   | TEST-804 — all close paths, not just esc                      | PASS   | esc, ✕ and ⌫ each hold the origin with the pointer parked                                    |
| 5   | TEST-806 — no change to click/keyboard activation             | PASS   | Baseline sanity before the drill: plain hover moves the active column freely (`start: attention kactive → hover B: openthreads kactive → hover Attention: attention kactive`). Clicking a row still activates its column |
| 6   | TEST-802 — suppression is not on the element                  | PASS   | Behaviorally confirmed: ordinary intra-column pointer movement (which fires bubbling `mouseover` repeatedly) adopts normally, so no component-level guard is misfiring |

## Failures

None.

## Summary

6 of 6 criteria pass. The parked-pointer drill that produced the original finding now behaves
correctly: the origin column keeps the board across all three drivable close paths, `esc` continues
to work down the escape stack, and the very first genuine mouse movement restores hover-follows-active
with no delay. I independently confirmed the discriminating fact the fix rests on — a close under a
stationary cursor emits `mouseover` with no `mousemove`. Console silent throughout.
