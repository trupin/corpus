# [UI-060] The source trace doesn't reproduce the renderer's block joins, so some turn selections decline

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: —

## Spec References
- SPEC.md §10 Thread view, "Commenting on a selection" (SHARED-009 Amendment 2)

## Summary
Found by the Fable review of PR #20, fixed there only to the extent of making it
**safe**. This issue is the correctness half.

UI-051 maps a DOM selection in a turn back to markdown offsets through two
projections that must agree: `renderedRange.ts` (what the browser draws) and
`sourceTrace.ts` (what the markdown says). They do not agree about whitespace.
`mdast-util-to-hast` writes a `"\n"` text node where two blocks join and beside
a markdown hard break; `walk` emits nothing for either, because no markdown was
consumed there. Measured:

| markdown | DOM text | `trace.plain` |
|---|---|---|
| `para one\n\npara two` | `para one\npara two` | `para onepara two` |
| `- foo\n- bar` | `\nfoo\nbar\n` | `foobar` |
| `line one  \nline two` (markdown hard break) | `line one\nline two` | `line oneline two` |

Closing the joins up can **manufacture an occurrence**: `the\n\nnext hen` renders
with one `hen` and traces with two, the second straddling the join. The capture
counted occurrences in the DOM and looked the index up in the trace, and returned
an anchor over `he\n\n` for a selection of `hen`.

**Shipped in PR #20:** a guard in `captureTurnAnchor` — if the two projections
disagree about how many times the quote appears, the capture **declines**. The
confidently-wrong anchor is gone.

