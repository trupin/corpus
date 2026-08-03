# Evaluation: UI-034

**Date**: 2026-08-02
**Sprint**: sprint-023
**Verdict**: PASS

## Test environment

Real tool from source, built with `npm run build`, run as
`node apps/cli/dist/bin/corpus.js`. Real workspace created with `corpus init` at
an explicit `/tmp/eval-dogfood` (never cwd-derived), real server on **:8791**
(8765 and 5173 untouched), **real built UI served by the server itself** at
`http://127.0.0.1:8791/` — no Vite dev server, no `stubCorpus`, no route mocks.
Driven with a real headless Chromium (Playwright API, not the repo's spec
suite). Geometry read with `getBoundingClientRect` / `Range.getClientRects` and
`getComputedStyle` — measured, not eyeballed.

Fixtures (real documents, created through the real CLI):
`doc_eo25lael` "List rendering probe" (task list with a 3-line wrapping item, a
plain `ul`, an `ol`), `doc_hqjyzfzq` "Nested task list probe", `th_nl27avkz` a
thread turn carrying a task list (exercises the `MarkdownView` shape).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                             |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, not placeholder.                                                                                                                                          |
| Commands are specific and concrete      | PASS   | Named selectors, named ports, named screenshot paths, and a numeric geometry table (`checkbox x=33 y=331.95 …`) of the kind only a real measurement produces.      |
| Real E2E (not mocked)                   | PASS   | Real Chromium against a real Vite server; the DOM shapes it reports (`ul[data-type="taskList"] > li > label > input`, `ul.contains-task-list > li.task-list-item`) match what I independently measured on the production build. |
| Scenarios cover acceptance criteria     | PASS   | All five criteria addressed; AC 3's second half (done treatment) is explicitly reasoned rather than asserted.                                                      |
| Application restarted after changes     | PASS   | Log records a pre-fix reproduction and a post-fix re-run on the same server, plus a re-screenshot after the second defect fix.                                     |
| Actual model recorded (implemented on:) | PASS   | "**Model: Opus 5 (1M context)** — ui-dev, 2026-08-02".                                                                                                            |
| Reproduction logged before fix (bugs)   | PASS   | §2: every UI-034 rule neutralised via `addStyleTag`, screenshot `/tmp/ui034-unfixed.png` showing the `•` marker and the stacked checkbox.                          |

The log is unusually credible: it reports the Technical Design's proposed
selector (`li[data-type="taskItem"]`) **did not exist** on screen, and two
defects the agent introduced and then caught by measuring. I independently
confirmed the corrected shape — the item really does carry no `data-type` and
is addressable only as `ul[data-type="taskList"] > li`.

## Criteria Results

| #   | Criterion                                                       | Result | Notes                                                                                                       |
| --- | --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | Task-list items show no list bullet                             | PASS   | `ul[data-type=taskList]` computes `list-style-type: none`, `padding-left: 0px`; `li` computes `none`.        |
| 2   | Checkbox inline with first line, baseline-aligned; wrapped lines indent under the text | PASS   | Measured in three surfaces; wrapped lines start at the same x as line 1 in the editor shape.                 |
| 3   | Done items keep existing done treatment; spacing consistent with ordinary list items | PASS   | Inter-item gap 10.0px for task items and 10.0px for the plain `ul` in the same document. See note below.    |
| 4   | Applies identically in column reader, full-screen focus, and while editing | PASS   | Same computed values and same line-box relations in all three; verified live by typing into a task item.     |
| 5   | Ordinary bulleted/numbered lists visually unchanged             | PASS   | Plain `ul` still `disc`/`22px`, `ol` still `decimal`/`22px`, in every surface tested.                        |

## Evidence

### AC 1 — no marker (column reader, production build)

```
ul[data-type="taskList"]  listStyleType=none    paddingLeft=0px
ul (plain, same document) listStyleType=disc    paddingLeft=22px
ol (same document)        listStyleType=decimal paddingLeft=22px
li (task)                 display=flex  listStyleType=none  ::marker content=normal
```

The plain list two blocks below still computes `disc`, so the rule is scoped and
does not leak.

### AC 2 — inline + hanging indent, measured

Column reader, the 3-line wrapping task item:

```
checkbox     x=15    y=278.4  w=13  h=13   (bottom 291.4)
text line 1  x=36    y=275.4  h=21         (spans 275.4 – 296.4)
text line 2  x=36    y=299.7  h=21
text line 3  x=36    y=324.0  h=21
```

The checkbox's vertical span (278.4–291.4) lies **inside** line 1's box, and its
right edge (28) is left of the text (36) — inline, not stacked. Lines 2 and 3
begin at **36**, identical to line 1 and 21px right of the checkbox — under the
text, not under the box. Baseline: the box bottom (291.4) lands within ~1.4px of
line 1's baseline (≈290 for 15px text on a 21px line box).

