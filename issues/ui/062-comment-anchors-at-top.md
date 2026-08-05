# [UI-062] A document comment sometimes anchors at the very top instead of at the selection

## Domain
ui

## Priority
P1

## Status
done

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring (text-quote selectors, the resolution ladder)
- SPEC.md §11 Document view — "Adaptive thread placement… aligned to their
  anchors with connectors"

## Summary
Live report 2026-08-03, with a screenshot: commenting on a selection in a
document sometimes produces a thread card pinned at the **top** of the document
rather than beside the text that was selected.

**The screenshot carries the strongest clue.** The card's quote reads:

```
Moushmi Verma** on repositioning Fernando under Mesbah
```

Note the `**` in the middle. That is raw markdown, and it means the selection
began **inside** a bold run — the user dragged from `Moushmi` (which sits inside
`**Moushmi Verma**`) through to `Mesbah`, so the file's literal slice from that
start offset carries the closing `**`.

**That part is by design, and is probably not the bug.**
`selectorFromSelection.ts` deliberately quotes the markdown source rather than
the screen: "a selection reading `30-year fixed quote` on screen is
`**30-year fixed** quote` in the file, and the server's resolution ladder matches
literally before it matches anything else." A tidier quote would be a quote of a
document that does not exist.

So the capture is plausibly correct and the failure is in **drawing it back** —
the anchor is a legitimate slice of the file, but one whose range starts partway
through inline markup, and something on the placement path cannot express that.

## Reproduce first — this is a bug, and the cause below is a hypothesis
Do not start from the code. Get it failing in the real app, with the workspace
document, and record the evidence in this log:
1. The document's markdown around the anchor (the actual bytes, including the
   `**`).
2. The selector the UI sent on the wire — `exact`, `prefix`, `suffix`.
3. What the server resolved it to: the `range` and whether it came back
   `orphaned`.
4. Where the card was drawn, and whether a highlight was drawn in the body at
   all.

That sequence distinguishes the two candidate causes without guessing:

- **(a) It resolved, but cannot be placed.** `mdRangeToPm`
  (`apps/ui/src/anchors/offsetMap.ts:101`) returns one segment per textblock and
  an **empty array** when a range touches no content. A range that begins inside
  syntax may yield no usable segment, so no highlight is drawn and the card has
  no anchor position to align to — falling back to the top. If so, the fix is in
  placement, and the question is what an anchor that starts mid-markup should
  align to (the first content it *does* cover, most likely).
- **(b) It did not resolve, and orphan placement is wrong.** SPEC §11 says
  orphaned threads are listed **below the body**, with whole-document comments.
  A card at the top would then be a second defect — orphans going to the wrong
  place — and the anchoring itself would be the first.

They call for different fixes, so establish which before writing code.

## Acceptance Criteria
- [x] Pre-fix reproduction logged with the four pieces of evidence above
- [x] A comment on a selection that starts or ends inside inline markup
      (`**bold**`, `*italic*`, `` `code` ``, a `[link](url)`) anchors beside the
      selected text
- [x] The highlight is drawn over the selected words — and specifically does not
      cover the markup characters the user never saw
- [x] A genuinely orphaned thread still goes where §11 says: below the body, not
      the top
- [x] Whatever the placement rule is for a range that begins mid-markup, it is
      stated in the code — this is the second bug in this class (see UI-060) and
      the rule should stop being rediscovered
