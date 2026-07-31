# [UI-018] Right-click context menu for actions on the selected item

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-004 (type-aware rows), UI-012 (DocMenu)
- Blocks: —

## Spec References
- SPEC.md §11 — new "Right-click context menu" bullet (before the keyboard scheme), amended and signed off 2026-07-30 (SHARED-004): rows, column headers, readers, and console job rows get a menu with exactly that item's existing actions (nothing invented), targeting the item under the cursor; native menu preserved on text selections, editable fields, and off-item; ⇧F10/menu-key opens it on the keyboard highlight; plugin-rendered surfaces excluded in v1.

## Summary
User request (2026-07-29, follow-up phase after PR #11): override the browser's
right-click so a context menu surfaces the actions available on whatever item is under
the cursor / selected — document row, view/column, thread, etc. The actions themselves
already exist (DocMenu, view menus); this is a second, pointer-native way to reach
them. Design questions for the spec pass: which surfaces get a menu, whether native
browser context menu remains reachable (e.g. on text selection for copy), and keyboard
accessibility parity.

## Acceptance Criteria
- [x] spec-writer amends SPEC.md with the surface-by-surface behavior (user-signed-off)
- [x] Right-click on a document row / view header / other specified surfaces opens a menu with that item's existing actions (no new actions invented)
- [x] Native context menu preserved where spec'd (at minimum: inside text selections and editable fields)
- [x] Menu is dismissible and keyboard-accessible per the app's existing menu conventions

## Technical Design

### Files to Create/Modify
- apps/ui — a shared context-menu component (or @corpus/kit if plugins should reuse it); wire into row/view components

### Key Implementation Details
Reuse the action lists that power DocMenu/view menus — one source of actions, two presentations. To be refined after the spec amendment.

### Edge Cases
- Right-click on an item that isn't the current selection (menu targets the clicked item).
- Plugin-rendered surfaces (todos view) — in or out of scope, decide at spec time.

## Testing Strategy
Vitest for menu wiring; Playwright for right-click flows.

## E2E Verification Plan

### Verification Steps
1. Real app: right-click a doc row → its actions appear and work; right-click selected text → native menu still available (per spec decision)

## E2E Verification Log

**implemented on: opus** (issue recommendation: opus).

### Where the primitive lives, and why (TEST-443)

**`apps/ui/src/menu/`, not `@corpus/kit`** (Adjudication 21). Plugin-rendered surfaces are
out of v1 scope, so a kit export would be public plugin-facing surface with no consumer;
moving it to kit when plugin surfaces are in scope is a later, cheap change, and unshipping
a kit export is not. `packages/kit` is **untouched** by this issue.

### One source of actions, two presentations (TEST-440)

`menu/docActions.ts` is the single declaration. The reader's `⋯` sheet (`DocMenu`,
`.comments-pop` / `.cp-item`) and every context menu (`.ac-menu` / `.ac-item`) render the
same array through `menu/MenuItems.tsx`, so availability changes in both at once. Each item
calls the shipped unit — `useRowActions`, `useSetThreadStatus`, `useDeleteDoc` — never a
parallel implementation. `hasStaleActions` is consulted, not duplicated.

### One dismissal story (TEST-442)

`ColumnMenu.tsx` is **deleted**. Its capture-phase mousedown and private Escape handling are
gone; the column header's `⋯` and its context menu both open `menu/ContextMenu.tsx`, which
registers at `EscapeLayerPriority.Popover` in the existing chain. Two implementations before
this issue, one after.

### The real app, real server, real files

Workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui018-gD8cCm`, created from
a cwd **outside** this repository, server on `9189`, Vite on `5291`.

**Proxy target proved (Adjudication 2):**

```
$ curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:5291/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":158.297,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-ui018-gD8cCm"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
(nothing bound on 8765 — never proxied into)
```

**The drill** (real Chromium, real right-clicks, `drill-ui018.mjs`):

```
== 1. right-click a document row ==
  menu name: Actions for Mortgage options
  items: ["open","open-focus","archive","delete"]
