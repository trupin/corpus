# [PLUGINS-015] The checkbox in the Todos column opens the item instead of checking it

## Domain

plugins

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-077 (checking the last item from here must resolve its
  document the same way checking it in the body does)

## Spec References

- SPEC.md §12 — "**Column**: a 'Todos' column type aggregating open items across
  all `todo` documents"
- SPEC.md §11 — "§11 adds no exclusive-pointer capability" (everything reachable
  from the keyboard)

## Summary

The Todos column renders each open item with a `☐` on the left. Clicking it
opens the item's document. Checking an item off from the column — the obvious
gesture on the surface built for exactly that — is only reachable through the
row's right-click menu.

The capability is already there: `TodosColumn.tsx:116` holds
`useTodoItemToggle()` and passes `toggle.toggle` to the item menu at line 246.
This issue puts it on the box.

## Reproduction (already confirmed by inspection)

`plugins/todos/ui/TodosColumn.tsx:198–224` renders the whole row as one
`<button>` whose `onClick` is `onOpen?.(itemOpenRequest(…))`, with the box as an
inert `<span className="box">☐</span>` inside it. Every click on the row,
including on the box, opens.

## Acceptance Criteria

- [ ] Clicking the checkbox checks the item and does **not** open the document
- [ ] Clicking anywhere else on the row still opens the document at that item,
      with UI-037's reveal behaviour unchanged
- [ ] A checked item leaves the column — the column shows open items (line 81
      filters `item.done`) — and the removal is driven by the same invalidation
      any other item write triggers, not by local optimism that could disagree
      with the server
- [ ] **Unchecking is reachable too.** The column shows only open items, so once
      an item is checked it is gone from this surface. Either the row stays
      briefly in a checked state that can be undone, or the write surfaces an
      undo — decide and record which, because "quickly check / uncheck" was the
      request and a checkbox that can only ever go one way is half the feature.
      Do not silently ship only the checking half.
- [ ] The checkbox is operable from the keyboard, and reaching it does not cost
      the row's existing keyboard behaviour (`onItemKeyDown`)
- [ ] A failed toggle surfaces through the existing `toggle.error` strip and
      leaves the box in its true state
- [ ] Under a lock held by the other party, the checkbox is refused the way any
      other write to that document is, naming the holder
- [ ] Right-click still opens the item menu, unchanged

## Technical Design

### Files to Create/Modify

- `plugins/todos/ui/TodosColumn.tsx` — the row markup
- `plugins/todos/ui/todos.css` — the box becomes a hit target with its own hover
  and focus treatment
- `plugins/todos/ui/TodosColumn.test.tsx`

### Key Implementation Details

**The row cannot stay one `<button>`.** A `<button>` inside a `<button>` is
invalid HTML and will not behave. The row becomes a container holding two
controls: the checkbox and the item text. Keep the container's existing
`data-todos-item` attribute and its `onContextMenu` — the tests and the native-
menu suppression (`nativeMenu.ts`, `[data-plugin-surface]`) depend on them.

Use a real checkbox control rather than a clickable span, so the keyboard and
assistive technology get it for free; style the `☐` glyph rather than
reimplementing the semantics.

The toggle mutation is `useTodoItemToggle()`, already wired — this issue widens
where it can be triggered from, and adds no second write path.

### Edge Cases

- Clicking the box on an **overdue** item (the row carries an `overdue` class) —
  the treatment must survive the restructure.
- A rapid double-click on the box — one write, not two racing ones.
- An item whose document is deleted or whose body changed under the column via
  SSE between render and click — the write is refused by the server as it would
  be from anywhere else; do not special-case it here.
- The `+N more` row is not an item and gets no checkbox.

## Testing Strategy

Vitest + Testing Library: clicking the checkbox calls the toggle and not the
open; clicking the text calls the open and not the toggle; keyboard activation
of the checkbox toggles; a rejected toggle renders the error strip and leaves the
box unchecked; right-click still opens the menu; the `+N more` row has no
checkbox.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` on a workspace with several open todo items; open the
   board's Todos column
2. Click the `☐` on any item
3. Expected: the item is checked
4. Actual: the item's document opens

### Verification Steps

1. Restart the app; open the Todos column
2. Click the `☐` on an item — confirm it is checked, the document did **not**
   open, the row leaves the column, the file on disk shows `- [x]`, and one
   commit was made
3. Confirm whichever uncheck affordance was chosen actually reverses it, on disk
4. Click the item's **text** — confirm the document opens at that item, revealed
   and flashed as before
5. Check the **last open item** of a document and confirm that document's status
   goes `resolved` (SERVER-077) — the two must agree from this surface too
6. Tab to a checkbox and activate it from the keyboard
7. Take the lock as the agent and confirm the checkbox is refused with the holder
   named

## E2E Verification Log

_[Agent fills: model run on, commands, observed output, and the uncheck
affordance chosen with its reasoning.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Pre-fix reproduction logged
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-015]` prefix
