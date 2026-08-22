# [UI-036] Todo document rows on the board have no context menu at all

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §10 context menus (core actions on documents); SHARED-004 item 4
  (plugin-rendered surfaces out of scope — which these rows are NOT)

## Summary
Found by sprint-023 pre-flight (2026-08-02), almost certainly most of what the
user's "right click does nothing" dogfood report actually hit. The context-menu
suppression keys on `resolveListItem(type)` in three places (`ColumnList.tsx:108`,
`Board.tsx:380`, `nativeMenu.ts:23`), so ANY document whose type has a plugin
ListItem — every todo doc row on the board — gets no context menu whatsoever:
no open, open-in-focus, archive, delete, or staleness actions, via right-click
or ⇧F10. The signed scope exclusion covers plugin-RENDERED surfaces; these are
core rows for a core subject and must have the full core menu.

## Acceptance Criteria
- [x] Todo document rows (and any plugin-typed doc rows) get the standard core
      document context menu, right-click and ⇧F10
- [x] Rows actually rendered by a plugin column body remain excluded (the
      signed rule stands until amended)
- [x] The bail condition is "surface is plugin-rendered", not "type has a
      plugin ListItem", in all three sites
- [x] E2E in context-menu.spec.ts (NOT todos.spec.ts — single-holder is UI-034
      this sprint)

## Technical Design
### The discriminator
`[data-plugin-surface]` — the attribute `nativeMenu.ts` already used for plugin
`View`s — is now the **only** thing any suppression site reads, and the plugin
**column body** stamps it too (`Column.tsx`, on the `.col-list` wrapping the
registered `Component`). That is what let the type-keyed bails go: a row's
surface knows its own origin, so core never has to guess it from a document's
type. The rule has one spelling, `isPluginRendered(node)` in `nativeMenu.ts`,
which `keepsNativeMenu` folds into its own host list from the same constant.

### Files to Create/Modify
- `apps/ui/src/menu/nativeMenu.ts` — `PLUGIN_SURFACE` hoisted and reused by
  `NATIVE_HOSTS`; new exported `isPluginRendered(node)`
- `apps/ui/src/board/Column.tsx` — `data-plugin-surface` on the plugin column
  body container (the stamp that makes the surface test true)
- `apps/ui/src/board/ColumnList.tsx` — type-keyed bail deleted;
  `keepsNativeMenu` (which tests the attribute) is the whole rule
- `apps/ui/src/shell/Board.tsx` — ⇧F10 bails on `isPluginRendered(element)`,
  asked of the painted row, not of `subject.type`
- `apps/ui/e2e/context-menu.spec.ts`, `apps/ui/src/menu/nativeMenu.test.ts`,
  `apps/ui/src/menu/rowContextMenu.test.tsx`,
  `apps/ui/src/board/pluginColumn.test.tsx`

## Testing Strategy
Component tests on the bail predicate; e2e right-click on a todo doc row.

## E2E Verification Plan
Real app with the todos plugin active: right-click a todo document row → full
core menu; actions work.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Real Chromium via Playwright against a
real Vite dev server (`CORPUS_UI_PORT=5473`, port 5173/5273 held by other
agents), `apps/ui/e2e/context-menu.spec.ts`. The API is `stubCorpus` plus the
todos plugin's real aggregate route — per sprint-016 Adjudication 19 this is the
browser half; the plugin itself is the real bundled `plugins/todos` manifest, so
`TodoListItem` is genuinely what paints the row under test.

### 1. Reproduction, before the fix (pointer and keyboard)
The two type-keyed bails were temporarily reinstated (`resolveListItem(row.type)`
in `ColumnList.tsx`; the equivalent on `subject.type` in `Board.tsx`) and the two
new cases run against them:

```
✘ 1 … › gives a todo document row the same menu a note row gets (6.1s)
✘ 2 … › ⇧F10 opens the todo row's menu, with its first item focused (5.8s)
    Error: expect(locator).toBeVisible() failed
    Expected: visible
    Error: element(s) not found     >  337 |     await expect(menu).toBeVisible();
```

Subject: `.row[data-row-doc="doc_todo"]` (`type: todo`, title "Inbox chores",
painted with `class="row todo-row"` by `TodoListItem`), in the ordinary `Inbox`
column beside a `note` row. Right-click produced **no** `role="menu"` node at
all, and `Shift+F10` on the same row with `.row.kbd` on it produced none either
— the whole core action set missing, exactly as filed. The temporary bails were
then removed and the file re-verified clean (`grep TEMP-REPRO` → nothing).

### 2. After the fix — pointer path
`.row[data-row-doc="doc_todo"]` right-clicked → `role="menu"` named
**"Actions for Inbox chores"**, and the rendered `data-act` sequence read back
off the DOM is `["open", "open-focus", "archive", "delete"]` — asserted **equal
to** the sequence the `note` row in the same column produces on the same gesture.
The row's plugin origin is asserted in the same test rather than assumed
(`toHaveClass(/todo-row/)`, and `.todo-items .t` containing "Call the plumber"
from the plugin's own aggregate), so the case cannot pass by the plugin silently
not being loaded. `[data-act="archive"]` was then clicked: the stub store's
`doc_todo` moved to `status: "archived"` and exactly one
`POST /api/docs/doc_todo/archive` was recorded — the core route, from the core
menu, on a plugin-typed document.

### 3. After the fix — keyboard path
Hover `doc_todo` → `ArrowDown` → `.row.kbd` carries `data-row-doc="doc_todo"` →
`Shift+F10` → the same "Actions for Inbox chores" menu, with
`[data-act="open"]` focused (`toBeFocused()`).

### 4. The negative: the signed exclusion still holds
A second, **plugin** column (`column: "todos/todos"`, the real `TodosColumn`)
was pinned on the same board. Its body container carries exactly one
`[data-plugin-surface]`; right-clicking its own `.check` item row ("Call the
plumber") opened **no** Corpus menu — the browser's, as SHARED-004 item 4
requires. In the same page, the same gesture on the core column's `doc_todo` row
still opened "Actions for Inbox chores", so the exclusion is scoped to the
surface and not to the document type. The ⇧F10 half of this negative is pinned in
jsdom (`rowContextMenu.test.tsx`), where `e` is pressed afterwards to prove the
cursor really was sitting on the plugin body's row — the silence is the rule
firing, not a cursor that never moved.

### Checks
- `playwright test e2e/context-menu.spec.ts` — **24 passed** (21 pre-existing +
  3 new), `CORPUS_UI_PORT=5473`, re-run green after the reproduction revert.
- `vitest run --root apps/ui src` — **1639 passed / 108 files**.
- `tsc --noEmit` in `apps/ui` — clean. `eslint` + `prettier --check` over
  `apps/ui/src` and `apps/ui/e2e` — clean.
- Ports: 5473 released; 5173/5273 (other agents') untouched. No stray vitest or
  playwright process left behind.

### Notes for the reviewer
- `packages/kit`, `packages/contract` and `plugins/**` are byte-identical
  (TEST-1076: no core file imports a plugin module as a result of this change —
  `Board.tsx` in fact *dropped* its `resolveListItem` import).
- `nativeMenu.ts`'s behaviour is unchanged (TEST-1075): `[data-plugin-surface]`
  was already in `NATIVE_HOSTS` and still is, now spelled from one constant.
- The e2e fixture's todo row reaches the plugin's aggregate route, so a
  regression that unloads the plugin turns the `todo-row` assertion red rather
  than passing quietly.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
