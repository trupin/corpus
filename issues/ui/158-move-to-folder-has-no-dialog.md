# [UI-158] "Move to folder…" has no dialog, and UI-150 assumed one existed

## Domain
ui

## Priority
P1

## Status
done

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
- [x] `design/navigation.html` draws the dialog before it is built — the mockup
      is authoritative for look and feel, and this one has no drawing yet
- [x] `packages/kit` gains a `moveDoc` client method and a hook, beside the
      folder acts UI-150 added
- [x] The explorer's document menu offers "Move to folder…", and so does the row
      menu if that is where the drawing puts it
- [x] A move updates the tree and every column showing the document, without a
      reload
- [x] The refusal cases the server already declares are shown, not swallowed

## Testing Strategy
Vitest for the hook and the dialog's model; Playwright for the act end to end
against the real route.

## E2E Verification Plan
### Verification Steps
1. Move a document from `inbox` to another folder through the explorer.
2. The tree shows it in its new place, and the file is on disk there.
3. A refused move says why.

## E2E Verification Log

**Model: opus (claude-opus-5[1m]).**

### The decision, since the issue asked for a dialog and got a list

The orchestrator settled it on 2026-08-23: **no modal dialog.** SPEC §10's rider
of that date makes every chip that names an editable field the control for that
field, so the document's folder chip in the reader is the natural second home —
and that chip is another agent's this session. What this issue builds is the
explorer's document-menu path, and the reader's folder chip is a **follow-up**.

The menu offers **one item per folder** rather than opening a picker. The
destinations are a known, small, already-drawn set: the explorer is showing them
two centimetres away. Naming them as items reuses the menu the user already
opened, cannot be mistyped, and reaches the keyboard for free. `design/navigation.html`
now draws it that way (the item was `serverGap("move to folder")`) — the mockup
was updated before the code, as the criterion asks, and no longer marks a gap.

### Verification, against the real app

A real server on port 8790 serving the built UI, driven by Chromium. Right click
on `Alpha in todos` in the tree:

```
move items offered: ["Move to boards", "Move to templates",
                     "Move to todos/unfiled", "Move to views"]
its own folder offered? false
```

Each item's second line reads `rewrites the path only — the id, and every link
to it, are unchanged`. Clicking `Move to todos/unfiled`:

```
POST /api/docs/doc_alpha001/move  body {"folder":"todos/unfiled"}
toast: ✓ | Moved “Alpha in todos” to todos/unfiled/ — committed. Its id is
          unchanged, so every link, anchor and thread on it still resolves. | ✕
alpha rows after the move: 1
tree after the move: ["› boards 5", "› templates 1", "⌄ todos 2",
                      "⌄ unfiled 2", "NOTE Alpha in todos",
                      "NOTE Beta in unfiled", "› views 3"]
```

The tree redrew without a reload — `useMoveDoc` invalidates the document, the
collection **and the tree**, which is the one document write that changes the
folder counts `GET /api/tree` reports. The file is on disk at its new path:
`GET /api/docs/doc_alpha001` answers `data/docs/todos/unfiled/a.md`, and moving
it back answers `data/docs/todos/a.md`.

A refused move is shown, not swallowed: with the fixture answering `400`,
`Move to archive/ failed — data/docs/archive/doc_alpha.md already exists`.

### Falsification

`moveTargets: acts.folders` replaced with `[]` — the menu keeps its shape and
offers nothing. All three `Explorer.test.tsx` move tests go red
(`expected null not to be null`).

### Two limitations, said plainly

1. **A folder holding no documents is not a destination.** `GET /api/tree` lists
   only folders that hold something, so an empty `archive/2024` never reaches the
   menu — measured, not assumed. The explorer does not draw such a folder either,
   so the menu and the tree agree; but a person cannot move a document into a
   folder they have just created and not yet filed anything in.
2. **The docs root is not a destination.** The tree has no root row, so nothing
   offers `data/docs` itself. A document already filed at the root can be moved
   into a folder and not back out from here.

Both are the "list the folders the tree draws" design being consistent with the
tree. Neither is a regression — there was no surface at all before.

### Checks

`vitest run apps/ui` — 178 files, 3689 tests pass. `vitest run packages/kit` —
63 files, 954 tests pass (five new over `useMoveDoc`: the request on the wire,
the three keys invalidated, no optimistic cache write, the teardown-safe
callbacks, and a refused destination surfaced). `npm run typecheck` exit 0.
`eslint apps/ui packages/kit` exit 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-158]` prefix
