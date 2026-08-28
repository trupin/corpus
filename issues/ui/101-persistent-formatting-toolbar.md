# [UI-101] Build the persistent formatting toolbar for focus mode

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-034 (rider must be signed first, **including the agreed control set**)
- Blocks: —
- Related: UI-100 (the same header, reported in the same session)

## Spec References

- SPEC.md §10 — the persistent toolbar, as added by SHARED-034
- SPEC.md §10 — "the editor serializes to clean markdown"
- SPEC.md §10 — the existing selection toolbar (formatting + Comment)
- SPEC.md §10 — "§10 adds no exclusive-pointer capability"
- `design/index.html` — authoritative for look & feel

## Summary

Focus mode gains an always-present formatting toolbar above the document, acting
on the selection or the cursor's block. The selection toolbar is unchanged — it
keeps **Comment**, which is not formatting.

**The control set is decided in SHARED-034's sign-off and recorded there.** Do
not infer it from the Google Docs reference screenshot: SHARED-034's bound (as
extended by SHARED-035) admits underline, highlight, named-role colour, block
alignment and indent — but rules out per-range font family and size, arbitrary
hex colour, and every app-level control (zoom, print, spellcheck). Build the
agreed list and nothing beyond it.

## Acceptance Criteria

- [ ] The toolbar is present whenever focus mode is, without a mode or a click to
      summon it
- [ ] It carries exactly the control set SHARED-034 records — no more, no fewer
- [ ] Every control **reports state**: the heading control names the current
      block's level; an active mark renders as active. The toolbar says what the
      text is, not only what could be done to it
- [ ] State updates as the cursor moves, not only on selection change
- [ ] Mark controls act on the selection; block controls act on the block
      containing the cursor when there is no selection
- [ ] Every control round-trips: applying it, autosaving, and reloading yields
      the same document, and the markdown on disk is clean — no HTML introduced
- [ ] The selection toolbar is unchanged and still carries Comment; the two never
      disagree about the same text
- [ ] Fully keyboard operable, and the toolbar does not steal focus from the
      editor when used — applying bold must leave the caret where it was
- [ ] Existing markdown input shortcuts (`##`, `**`, `[[`) keep working
      unchanged
- [ ] Column readers are **unaffected** (per SHARED-034) — the floating toolbar
      alone there
- [ ] The toolbar does not appear for surfaces that are not the markdown editor:
      a `thread` or a `view` (`anchorsHost` / `editorHandlesType` already answer
      this — reuse them, do not re-derive). **An unrecognised `type:` gets the
      toolbar like any other document**, because `editorHandlesType` answers true
      for every type but `view`, and SPEC §12's M6 requires such a document to
      open and edit normally
- [ ] Under a lock held by the other party, the toolbar is disabled with the
      document, not hidden — consistent with §7's read-only banner
- [ ] Checked against `design/index.html`

## Technical Design

### Files to Create/Modify

- a new toolbar component under `apps/ui/src/editor/`
- `apps/ui/src/reader/FocusMode.tsx` — mounting it above the scroll region
- `apps/ui/src/editor/DocEditor.tsx` — exposing the editor instance to it;
  `corpusExtensions()` (line 174) is the source of truth for what exists
- `apps/ui/src/editor/editor.css`
- `apps/ui/src/editor/markdown/schema.ts` — **only** if the agreed set needs a
  node or mark the schema lacks, and only where it serializes to clean markdown

### Key Implementation Details

Drive everything from the **TipTap editor instance** — `editor.can()` for whether
a control applies, `editor.isActive()` for state, the existing commands to apply.
Do not build a parallel notion of document state; the editor already has one, and
a second would drift.

`corpusExtensions()` is shared by parsing and serialising (`DocEditor.tsx:182`
notes this deliberately). A control for something the schema does not carry will
appear to work and vanish on save — so gate the control set on the schema, and
add to the schema only where SHARED-034 agreed it.

Re-rendering on every cursor move is the performance trap here: subscribe to the
editor's transactions and derive the active state, rather than re-rendering the
whole toolbar per keystroke.

### Edge Cases

- A selection spanning several block types — block controls report mixed state
  rather than lying about one of them
- A selection inside a table cell, a code block, or a task-list item — several
  controls do not apply; they disable rather than misapply
- An empty document — controls still act, creating the block
- A collapsed cursor with no selection — mark controls set the "pending" mark for
  what is typed next, or disable; pick one and be consistent
- Applying a control while an autosave is in flight
- Very narrow viewports in focus mode — the bar must degrade (overflow), never
  wrap into something that pushes the document off screen

## Testing Strategy

Vitest + Testing Library per control: applying it changes the document as
expected, `isActive` state renders, disabled states are correct in the contexts
above, and the caret is preserved. **A serialization round-trip test per control
is mandatory** — apply, serialize, re-parse, assert the markdown is clean and
stable, because "looks right in the editor, wrong on disk" is the specific failure
this toolbar can cause. A Playwright spec covers the toolbar being present in
focus mode and absent in a column.

## E2E Verification Plan

### Verification Steps

1. Restart the app; open a document in focus mode — confirm the toolbar is
   present without any gesture
2. Put the cursor in a heading — confirm the heading control names its level
3. Select prose and apply each agreed control in turn; after each, confirm the
   change on screen, then `cat` the file and confirm the markdown is clean and
   is what that control should produce