Full-screen focus, same document, wider measure — same relations at a different
wrap point:

```
checkbox     x=426.9  y=214.3  bottom=227.3
text lines   x=447.9  y=210.3 / 238.3 / 266.4
```

Nested task lists (`doc_hqjyzfzq`) hold too: nested checkbox x=36, nested text
x=57, nested wrapped line x=57.

`MarkdownView` shape (a task list inside a rendered thread turn) is a **different
DOM entirely** — `ul.contains-task-list > li.task-list-item > input` — and is
styled separately with a hanging indent (`padding-left: 21px`,
`text-indent: -21px`): checkbox x=32, first line x=57.2, wrapped lines x=53. The
4.2px difference between the first line's text and the continuation lines is the
checkbox's inline advance width; the continuation lines are 21px right of the
checkbox and within 1px of the plain list's text (x=54) in the same turn, so the
criterion's actual requirement — *under the text, not under the checkbox* — holds,
and the screenshot shows no perceptible step.

### AC 3 — spacing

```
task list   li margin 10px;  item1.bottom 347.3 → item2.top 357.3  = 10.0px gap
plain list  li margin  4px;  item1.bottom 533.1 → item2.top 543.1  = 10.0px gap
text left edge: task 36, plain 37  (1px apart)
```

Identical rhythm and a single reading margin, as required.

**Done treatment**: measured on the done item in the document body —
`text-decoration-line: none`, `opacity: 1`, `color: rgb(29,33,38)` — identical to
open items; the only done signal is the checked checkbox itself, which renders.
The criterion is conditional ("keep **any existing** done treatment") and the
document body carries none to keep; the plugin's own surfaces, which do have one,
still show it (the board's todo row still strikes "Order the replacement filter"
through, and the PLUGINS-008 legacy notice strikes "Send the signed form"
through). Nothing was removed. PASS on the criterion as written; flagged here
because a reader who wants a done treatment in the body will not find one.

### AC 4 — reader, focus, and editing

The reader **is** the contenteditable (`.reader [contenteditable="true"]` →
`true`; the focus overlay header reads "click anywhere to edit"), so the
screenshotted surface is the editing surface. I placed a caret at the end of a
task item and typed 137 characters live:

- during and after the edit the same rules hold: `listStyleType: none`,
  `display: flex`, checkbox x=426.9, text lines x=447.9 / 447.9 (the item now
  wraps to two lines — the new line lands at the text indent, not the checkbox)
- the edit persisted to disk:
  `data/docs/inbox/list-rendering-probe.md:18` now reads
  `- [ ] Short one — typed live while editing, long enough that the item must wrap onto a second and third line to prove the hanging indent survives an edit`

The CSS also does not block interaction: clicking a body checkbox in the reader
issued `POST /api/locks/<id>` + `PUT /api/docs/<id>` and flipped the on-disk line
to `- [x]`.

Screenshots: `/tmp/eval-dogfood/shots/10-reader-tasklist.png`,
`11-focus-tasklist.png`, `12-editing.png`, `13-turn-tasklist.png`,
`20-nested.png`.

### AC 5 — ordinary lists

Plain `ul` `disc`/22px and `ol` `decimal`/22px in the column reader, in
full-screen focus, and in a rendered turn; markers visible in every screenshot;
`::marker` content unchanged. No task-list rule reaches them.

## Failures

None.

## Subjective quality (task-list rendering)

- Design quality **4** — the task list reads as the same typographic system as
  the surrounding prose; the checkbox is a restrained 13px box on the text
  baseline rather than a widget.
- Originality **3** — a conventional, correct treatment; the deliberate choice is
  the alignment discipline, not a distinctive look.
- Craft **4** — measured alignment holds across three DOM shapes, two surfaces
  and a live edit; one 4.2px first-line/continuation offset in the
  `MarkdownView` shape is the only imprecision found.
- Functionality **5** — checkboxes remain clickable and write through; nothing
  about the styling costs an affordance.

Average 4.0, no score of 1.

## Observations (not failures, outside this issue's criteria)

A list that mixes a plain bullet and a task item (`- plain bullet` followed by
`- [ ] task item`) is normalised by the editor schema into a single task list,
giving the plain bullet a checkbox. That is markdown-schema/TipTap parsing
behaviour, not presentation, and is outside UI-034's criteria — filed here only
so it is not mistaken for a styling bug later.

## Summary

**5 of 5 criteria passed.** The bullet is gone, the checkbox is on the first
text line, wrapped lines hang under the text, plain lists are untouched, and all
of it holds in the column reader, in full-screen focus, while editing, and in the
separate `MarkdownView` DOM shape — verified against the production build served
by the real server, with measured geometry rather than screenshots alone.
