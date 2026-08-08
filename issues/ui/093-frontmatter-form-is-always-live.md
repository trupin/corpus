# [UI-093] Frontmatter controls are always live and save on change

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-030 (rider must be signed first)
- Blocks: UI-092

## Spec References

- SPEC.md §11 line 465 — as amended by SHARED-030
- SPEC.md §4 — autosave, idle-squashed commits
- SPEC.md §7 — locks freeze every control

## Summary

Opening a document and changing its status, due date or tags currently requires
clicking an `edit` chip, changing the field, and clicking Save. The body beside
it has accepted a keystroke and autosaved since UI-006. This issue removes the
mode: the controls are live whenever the document is, and each change commits
through the same `PUT` path the Save button used, debounced for free-text fields
and immediate for discrete ones.

## Acceptance Criteria

- [ ] The `edit` chip is gone from the frontmatter chip row
- [ ] The Save button is gone
- [ ] Status and due render as live controls whenever the reader shows the
      document — no click required to reach them
- [ ] Changing status or due issues the `PUT` immediately (no debounce — a
      select and a date picker produce one deliberate value, not a keystroke
      stream)
- [ ] Changing title or tags issues the `PUT` debounced at `AUTOSAVE_DEBOUNCE_MS`
      (700 ms, imported from `apps/ui/src/editor/useAutosave.ts` — **not** a
      second constant)
- [ ] A frontmatter change and a body change in the same idle window land in
      **one** commit, per §4
- [ ] A failed save is visible and retryable without a Save button, using the
      body's existing `SaveChip` treatment rather than a new one
- [ ] Under a lock held by the other party, every control is disabled and the
      §7 banner names the holder — unchanged behaviour, reached without the mode
- [ ] Leaving the document mid-debounce still flushes the pending change (the
      current exit-flush guarantee is not weakened)
- [ ] No regression to the "empty document does not survive leaving it" rule
      when a title is cleared

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/FrontmatterForm.tsx` — remove `editing` state and the
  draft; controls read from `doc` and write on change. The doc comment at the
  top describing the draft ("The draft outlives no surface…") describes
  machinery this issue deletes — rewrite it, do not leave it describing a
  mechanism that is gone.
- `apps/ui/src/reader/FrontmatterForm.test.tsx` — tests are written against the
  edit/save flow; they need rewriting rather than patching.
- `apps/ui/src/editor/editSessionFlush.ts` — the form participates in the exit
  flush today via the draft. Re-point it at the pending debounce, or drop its
  participation if the debounce's own flush covers it. **Do not leave both.**

### Key Implementation Details

The `PUT` path, the mutation, the `beginEditWrite` / `endEditWrite` bracket and
the lock freeze all stay exactly as they are — this issue changes **when** the
mutation fires, not what it does. The edit-session bracket in particular is
load-bearing (UI-012's unmount seam) and must still open and close around every
write.

Coalescing matters: four rapid changes to four different fields must not issue
four `PUT`s that race. Accumulate changed fields into one pending patch and send
it as a single request, the way the current Save sends all four at once.

### Edge Cases

- Two changes to the same field inside one debounce window — last value wins,
  one request.
- A change made while a previous `PUT` is in flight — queue it rather than
  dropping it or sending concurrently.
- A change made while the document is being unmounted — the exit flush must
  still send it (this is the current guarantee, and the reason the draft
  existed).
- A status value that becomes invalid because the document's type changed under
  the reader via SSE — the control re-renders from the server's answer, never
  from a local draft that no longer exists.

## Testing Strategy

Vitest + Testing Library in `FrontmatterForm.test.tsx`: changing the status
select fires one `PUT` with only `status`; typing in tags fires nothing before
700 ms and one request after; changing two fields inside one window sends one
request carrying both; a rejected request surfaces the failure state; a locked
document renders every control disabled and issues nothing.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `npm run dev -w apps/cli` against a real workspace, open the board
2. Open any note in a column reader
3. Observe: status shows as a chip; changing it requires clicking `edit`
4. Expected: the status control is live and a change saves itself
5. Actual: an edit mode with a Save button

### Verification Steps

1. Restart the app; open a note in a column reader
2. Change status `open` → `resolved` — no `edit` click first; confirm the chip
   updates and `git log` in the workspace shows the committed change
3. Change the due date; confirm one further commit (or one squashed commit if
   inside the same idle window, per §4)
4. Type a tag; confirm no request before ~700 ms and one after
5. Change title and status together quickly; confirm **one** `PUT` in the
   network panel and one commit
6. Have the agent take the lock (`corpus lock acquire --from agent`); confirm
   every control is disabled with the holder named
7. Change a field and immediately navigate away; confirm the change is on disk

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-093]` prefix
