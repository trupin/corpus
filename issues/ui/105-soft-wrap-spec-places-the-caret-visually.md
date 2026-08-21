# [UI-105] `soft-wrap.spec.ts` places the caret at the end of a visual line, and flakes

## Domain

ui

## Status

done — 2026-08-21. **The diagnosis in this issue is wrong**, and the correction
is in the E2E log below: `End` is a text-block command in this editor, measured
against a paragraph that really did wrap. The flake was the focus race, which
UI-103's `caretIn` had already fixed. What shipped removes the spec's unstated
dependency on that keymap and makes the caret's position a checked claim.

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-080 (ten e2e sites sending a key straight after `click()`)

## Spec References

- Not a spec behaviour — a test defect.

## Summary

Diagnosed during UI-103 and deliberately left alone there, since it is unrelated
to that fix and fixing it would have mixed concerns.

`apps/ui/e2e/soft-wrap.spec.ts:193` fails in **2 of 3** full Playwright runs and
**0 of 24** in isolation. It positions the caret with `press("End")`, which goes
to the end of the **visual** line rather than the logical one — so under load,
when wrapping settles differently, the typed character lands mid-word
(`offic!e opens later.`).

It cannot be UI-103's serializer change: `separateListItemBlocks` returns
`undefined` for any parent that is not a `listItem`, and the document this spec
uses contains no list.

## Acceptance Criteria

- [x] The caret is placed by a means that does not depend on where the text
      happens to wrap — it is placed by clicking just past the last character's
      own measured box, and no key is pressed at all
- [x] The spec passes under `--repeat-each 4` in a full run, not only in
      isolation — isolation is what hid this
- [x] Check the sibling specs for the same idiom. `press("End")` in a wrapped
      editor is wrong wherever it appears, and UI-080 already records that this
      suite has a family of timing-shaped caret bugs — **audited; see the log.
      No other site is at risk, and the premise itself did not hold.**

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/soft-wrap.spec.ts`.

### Notes

- A flake that only appears under load is the kind that gets re-run rather than
  read. Fix the cause; do not add a retry.

## Testing Strategy

The spec itself, under `--repeat-each 4` in a full run.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real Chromium via Playwright,
`CORPUS_UI_PORT=5873`. Done after UI-066, as instructed, so the caret was
re-checked against a reading measure a person can now change.

### The correction: `End` is not visual here

A scratch probe was written and run against this spec's own document at a column
width narrow enough to wrap it. Measured:

```
geometry  {"height":48.59375,"lineHeight":24.3,"width":234.421875,
           "text":"Tomorrow is a\nWednesday, so the\noffice opens later."}