**The cost is larger than this file first claimed** (corrected 2026-08-04 from
the PR #20 re-review, which measured it). The guard's condition is "the two
projections disagree about the count *anywhere in the part*", which is broader
than "this user's occurrence index is untransferable". A turn reading
`hen sleeps. the\n\nnext day` renders one `hen` and traces two, so selecting the
**leading** word — an occurrence the old code resolved correctly — now declines.
And the collision is not as rare as "rare": bullets seldom end in punctuation, so
in list-heavy agent turns a join routinely welds two words into a third
(`…set` + `up…` → `setup`, `…to` + `day…` → `today`), and short double-clicked
quotes are exactly what collides. Occasional, not exotic.

**What is still owed:**
1. Make the projections genuinely agree, so those selections anchor instead of
   declining.
2. **Guard the other direction too.** `renderedRangeOfTurnAnchor` (and
   `domRangeOfTurnAnchor` through it) got no equivalent check, so the same
   disagreement still produces a confidently-wrong result when *painting* an
   existing anchor. Measured in the re-review: a turn `the\n\nnext hen and hen`
   with an anchor over the **first** real `hen` paints the **second** one,
   because the manufactured occurrence inside `thenext` takes index 0. Data is
   untouched and the thread still opens correctly, so it is visual only — but
   anchors created before the capture-side guard exist in the live workspace
   today and hit it. The rationale the guard shipped with ("guessing costs them
   a comment attached to words they did not choose") was applied to one of the
   two directions.

## The trap, stated plainly
The obvious fix — emit `"\n"` for block joins and `break` nodes in `walk` — is
not obviously safe. A **typed** newline in a user turn (UI-054's `hardBreaks`)
already carries the `"\n"` in *both* projections and resolves correctly today;
that is the common case and the one a naive change is most likely to break.
Whatever is done here must keep it working, and the list case above shows the
renderer also emits leading and trailing newlines inside a `ul`, so this is
reproducing a real algorithm rather than adding one separator.

Consider whether the honest shape is for the trace to *derive* its plain text
from the same hast the renderer builds, rather than from a parallel walk of the
mdast — two walks of the same tree is the drift this whole module exists to
prevent, and it is the reason the bug was possible.

## Acceptance Criteria
- [x] The three rows of the table above agree between the two projections
- [x] `the\n\nnext hen` anchors a selection of `hen` to the real `hen`
      (offsets 10–13) — the assertion PR #20 had to weaken to `toBeNull()`
- [x] A typed newline in a user turn still resolves, with `hardBreaks` on and off
      — this is the regression to fear; test it first
- [x] Markdown hard breaks (`  \n` and backslash-newline) resolve
- [x] List items, nested lists and blockquotes resolve
- [x] The disagreement guard stays as a backstop **in both directions** — capture
      and paint — and a test proves each still fires if the projections are ever
      made to disagree again
- [x] `renderedRangeOfTurnAnchor` no longer paints a different occurrence than
      the one the anchor resolved to (the `the\n\nnext hen and hen` case)
- [x] `turnAnchors.test.tsx`'s `the\n\nnext hen` test asserts the **anchor**
      rather than `toBeNull()`, and its comment pointing here is removed

_(Correction, 2026-08-04: an earlier draft of this file said that test had been
"weakened" and should be "restored". It was not — the case did not exist before
PR #20, which added it at +47/−0. Nothing was lost; the new test simply asserts
refusal rather than correctness. Recorded because the wording would have sent
whoever picks this up looking for a revision to restore.)_

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/sourceTrace.ts` (the `walk` / join handling)
- `apps/ui/src/anchors/renderedRange.ts` if the parity is better achieved there
- `apps/ui/src/thread/turnAnchors.ts` (restore the strict path; keep the guard)
- tests in all three

## Testing Strategy
Property-style: for a set of markdown fixtures covering paragraphs, lists,
blockquotes, hard breaks and typed newlines, assert `renderedTextOf(render(md))`
equals `sourceTraceOf(md).plain`. That single assertion is the invariant the
module claims and currently does not hold.

## E2E Verification Log

**Model: Opus 5 (1M context), 2026-08-31.**

### What was built, and why not what this file guessed

This file proposed deriving the trace's plain text "from the same hast the
renderer builds". That is what shipped, with one correction the file could not
have known: **the trace cannot run `MarkdownView`'s remark pipeline.**
`remarkCorpusRefs` and `remarkCorpusStyling` both rebuild the nodes they touch,
and a rebuilt node carries no `position` — a trace built from one loses every
paragraph containing a reference or a styled phrase.

The split that works: the whitespace is **structural**, so the trace runs
`mdast-util-to-hast` over the tree remark positioned (the same conversion
`react-markdown` runs) and reads the inline changes out of the source itself,
which is what it already did for `[[ref]]`. A text node with a position is
addressable; one without is a separator — in `plain`, in neither direction of the
map. That distinction is the library's own: it patches what it derives and
patches nothing it invents.

### Measured before the change, against the real renderer

A probe rendering 25 fixtures through `Turn` and comparing `renderedTextOf` with
`sourceTraceOf().plain`. **Nearly every multi-block body diverged**, not only the
exotic ones — two paragraphs, every list, every blockquote, headings, fences,
thematic breaks, both hard breaks. §5's inline markers diverged too, which is a
v0.28.0 regression this closes: `the ==rate== rose` drew `the rate rose` and
traced `the ==rate== rose`, so every selection in a styled turn declined.

A second probe compared hast text with DOM text over the same fixtures. They
agreed everywhere except three places, and each is now handled or documented:
tables (`hast-util-to-jsx-runtime` drops inter-element whitespace there, because
`react-dom` warns about any of it), `[[ref]]` (the trace's own business), and raw
HTML (left out, deliberately — see below).

### The invariant, as a test

`apps/ui/src/anchors/renderParity.test.tsx` renders **37 fixtures** through the
real `MarkdownView`, with `hardBreaks` on and off, and asserts
`sourceTraceOf(md).plain === renderedTextOf(rendered).text`. 76 assertions. That
single line is what every construct-level claim rests on, and a remark upgrade or
a new plugin turns it red without anyone predicting which construct broke.

Two exceptions are asserted rather than omitted: raw HTML (matching it would mean
drawing `<u>` and `</u>` as text, and those are §5's underline), and a styling
marker split across another inline node. Both fall to the disagreement guard and
decline, which is what they did before.

### A defect the parity test found that nobody had filed

`CorpusImage` draws `🖼 a chart` while an attachment loads and the file name when
it will not. Those are **visible words in the DOM that no character of the file
spells**, so every offset after an image moved for as long as the attachment took
to arrive. Both stand-ins are now chrome in `renderedRange.ts`, next to the
fence's copy button and the ref's resolved title. Found by asking the DOM instead
of reasoning about it.

### Real browser, real selection, real request

`apps/ui/e2e/turn-comment.spec.ts`, Chromium:

```
✓ a selection beside a paragraph join › anchors to the word selected, not to the break beside it
```

The turn is `the⏎⏎next hen`. The rendered paragraphs are `["the", "next hen"]` —
one `hen`. The Comment item is offered at all, which it was not before, and the
posted selector is:

```
exact: "hen"           (asserted not to contain a newline)
```

framed so `prefix + exact + suffix` is present in the thread file byte for byte —
§6's rung 1. Pre-fix this produced `he\n\n`; PR #20 turned that into a refusal;
this is the correctness half.

### Both guards, and the paint side that never had one

`renderedRangeOfTurnAnchor` now runs the same disagreement check as the capture
side. The measured failure it closes: a turn reading `the⏎⏎next hen and hen`,
anchored on the **first** real `hen`, painted the **second** — a phantom
occurrence inside `thenext` took index 0. Data untouched, thread opened
correctly, wrong words highlighted. Anchors written before PR #20's capture guard
exist in live workspaces.

`turnAnchors.test.tsx` pins the paint at rendered offsets 9–12 and pins each
guard still firing, using a raw-HTML block — the case that genuinely still
disagrees.

### What changed in `rebase.ts`, and what it cost

Adding the renderer's whitespace to `plain` broke `rebaseRange`: two spellings of
one document that differ by a blank line render with different joins, so four
UI-099 cases came back `null`. The trace therefore carries **two axes** —
`plain` for anything whose other end is the DOM, `sourced` for anything whose
other end is another spelling of the same file. `rebase.ts` uses `sourced` and is
back to its old behaviour, with one improvement:

- the two-space **continuation indent** under a list item used to make a run
  atomic, so a passage inside it came back widened to
  `Nested bullet two.⏎  A trailing paragraph of the outer item.`; `trim-lines`
  explains that difference now, so it comes back exactly. The escape case still
  widens and its test still passes.
- the **ref edge**, which the module comment has described since PR #21 and
  nothing pinned, is now pinned.

### A refusal that lost its last natural cause

UI-104's largest category — a soft line break inside a code span, 51 of this
repository's own documents — used to produce `REFUSAL_NOTICE["not-in-file"]`. The
trace read the code span's markdown, newline and all; it now reads what the
renderer draws, where a line ending in a code span is a space on both sides. So
the selection maps, widened to the code span, and what goes on the wire is in the
file byte for byte. `useAnchorLayer.test.tsx` asserts the new behaviour, the same
shape UI-103's fix left behind two tests below it.

### Gate

- `renderParity.test.tsx` 76 passed · `sourceTrace.test.ts` 34 passed ·
  `turnAnchors.test.tsx` 22 passed · `rebase.test.ts` 23 passed
- Full unit suite, run alone: **662 files, 16,241 passed** in 337s
- Full browser suite: **671 passed** in 7.7m
- `npm run lint`, `format:check`, `typecheck` clean

### Falsifications

Each broke one fix on purpose and named how many of 248 anchor/thread/menu tests
went red. **Nine for nine.**

| broken | red |
| --- | --- |
| separators dropped | 52 |
| table whitespace kept | 5 |
| line whitespace not reproduced | 2 |
| a fence's text not owned by its element | 1 |
| styling delimiters not hidden | 5 |
| paint-side guard removed | 1 |
| image stand-ins not chrome | 2 |
| rebase on the `plain` axis | 4 |
| cross-turn narrowing not announced (UI-061) | 2 |

In the browser: dropping separators turns the paragraph-join spec red; removing
the announcement turns the cross-turn spec red.

**One falsification corrected a comment rather than the code.** Deleting
`ownsItsText` turned exactly one test red, not two: `mdast-util-to-hast` patches
the text node inside a *code span*, so only a fenced block needs it. The docblock
claimed both. It now says what was measured.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [x] Committed with `[ISSUE-ID]` prefix
