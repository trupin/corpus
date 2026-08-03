# [PLUGINS-009] Todo item rows: right-click quick actions (toggle, comment/open thread)

## Domain
plugins

## Status
done — the SPEC §11 amendment was SIGNED 2026-08-02 (sprint-023 OC2 resolved:
"Amend — plugin menus in"); the amended §11 text allows plugin-rendered
surfaces to contribute context menus through the kit. UI-037 shipped, so the
"open thread" payload is the reveal seam.

## Priority
P2

## Model
opus

## Dependencies
- Depends on: PLUGINS-005, PLUGINS-003, UI-037 (reveal payload for "open
  thread"), SPEC §11 amendment sign-off
- Blocks: —

## Spec References
- SPEC.md §12 todos; §11 context menus (UI-024 pattern)

## Summary
Live dogfood report (2026-08-02): right-clicking a todo item row in the todos
board column does nothing. The core board rows (`ColumnList.tsx`) and the reader
(`DocView.tsx`) have context menus, but the todos plugin renders its own item
rows with no `onContextMenu` at all. The user expects quick actions on an item
without opening the document: toggle done/open, comment on the item (opens an
anchored thread per PLUGINS-003), and open the item's existing thread when one
exists.

## Acceptance Criteria
- [x] Right-click on a todo item row opens a context menu: toggle done/open;
      comment on item; open existing thread (shown only when the item has one)
- [x] Toggle goes through the plugin's atomic mutate path (PLUGINS-004) and the
      row preview refreshes without reload
- [x] Comment produces the same anchored thread as selecting the item's text in
      the reader (PLUGINS-003 anchors) — no new thread shape
- [x] Menu matches the board's existing context-menu look/keyboard behavior
      (UI-028/UI-030 conventions)

## Technical Design
### Files to Create/Modify
- `plugins/todos/` column row components
- `packages/kit` if the shared context-menu primitive is not yet exported to
  plugins — escalate if the kit surface needs a new export

## Testing Strategy
Component tests for the menu actions; e2e in apps/ui/e2e/todos.spec.ts.

## E2E Verification Plan
Real app: right-click an item → toggle flips the checkbox in the document;
comment opens an anchored thread quoting the item.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), 2026-08-02, branch `dogfood-todos-polish`.**

### What was built

The menu is the **plugin's own**, in `plugins/todos/ui/`. The kit publishes no
context-menu surface (sprint-023 C6 is still true: `packages/kit` exports rows,
badges, staleness and the query hooks, and nothing from `apps/ui/src/menu/`), so
`PluginMenu.tsx` is a ~190-line frame written to the app's conventions rather
than to new ones — see the kit-gap note at the end.

Three actions, all of them the item's and none of them exclusive:
`Mark as done`/`Mark as open` · `Comment on item` · `Open existing thread`
(present only when a non-orphaned anchor on the parent quotes exactly the item's
text). The write path is `PUT /api/x/todos/{docId}/items/{index}` carrying
`expectedText`; the comment path is `POST /api/threads` through the kit's own
`useCreateThread`, with a §6 selector sliced from the parent body; the thread
path is `onOpen({docId, reveal: {kind: "thread", threadId}})` on UI-037's seam.

### Real app, real workspace (the half no browser stub can give)

`corpus init /tmp/corpus-drill-009 --port 8791` → a hand-written todo document
and a pinned `column: todos/todos` view on disk → real server (`corpus server
start`, pid 83186) → `vite --port 5975` from `apps/ui` with `VITE_CORPUS_TOKEN`
and `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` → driven with Chromium.

```
1. COLUMN ROWS: ["☐Book the passport appointment2026-08-01","☐Call the plumber"]
2. MENU LABEL: Actions for Call the plumber
2. NATIVE MENU PREVENTED: true
2. ACTIONS: ["Mark as done…","Comment on item…"]          ← two, no greyed third
3. ROWS AFTER TOGGLE: ["☐Book the passport appointment2026-08-01"]
4. COMPOSER QUOTE: “Book the passport appointment”
5. THREAD REQUEST: {"parent":"doc_drillchores",
     "selector":{"exact":"Book the passport appointment",
                 "prefix":" [x] Send the signed form\n- [ ] ",
                 "suffix":" (due: 2026-08-01)\n- [x] Call th"},
     "body":"Drill: which consulate?","requestsAgent":true}
6. READER DOC: doc_drillchores
7. ACTIONS WITH A THREAD: ["Mark as done…","Comment on item…","Open existing thread…"]
```

**On disk afterwards** (`data/docs/inbox/chores.md`): the toggle changed exactly
one character — `- [ ] Call the plumber` → `- [x] Call the plumber` — and every
other line, including the fenced prose above the list, is byte-identical. The
comment added the anchor to the parent's frontmatter:

```yaml
anchors:
  anc_ffe8a9b7:
    exact: Book the passport appointment
    prefix: |2-
       [x] Send the signed form
      - [ ] 
    suffix: |2-
       (due: 2026-08-01)
      - [x] Call th
```

and wrote `data/threads/th_z2noh7h4.md` with `parent: doc_drillchores`,
`anchor: anc_ffe8a9b7`, `agent: requested` and one `## user · …` turn. Two git
commits, authored as `user`, in the workspace repo:

```
14ebd2c comment: new thread on doc_drillchores (th_z2noh7h4) by user
1c3c5cf doc edit: Drill chores (doc_drillchores) by user
```

Re-read through the API, the anchor **resolves** — this is the "indistinguishable
from a reader selection" claim, checked rather than asserted:

```
anchorId anc_ffe8a9b7 thread th_z2noh7h4 orphaned false range {"start":68,"end":97}
body slice: "Book the passport appointment"
```

Keyboard conventions, same workspace, second pass:

```
A. focused after ⇧F10: toggle          E. menus open: 0 | readers open: 0
B. focused after ↓: comment            F. focus back on row: 1
C. focused after ↓↓: open-thread       G. ↵ opened the composer: “Book the passport…”
D. focused after ↑: comment            H. composer after esc: 0 | readers: 0
```

`↵` activating a menu item rather than the board's `rows.open` is inherited, not
re-implemented: the frame declares `role="menu"`, which is exactly what
`apps/ui/src/shell/overlays.ts` queries to take the board's keys out of scope
(UI-028). Escape is heard on `window` in the capture phase, ahead of the escape
registry's `document` listener, so the menu closes and the reader underneath
does not — the precedence a core menu gets from `EscapeLayerPriority.Popover`.

Server stopped (`stopped (pid 83186)`), Vite killed, ports 5975/8791 verified
free, scratch driver scripts deleted.

### Browser suite

New `apps/ui/e2e/todos-menu.spec.ts` — 8 tests, real Chromium against the real
Vite dev server on `CORPUS_UI_PORT=5973` (5173 and 8765 left alone; both held).
**8 passed (5.4s)**, and **24/24 with `--repeat-each=3`**. Neighbours re-run to
prove no regression: `todos reveal context-menu` → **69 passed** after the one
amendment below.

`context-menu.spec.ts`'s "leaves a plugin column body's own rows to the browser"
(TEST-1075) **had to be amended**, because the SPEC sentence it encodes is the
one the user reversed. What UI-036 is actually about survives and is what the
test now asserts: **core** paints no menu over a surface it handed to a plugin
(`[data-ctx-menu]` count 0), and what does open is the plugin's own frame,
naming the item rather than a document. The core column beside it is unchanged.

### One defect found, in someone else's code — reported, not worked around

`{kind: "thread"}` reveals are dropped **in development only**, and this menu is
the first caller to trip it. `useReaderSurface` resets `expanded`/`flash` in a
`[reader.docId]` effect and honours the reveal in a later one; the order is
right, but StrictMode replays both, the reset runs a second time, and the
reveal's identity guard correctly refuses to re-fire — so nothing puts the
expansion back. It only bites when the document is **already cached** at reader
mount, which is exactly what this menu guarantees (it reads the document to
decide whether the item has a thread). Proven by removing `<StrictMode>` from
`main.tsx` and re-running the one test: `.thread-slot.expanded[data-slot-thread=
"th_plumber"]` and `.thread-card.flash` both appear and it passes. `main.tsx`
was restored immediately (`git status` clean for it). A production build runs
effects once, so the shipped app is unaffected; `npm run dev` is not.

The e2e therefore asserts what this issue owns — the action opens the parent
document and the thread is there at its anchor — and the exact payload
(`{docId, reveal: {kind: "thread", threadId}}`) is pinned in
`plugins/todos/ui/TodosColumnMenu.test.tsx`. The reasoning is written into
`todos-menu.spec.ts` as `DEV-STRICTMODE` so the next reader does not rediscover
it. **A UI issue should be filed against `apps/ui/src/reader/useReaderSurface.ts`.**

### Unit / component

Scoped runs, `VITEST_MAX_THREADS=4`. `plugins/todos` → **15 files, 351 tests,
all passing** (was 286). New: `itemAnchor.test.ts` (11 — selector framing,
boundary frames, the stale-index refusal, duplicate items told apart by their
frames, thread matching incl. orphaned and partial quotes), `PluginMenu.test.tsx`
(12 — roving focus, disabled items skipped, Escape ahead of the layer behind it,
Tab, outside click, focus restore, viewport clamping), `TodoItemMenu.test.tsx`
(8), `TodoItemComposer.test.tsx` (8 — the wire body asserted field by field),
`TodosColumnMenu.test.tsx` (8 — the column end to end over a **stateful**
transport that really applies the item write), plus 5 `itemTextRange` cases in
`items.test.ts`.

Gates: `eslint plugins/todos apps/ui/e2e/…` clean with `--max-warnings 0` and no
suppressions added; `prettier --check` clean; `tsc --noEmit` clean in both
`plugins/todos` and `apps/ui`.

### The kit-export gap (raise before the next plugin wants a menu)

SPEC.md §11 now says a plugin contributes a menu *"through the plugin kit"*, and
there is no such kit surface. Four things had to be written plugin-side that
core already owns and does not publish:

1. **The menu frame** — `apps/ui/src/menu/`'s `ContextMenuHost` / `ContextMenu` /
   `useRovingMenu` / `MenuItems` / `clampToViewport`. Note this is not a
   re-export job: the host takes `items` as an *element factory* because every
   core action list is built from hooks, and a kit version has to decide whether
   plugins get that shape or a data one.
2. **Escape precedence** — `useEscapeStack` is a module-level registry in
   `apps/ui`. A plugin cannot join it, so this menu wins the key by listening on
   `window` in the capture phase. That works, and it is a trick rather than a
   contract: two plugin menus would have no defined order between them.
3. **The selector builder** — `selectorAt` / `SELECTOR_CONTEXT` (=32) from
   `apps/ui/src/editor/selection.ts`. Duplicated in `ui/itemAnchor.ts` and
   pinned by test; if the constant ever changes in core, plugin-made anchors
   quietly stop matching reader-made ones.
4. **The comment composer** — `CommentPopover`'s shape, keys and the tri-state
   agent toggle, re-typed as `TodoItemComposer`.

A fifth, smaller one: the kit has `usePluginQuery` and no `usePluginMutation`, so
a plugin write is `client.pluginRequest` plus a hand-rolled pending/error state.
This issue avoided a new kit export entirely by returning `refresh()` from
`useTodoLists` (the underlying `refetch`), which needs nothing new — but every
plugin that writes will re-invent the same three lines.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
