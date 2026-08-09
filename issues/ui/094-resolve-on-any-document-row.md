# [UI-094] Right-clicking a document offers no Resolve, though every document has one

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-031 (signed)
- Related: PLUGINS-016 / UI-092 — a derived-status type must be excluded

## Spec References

- SPEC.md §5 — as amended by SHARED-031: one status vocabulary for every type
- SPEC.md §11 — the reader ⋯ menu and the row context menu
- SPEC.md §11 — the bulk-selection rider's Resolve clause, as corrected by
  SHARED-031

## Summary

Right-clicking a note offers Open, Open in focus, Archive and Delete — no
Resolve. Opening the same note and using the frontmatter form's status dropdown
resolves it without complaint, because `DOC_STATUSES` is type-independent and
the write path gates only on leaving `archived`. One reader, two surfaces, two
different answers about whether a note has a status.

This issue makes the menu agree with the contract.

## Reproduction (confirmed by inspection)

`apps/ui/src/menu/docActions.ts:154` — `if (isThread) { list.push({ id:
"resolve", … }) }`, where `isThread = subject.type === THREAD_DOC_TYPE` (line
119). Every non-thread document is excluded regardless of what its status can
hold.

## Acceptance Criteria

- [ ] Resolve / Reopen appears in the row context menu for **any** document
      whose status is stored, not only threads
- [ ] It appears on the reader's ⋯ menu on the same terms (both surfaces are
      built from `useDocActions`; they must not diverge again)
- [ ] The label flips to Reopen on an already-resolved document, as it does for
      threads today
- [ ] A resolved document **stays visible** in the list it was in — per
      SHARED-031, resolving is not a way to hide something. Confirm no column
      query silently filters it out; if one does, that is a separate finding to
      file, not something to fix by hiding the action
- [ ] It is **not** offered on a document whose type derives its status
      (PLUGINS-016) — there is nothing there for anyone to set
- [ ] It is not offered on an archived document (the write path refuses leaving
      `archived` via `PUT`; offering it would promise a refusal)
- [ ] Threads keep their existing behaviour exactly, including whatever
      `useSetThreadStatus` does beyond the status write

## Technical Design

### Files to Create/Modify

- `apps/ui/src/menu/docActions.ts` — replace the `isThread` gate
- `apps/ui/src/menu/docActions.test.ts`

### Key Implementation Details

**Threads and documents take different write paths today.** Resolve currently
runs `useSetThreadStatus`; a note's status is written through the ordinary
document `PUT` the frontmatter form uses. Do not route notes through the thread
mutation — check what `useSetThreadStatus` does beyond writing status (read
state, Attention, SSE invalidation keys) before assuming the two are
interchangeable. The menu picks the right mutation for the subject; it does not
unify them.

The derived-status exclusion needs PLUGINS-016's declaration. If UI-094 lands
first, gate on the doc type being `todo` as a **named temporary** with a comment
pointing at PLUGINS-016 — do not invent a second mechanism that then has to be
removed.

### Edge Cases

- A document type nothing recognises — takes the same three statuses; offers
  Resolve.
- A `view` or `template` document — same. If resolving one of these is
  meaningless in practice, that is an argument to make in SHARED-031, not a
  special case to bury in the menu.
- A locked document — refused as any other write is, naming the holder.
- Bulk selection — once UI-083 is built (per SHARED-032), Resolve must be
  offered on mixed selections per SHARED-031 part 2. Not this issue's work, but
  do not add a gate that would block it.

## Testing Strategy

Vitest: the menu for a note includes Resolve; for a resolved note, Reopen; for a
thread, unchanged behaviour and the thread mutation; for an archived document, no
Resolve; for a derived-status type, no Resolve. Assert which mutation each
subject dispatches, not just that the item renders.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; right-click a `note` row in a folder column
2. Expected: a Resolve action
3. Actual: Open, Open in focus, Archive, Delete — no Resolve, while the same
   note's frontmatter dropdown resolves it fine

### Verification Steps

1. Restart the app; right-click a note row
2. Resolve it — confirm the file's frontmatter reads `status: resolved`, one
   commit was made, and **the row is still in the column**
3. Right-click it again — confirm the action now reads Reopen, and reopening
   reverts both the file and the menu
4. Repeat from the reader's ⋯ menu; confirm identical behaviour
5. Right-click a thread row — confirm unchanged behaviour end to end
6. Right-click an archived document — confirm no Resolve
7. Right-click a todo document — confirm no Resolve (or the temporary gate, with
   its comment, if PLUGINS-016 has not landed)

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Pre-fix reproduction logged
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-094]` prefix
