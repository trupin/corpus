# [UI-092] A derived status shows its value and its source, and nobody can edit it

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-036 (rider must be signed first), SHARED-030 (rider must be signed first), PLUGINS-016, SERVER-077,
  UI-093
- Blocks: —

## Spec References

- SPEC.md §12 — as amended by SHARED-036: "the status control shows the derived
  value and says it comes from the items"
- SPEC.md §11 — as amended by SHARED-030: a derived field "is editable by
  nobody — that is not an edit mode, it is a field that was never the person's
  to set"

## Summary

UI-093 makes every frontmatter control live. For a `todo` document the status
control must not be live — its value comes from the items, and offering a
dropdown would offer a change the write path would immediately undo. This issue
renders that case: the value, plus a plain statement of where it comes from.

The scope is narrow deliberately. It is the visible half of SHARED-036, and it
is worth its own issue because it is the one place where "always editable" and
"derived" meet, and getting it wrong reads as either a bug or a lie.

## Acceptance Criteria

- [ ] On a document whose type declares a derived status, the status control
      renders the derived value and is **not** interactive — not a disabled
      dropdown that looks momentarily clickable, but a control that reads as a
      statement
- [ ] It says where the value comes from, in words, next to the value (the
      DocPanel's existing voice is the reference — "derived from the items", not
      an icon alone)
- [ ] The row's status chip agrees with it, and with the board, and with the
      DocPanel's counts on the same screen
- [ ] Checking the last item updates the control **without a reload**, via the
      same SSE invalidation that updates the DocPanel counts
- [ ] An archived todo document shows `archived`, and the control still explains
      that `archived` is the stored decision rather than a derived value
- [ ] A document whose items are unreadable falls back to an ordinary editable
      status control — there is nothing to derive from, so the field is the
      person's again
- [ ] With `plugins/todos/` deleted, a todo document's status control is an
      ordinary editable one (§15 M6)
- [ ] The frontmatter form's other controls are unaffected and stay live

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/FrontmatterForm.tsx` — read the declaration PLUGINS-016
  adds and branch the status control on it
- `apps/ui/src/reader/FrontmatterForm.test.tsx`
- wherever the row-level status chip is rendered — it must read the same source,
  not re-derive

### Key Implementation Details

The UI reads the declaration from the **client-side manifest** it already loads
with `import.meta.glob`, so no contract change is needed and no API field has to
carry "is this derived". The *value* comes from the server (SERVER-077 already
puts the derived status on the resource); only the "is it editable" question is
answered locally.

Do not re-derive the value in the UI. Two derivations is two chances to
disagree, and the DocPanel's own doc comment already states the principle: it
derives and never stores, from the same body the editor renders.

### Edge Cases

- The plugin manifest fails to load (a broken plugin, contained at discovery) —
  the control falls back to editable. It must never render permanently
  uneditable because a declaration could not be read.
- A type declaring derived status where the server sends a value that could not
  have been derived (version skew between server and UI) — show what the server
  sent; never correct it locally.

## Testing Strategy

Vitest + Testing Library: a todo doc with all items done renders a
non-interactive `resolved` with its source named; with one open item, `open`;
archived renders `archived`; unreadable items render an editable control; a note
renders an editable control. Assert no mutation is issued from any of the
non-interactive cases.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; open a todo document with every item checked
2. Expected: status reads `resolved`, derived, not editable
3. Actual (today): status reads `open` in an editable dropdown behind an `edit`
   chip — the screenshot that opened SHARED-036

### Verification Steps

1. Restart the app; open a todo document with one open item
2. Confirm status reads `open`, non-interactive, source named
3. Check the last item **in the body editor**; confirm the control flips to
   `resolved` with no reload, at the same moment the DocPanel reads `0 OPEN`
4. Uncheck it; confirm it flips back
5. Archive the document from the ⋯ menu; confirm `archived`
6. Delete `plugins/todos/`, restart, reopen; confirm an ordinary editable control
   and a booting app

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-092]` prefix
