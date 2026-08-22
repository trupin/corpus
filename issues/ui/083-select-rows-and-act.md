# [UI-083] Selecting rows and acting on the selection

## Domain

ui

## Status

todo — **the design below is superseded; rewrite this issue before implementing
from it.** SHARED-032 was signed 2026-08-09, which cleared the block, but what it
cleared into is a rewrite: bulk actions became a mode with per-row staged actions
and a Save, and the 2026-08-05 model described below is not that. Not `blocked`
any more, because nothing is waiting on anyone. (INFRA-027, 2026-08-13.)

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: SHARED-032 (rider must be signed first, then this issue is
  rewritten), CONTRACT-037 (re-checked during the rewrite — a per-row staged
  set may need a different request shape); originally SHARED-017 (signed
  2026-08-05; superseded by SHARED-032)
- Blocks: —

## Spec References

- SPEC.md **§10**, "Selecting rows, and acting on the selection" (rider signed
  2026-08-05) — the whole feature: additive selection, one column at a time,
  browser-local, the offered actions, the three-part result, the selection
  reducing to what did not change, select-all vs. select-everything-matching,
  bulk delete's heavier gate, what clears a selection, and the context-menu rule
- SPEC.md **§10**, Keyboard scheme (v1) — `x`, `⇧↑`/`⇧↓`, `⌘A`, and `esc`
  clearing a non-empty selection **last**
- SPEC.md **§4**, "One action, one commit" — the history the result must agree
  with
- SPEC.md **§7** — document locks; a locked document is refused, naming the holder
- SPEC.md **§9** — `DELETE /api/docs/:id` is user-only with an explicit confirm;
  deleted documents' threads become orphaned records
- SPEC.md **§11** — a document that fails validation is refused with its reason

## Summary

The board can act on one row at a time. §10 now describes acting on a set, and
every action it batches already exists individually — the reader's ⋯ menu, the
per-row staleness quick actions, and the §9.2 write routes. **This issue invents
no action.** It lets you aim an existing one at more than one document.

Selection is **additive, never a mode**: clicking a row still opens it in the
reader exactly as before, and a row joins the selection only through an explicit
act. It lives in **one column at a time**, because the same document legitimately
appears in two columns and a board-wide selection would show it selected in one
place and unselected in another. It is **browser-local state**, alongside scroll
positions and open readers: selecting rows writes no file, makes no commit,
changes no view document, and does not appear in another browser.

**The two hard decisions SHARED-017 made are the acceptance criteria worth
testing, and neither is optional.** A bulk action applies to what it can and never
refuses the whole set because of one document — a locked document is the routine
case, not the exception, since the agent takes locks while it works. The honesty
half is what makes that acceptable: the result is stated in **three parts** and
the selection **survives as the retry**. A bulk action that reports "done" while
three of twenty did not happen is the same class of defect this codebase has
already filed three times.

**This issue depends on CONTRACT-037 and must not be built without it.** Without
a way to ask the server for several document mutations as one act, the board
fires N requests, each auto-commits separately, and §4's "One action, one commit"
becomes a promise the UI cannot keep. SHARED-017 named this precondition itself
and required the contract issue to be filed first.

## Acceptance Criteria

### Selecting

- [ ] A row joins the selection only through an explicit act: its own selection
      control (revealed on hover or keyboard focus, and shown on **every** row
      once the selection is non-empty) or the keyboard bindings below
- [ ] Clicking a row still opens it in the reader, exactly as before
- [ ] The selection lives in **one column at a time**; starting one in another
      column clears it
- [ ] The column **states how many rows are selected**, offers the actions, and
      offers a way to clear — the number is always on screen, never inferred
- [ ] Selecting rows writes no file, makes no commit, and changes no view
      document — asserted against the workspace, not just against the UI
- [ ] Keyboard: `x` toggles selection on the highlighted row; `⇧↑`/`⇧↓` extend
      while moving; `⌘A` selects every row **currently listed** in the active
      column and **only while the list itself has focus** — inside a composer or
      the editor it stays the browser's select-all
- [ ] `esc` clears a non-empty selection **last**: after any overlay, focus mode
      and the column reader in front of it have had their turn
- [ ] What else clears it: the clear control, changing the column's query,
      removing the column, starting a selection in another column, a reload. It
      **survives** scrolling, opening and closing a reader, and live updates over
      SSE
- [ ] A row that leaves the list because it no longer matches the query —
      including because the action just archived it — leaves the selection with it
- [ ] The `?` cheat-sheet overlay lists the new bindings (it renders from the
      shortcut table, so this follows from adding them there)

### Acting

- [ ] The actions offered are **the ones the selected items already have**, and
      nothing else: Archive, Unarchive, Resolve/Reopen, Move to a folder, add or
      remove tags, mark still current, Delete, and Ask the agent about these
- [ ] An action is offered only when it applies to **every** selected item — a
      selection holding a note and a thread offers no Resolve
