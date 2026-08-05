# [UI-064] `<br>` inside a table cell renders as literal text

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 Document view (the editor serializes to clean markdown)

## Summary
Live report 2026-08-04: _"The rendering of tables in documents are using `<br>`
instead of `\n` for whatever reason. These `<br>` look like HTML and aren't
rendered so they show as such in the rendered document."_

**CORRECTED 2026-08-04 by the implementing agent — the diagnosis below this
paragraph was wrong, and the truth is worse.** I wrote that our writer emits
`<br>` because `mdast-util-gfm-table` does so for a break in a cell. It does not:
probed against the installed `mdast-util-gfm-table@2.0.0`, it supplies handlers
for `table`/`tableRow`/`tableCell`/`inlineCode` only and never touches `break`.
A `break` in a cell fell through to `mdast-util-to-markdown`'s default handler,
which — finding `\n` unsafe in that scope — emits a **space**:

```
serialize([text "one", break, text "two"] in a cell)  →  | one two | x |
```

So the writer was not producing markup the reader refused. It was **silently
deleting a line break the user typed into a table cell**, on the next save. The
visible `<br>` the user reported comes from pasted or agent-authored content, not
from us — and behind it sat a second, quieter data-loss defect that nobody had
reported because you only notice it after the fact.

Both are fixed. The corrected reading of the seam:

- **The reader refuses raw HTML.** `packages/kit/src/markdown/MarkdownView.tsx:16`
  states it plainly: _"**No raw HTML path, by construction.** `rehype-raw` is
  deliberately absent"_. So a `<br>` that arrives in the file renders as text.
- **The editor also refuses it**, differently: an inline `html` node has no case
  in `parse.ts`'s `inlineNode` walk, so it fell to `rawInline` and drew as a
  monospace chip containing the literal characters. Both surfaces were broken,
  and a fix to either half alone would have left the other wrong.

_(Original diagnosis kept below only where it remains accurate; the claim about
`mdast-util-gfm-table` emitting `<br>` is retracted.)_

## The decision this issue has to make
Three routes, and they differ in what they cost:

1. **Render `<br>` where GFM puts it.** Narrowly allow the one element our own
   serializer emits, in the one place it emits it. Keeps documents faithful and
   keeps the no-raw-HTML rule everywhere else. The cost is that "no raw HTML" is
   no longer absolute, and the exception has to be written down where the rule is.
2. **Stop emitting it.** Refuse hard breaks inside table cells at the editor
   level, so the file never contains one. Preserves the rule, but silently drops
   something the user typed, and does nothing for the documents (and agent
   output) that already contain `<br>`.
3. **Render it as a line break without allowing raw HTML generally** — recognise
   the `<br>` token during parsing and turn it into a real break node. Keeps the
   security posture exactly as it is (no `rehype-raw`, no arbitrary HTML) while
   fixing the display. Likely the best of the three; verify it is achievable
   inside the existing remark pipeline.

Whichever is chosen, say why in the code next to the rule it qualifies.

## Investigation owed
- Confirm where the user is seeing it: a document body renders through **TipTap**
  (always-editable), while `MarkdownView` draws threads, focus-mode content and
  plugin surfaces. Establish which surface shows the literal `<br>` — if TipTap
  also shows it, the parse side has the same gap and both need the fix.
- Check whether agent-authored tables already contain `<br>` in the live
  workspace; if so, any fix that only changes the writer leaves them broken.

## Acceptance Criteria
- [x] A table cell containing a line break displays as a line break, not as
      `<br>` text
- [x] Round-trip is stable: open the document, save it untouched, and the bytes
      do not change
- [x] The no-raw-HTML posture is preserved for everything else — a document
      containing `<script>`, `<img onerror=…>` or arbitrary markup still renders
      it as text. A test pins this, because it is the property being qualified
- [x] Existing documents already containing `<br>` in a cell render correctly
      without being rewritten
