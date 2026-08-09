# [UI-101] Build the persistent formatting toolbar for focus mode

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-034 (rider must be signed first, **including the agreed control set**)
- Blocks: —
- Related: UI-100 (the same header, reported in the same session)

## Spec References

- SPEC.md §11 — the persistent toolbar, as added by SHARED-034
- SPEC.md §11 — "the editor serializes to clean markdown"
- SPEC.md §11 — the existing selection toolbar (formatting + Comment)
- SPEC.md §11 — "§11 adds no exclusive-pointer capability"
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
      a `thread`, a `view`, or a type a plugin claims with its own `View`
      (`anchorsHost` / `editorHandlesType` already answer this — reuse them,
      do not re-derive)
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

_[Agent fills: model run on, the control set built, per-control round-trip
evidence including the markdown produced, observed output.]_

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