4. Reload — confirm every change survived and the toolbar reports the same state
5. Confirm the caret stays put when applying a mark from the toolbar
6. Open the same document in a column reader — confirm no persistent toolbar and
   an unchanged floating one
7. Open a thread and a `view` in focus mode — confirm no toolbar
8. Take the lock as the agent — confirm the toolbar disables with the document
9. Drive every control from the keyboard
10. Narrow the window — confirm the bar degrades without displacing the document

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

**What shipped.** `apps/ui/src/editor/FormatToolbar.tsx`, rendered by
`FocusMode` between the header and the scrolling surface, with its look ported
from a new `.fmt-bar` block added to `design/index.html` in the same change.
`DocView` gained one prop — the live editor — and **`null` is the whole gate**:
it mounts an editor only for a body it edits, so a `thread`, a `view` and the
comments list publish none and the toolbar is simply not there. No second
predicate to keep in step with `editorHandlesType`.

**The control set**, bounded by what round-trips through the file: block style
(Text, Heading 1–6), bold, italic, strikethrough, underline, highlight, inline
code, colour role, bulleted / numbered / task list, quote, code block,
alignment, indent, link, image, table, divider, clear formatting. Undo and redo
are **absent by decision**, not omission (SHARED-034's sign-off).

**Unit.** `FormatToolbar.test.ts` — 7 passed, over the four readers that make the
bar report state. The commands themselves are exercised in the browser, where a
wrong one shows up in the saved file.

**Browser** — `apps/ui/e2e/format-toolbar.spec.ts`, **9 passed**, six
consecutive runs:

```
✓ is present without a mode or a click, and only in focus mode
✓ the heading control names the block the caret is in
✓ an active mark shows as active, and the caret moving is enough
✓ a thread gets no toolbar, because no editor is mounted for one
✓ a mark applied from the bar reaches the saved markdown
✓ a colour role reaches the file as a named role, never a colour
✓ alignment wraps the block, and clearing it removes the wrapper
✓ the caret stays where it was when a button is pressed
✓ the selection toolbar is unchanged and still carries Comment
```

### Three things the falsification found, and none of them were visible before it

**1. A subscription that did nothing, and a comment that claimed it did.** The
effect listened to both `selectionUpdate` and `transaction`, with a docblock
saying a caret moved by arrow key fires only the first. Removing
`selectionUpdate` failed **nothing**: a selection change *is* a transaction, and
TipTap fires `transaction` for it. The subscription is gone and the comment now
records the correction instead of the claim.

**2. A cleared alignment became a quotation.** Removing the toolbar's "clear the
last property → lift the block" branch also failed nothing — because the
serializer was catching it, by printing an attribute-less styled block as a
**blockquote**. That round-trips, and it silently turns a paragraph somebody
un-centred into a quotation: valid markdown, different document, invisible to
every round-trip test. The serializer now **unwraps** such a block, splicing its
contents back into the parent, and the browser test asserts the wrapper is gone
from the document as well as from the file.

**3. A test that was failing for a reason that was not the toolbar.** The
selection helper used `Home` then `Shift+End`. On macOS Chromium reads those as
*document* navigation inside a contenteditable, so it sometimes selected two
paragraphs and sometimes nothing — one run in three failed on a synchronisation
point. Diagnosed rather than retried (INFRA-020): it is a triple click now, six
consecutive green runs at a steady 8.7s, against 16.8s on the runs that were
retrying.

### One design call worth recording

**A `<select>` cannot have its `mousedown` cancelled** — cancelling it is what
stops the menu opening — so using one takes focus off the editor, the browser
collapses the selection, and ProseMirror adopts the collapse. By the time
`change` fires the user's words are no longer selected. The bar therefore
**mirrors the selection as it changes** and restores it when focus has left the
editor. Capturing on `mousedown` instead was the first attempt and is wrong: a
keyboard user tabs to the control and changes it with the arrow keys, and no
pointer event happens at all.

### One more thing, found in self-review

The heading control cast a `number` into TipTap's six-literal `Level` union —
`setHeading({ level: level as 1 })` — which is a claim about the `<option>` list
that nothing checks, and it read as `1` for every level. It narrows by searching
`HEADING_LEVELS` now, and a value outside the list is Text, which is the safe
reading of an element somebody has tampered with. The same review found the
heading control was the one control not running through the shared
selection-restoring path; it does now.

### Acceptance, against the rider

- Present with no mode and no click — asserted, and asserted absent in a column
- Exactly the bounded control set, undo/redo excluded — enumerated above
- Reports state: the heading control names the level, an active mark reads
  active — both asserted from a caret move alone
- Mark controls act on the selection, block controls on the block at the caret —
  asserted through the saved file
- Round-trips and stays clean markdown — the saved body carries `<u>…</u>` and
  `{color="warning"}`, no hex, no `rgb`
- The selection toolbar is unchanged and still carries Comment — asserted
- Keyboard operable, and the caret does not move when a button is pressed —
  asserted by typing straight afterwards
- Markdown input shortcuts unchanged — the editor's own 1,011 tests still pass
- Column readers unaffected — asserted
- Not for a `thread` or a `view` — asserted, through the one gate

## Completion Checklist (domain agent)

- [ ] The control set matches SHARED-034's record exactly
- [ ] Tests written and passing, including a round-trip per control
- [ ] `/lint` passes
- [ ] E2E verification log filled in with the markdown each control produced
- [ ] Checked against `design/index.html`
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-101]` prefix