- [x] Selections wholly inside one text run keep working exactly as today
- [x] Regression test at the level the bug lives at: a selection whose markdown
      range straddles a markup boundary, asserted end to end rather than only
      over the offset helpers

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/offsetMap.ts` (`mdRangeToPm`), `useAnchorLayer.ts`
  (placement and the no-segment path), possibly the margin-card layout
- tests alongside

### Notes
- Related but distinct: UI-060 is the same *class* of problem (two projections of
  one text disagreeing) in the **thread** path. This one is the **document**
  path, which maps through ProseMirror positions rather than a rendered DOM
  range. Do not fix one by importing the other's assumptions; do check whether
  the two placement rules should agree.
- Do not "fix" this by trimming the markup out of `exact`. That would change what
  the server matches against and is explicitly rejected in
  `selectorFromSelection.ts`'s docblock.

## Testing Strategy
Component/unit tests over the placement path with markup-straddling ranges, plus
an e2e that comments across a bold boundary in the real editor and asserts the
card is aligned to the line rather than the document top.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** Real `corpus init` workspace at
`/tmp/ui062ws`, real server (`corpus server start`, port **8766** — never 8765),
real Vite dev server on **5992** with `CORPUS_SERVER_ORIGIN=127.0.0.1:8766`, real
Chromium driven by Playwright. Selection made as a real DOM range over the live
`.ProseMirror`, comment created through the floating toolbar's 💬 Comment and the
real composer. Wire traffic captured off the browser's own network events.

### Pre-fix reproduction — the four pieces of evidence

Fixture `doc_ui062b` (`data/docs/plain.md`), an ordinary file: frontmatter fence,
**a blank line**, then the body.

1. **The markdown around the anchor** — what `GET /api/docs/doc_ui062b` returned
   as `body`, verbatim:
   ```
   "\n# Plain standup\n\n**Moushmi Verma** on repositioning Fernando under Mesbah — the reporting line changes on Monday.\n\nClosing paragraph…\n"
   ```
   Note the leading `\n`: the blank line after the frontmatter fence is part of
   the body the server stores and returns.
2. **The selector on the wire** — `POST /api/threads`, dragging from inside the
   bold run through `Mesbah`:
   ```json
   {"exact":"Moushmi Verma** on repositioning Fernando under Mesbah",
    "prefix":"# Plain standup\n\n**",
    "suffix":" — the reporting line changes on"}
   ```
   The `**` inside `exact` is correct and by design (`selectorFromSelection`'s
   docblock): the quote is a slice of the file, not of the screen.
3. **What the server resolved it to** — the next `GET /api/docs/doc_ui062b`:
   ```json
   {"anchorId":"anc_5c9e4ed0","threadId":"th_r5m25sq4",
    "range":{"start":20,"end":74},"orphaned":false}
   ```
   **Resolved. Not orphaned.** So this is candidate **(a)**, not (b).
4. **Where the card was drawn, and whether a highlight was drawn at all** — in
   focus mode (`marginMode: true`), read off the live DOM:
   ```
   highlights: []          ← no .anchor-hl anywhere in the body
   pips:       []
   cards: [{ thread:"th_mj4v2hzr", styleTop:"0px",   rectTop: 87.3,
             quote:"“Moushmi Verma** on repositioning Fernando under Mesbah”" },
           { thread:"th_r5m25sq4", styleTop:"333px", rectTop: 420.3, … }]
   detached: []            ← nothing below the body
   ```
   `styleTop: "0px"` — the card pinned to the very top of the document, quote and
   all, exactly the screenshot. The second card is only there because the cascade
   stacked it under the first; with one thread there is one card, at the top.

**Diagnosis.** The anchor resolves, and `mdRangeToPm` is not the culprit: an
exhaustive sweep of **18 325** selections over a canonical markup-rich body
(bold, italic, inline code, links, `[[ref]]`, list, blockquote, fence) produced
**zero** ranges that resolved but yielded no segments — a range beginning inside
markup has always placed correctly. What fails is one rung above:
`offsetsComparable(body, canonical)` is **false**, because the printer does not
re-emit the leading blank line, so every offset in the file is one past where the
editor's own text puts it. `placeAnchors` then forced `segments: []` for *every*
anchor on the document, no highlight was drawn, and `marginLayout.cascade`'s
`anchorTop ?? lastBottom` — `lastBottom` still `0` at collection time — dropped
the card at the top. Same trigger for tables (the printer pads cells), hard
breaks written as two trailing spaces, setext headings and indented code.

The healthy control, same selection, same bold boundary, on a byte-canonical file
(`doc_ui062c`): highlight drawn as **two** spans, `"Moushmi Verma"` and
`" on repositioning Fernando under Mesbah"` (the `**` between them has no
position, so it is inside neither), pip drawn, card at `top: 211.3` against an
anchor at `211.1`. Nothing about inline markup was ever broken.

### Post-fix verification, same app, same flow

`doc_ui062b` (leading blank line), identical selection:
```
highlights: "Moushmi Verma" @211 / " on repositioning Fernando under Mesbah" @211
pips:       one per thread
cards:      th_gemn6zxh styleTop:"122px" rectTop: 209.3  ← anchor top 209.1
```
No card at `0px`; no `*` inside any highlight span.

`doc_ui062a` (the table fixture, where the padded `prefix` also stops the
server's rung 1 and it resolves on rung 2 instead): highlight drawn below the
table at `374.9`, card at `375.3`.

### Gates

- `apps/ui` unit suite: **2053 passed / 128 files** (`vitest run src`).
- `apps/ui/e2e/anchor-layer.spec.ts`: **9 passed** (7 existing + 2 new), real
  Vite dev server on `CORPUS_UI_PORT=5993`.
- Pre-fix red, recorded by reverting the two behaviour changes and re-running:
  **8 unit tests** red (5 in `anchorPlacement.test.ts`, 3 in
  `marginLayout.test.ts`) and **both new e2e tests** red — the first on
  `.anchor-hl` count `0` instead of `2`, the second timing out waiting for the
  aligned card.
- `npx eslint … --max-warnings 0`, `npx prettier --check`, `npx tsc --noEmit`
  over the touched files: clean.

### Processes

Workspace server on 8766 and Vite on 5992/5993 were started for this run and
stopped afterwards; ports 8765 and 5173 were never touched.

---

### PR #21 review follow-up (2026-08-04)

**Model: Opus 5 (1M context)**, ui-dev agent. One MINOR finding: `rebase.ts`'s
docblock said the round trip "is arithmetic rather than a search", which is true
of the *offsets* and overstates the *result*.

The reviewer's reading is confirmed. Plain-text equality licenses the offsets and
says nothing about granularity: `sourceTrace.ts` marks a run **atomic** when its
markdown and its text differ character for character, and a partial hit inside an
atomic run quotes the whole run. Escaping puts a run on one side of that line and
not the other, so a range travelling through one comes back **widened to the
run** — a superset of the true range, never disjoint from it, and never wider
than the runs it overlapped.

No behaviour was changed. The docblock now states the widening and its bound, and
`rebase.test.ts` pins it with two tests (the widening, and the same paragraph
without the escape staying exact).

#### Real-app confirmation
Same harness as above, fresh: `corpus init /tmp/corpus-ui21` (server on **8766**),
Vite on **5999**, real Chromium. Document created through the CLI with the body

```
We assume a 30-year fixed at 6.1% and 5 \* 3 is fifteen.
```

— the ordinary shape of a file written by a defensively-escaping printer, which
our `escape.ts` prints back as a bare `5 * 3` (an asterisk with spaces on both
sides can neither open nor close emphasis). A thread was anchored on the quote
`30-year fixed at 6.1%`. In the reader:

```
highlights: [{ "cls": "anchor-hl", "attr": "anc_0d651085",
               "text": "We assume a 30-year fixed at 6.1% and 5 * 3 is fifteen." }]
```

The highlight covers the **whole paragraph**, not the quoted phrase — the
documented widening, live, and visibly a superset containing the quote rather
than a misplacement. It stops at the paragraph, as the bound says it must.

#### Gates
- `apps/ui` unit suite: **2072 passed**, 0 failed (`VITEST_MAX_THREADS=4`);
  `rebase.test.ts` 13 tests (was 11).
- `npx eslint … --max-warnings 0`, `npx prettier --check`, `npx tsc --noEmit`
  over the touched files: clean.
- Server, Vite and the temp workspace torn down; 5999 and 8766 verified free.
  Ports 8765 and 5173 never touched.

## Completion Checklist (domain agent)
- [x] Pre-fix reproduction logged
- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint, prettier, tsc over the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
