# [UI-064] `<br>` inside a table cell renders as literal text

## Domain
ui

## Status
todo

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

**Diagnosed: the two halves of the system disagree, and both are individually
right.**

- **The writer emits it.** A hard break in the editor becomes an mdast `break`
  node (`apps/ui/src/editor/markdown/serialize.ts:653`). Inside a table cell,
  `mdast-util-gfm-table` cannot serialize that as a newline — a newline ends the
  row — so it emits `<br>`. That is GFM's standard answer and what every other
  markdown tool does.
- **The reader refuses it.** `packages/kit/src/markdown/MarkdownView.tsx:16`
  states it plainly: _"**No raw HTML path, by construction.** `rehype-raw` is
  deliberately absent"_. So the `<br>` is text, and the reader shows it.

The result is a document that round-trips through our own editor and comes back
displaying markup. Neither component is wrong on its own terms; nobody owns the
seam.

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
- [ ] A table cell containing a line break displays as a line break, not as
      `<br>` text
- [ ] Round-trip is stable: open the document, save it untouched, and the bytes
      do not change
- [ ] The no-raw-HTML posture is preserved for everything else — a document
      containing `<script>`, `<img onerror=…>` or arbitrary markup still renders
      it as text. A test pins this, because it is the property being qualified
- [ ] Existing documents already containing `<br>` in a cell render correctly
      without being rewritten
- [ ] Whatever rule is chosen is stated where `MarkdownView`'s "no raw HTML"
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
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