afterClick remaining  "omorrow is a\nWednesday, so the\noffice opens later."
afterEnd   remaining  ""
```

One paragraph, **two line boxes** (48.59 / 24.3), the caret placed after the
first character of the **first** line, and `End` left **nothing** between the
caret and the end of the paragraph. It crossed the wrap. So the issue's stated
cause — `End` reaching the end of a *visual* line — does not reproduce: it is a
text-block command in this editor.

Confirmed a second way. With the column narrowed so the paragraph wraps, the
`End` idiom restored, and the click aimed explicitly at the first line
(`position: {x: 5, y: 5}`), the spec still wrote `office opens later.!` and
passed — while, in the same run, "is drawn as flowing prose" failed with
`48.59 > 36.45`, proving the paragraph really was on two lines.

**What the flake actually was** is recorded in the spec's own file and was
already fixed before this issue was picked up: the focus race. `click()` returns
before ProseMirror's surface becomes `document.activeElement`, `End` lands on an
unfocused page where Chrome treats it as "scroll", and the next keystroke
inserts wherever the mousedown left the caret. `paragraph.click()` clicks the
box's centre, and the centre of this paragraph is inside "office" — which is
exactly `offic!e`, the reported symptom, and not the end of any line.

### What shipped, and why it is still worth shipping

The spec is not reporting a product defect, and it is no longer fragile, so
neither branch of "reproduce or stop" applied. Two things were still wrong with
it, and both are fixed:

1. **An unstated dependency.** That `End` crosses a wrap is a fact about
   ProseMirror's keymap this spec never stated and could not see change. The
   caret is now placed by clicking 2px past the **last character's own
   `getBoundingClientRect()`** — the browser is asked where the text is rather
   than assumed — so it lands at the end of whatever line that character ended
   up on. No key is pressed.
2. **A silent failure mode.** A caret one character out used to write a
   plausible body that failed an assertion pages later. The helper now asserts,
   before typing, that the range from the selection to the end of the paragraph
   is **empty**, and reports how many characters short it is otherwise.

Nothing about what the spec tests changed: it still types at the end of a
paragraph the file hard-wraps over three source lines, and still asserts the
stored body byte for byte.

### Broken on purpose, and watched to fail

- The click aimed at `box.left - 2` instead of `box.right + 2` (before the last
  glyph rather than after it): the spec went red immediately with
  `Expected: "at the end"` / `Received: "1 short"`, before any character was
  typed. Restored.
- The self-check earned its keep during the work itself: an early version aimed
  at `tail.right + 2` with no clamp and no settle, and reported
  `Received: "outside the paragraph"` — a click that had landed under a
  paragraph the column was still moving. It said so instead of writing a wrong
  body and failing three assertions later.

### A second, real fragility in the same file

Running the whole file at one worker turned up a different flake, in *"is drawn
as flowing prose"*: 2 failures in 8 runs, `height 48.59` where one line is 24.3.
Instrumented rather than guessed at, and the numbers name it:

```
PROBE {"line":24.3,"height":24.296875,"col":399,"body":369}
PROBE {"line":24.3,"height":24.296875,"col":463,"body":433}
PROBE {"line":24.3,"height":24.296875,"col":439,"body":409}
```

The column is still **animating** when the assertion runs — opening a document
widens its column (UI-113) and `.col` transitions that width over 250ms, so it
was measured at 399, 439 and 463 on three runs and never at its settled 560.
The sentence this suite draws is 51 characters, about **367px** of the shipped
serif, and the body crosses 367px in the middle of that animation: measured
before, two line boxes, measured after, one. A knife edge, and nothing to do
with soft wrap.

`openNote` now waits for `.col.reading`'s box to read the same for three
consecutive frames — the browser's own answer to "has it stopped", the same
routine `anchor-layer.spec.ts` uses, with no invented duration. `caretAtEndOf`
settles the paragraph separately, because the column and the paragraph stop
moving at different times.

**This is not a retry and it does not soften what the file tests.** The claim is
"the paragraph is drawn as one line **at the reading measure**", and the reading
measure is not what is on screen mid-animation.

### Repeat-each, and the sibling audit

- `npx playwright test soft-wrap.spec.ts --repeat-each 4 --workers=4` —
  **24 passed** (17.6s), four workers competing for the machine.
- After the column-settle fix, `--repeat-each 4 --workers=1` — **24 passed**
  (40.5s). The run that exposed the second flake was 22 passed / 2 failed.
- Full-suite run: see the run recorded in UI-066's log; this spec is in it.
- **Sibling audit — `press("End")` appears at four sites, and none is at risk:**
  - `edit-session-close.spec.ts:112` — body is `"The first sentence.\n"`, one
    short line that cannot wrap, and the assertion is `toContain`.
  - `reader-head-geometry.spec.ts:240` — bodies are `"Everything about the flat
    lives here."`, `"The rate held."`, `"Notes below."`; all one short line, and
    the assertions are geometric.
  - `query-editor.spec.ts:320` — a single-line query field, not the editor.
  - `key-conflict.spec.ts:56` — `Home`, not `End`.

  They were left alone: the premise that the idiom is "wrong wherever it
  appears" did not survive the measurement, and touching four specs to remove a
  hazard none of them has would be churn.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
