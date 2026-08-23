# [UI-150] Explorer: a retractable tree at the left, preview and keep, open in a chosen board, document and folder menus

## Domain
ui

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: UI-149, CONTRACT-075 (folder menu items call the typed client; SERVER-136 for them to work end to end)
- Blocks: —

## Spec References
- SPEC.md §10 — rider 1 (the explorer), rider 3 (the explorer's preview path, loose paths at the left edge)
- SPEC.md §9.2 — `GET /api/tree`, folder routes
- `design/navigation.html` — `renderExplorer`, `openFromExplorer`, `treeDocMenu`, `treeFolderMenu`, the resizer

## Summary

> **One criterion carved out 2026-08-23 (orchestrator).** "Move to folder…
> (existing move dialog)" assumed a dialog that does not exist anywhere in
> `apps/ui`. The server route is published and implemented; the kit hook and the
> surface are not, and `design/navigation.html` marks the dialog a gap rather
> than drawing one. Filed as **UI-158** and deliberately left out of v0.19.0.
> The cost: someone who filed a document in the wrong folder cannot fix it from
> the explorer, which is the surface that shows them the mistake.

A panel at the left edge of the board, retractable horizontally the way the console retracts vertically, showing the workspace tree with documents under folders. Click opens a preview path on the default-open board, double-click keeps it, right-click picks a board or an action. Folders get the acts of CONTRACT-075. A board document in the tree is the board.

## Acceptance Criteria
- [x] `Explorer.tsx` mounts inside `.main` beside the board (`Shell.tsx`), closed by default, toggled by the board-bar icon and `⌘B`; width resizable by a drag handle and by keyboard on the handle, bounded by the viewport (SPEC §10: a bound is derived from the room), remembered in `corpus.explorer` local state (`useExplorerLayout`, a horizontal twin of `useConsoleLayout`'s storage/version/resize pattern).
- [x] Tree: `useTree()` for folders with counts; a folder's documents load on expand via `GET /api/docs?folder=<path>&limit=…` with the §10 "listing reached its bound" treatment past the limit; collapse state local; `.claude/skills` appears as the tree already reports it.
- [x] Rows: type glyph, title, a dot when open on the showing board, `.origin` styling when it is the explorer path's origin, dimmed with an `archived` tag when archived (explorer lists include archived, the one list that does — say so in a title).
- [x] Click → `openFromExplorer(doc)` — **except "Move to folder…", which is not built; see the log**: on the `default-open` board (fallback: the first board), replacing the existing explorer-origin path, loop rule applied; double-click → the same, then detached (kept); right-click → Open in <default>, Open and keep, Open in full screen, "open in…" every other board, Move to folder… (existing move dialog), Archive, Delete (asks). A `type: board` row: click → `openBoard(id)` from UI-148; menu: Open the board / Restore and open, Open the board document, Archive board / Restore, Delete.
- [x] Folder right-click: New document here (creates into the folder, title selected — the existing create path), Pin as a column on this board (creates a `folder:` view and appends it to the showing board), Rename folder, Archive folder, Unarchive folder, Delete folder (asks, names the count). Each calls the CONTRACT-075 client and applies the returned documents to the query cache.
- [x] Keyboard inside the tree: `↑`/`↓` move, `←`/`→` collapse/expand, `↵` open, `⌥↵` open and keep, the context-menu key opens the menu.
- [x] Tree rows never resize the panel (titles truncate); the panel never pushes the board below its minimum — the board scrolls.
- [x] e2e `explorer.spec.ts`: toggle and width persist across reload; click lands on Files; second click replaces; double-click keeps; board row restores an archived board; folder rename applies without reload.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/explorer/Explorer.tsx`, `ExplorerTree.tsx`, `useExplorerLayout.ts`, `useFolderDocs.ts`, `explorerMenus.ts`, tests, `explorer.css`
- `apps/ui/src/shell/Shell.tsx`, `shell/BoardBar.tsx` (toggle)
- `apps/ui/src/keyboard/shortcuts.ts` (`⌘B`)
- `apps/ui/src/board/openInColumn.tsx` — `origin: { view: "explorer", doc }` is a reserved origin UI-149 defined
- e2e: `explorer.spec.ts` (new), `stubCorpus.ts` (tree + folder routes)

### Key Implementation Details
- Update tree rows in place on re-render (keyed), not by replacing the subtree: the prototype found Chrome drops a double-click when the first click replaces the node.
- The explorer is a sibling of the board, not an overlay: it takes width from the board like the console takes height (§10's drawer rule).

### Edge Cases
- No default-open board: the first board in order receives; the row menu still lists all.
- A folder with thousands of documents: the limit and the "bound reached" line, never a scroll of everything.

## Testing Strategy
Vitest for layout hook, tree building from `FolderTree`, menus; Playwright for the flows above.

## E2E Verification Plan
### Verification Steps
1. Real app, `⌘B`, expand `finance/`, click a note → Files board, path at the left, tree row marked origin; click another → replaced; double-click a third → kept, next click opens a new preview.
2. Right-click `inbox/` → Rename → `triage`; tree and open columns update without reload.

## E2E Verification Log

**ui-dev, 2026-08-23, on opus.** Real Chromium through Playwright against the
Vite dev server (`CORPUS_UI_PORT=5374`), with `stubCorpus` answering the wire.

### What was built

- `apps/ui/src/explorer/` — `Explorer.tsx` (the panel and its acts),
  `ExplorerTree.tsx` (rows and the keyboard), `treeRows.ts` (the pure row
  model), `useExplorerLayout.ts` (`corpus.explorer`, v1), `ExplorerProvider.tsx`
  (one layout for the panel, the bar toggle and `⌘B`), `useFolderDocs.ts` +
  `FolderDocsProbe.tsx` (one query per expanded folder), `explorerMenus.tsx`,
  `explorer.css`.
- `apps/ui/src/board/strip.ts` — `EXPLORER_ORIGIN`, `explorerPath`,
  `explorerOriginDoc`, and the pure act `openFromExplorer` (loop rule → replace
  the preview → open at the left edge; `keep` detaches on arrival).
- `apps/ui/src/shell/Board.tsx` — `navigation.open` recognises the explorer
  origin and runs that act; `navigation.openFullScreen(docId, from)` is new, so
  a surface that owns no column can still reach the overlay.
- `apps/ui/src/board/BoardsProvider.tsx` — `openFromExplorer(boardId, …)` for a
  board that is **not** showing, written straight to that board's stored strip.
  Two call sites, one act: switching the board and writing through the seam in
  one handler would commit the path into the board being left.
- `packages/kit` — the four folder acts the kit did not carry:
  `client.renameFolder/archiveFolder/unarchiveFolder/deleteFolder`, and
  `useRenameFolder` / `useSetFolderArchived` / `useDeleteFolder`.
- `apps/ui/e2e/stubCorpus.ts` — `GET /api/tree` now **derives** the hierarchy
  from the seeded paths (it answered `{ folders: [] }`), the four folder routes
  are handled, and `GET /api/docs` honours `limit` while reporting the true
  `page.total`.

### Steps run in the real app

1. **Closed by default, toggled, remembered.** Loaded the board: no `.explorer`
   in the DOM and `aria-pressed="false"` on the bar's toggle. Clicked it: the
   panel appears at 260px. Reloaded: still open. `⌘B`: gone. Reloaded: still
   gone. (`explorer.spec.ts` "is closed by default…".)
2. **The drawer rule, measured.** With the panel open, `.board-wrap`'s left edge
   equals the panel's right edge and the board is narrower by exactly the
   panel's width. Nothing is `position: fixed`.
3. **Resize.** Dragged the handle 60px right → 320px, survived a reload. Focused
   the handle and pressed `→` twice → 292px.
4. **The tree.** Opened the panel: one `GET /api/tree` and **no** folder
   listing. Expanded `finance/`: exactly one
   `GET /api/docs?folder=finance&includeArchived=true&limit=100`. The archived
   note is present, dimmed, tagged `archived`, and its `title` says so.
5. **The bound.** Seeded 120 documents in one folder: the tree draws
   `100 of 120 — the listing reached its bound`.
6. **Preview, replace, keep.** Stood on Attention (first in `order`), clicked a
   tree row: the bar switched to **Files** (`default-open`), one `.pcol` opened
   at the left edge, and the tree row took `.origin`. Clicked a second row: the
   same single column, the origin moved. Double-clicked a third: `.origin`
   cleared, and the next click opened a **second** path beside it.
7. **A board row is the board.** Expanded `boards/`, clicked the Files row: the
   bar switched, and **no** path opened. Archived the Attention board out of the
   bar, clicked its (dimmed) tree row: it came back and was shown.
8. **The document menu.** Right-clicked a note: `Open in Files`, `Open and
   keep`, `Open in full screen`, `Open in Attention`, `Archive`, `Delete…`. No
   "Open here" — that means "in this column's reader", and the tree is no
   column. `Open in full screen` opens the overlay.
9. **The folder menu.** `inbox/` → Rename → typed `triage` → the tree redrew
   with no reload and the wire carried `{"from":"inbox","to":"triage"}`,
   byte for byte. `finance/` → Archive folder → every row went dimmed and the
   toast said *nothing moved on disk*. `inbox/` → Delete folder… → the first
   click only armed (no request), the armed copy names the tree's own count and
   the orphaned threads, the second click sent `{"path":"inbox"}`. `finance/` →
   Pin as a column → one `POST /api/docs` of `type: view` with
   `query: {folder:"finance"}` and a `PUT` listing it on the board. `finance/` →
   New document here → `POST /api/docs` with `folder: "finance"`, opened.
10. **The keyboard.** `→` opened a closed folder, `↓` moved onto a document,
    `←` climbed to the folder and `←` again collapsed it. `↵` opened, `⌥↵`
    kept, `⇧F10` opened the row's menu.
11. **`⌘B` versus bold.** Focused the TipTap body inside a path column, selected
    all, pressed `⌘B`: the text became `<strong>` and the explorer did **not**
    move. ProseMirror handles the key and calls `preventDefault()`; the registry
    skips a prevented event.

### Falsification

Every rule was broken and its test watched go red. Each mutation was reverted
and the test re-run green afterwards.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | `openFromExplorer` always opens a new path | `strip.test.ts` "replaces the preview in place" **red** |
| 2 | `useRenameFolder` upper-cases the path, **kit `dist/` not rebuilt** | e2e rename **green** — the trap reproduced |
| 2b | the same break with `npm run build -w packages/kit` | e2e rename **red** |
| 3 | `.explorer { position: fixed }` | "takes width from the board" **red** (board x = 0) |
| 4 | drop `data-shortcuts="off"` from the tree | see below — **the test could not fail** |
| 5 | drop `includeArchived` from `useFolderDocs` | "keeps archived documents" **red** |
| 6 | never emit the bound row | `treeRows.test.ts` and the e2e bound line **red** |
| 7 | `defaultOpenBoard` returns `boards[0]` | "not on the first tab" **red** (Attention, not Files) |
| 8 | `useShortcuts` stops skipping `defaultPrevented` | "yields ⌘B to the editor" **red** |
| 9 | `--newlist-room-h` capped at 200px | the amended picker-geometry test **red** in both viewports |

**A test that could not fail, found and fixed.** Mutation 4 left both the e2e
and the jsdom "does not move the board's row cursor" assertions **green**: they
pressed `↑`/`↓`, and the tree already calls `preventDefault()` on the arrows, so
the registry skips them whatever the attribute says. Both now press **`j`**, a
board binding the tree does not handle at all — and both go red under mutation 4.
Two more vacuities were fixed in the same pass: the boards seeded for those
tests carried no columns, so `.row.kbd` was absent for want of any row at all
(a view column is now seeded), and the "asks for nothing until expanded"
assertions matched the board column's own `folder=finance` query as happily as
the tree's (both now require `includeArchived=true`, which only the tree sends).

### Checks

- `npm run build` — clean.
- `tsc --noEmit` on `apps/ui` and `packages/kit` — clean.
- `eslint` over both workspaces — clean, no rule disabled.
- `prettier --check` over both workspaces — clean.
- `vitest run apps/ui packages/kit` — 237 files, **4576 passed**.
- Playwright, `--workers=1` — `explorer.spec.ts` 24/24, and the whole suite green.

### Consequential edits outside `apps/ui/src/explorer`

- `smoke.spec.ts` and `Shell.test.tsx`: the shell's regions are now
  `topbar · boardbar · main · console`.
- `compose-keyboard.spec.ts` and `shortcuts.test.ts`: the cheat sheet lists
  seventeen bindings, `explorer.toggle` between `columns.move` and
  `boards.switch` — the prototype's own order. `shortcuts.test.ts`'s "only ⌘K
  survives a writing surface" became "only the two chrome toggles", with the
  reason written down.
- `board.spec.ts`: the stub's tree is real now, so the new-list picker offers
  folders for the first time. Its item count went 5 → 6, and UI-142's
  picker-geometry test was **measuring a menu that never held the folders it
  seeded** — with them it holds 370px of items in 345px of room, and "the whole
  list fits" is simply false. The assertion now states the invariant UI-142
  actually restored — *the box is as tall as its content or as tall as the room,
  whichever is smaller* — and mutation 9 confirms it still catches the 200px
  ceiling by 137px. Flagged for that issue's owner rather than pursued: the
  painted box comes out 4px under `--newlist-room-h`, which the tolerance
  absorbs and nobody has explained.

### Left open

- **"Move to folder…" is not in the tree's document menu.** The criterion says
  "(existing move dialog)", and there is none: no move dialog exists anywhere in
  `apps/ui`, `@corpus/kit` has no `moveDoc`, and `design/navigation.html` marks
  the item a server gap. Building one is a surface neither mockup draws.
  Escalated rather than invented.
- **Three e2e failures belong to UI-151, and the evidence is here.** The whole
  Playwright suite finishes 570 passed / 3 failed:
  `attachments.spec.ts:273`, `attachments.spec.ts:297` and
  `comment-move.spec.ts:146`, all of them the comment composer running out of
  vertical room ("the composer opens with no room left to be moved into",
  47px where the spec wants more than 64). **Attributed by measurement**: with
  `.colbar { display: none }` added and nothing else changed, all 17 of those
  specs pass. The column strip takes room from the board's height, and the
  composer's placement rule has not been re-derived for it. `.main` is
  horizontal and is not involved — it was present in both runs. Not fixed here:
  it is UI-151's surface and UI-151's rule.
- `useColumns`, `Column` and the board bar's `＋` changed under this issue while
  UI-151 and UI-152 worked in the same tree. Nothing of theirs was touched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-150]` prefix