- [ ] Tagging **adds or removes** the named tags and never replaces a document's
      tag set
- [ ] **Ask the agent about these** creates one agent-requested standalone thread
      whose first turn references every selected document; it changes none of
      them, so it stays available when some are locked
- [ ] Right-clicking a row **inside** the selection opens the selection's actions
      and names the count; right-clicking a row **outside** it opens that row's own
      menu and leaves the selection alone

### The two hard decisions

- [ ] **The result is stated in three parts**: what **changed**, what was
      **already in that state** (already archived is a no-op, not a failure), and,
      listed apart from both, what **did not change and why** — **each named
      individually** with its reason (the lock's holder, the validation error, the
      rule that refused it)
- [ ] The result **stays until it is dismissed** — never a message that
      disappears on its own, because the part worth re-reading is the part that
      did not happen
- [ ] A bulk action **never reports success for work that did not happen**: if
      seventeen of twenty changed, the result says seventeen, names the three, and
      `git log` agrees with it
- [ ] After the action the selection is **reduced to exactly the documents that
      did not change** — so retrying after clearing a lock is one gesture — and
      clears entirely when everything changed
- [ ] **Bulk delete keeps a heavier gate than single delete, never a lighter
      one**: it stays user-only with an explicit confirm (§9), and the confirm
      names **how many** documents will be deleted, **lists them**, and says how
      many threads will be left as **orphaned records**. It is offered **only on a
      selection whose documents are enumerated** — a whole-result-set selection
      cannot be deleted, because "all 412 matching" is not a set anyone read
      before confirming

### Selecting a whole result set

- [ ] Select-all selects the rows **currently listed**, saying how many
- [ ] When the query matches more than is listed, a **second, separately
      labelled** act extends the selection to everything the query matches,
      **naming that number before it is taken**
- [ ] The count is re-evaluated when the action runs, and the result reports the
      documents actually changed — **saying so when that differs** from the number
      shown

## Technical Design

### Files to Create/Modify

- `apps/ui/src/board/ColumnList.tsx` — the row seam (`.col-list`, `items.map(…)`,
  the existing `onContextMenu`); where a row's selected state and its selection
  control land
- `apps/ui/src/board/Column.tsx` / `ColumnHead.tsx` — the count, the actions, and
  the clear control
- `apps/ui/src/board/useBoardLocalState.ts` — selection is browser-local state and
  belongs beside scroll positions, **not** in the view document
- `packages/kit/src/row/Row.tsx`, `row.css` — the selection control and the
  selected affordance, without disturbing the existing badges, reason chips and
  staleness quick actions
- `apps/ui/src/keyboard/shortcuts.ts` — `x`, `⇧↑`/`⇧↓`, `⌘A` in the single
  `SHORTCUTS` source (the cheat sheet generates from it)
- `apps/ui/src/keyboard/boardCommands.tsx`, `apps/ui/src/shell/Board.tsx` — the
  commands themselves, beside `archiveTarget` / `moveRowCursor`
- `apps/ui/src/reader/useEscapeStack.ts` — `esc` ordering: the selection clears
  **last**
- `apps/ui/src/menu/` — a **row-selection** menu, and the context-menu branch that
  chooses between it and the single row's menu. **Naming hazard**: `menu/`
  already has `SelectionMenuItems.tsx`, `useSelectionContextMenu.tsx` and
  `selectionCopy.ts`, and every one of them is about a **text** selection in the
  document body (Comment on selection, Copy/Cut/Paste). Do not extend them, and do
  not reuse the word "selection" unqualified in new symbols — pick a name that
  distinguishes rows from text and the next reader is spared a trap