- [x] Whatever rule is chosen is stated where `MarkdownView`'s "no raw HTML"
      claim is made, so the two do not drift apart again

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/MarkdownView.tsx` (and/or the remark pipeline)
- `apps/ui/src/editor/markdown/` (parse/serialize) if the fix is on the writer
- tests in both

## Testing Strategy
Fixture with a table whose cell holds a break: assert the rendered output has a
real break, assert the round-tripped markdown is byte-identical, and assert an
unrelated raw HTML tag still renders as text.

## E2E Verification Log
Model: **opus** (claude-opus-5, 1M context). 2026-08-04.

### Correction to the diagnosis above
The issue says the writer emits `<br>` via `mdast-util-gfm-table`. **It does
not.** Probed directly against the installed `mdast-util-gfm-table@2.0.0`: that
extension supplies handlers for `table`/`tableRow`/`tableCell`/`inlineCode` only
and never touches `break`, so a `break` node in a cell falls to
`mdast-util-to-markdown`'s default hard-break handler, which — finding `\n`
unsafe in scope — emits a **space**.

```
serialize([text "one", break, text "two"] in a cell)  →  | one two | x |
```

So the pre-existing writer-side behaviour was not "emits markup", it was
**silent data loss**: a line break typed into a table cell was deleted on the
next save. That is a second defect this issue's fix now also closes.

### Where the `<br>` actually comes from, and which surface shows it
- Searched the live workspace at `/Users/theophanerupin/cos` (162 markdown
  documents, 24 of them containing tables) and its whole git history
  (`git log -S'<br'`): **zero** occurrences today. So no existing document is
  left broken by this fix, and the report is about content that arrived by
  paste or from an agent turn rather than about something our writer produced.
- **Both** rendered surfaces reproduced it, which is the investigation the issue
  asked for:
  - **TipTap** (the document body). An inline `html` node has no case in
    `parse.ts`'s `inlineNode` walk, so it fell to `default` → `rawInline`, and
    `rawNodes.ts` renders that as `<span class="md-raw-inline">` — the literal
    text `<br>` in a monospace chip.
  - **`MarkdownView`** (thread turns, focus mode, plugin bodies). No
    `rehype-raw`, so the `html` node renders as characters.
  A writer-only or reader-only fix would therefore have left half the app broken.

### Route taken
**Route 3** — recognise the token during parsing — as recommended, **scoped to
table cells**. `packages/kit/src/markdown/tableBreaks.ts` exports
`remarkTableCellBreaks`, an mdast transform that rewrites a bare `<br>` (any
case, optionally self-closing, **no attributes**) into a `break` node *only*
below a `tableCell`. `MarkdownView` and `apps/ui/src/editor/markdown/parse.ts`
both attach it, so the reader and the editor cannot come to two readings of one
file. `serialize.ts` writes the token back (`breaksAsTokens`), which is what
makes the round trip byte-stable and what stops the silent deletion above.

The scope is the argument: inside a cell markdown has **no** spelling for a
break (every one it has is a newline, and a newline ends the row); outside one it
has two. So a `<br>` in prose stays the inert text the no-raw-HTML posture makes
of every tag, and the exception is written where the rule is stated
(`MarkdownView.tsx` docblock) and argued in full in `tableBreaks.ts`.

### Reproduction, then fix, in a real browser
`apps/ui/e2e/render-fixes.spec.ts`, Chromium, `CORPUS_UI_PORT=5993`.

With the plugin removed from both pipelines (the pre-fix state), rebuilt and
re-run:

```
✘ is a line break in the document body …
    locator('.reader .doc-editor .ProseMirror').locator('td br')
    Expected: 1   Received: 0
✘ is a line break in a thread turn too
    locator('.reader .turn-markdown').first().locator('td br')
    Expected: 1   Received: 0
```

With the fix restored: **8 passed** (5.5 s). The document body and the thread
turn each render exactly one `<br>` element in the cell, and
`innerText` of the cell no longer contains `<br>`.

### Raw HTML is still inert — the property being qualified
Asserted in the same real browser, on both surfaces, over a body that also
contains `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`:
`page.locator("script#injected")` → 0, `body.locator("img")` → 0, and
`innerText` still contains both tags verbatim as characters.

Pinned again as unit tests in `packages/kit/src/markdown/tableBreaks.test.tsx`
(32 tests): six kinds of markup — `<script>`, `<img onerror>`, `<iframe>`,
`<a href>`, `<br class="x" onclick=…>` and `<b>` — each asserted to render as
text **inside a cell** and **in prose**; `<br>` in prose and `<br>` in a fence
left raw; and `isLineBreakTag` table-driven over 11 spellings. The editor side is
pinned in `parse.test.ts` (a tag with attributes and a `<script>` stay
`rawInline`).

### Round trip
- `fixtures/tables.md` gained two `<br>` rows and still round-trips **byte for
  byte** (`roundtrip.test.ts`, 130 tests).
- `<br/>` and `<br />` are added to `NON_CANONICAL`: they normalise to `<br>` on
  one pass and settle, exactly as `*` bullets normalise to `-`. That is the
  module's stated contract, not a new exception.
- `serialize.test.ts` pins `<br>` for a break in a cell, `<br>` for one nested
  inside a mark, no `<br>` for a break in a paragraph, and the byte-identical
  round trip.

### Gates
`vitest packages/kit/src` 657 passed · `vitest apps/ui/src` 2052 passed ·
`eslint --max-warnings 0` clean · `prettier --check` clean · `tsc --noEmit`
clean in both workspaces · Playwright `render-fixes` 8 passed, plus
`reader/editor/related/turn-breaks/fences/board/column-width` 47 passed with no
regressions.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
