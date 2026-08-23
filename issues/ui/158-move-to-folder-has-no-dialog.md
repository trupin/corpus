# [UI-158] "Move to folder…" has no dialog, and UI-150 assumed one existed

## Domain
ui

## Priority
P1

## Status
todo

## Model
opus

## Dependencies
- Depends on: UI-150 (which found it)

## Spec References
- SPEC.md §10 — "UI — the board", the explorer's document menu
- `design/navigation.html` — draws the menu item and marks the dialog a gap

## Summary

UI-150's acceptance criteria name a document-menu item, "Move to folder…", with
the parenthetical "(existing move dialog)". **There is no move dialog.** Its
implementer looked, escalated rather than inventing one, and shipped the rest of
the explorer.

What exists and what does not:

- `POST /api/docs/{id}/move` is **published** (`packages/contract/src/routes/docs.ts`)
  and **implemented** (`apps/server/src/docs/move.ts`). The wire and the server
  are done.
- `packages/kit` has no `moveDoc` client method and no hook.
- `apps/ui` has no dialog for it, and `design/navigation.html` marks it a gap
  rather than drawing one.

So this is UI work over a finished server route, not a feature.

## Why it is not in v0.19.0

Building a surface neither mockup draws, at the end of a seventeen-issue phase,
is how a release slips. The explorer ships with the folder acts (rename,
archive, unarchive, delete) and the document acts (open, open here, open in full
screen, open in… a board, keep). A single document moves between folders today
through the CLI, and the corpus's own organisation is folder-shaped rather than
document-shaped, so the folder acts carry the common case.

**The cost is real and should be said plainly**: someone who filed a document in
the wrong folder cannot fix it from the explorer, which is the one surface that
shows them the mistake.

## Acceptance Criteria
- [ ] `design/navigation.html` draws the dialog before it is built — the mockup
      is authoritative for look and feel, and this one has no drawing yet
- [ ] `packages/kit` gains a `moveDoc` client method and a hook, beside the
      folder acts UI-150 added
- [ ] The explorer's document menu offers "Move to folder…", and so does the row
      menu if that is where the drawing puts it
- [ ] A move updates the tree and every column showing the document, without a
      reload
- [ ] The refusal cases the server already declares are shown, not swallowed

## Testing Strategy
Vitest for the hook and the dialog's model; Playwright for the act end to end
against the real route.

## E2E Verification Plan
### Verification Steps
1. Move a document from `inbox` to another folder through the explorer.
2. The tree shows it in its new place, and the file is on disk there.
3. A refused move says why.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-158]` prefix
