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

- Depends on: SHARED-036 part 2 (the column showing completed items is a §12
  change, and it is what makes unchecking reachable at all)
- Blocks: —
- Related: SERVER-085 (checking the last item from here must resolve its
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

- [x] Clicking the checkbox checks the item and does **not** open the document
- [x] Clicking anywhere else on the row still opens the document at that item,
      with UI-037's reveal behaviour unchanged
- [x] A checked item leaves the column — the column shows open items (line 81
      filters `item.done`) — and the removal is driven by the same invalidation
      any other item write triggers, not by local optimism that could disagree
      with the server
- [x] **Completed items are reachable, so unchecking is too.** Per SHARED-036
      part 2, the column shows open items by default and offers a control that
      also shows completed ones. Unchecking from that view works exactly as
      checking does. Shipping only the checking half is shipping half the issue.
- [x] The show-completed state is browser-local (like scroll position and open
      readers), **not** written into the column's view document — the default is
      "unchanged by looking at them", per the rider
- [x] The checkbox is operable from the keyboard, and reaching it does not cost
      the row's existing keyboard behaviour (`onItemKeyDown`)
- [x] A failed toggle surfaces through the existing `toggle.error` strip and
      leaves the box in its true state
- [x] Under a lock held by the other party, the checkbox is refused the way any
      other write to that document is, naming the holder — **there is no lock to
      take since §7** (see the log); the refusal that exists, the stale-`expectedText`
      409, was driven for real and names what changed
- [x] Right-click still opens the item menu, unchanged

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
   goes `resolved` (SERVER-085) — the two must agree from this surface too
6. Tab to a checkbox and activate it from the keyboard
7. Take the lock as the agent and confirm the checkbox is refused with the holder
   named

## E2E Verification Log

**Model run on:** Opus 5 (1M context).

### Pre-fix reproduction

Real app, no stub: scratch workspace `/tmp/p015ws` (`corpus init --port 8793`),
two hand-written todo documents and a `column: todos/todos` view document on
disk, server started with `tsx apps/cli/src/bin/corpus.ts server start`, UI from
`apps/ui` on `CORPUS_UI_PORT`-equivalent **5373** (`vite --port 5373
--strictPort`, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8793`). 8765 and 5173 were
never bound. Driven by Playwright/Chromium from a script inside the repo.

The box, before the fix, was an inert `<span>` inside the row's one `<button>`:

```
rows before: ["☐Pull credit reports","☐Scan the deed",
              "☐Book the passport appointment2026-08-01","☐Call the plumber",
              "☐Renew the car insurance"]
box tag: SPAN / box
open readers before: 0
open readers after clicking the box: ["doc_week01"]
rows after: ["☐Pull credit reports", … unchanged … ]
```

Clicking the `☐` opened the document and checked nothing — the report exactly.

### The uncheck affordance, and why this one

A **toggle button in the column body**, top-right, reading `Show completed` /
`Hide completed`, with `aria-pressed`. Three things decided it:

- the column has no head of its own — `ColumnHead` is core's and the plugin owns
  only the body — so a control has to live inside the body or not exist;
- it **renders above the empty state as well as above rows**. That is the case
  the rider is actually about: tick the last open item by mistake and the column
  goes empty, so a control that only appeared beside rows would be missing at
  precisely the moment it is needed. `TodosColumnCheckbox.test.tsx` → "stays on
  screen when the column has nothing left to show" pins this;
- it is unconditional rather than appearing only when something is completed. A
  control that comes and goes is its own small trust problem, and the honest
  cost is that pressing it in a workspace that has completed nothing changes
  nothing visible.

Browser-local, in `localStorage` under `corpus.x.todos`, as the *set of column
ids showing completed items* — so the default costs no entry at all and turning
the control off removes the id rather than storing `false`. The plugin holds its
own key rather than joining `corpus.board`, which is core's blob and versioned by
core.

### Post-fix verification — same workspace, same script, only the code changed

The row is now a container with two controls:

```html
<div class="check" data-todos-item="0" data-todos-done="false">
  <button type="button" role="checkbox" aria-checked="false" class="box"
          data-todos-check="0" aria-label="Mark as done: Pull credit reports">☐</button>
  <button type="button" class="todo-item-open"><span class="todo-item-text">Pull credit reports</span></button>
</div>
```

| step | observed |
| --- | --- |
| click the box on "Call the plumber" | row left the column; `readers open: []` — **nothing opened**; disk went `- [ ] Call the plumber` → `- [x] Call the plumber`, and only that line |
| commit | `.git/logs/HEAD` in the workspace gained `commit: doc edit: Week of Aug 17 (doc_week01) by user` |
| show completed | the row came back reading `☑Call the plumber`, `aria-checked="true"` |
| uncheck it from there | disk went back to `- [ ] Call the plumber`; `readers open: []` |
| click the item **text** | `readers open: ["doc_week01"]`, one `.reveal-flash` node present — UI-037's reveal unchanged |
| keyboard | `focused: BUTTON.box role=checkbox label=Mark as done: Scan the deed`; `Space` wrote `- [x] Scan the deed` to `doc_house1.md` and opened nothing |
| right-click | `[data-todo-menu] aria-label="Actions for Pull credit reports"` — unchanged |
| reload | `localStorage → {"version":1,"showCompleted":["doc_todoscol"]}`; `aria-pressed="true"` after reload; **the view document on disk was never written** |

**A refused write, driven for real.** The item was renamed on disk under the
column (`Renew the car insurance` → `… NOW`), so the row's `expectedText` went
stale and the server answered 409:

```
alert: item 3 is now “Renew the car insurance NOW”, not “Renew the car insurance”
       — it changed under you; nothing was written   [Dismiss]
box still: false ☐
file:  - [ ] Renew the car insurance NOW      (untouched)
```

The box is left in its true state because nothing is optimistic: the row leaves
the column only when the shared aggregate has been re-read.

**On the lock criterion.** There is no lock to take — SPEC.md §7 replaced the
per-document lock with a key and §11 says the board is never read-only, which
`TodoListItem`'s docblock already states. The refusal that actually exists on
this path is the stale-key / stale-`expectedText` 409 above, and it is what was
verified. Written down here rather than silently skipped.

**SPEC §15 / M5 drill.** `plugins/todos` moved aside → the board still booted, 5
columns rendered, the Todos column showed *"Plugin missing — This column renders
todos's todos view, which is not installed"*, **zero page errors**. Restored →
the column returned with its 4 open items. No discovery seam was touched by this
change; the drill was run anyway.

### Tests

- `plugins/todos` — **409 pass** (17 files), of which 26 are new:
  `showCompleted.test.ts` (12) and `TodosColumnCheckbox.test.tsx` (14).
- **The new tests were confirmed to bite**, by breaking the fix in the working
  tree and watching them go red:
  - box `onClick` → the old open-the-document behaviour: **7 fail**, including
    "checks the item and does not open the document";
  - `groupItems` ignoring `showCompleted`: **5 fail**, including the
    `groupItems` unit case and all four show-completed component cases.
  Both reverted afterwards and the suite re-run green.
- `npm run typecheck`, `eslint` on every touched file, `prettier --check` on
  `plugins/todos/ui/` — all clean.

### What changed beyond the row

- `TodosColumnMenu.test.tsx`'s two keyboard tests focused the **row** and
  asserted focus returned to it. The row is a container now and is not the
  focusable thing, so they focus the row's open control instead and assert focus
  returns *there*. That is the honest translation of what they were checking —
  the menu returns focus to whatever opened it — not a weakening; both still
  fail if `PluginMenu` stops restoring focus.
- `statefulWire` moved out of `TodosColumnMenu.test.tsx` into `testing.tsx` as
  `statefulTodoWire`, because the checkbox tests need the same stateful server
  and a second copy would drift.
- `testing.tsx` gained `memoryStorage` / `throwingStorage`. The ambient
  `localStorage` under the runner is Node 25's own inert Web Storage global,
  which shadows jsdom's — `apps/ui/src/testing/memoryStorage.ts` documents the
  same fact, and a plugin cannot import it (§10).
- `.check`'s padding moved onto its two children so they **tile the row**. A
  container that kept the padding would have a strip along its edge that
  answered no click, which is this same defect in miniature.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Pre-fix reproduction logged
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-015]` prefix