- `apps/ui/src/menu/docActions.ts` — the one action declaration behind both ⋯ and
  the context menu; the selection's actions must be derived from it rather than
  written a second time (§10: "listing exactly that item's existing actions,
  nothing invented")
- **A persistent result surface** — see below
- `packages/kit/src/query/` — the mutation over CONTRACT-037's route, and the
  invalidations
- e2e: a new spec in `apps/ui/e2e/`

### Key Implementation Details

**The result surface does not exist yet, and a toast cannot be it.**
`apps/ui/src/shell/Toasts.tsx` auto-dismisses after 6 s and caps at 3 — so a
twenty-document result with three named failures would either vanish while being
read or be dropped for being the fourth notice. §10 requires the opposite: "it
**stays until it is dismissed**; it is never a message that disappears on its own,
because the part worth re-reading is the part that did not happen." So this issue
needs a surface that persists and can hold three lists of named documents. The
one persistent surface today is `LockBanner`, and the console drawer is the one
persistent *status* surface. Decide deliberately where the result lives, and do
not let "reuse the toast" win by being nearest — the persistence is a stated
requirement, not a nicety.

**Derive the actions; do not re-declare them.** §10's governing rule for the
context menu is "listing exactly that item's existing actions, nothing invented",
and the selection menu must obey it rather than sidestep it. `docActions.ts` is
that list. An action is offered only when it applies to **every** selected item,
so the offered set is an intersection computed from the same declaration, which
is also what keeps Resolve away from a mixed selection for free.

**One request per action, not one per document.** This is the whole reason
CONTRACT-037 exists. A loop over the single-document routes would produce twenty
commits and a result the UI assembled itself — and the auto-committer's fold
decision keys on the same `docId` and actor, so those twenty can never fold into
one. If the batch route is missing something the board needs, that is a contract
change, not a client-side loop.

**"Already in that state" is not a failure and must not be rendered as one.** A
document already archived contributes nothing to the commit and belongs in the
middle list. Collapsing it into either neighbour is the easiest way to make the
result lie in the direction that matters least but erodes trust fastest.

**The selection reducing to the untouched documents is the retry.** After the
action, the selection is exactly the set that did not change — so "unlock and try
again" is one gesture. Note the interaction with the rule above it: rows that
changed often leave the list (an archive drops them from an Inbox column), and
rows that leave the list leave the selection with them. Both rules point the same
way; implement them as one reduction, not two that race.

**`⌘A` is the only binding that takes a key the browser also uses**, which is why
§10 narrows it to "only while the list itself has focus". `useShortcuts.ts`
already has `isWritingSurface` and `currentScope` for exactly this kind of
narrowing — use them rather than a global preventDefault.

**Extending to the whole result set is not a key.** §10 says so explicitly: it is
a second, separately labelled act that names the number before it is taken. And
bulk delete is excluded from it entirely.

### Edge Cases

- A selected row whose document is deleted or archived by the agent while the
  selection is live (arriving over SSE) — it leaves the list, and the selection
  with it; the count on screen updates
- Every selected document already in the target state — a successful act that
  changed nothing; the result says so and the commit does not exist
- Every selected document refused — the selection is unchanged (all of them did
  not change), and the retry is one gesture
- A selection of one — the same paths, not a special case that quietly routes to
  the single-document route
- Selecting, then switching columns and back — the selection cleared when the
  other column's selection started, and did not resurrect
- A locked document among the selected, where the lock clears between the action
  and the retry
- `esc` with an overlay open, a reader open, and a non-empty selection — three
  presses, in that order
- Right-click on a row while a selection exists in **another** column
- ~~A plugin column, whose rows render through the plugin's `ListItem`~~ —
  **struck 2026-08-22 by SHARED-065 (Phase 41).** SHARED-064 removed the plugin
  surface, so every column renders its rows through the core `Row`. There is no
  second renderer for selection to reach or miss.

## Testing Strategy

Component and unit tests: the selection reducer (add, extend, reduce-to-untouched,
clear rules), the offered-action intersection, the three-part result rendering
with each part populated independently, and the keyboard bindings resolved
through `SHORTCUTS`.

E2E in `apps/ui/e2e/`, against the real app — most of these are only meaningful
end-to-end:

- twenty rows selected, three locked by the agent → seventeen change, the result
  names the three **with their holders**, the selection is reduced to exactly
  those three, and `git log` shows **one** commit touching seventeen files
- a selection containing an already-archived document, then Archive → it lands in
  the "already in that state" list, not in the failures, and contributes nothing
  to the commit
- select-all on a column whose query matches more than is listed → the two acts
  are distinguishable and the second names the number before it is taken
- a selection holding a note and a thread → Resolve is not offered
- bulk delete → the confirm names the count, lists the documents and the
  orphaned-thread count; the action is absent on a whole-result-set selection
- `esc` with a reader open and a non-empty selection → the reader closes first,
  the selection survives; `esc` again clears it
- selecting rows → no file changes, no commit, no diff in the column's view
  document
- a bulk archive immediately after an autosave on one of the same documents →
  **two** commits, not one folded entry

## E2E Verification Plan

### Verification Steps

1. Start the real app against a scratch workspace on a non-default port, with
   enough documents in one column to make twenty selectable.
2. Take an agent lock on three of them through the real lock routes.
3. Select twenty rows with the keyboard alone (`x`, `⇧↓`), confirm the count on
   screen, and archive the selection.
4. Read the result: seventeen changed, the three named with their holders. Leave
   it on screen and navigate — it is still there until dismissed.
5. `git log --name-only` in the workspace: **one** commit, seventeen files, the
   acting party as author, and a message naming the action and the documents it
   changed (§4).
6. Confirm the selection now holds exactly the three refused documents. Release
   one lock and re-run the action — one gesture, one further commit, one file.
7. `git status` clean of any view-document change, and `corpus db doctor` clean.
8. Repeat the confirm path for bulk delete on an enumerated selection, and confirm
   the action is absent on a whole-result-set selection.

## E2E Verification Log

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output,
confirmation the feature works. State which model you ran on.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-083]` prefix