== 2. the menu targets the row under the cursor, not the highlight ==
  keyboard highlight is on: doc_bqpj7rv7
  right-clicked doc_nybrhyuk; menu name: Actions for Rates
== 3. ARCHIVE from the context menu — a real corpus change ==
  archived doc_nybrhyuk via the row context menu
== 4. the native menu survives inside the editor ==
  corpus menus open while right-clicking the editor: 0
  reader menu items: ["review","archive","delete"]
== 5. ⇧F10 on the keyboard highlight ==
  menu name: Actions for Mortgage options
  focused item: open
  after ArrowDown, focused item: open-focus
  after Escape, menus open: 0
== 6. column header ==
  menu name: List options for Inbox
  items: ["rename","edit-query","unpin"]
== 7. DELETE from a row's context menu — two activations ==
  after one activation, item reads: Really delete? Click again…
  deleted doc_bqpj7rv7 from the row context menu
```

**The corpus actually changed** (TEST-444) — `git log --format='%an %s'` in the workspace:

```
user doc delete: Mortgage options (doc_bqpj7rv7) by user     <- from the row context menu
user doc edit:   Rates (doc_nybrhyuk) by user                <- Archive, from the row context menu
user doc create: Mortgage options (doc_bqpj7rv7) by user
user workspace: initialize corpus workspace by user

$ grep -n '^status:' data/docs/inbox/rates.md   ->  status: archived
$ ls data/docs/inbox/                           ->  rates.md          (mortgage-options.md is gone)
$ curl .../api/docs/doc_bqpj7rv7                ->  404
$ corpus db doctor  ->  projection is clean — 9 documents from 9 files (1ms)
```

Step 2 is the destructive-shaped check TEST-433 asks for: the highlight was on
`doc_bqpj7rv7` and the archive landed on `doc_nybrhyuk`, the row under the cursor.

### Found in the browser, not in jsdom

A pointer-opened menu left focus on the body, so `↑`/`↓` never reached it — "arrows
navigate" was a promise the menu could not keep. `ContextMenu` now focuses its container on
open (`tabIndex={-1}`), and focuses the *first item* only when a key opened it.

### Playwright, scoped, once

`apps/ui/e2e/context-menu.spec.ts` (8 tests): real right-clicks on a row, a column header
and the open reader; target-vs-highlight with a destructive action; the two-activation
delete; escape and arrow navigation; ⇧F10; and the native menu surviving on a field, inside
the editor, and off any item. Ran once with the other two specs: **20 passed**.

### Unit tests (TEST-444)

`apps/ui/src/menu/{menuModel,nativeMenu,ContextMenu,rowContextMenu}.test.*` — action-list
derivation per surface and per staleness tier, target resolution (cursor item vs. keyboard
highlight), native-menu passthrough decisions, plugin `ListItem` passthrough, the frame's
dismissal/keyboard/focus contract. Whole workspace: **98 files, 1446 tests, all passing.**
No new coverage exemption.

### Scope

`apps/ui` only — `packages/kit`, `SPEC.md` and `packages/contract` are untouched.
Plugin-rendered rows and plugin column bodies get the **native** menu (TEST-437): the row
handler consults `resolveListItem(row.type)`, a plugin `View` marks its surface
`data-plugin-surface`, and no handler is attached inside a plugin column body at all.

### Shipped spec pin reconciled to the amended §11

`apps/ui/e2e/compose-keyboard.spec.ts`'s cheat-sheet test pinned "SPEC.md §11's **twelve**
bindings". UI-018 adds a thirteenth, and it is a §11 binding: the section's right-click
bullet says "the menu key (or ⇧F10) opens the same menu on the current keyboard highlight".
The spec now pins **thirteen**, with `menu.open` listed among the row bindings (which is
what it acts on), and carries a comment naming the bullet the thirteenth comes from — so it
stays a genuine pin on the amended spec rather than a count that was loosened to go green.
Caught by the full e2e suite, which a scoped run of the three new specs could not see.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[ISSUE-ID]` prefix
